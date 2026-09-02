import { createHash } from 'crypto';
import { createSteelOcrPdfChunkArtifactModel } from '@librechat/data-schemas';

import { ocrPreprocessingPipelineVersion } from '../memory/service';

import {
  getOcrPageRangeKey,
  normalizeOcrPageChunks,
  type OcrPageRange,
  type OcrPreprocessingPageChunk,
  validateOcrPageSplit,
} from './chunks';

type Mongoose = typeof import('mongoose');

export const ocrPdfChunkArtifactMinimumUrlValiditySeconds: number = 6 * 60 * 60;
const maxCloudFrontPolicyParameterLength = 16 * 1024;

export function getSignedUrlRemainingValiditySeconds(
  filepath: string,
  now: number = Date.now(),
): number | undefined {
  let url: URL;
  try {
    url = new URL(filepath);
  } catch {
    return undefined;
  }

  const parameters = new Map(
    [...url.searchParams.entries()].map(([key, value]) => [key.toLowerCase(), value]),
  );
  const epochSeconds = Number(parameters.get('expires'));
  if (Number.isSafeInteger(epochSeconds) && epochSeconds >= 0) {
    return Math.floor((epochSeconds * 1000 - now) / 1000);
  }

  const expiresInSeconds = Number(parameters.get('x-amz-expires'));
  const amzDate = parameters.get('x-amz-date');
  if (
    amzDate &&
    Number.isSafeInteger(expiresInSeconds) &&
    expiresInSeconds >= 0 &&
    /^\d{8}T\d{6}Z$/u.test(amzDate)
  ) {
    const issuedAt = Date.UTC(
      Number(amzDate.slice(0, 4)),
      Number(amzDate.slice(4, 6)) - 1,
      Number(amzDate.slice(6, 8)),
      Number(amzDate.slice(9, 11)),
      Number(amzDate.slice(11, 13)),
      Number(amzDate.slice(13, 15)),
    );
    const issuedDate = new Date(issuedAt);
    const validIssuedDate =
      Number.isFinite(issuedAt) &&
      issuedDate.getUTCFullYear() === Number(amzDate.slice(0, 4)) &&
      issuedDate.getUTCMonth() === Number(amzDate.slice(4, 6)) - 1 &&
      issuedDate.getUTCDate() === Number(amzDate.slice(6, 8)) &&
      issuedDate.getUTCHours() === Number(amzDate.slice(9, 11)) &&
      issuedDate.getUTCMinutes() === Number(amzDate.slice(11, 13)) &&
      issuedDate.getUTCSeconds() === Number(amzDate.slice(13, 15));
    if (validIssuedDate) {
      return Math.floor((issuedAt + expiresInSeconds * 1000 - now) / 1000);
    }
  }

  const policy = parameters.get('policy');
  if (!policy || policy.length > maxCloudFrontPolicyParameterLength) {
    return undefined;
  }
  const encodedPolicies = [
    policy.replace(/-/gu, '+').replace(/_/gu, '=').replace(/~/gu, '/'),
    policy,
  ];
  for (const encodedPolicy of encodedPolicies) {
    try {
      const policyText = Buffer.from(
        encodedPolicy,
        encodedPolicy === policy ? 'base64url' : 'base64',
      ).toString('utf8');
      if (policyText.length > maxCloudFrontPolicyParameterLength) {
        continue;
      }
      const parsed: unknown = JSON.parse(policyText);
      const expiration = findPolicyEpochTime(parsed);
      if (expiration !== undefined) {
        return Math.floor((expiration * 1000 - now) / 1000);
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export function hasSufficientOcrPdfChunkArtifactUrlValidity(
  filepath: string,
  now: number = Date.now(),
): boolean {
  const remaining = getSignedUrlRemainingValiditySeconds(filepath, now);
  return (
    remaining !== undefined && remaining >= ocrPdfChunkArtifactMinimumUrlValiditySeconds
  );
}

function findPolicyEpochTime(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const policy = value as Record<string, unknown>;
  const statementValue = findObjectValue(policy, 'statement');
  const statements = Array.isArray(statementValue) ? statementValue : [statementValue];
  for (const statement of statements) {
    if (statement === null || typeof statement !== 'object' || Array.isArray(statement)) {
      continue;
    }
    const condition = findObjectValue(statement as Record<string, unknown>, 'condition');
    if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) {
      continue;
    }
    const dateLessThan = findObjectValue(
      condition as Record<string, unknown>,
      'datelessthan',
    );
    if (dateLessThan === null || typeof dateLessThan !== 'object' || Array.isArray(dateLessThan)) {
      continue;
    }
    const epochValue = findObjectValue(
      dateLessThan as Record<string, unknown>,
      'aws:epochtime',
    );
    const epoch = Number(epochValue);
    if (Number.isSafeInteger(epoch) && epoch >= 0) {
      return epoch;
    }
  }
  return undefined;
}

function findObjectValue(object: Record<string, unknown>, normalizedKey: string): unknown {
  for (const [key, value] of Object.entries(object)) {
    if (key.toLowerCase() === normalizedKey) {
      return value;
    }
  }
  return undefined;
}

export interface OcrPdfChunkArtifactRecord extends OcrPreprocessingPageChunk {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
  pipelineVersion: number;
  supersededByRanges?: OcrPageRange[];
  supersededAt?: Date;
  artifact: {
    source: 's3' | 'cloudfront';
    storageKey: string;
    storageRegion?: string;
    filepath: string;
    filename: string;
    bytes: number;
    contentType: 'application/pdf';
  };
}

export interface EnsuredOcrPdfChunkArtifact extends OcrPreprocessingPageChunk {
  sourcePdfKey: string;
  source: 's3' | 'cloudfront';
  storageKey: string;
  storageRegion?: string;
  filepath: string;
  filename: string;
  bytes: number;
  contentType: 'application/pdf';
  artifactOrigin: 'existing' | 'repaired' | 'uploaded';
}

export interface OcrPdfChunkArtifactRepository {
  findBySourcePdfKey(input: {
    sourcePdfKey: string;
    pipelineVersion: number;
    chunkSizePages?: number;
  }): Promise<OcrPdfChunkArtifactRecord[]>;
  upsert(artifact: OcrPdfChunkArtifactRecord): Promise<void>;
  compareAndSetArtifactFilepath(input: {
    sourcePdfKey: string;
    pipelineVersion: number;
    pageStart: number;
    pageEnd: number;
    previousFilepath: string;
    filepath: string;
  }): Promise<string>;
  compareAndSetSupersededByRanges?(input: {
    sourcePdfKey: string;
    pipelineVersion: number;
    parent: OcrPageRange & Pick<OcrPreprocessingPageChunk, 'chunkSizePages'>;
    supersededByRanges: readonly OcrPageRange[];
  }): Promise<'updated' | 'idempotent'>;
}

export function createMongooseOcrPdfChunkArtifactRepository(
  mongoose: Mongoose,
): OcrPdfChunkArtifactRepository {
  const SteelOcrPdfChunkArtifact = createSteelOcrPdfChunkArtifactModel(mongoose);

  return {
    async findBySourcePdfKey({ sourcePdfKey, pipelineVersion }) {
      return await SteelOcrPdfChunkArtifact.find({
        sourcePdfKey,
        pipelineVersion,
      })
        .sort({ pageStart: 1, pageEnd: 1 })
        .lean<OcrPdfChunkArtifactRecord[]>();
    },
    async upsert(artifact) {
      const rangeIdentity = [
        artifact.sourcePdfKey,
        artifact.pipelineVersion,
        artifact.pageStart,
        artifact.pageEnd,
      ];
      const deterministicId = new mongoose.Types.ObjectId(
        createHash('sha256').update(JSON.stringify(rangeIdentity)).digest('hex').slice(0, 24),
      );
      await SteelOcrPdfChunkArtifact.updateOne(
        { _id: deterministicId },
        { $set: artifact },
        { upsert: true },
      );
    },
    async compareAndSetArtifactFilepath({
      sourcePdfKey,
      pipelineVersion,
      pageStart,
      pageEnd,
      previousFilepath,
      filepath,
    }) {
      const result = await SteelOcrPdfChunkArtifact.updateOne(
        {
          sourcePdfKey,
          pipelineVersion,
          pageStart,
          pageEnd,
          'artifact.filepath': previousFilepath,
        },
        {
          $set: {
            'artifact.filepath': filepath,
          },
        },
      );
      const matchedCount = result.matchedCount ?? result.modifiedCount ?? 0;
      if (matchedCount === 1) {
        return filepath;
      }
      const winner = await SteelOcrPdfChunkArtifact.findOne({
        sourcePdfKey,
        pipelineVersion,
        pageStart,
        pageEnd,
      }).lean<OcrPdfChunkArtifactRecord | null>();
      if (!winner) {
        throw new Error(
          `Missing OCR artifact row for ${sourcePdfKey} pages ${pageStart}-${pageEnd}`,
        );
      }
      if (!winner.artifact?.filepath) {
        throw new Error(
          `OCR artifact row has no filepath for ${sourcePdfKey} pages ${pageStart}-${pageEnd}`,
        );
      }
      return winner.artifact.filepath;
    },
    async compareAndSetSupersededByRanges({
      sourcePdfKey,
      pipelineVersion,
      parent,
      supersededByRanges,
    }) {
      const existingRows = await SteelOcrPdfChunkArtifact.find({
        sourcePdfKey,
        pipelineVersion,
        pageStart: parent.pageStart,
        pageEnd: parent.pageEnd,
      })
        .limit(2)
        .lean<Array<OcrPdfChunkArtifactRecord & { _id: unknown }>>();
      if (existingRows.length !== 1) {
        throw new Error(
          `${existingRows.length === 0 ? 'Missing' : 'Duplicate'} OCR parent artifact row for ${parent.pageStart}-${parent.pageEnd}`,
        );
      }
      const existing = existingRows[0]!;
      const expected = validateOcrPageSplit({
        parent: existing.supersededByRanges ? existing : parent,
        children: supersededByRanges,
      });
      if (existing.supersededByRanges) {
        const current = normalizeOcrPageChunks(existing.supersededByRanges).map(
          ({ pageStart, pageEnd }) => ({ pageStart, pageEnd }),
        );
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          throw new Error(
            `Conflicting OCR split marker for ${parent.pageStart}-${parent.pageEnd}`,
          );
        }
        return 'idempotent';
      }
      const result = await SteelOcrPdfChunkArtifact.updateOne(
        {
          _id: existing._id,
          supersededByRanges: { $exists: false },
        },
        {
          $set: {
            chunkSizePages: parent.chunkSizePages,
            supersededByRanges: expected,
            supersededAt: new Date(),
          },
        },
      );
      if (result.modifiedCount === 1) {
        return 'updated';
      }
      const raced = await SteelOcrPdfChunkArtifact.findOne({
        _id: existing._id,
      }).lean<OcrPdfChunkArtifactRecord | null>();
      if (
        raced?.supersededByRanges &&
        JSON.stringify(
          normalizeOcrPageChunks(raced.supersededByRanges).map(({ pageStart, pageEnd }) => ({
            pageStart,
            pageEnd,
          })),
        ) === JSON.stringify(expected)
      ) {
        return 'idempotent';
      }
      throw new Error(`Conflicting OCR split marker for ${parent.pageStart}-${parent.pageEnd}`);
    },
  };
}

export function resolveCanonicalOcrPageChunks(input: {
  defaultChunks: readonly OcrPreprocessingPageChunk[];
  artifactRows: readonly OcrPdfChunkArtifactRecord[];
}): OcrPreprocessingPageChunk[] {
  let chunks = normalizeOcrPageChunks(input.defaultChunks);
  const rowsByRange = new Map<string, OcrPdfChunkArtifactRecord>();
  for (const row of input.artifactRows) {
    const key = getOcrPageRangeKey(row);
    if (row.supersededByRanges) {
      validateOcrPageSplit({ parent: row, children: row.supersededByRanges });
    }
    const existing = rowsByRange.get(key);
    if (existing) {
      throw new Error(`Duplicate OCR artifact rows for ${row.pageStart}-${row.pageEnd}`);
    }
    rowsByRange.set(key, row);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const next: OcrPreprocessingPageChunk[] = [];
    for (const chunk of chunks) {
      const row = rowsByRange.get(getOcrPageRangeKey(chunk));
      if (!row?.supersededByRanges) {
        next.push(chunk);
        continue;
      }
      const children = validateOcrPageSplit({
        parent: row,
        children: row.supersededByRanges,
      });
      const childChunkSizePages = (row.chunkSizePages ?? getOcrPageRangePageCount(row)) / 2;
      next.push(
        ...children.map((child, index) => ({
          ...child,
          chunkIndex: index + 1,
          chunkCount: children.length,
          chunkSizePages: childChunkSizePages,
        })),
      );
      changed = true;
    }
    chunks = normalizeOcrPageChunks(next);
  }
  return chunks;
}

export interface OcrPdfChunkArtifactStorage {
  source: 's3' | 'cloudfront';
  exists(input: { storageKey: string }): Promise<boolean>;
  saveBuffer(input: {
    storageKey: string;
    filename: string;
    bytes: Uint8Array;
    contentType: 'application/pdf';
  }): Promise<{ bytes: number; storageRegion?: string }>;
  getDownloadUrl(input: { storageKey: string }): Promise<string>;
}

export interface EnsurePdfChunkArtifactsInput {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
  chunks: readonly OcrPreprocessingPageChunk[];
  repository: OcrPdfChunkArtifactRepository;
  storage: OcrPdfChunkArtifactStorage;
  createPdfChunk(input: { chunk: OcrPreprocessingPageChunk }): Promise<Uint8Array>;
  now?: number;
}

export interface LoadExistingPdfChunkArtifactsInput {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  sourceFileId?: string;
  pageRanges: readonly OcrPageRange[];
  repository: OcrPdfChunkArtifactRepository;
  storage: OcrPdfChunkArtifactStorage;
  now?: number;
}

export interface CommitOcrPdfChunkSplitInput extends EnsurePdfChunkArtifactsInput {
  parent: OcrPageRange & Pick<OcrPreprocessingPageChunk, 'chunkSizePages'>;
  children: readonly OcrPageRange[];
}

export function buildOcrPdfChunkArtifactStorageKey(input: {
  sourcePdfKey: string;
  pipelineVersion?: number;
  chunk: Pick<OcrPreprocessingPageChunk, 'pageStart' | 'pageEnd'>;
}): string {
  const pipelineVersion = input.pipelineVersion ?? ocrPreprocessingPipelineVersion;
  const sourceHash = createHash('sha256').update(input.sourcePdfKey).digest('hex');
  const pageStart = String(input.chunk.pageStart).padStart(6, '0');
  const pageEnd = String(input.chunk.pageEnd).padStart(6, '0');

  return `ocr-preprocessing/${sourceHash}/v${pipelineVersion}/pages-${pageStart}-${pageEnd}.pdf`;
}

function getCanonicalArtifactStorageKey(storageKey: string): string {
  const hasControlCharacter = [...storageKey].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  const invalid =
    storageKey === '' ||
    storageKey.trim() !== storageKey ||
    /^https?:\/\//iu.test(storageKey) ||
    storageKey.startsWith('/') ||
    storageKey.includes('\\') ||
    hasControlCharacter;
  const segments = storageKey.split('/');
  if (
    invalid ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('OCR artifact storage key is invalid');
  }
  return storageKey;
}

function isArtifactUrlBoundToStorageKey(filepath: string, storageKey: string): boolean {
  let url: URL;
  try {
    url = new URL(filepath);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    return false;
  }
  const pathKey = pathname.slice(1);
  try {
    return getCanonicalArtifactStorageKey(pathKey) === storageKey;
  } catch {
    return false;
  }
}

export function isUsableOcrPdfChunkArtifactUrl(
  filepath: string,
  storageKey: string,
  now?: number,
): boolean {
  return (
    isArtifactUrlBoundToStorageKey(filepath, storageKey) &&
    hasSufficientOcrPdfChunkArtifactUrlValidity(filepath, now)
  );
}

export async function loadExistingPdfChunkArtifacts(
  input: LoadExistingPdfChunkArtifactsInput,
): Promise<EnsuredOcrPdfChunkArtifact[]> {
  const pipelineVersion = ocrPreprocessingPipelineVersion;
  const rows = (
    await input.repository.findBySourcePdfKey({
      sourcePdfKey: input.sourcePdfKey,
      pipelineVersion,
    })
  ).filter(
    (row) => row.sourcePdfKey === input.sourcePdfKey && row.pipelineVersion === pipelineVersion,
  );
  if (rows.length === 0) {
    throw new Error(`Missing OCR artifact rows for ${input.sourcePdfKey}`);
  }
  const rowsByRange = new Map<string, OcrPdfChunkArtifactRecord>();
  for (const row of rows) {
    const key = getOcrPageRangeKey(row);
    if (rowsByRange.has(key)) {
      throw new Error(`Duplicate OCR artifact rows for ${key}`);
    }
    rowsByRange.set(key, row);
  }
  const requestedRanges = input.pageRanges.map(({ pageStart, pageEnd }) => ({
    pageStart,
    pageEnd,
  }));
  if (requestedRanges.length === 0) {
    throw new Error('delegate_ocr PDF pageRanges must be non-empty');
  }
  let previousRange: OcrPageRange | undefined;
  const maxPageEnd = Math.max(...rows.map((row) => row.pageEnd));
  for (const range of requestedRanges) {
    if (
      !Number.isInteger(range.pageStart) ||
      !Number.isInteger(range.pageEnd) ||
      range.pageStart < 1 ||
      range.pageEnd < range.pageStart ||
      range.pageEnd > maxPageEnd
    ) {
      throw new Error(`Invalid OCR artifact page range ${range.pageStart}-${range.pageEnd}`);
    }
    if (previousRange && range.pageStart <= previousRange.pageEnd) {
      throw new Error('delegate_ocr PDF pageRanges must be sorted and non-overlapping');
    }
    previousRange = range;
  }

  const expandRange = (
    range: OcrPageRange,
    ancestors: ReadonlySet<string>,
    depth: number,
  ): OcrPdfChunkArtifactRecord[] => {
    if (depth > rows.length) {
      throw new Error(`OCR artifact split depth exceeded for ${getOcrPageRangeKey(range)}`);
    }
    const key = getOcrPageRangeKey(range);
    if (ancestors.has(key)) {
      throw new Error(`OCR artifact split cycle for ${key}`);
    }
    const row = rowsByRange.get(key);
    if (!row) {
      throw new Error(`Missing OCR artifact row for ${key}`);
    }
    if (row.sourceFileId && input.sourceFileId && row.sourceFileId !== input.sourceFileId) {
      throw new Error(`OCR artifact file owner mismatch for ${key}`);
    }
    if (
      row.sourceStorageKey &&
      input.sourceStorageKey &&
      row.sourceStorageKey !== input.sourceStorageKey
    ) {
      throw new Error(`OCR artifact storage owner mismatch for ${key}`);
    }
    if (!row.supersededByRanges) {
      return [row];
    }
    const children = validateOcrPageSplit({ parent: row, children: row.supersededByRanges });
    const nextAncestors = new Set(ancestors).add(key);
    return children.flatMap((child) => expandRange(child, nextAncestors, depth + 1));
  };
  const leaves = requestedRanges.flatMap((range) => expandRange(range, new Set(), 0));
  const artifacts: EnsuredOcrPdfChunkArtifact[] = [];
  for (let index = 0; index < leaves.length; index += 1) {
    const row = leaves[index]!;
    if (row.artifact.source !== input.storage.source) {
      throw new Error(`OCR artifact storage source mismatch for ${getOcrPageRangeKey(row)}`);
    }
    const storageKey = getCanonicalArtifactStorageKey(row.artifact.storageKey);
    if (!(await input.storage.exists({ storageKey }))) {
      throw new Error(`OCR artifact object is missing for ${getOcrPageRangeKey(row)}`);
    }
    let filepath = row.artifact.filepath;
    if (!isUsableOcrPdfChunkArtifactUrl(filepath, storageKey, input.now)) {
      const refreshed = await input.storage.getDownloadUrl({ storageKey });
      if (!isUsableOcrPdfChunkArtifactUrl(refreshed, storageKey, input.now)) {
        throw new Error(`OCR artifact signer returned an invalid URL for ${getOcrPageRangeKey(row)}`);
      }
      filepath = await input.repository.compareAndSetArtifactFilepath({
        sourcePdfKey: row.sourcePdfKey,
        pipelineVersion,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        previousFilepath: row.artifact.filepath,
        filepath: refreshed,
      });
      if (!isUsableOcrPdfChunkArtifactUrl(filepath, storageKey, input.now)) {
        throw new Error(`OCR artifact URL is invalid for ${getOcrPageRangeKey(row)}`);
      }
    }
    artifacts.push({
      sourcePdfKey: row.sourcePdfKey,
      chunkIndex: index + 1,
      chunkCount: leaves.length,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      chunkSizePages: row.chunkSizePages,
      source: row.artifact.source,
      storageKey,
      storageRegion: row.artifact.storageRegion,
      filepath,
      filename: row.artifact.filename,
      bytes: row.artifact.bytes,
      contentType: row.artifact.contentType,
      artifactOrigin: 'existing',
    });
  }
  return artifacts;
}

export async function ensurePdfChunkArtifacts(
  input: EnsurePdfChunkArtifactsInput,
): Promise<EnsuredOcrPdfChunkArtifact[]> {
  const pipelineVersion = ocrPreprocessingPipelineVersion;
  const existingRows = await input.repository.findBySourcePdfKey({
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion,
  });
  const chunks = resolveCanonicalOcrPageChunks({
    defaultChunks: input.chunks,
    artifactRows: existingRows,
  });
  const existingByIdentity = new Map(
    existingRows.map((row) => [
      getOcrPageRangeKey(row),
      row,
    ]),
  );
  const artifacts: EnsuredOcrPdfChunkArtifact[] = [];

  for (const chunk of chunks) {
    const existing = existingByIdentity.get(getOcrPageRangeKey(chunk));
    if (existing) {
      const existingObjectIsPresent = await input.storage.exists({
        storageKey: existing.artifact.storageKey,
      });
      if (existingObjectIsPresent) {
        if (
          hasSufficientOcrPdfChunkArtifactUrlValidity(
            existing.artifact.filepath,
            input.now,
          )
        ) {
          artifacts.push({
            sourcePdfKey: existing.sourcePdfKey,
            chunkIndex: chunk.chunkIndex,
            chunkCount: chunk.chunkCount,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            chunkSizePages: chunk.chunkSizePages,
            source: existing.artifact.source,
            storageKey: existing.artifact.storageKey,
            storageRegion: existing.artifact.storageRegion,
            filepath: existing.artifact.filepath,
            filename: existing.artifact.filename,
            bytes: existing.artifact.bytes,
            contentType: existing.artifact.contentType,
            artifactOrigin: 'existing',
          });
          continue;
        }
        const filepath = await input.storage.getDownloadUrl({
          storageKey: existing.artifact.storageKey,
        });
        const persistedFilepath = await input.repository.compareAndSetArtifactFilepath({
          sourcePdfKey: existing.sourcePdfKey,
          pipelineVersion: existing.pipelineVersion,
          pageStart: existing.pageStart,
          pageEnd: existing.pageEnd,
          previousFilepath: existing.artifact.filepath,
          filepath,
        });
        artifacts.push({
          sourcePdfKey: existing.sourcePdfKey,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          chunkSizePages: chunk.chunkSizePages,
          source: existing.artifact.source,
          storageKey: existing.artifact.storageKey,
          storageRegion: existing.artifact.storageRegion,
          filepath: persistedFilepath,
          filename: existing.artifact.filename,
          bytes: existing.artifact.bytes,
          contentType: existing.artifact.contentType,
          artifactOrigin: 'existing',
        });
        continue;
      }
    }

    const storageKey =
      existing?.artifact.storageKey ??
      buildOcrPdfChunkArtifactStorageKey({
        sourcePdfKey: input.sourcePdfKey,
        pipelineVersion,
        chunk,
      });
    const filename = existing?.artifact.filename ?? buildChunkFilename(input.sourceFilename, chunk);
    const objectExists = existing ? false : await input.storage.exists({ storageKey });
    const chunkBytes = objectExists ? undefined : await input.createPdfChunk({ chunk });
    const saved = objectExists
      ? { bytes: 0, storageRegion: undefined }
      : await input.storage.saveBuffer({
          storageKey,
          filename,
          bytes: chunkBytes ?? new Uint8Array(),
          contentType: 'application/pdf',
        });
    const filepath = await input.storage.getDownloadUrl({ storageKey });
    const artifact: OcrPdfChunkArtifactRecord = {
      sourcePdfKey: input.sourcePdfKey,
      sourceStorageKey: input.sourceStorageKey,
      sourceFileId: input.sourceFileId,
      sourceFilename: input.sourceFilename,
      sourceBytes: input.sourceBytes,
      pipelineVersion,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages,
      artifact: {
        source: input.storage.source,
        storageKey,
        storageRegion: saved.storageRegion,
        filepath,
        filename,
        bytes: saved.bytes,
        contentType: 'application/pdf',
      },
    };

    await input.repository.upsert(artifact);
    artifacts.push({
      sourcePdfKey: artifact.sourcePdfKey,
      chunkIndex: artifact.chunkIndex,
      chunkCount: artifact.chunkCount,
      pageStart: artifact.pageStart,
      pageEnd: artifact.pageEnd,
      chunkSizePages: artifact.chunkSizePages,
      source: artifact.artifact.source,
      storageKey: artifact.artifact.storageKey,
      storageRegion: artifact.artifact.storageRegion,
      filepath: artifact.artifact.filepath,
      filename: artifact.artifact.filename,
      bytes: artifact.artifact.bytes,
      contentType: artifact.artifact.contentType,
      artifactOrigin: objectExists ? 'repaired' : 'uploaded',
    });
  }

  return artifacts.sort((left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd);
}

export async function commitOcrPdfChunkSplit(
  input: CommitOcrPdfChunkSplitInput,
): Promise<EnsuredOcrPdfChunkArtifact[]> {
  const children = validateOcrPageSplit({
    parent: input.parent,
    children: input.children,
  });
  const artifacts = await ensurePdfChunkArtifacts({
    ...input,
    chunks: input.chunks,
  });
  const childKeys = new Set(children.map(getOcrPageRangeKey));
  const childArtifacts = artifacts.filter((artifact) => childKeys.has(getOcrPageRangeKey(artifact)));
  if (childArtifacts.length !== children.length) {
    throw new Error('OCR split child artifacts could not be addressed after upload');
  }
  if (!input.repository.compareAndSetSupersededByRanges) {
    throw new Error('OCR artifact repository cannot commit split markers');
  }
  await input.repository.compareAndSetSupersededByRanges({
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion: ocrPreprocessingPipelineVersion,
    parent: input.parent,
    supersededByRanges: children,
  });
  return artifacts;
}

function buildChunkFilename(
  sourceFilename: string | undefined,
  chunk: Pick<OcrPreprocessingPageChunk, 'pageStart' | 'pageEnd'>,
): string {
  const baseName = sourceFilename?.replace(/\.pdf$/iu, '') || 'document';
  const pageStart = String(chunk.pageStart).padStart(6, '0');
  const pageEnd = String(chunk.pageEnd).padStart(6, '0');

  return `${baseName}.pages-${pageStart}-${pageEnd}.pdf`;
}
