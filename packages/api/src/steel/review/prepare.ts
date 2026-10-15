import { createHash } from 'node:crypto';
import { SteelReviewWriteError } from '@librechat/data-schemas';
import {
  applySteelReviewOperations,
  encodeSteelReviewDigest,
  isSteelReviewSourceAssociationHeader,
  normalizeSteelReviewLedgerRows,
  sameSteelReviewSource,
  steelReviewOperationCommitSchema,
  steelReviewOperationPrepareSchema,
  validateSteelReviewLedger,
} from 'librechat-data-provider';
import type {
  SteelReviewKind,
  SteelReviewRow,
  SteelReviewPrepare,
  SteelReviewPrepared,
  SteelReviewOperationPrepare,
  SteelReviewOperationCommit,
  SteelReviewLedgerRow,
  SteelReviewCommit,
  SteelReviewConflict,
  SteelReviewRecovery,
  SteelReviewSourceIntent,
} from 'librechat-data-provider';
import type {
  SteelReviewCommitInput,
  SteelReviewCommitResult,
  SteelReviewReadInput,
  SteelReviewReadRecord,
} from '@librechat/data-schemas';
import type { SteelReviewCatalogService } from '../catalog';
import type { ServerRequest } from '~/types/http';
import { SteelReviewCatalogError, steelCatalogCustomerEvidenceForSnapshot } from '../catalog';
import { reconcileSteelReviewOcrLinks } from './ocr';
import { sha256Hex } from '../utils';

import type { LocatedTable } from './projection';
import {
  collectTables,
  sameCellProperty,
  createRecordBaselineRows,
  fullMessageText,
  findVerifiedSaveTarget,
  serializeReviewTable,
  isValidSystemOrderCellValue,
  quoteProjection,
  countCustomerQuoteChangedRows,
  replaceOwnerTarget,
  sourceHeader,
  nextHumanSourceCode,
  uniqueSourceMappings,
  rowWithSource,
  throwLedgerValidationFailure,
} from './projection';
import { SteelReviewReadError } from './errors';
import type {
  SteelReviewReader,
  SteelReviewSourceAuthority,
  SteelReviewSourceIntentInput,
} from '../review';

export type SteelReviewPrepareInput = SteelReviewOperationPrepare &
  SteelReviewReadInput & { sourceRequest?: ServerRequest };
export type SteelReviewCommitRequest = SteelReviewOperationCommit &
  SteelReviewReadInput & {
    sourceRequest?: ServerRequest;
  };
export type SteelReviewInternalPrepare = {
  conversationId: string;
  messageId: string;
  tableId: string;
  partIndex?: number;
  kind: SteelReviewKind;
  outputId: string;
  revision: string;
  title: string;
  rows: SteelReviewRow[];
  sourceIntents?: SteelReviewSourceIntent[];
  selectionEvidence?: SteelReviewCommitInput['selectionEvidence'];
};
export type SteelReviewTrustedProjection = Omit<SteelReviewCommitInput, 'digest'> & {
  digest: string;
  requestDigest?: string;
  operationRequest?: SteelReviewOperationPrepare;
};

export type SteelReviewSourceMetadata = {
  fileId: string;
  filename: string;
  mediaType: string;
  pageCount?: number;
};

export interface SteelReviewSourceEvidence {
  metadataByFile: Map<string, SteelReviewSourceMetadata | null>;
  pageCountsByFile: Map<string, { pageCount: number } | null>;
}

export function isOperationCommit(
  payload: SteelReviewCommit,
): payload is SteelReviewOperationCommit {
  return Object.prototype.hasOwnProperty.call(payload, 'operations');
}

const operationIdentityKeys = new Set([
  'conversationId',
  'messageId',
  'title',
  'kind',
  'outputId',
  'revision',
  'operations',
  // These are injected by the authenticated route/service boundary, never by
  // the browser operation DTO.
  'userId',
  'tenantId',
  'sourceRequest',
]);

function assertOperationKeys(input: object, commit: boolean): void {
  const allowed = new Set(operationIdentityKeys);
  if (commit) {
    allowed.add('operationId');
    allowed.add('digest');
  }
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
  }
}

export interface SteelReviewPreparer {
  parsePreparePayload(input: SteelReviewPrepareInput): SteelReviewPrepare;
  parseCommitPayload(input: SteelReviewCommitRequest): SteelReviewCommit;
  operationRequestDigest(
    payload: SteelReviewOperationPrepare,
    scope: Pick<SteelReviewReadInput, 'userId' | 'tenantId'>,
  ): string;
  operationPreparedFromReceipt(
    payload: SteelReviewOperationCommit,
    result: SteelReviewCommitResult,
  ): SteelReviewPrepared;
  loadSourceEvidence(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewOperationPrepare,
  ): Promise<SteelReviewSourceEvidence>;
  buildTrustedOperationPrepared(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewOperationPrepare,
    operationId: string,
    trustedRecord?: SteelReviewReadRecord,
    sourceEvidence?: SteelReviewSourceEvidence,
  ): Promise<SteelReviewTrustedProjection>;
  projectPrepared(
    payload: SteelReviewOperationPrepare,
    prepared: SteelReviewTrustedProjection,
  ): SteelReviewPrepared;
}

/** Builds and verifies trusted review prepare projections from client operations. */
export function createSteelReviewPreparer({
  reader,
  sourceAuthority,
  catalogService,
}: {
  reader: SteelReviewReader;
  sourceAuthority?: SteelReviewSourceAuthority;
  catalogService?: SteelReviewCatalogService;
}): SteelReviewPreparer {
  function parsePreparePayload(input: SteelReviewPrepareInput): SteelReviewPrepare {
    assertOperationKeys(input, false);
    const operationInput = input as SteelReviewOperationPrepare;
    const parsed = steelReviewOperationPrepareSchema.safeParse({
      conversationId: operationInput.conversationId,
      messageId: operationInput.messageId,
      title: operationInput.title,
      kind: operationInput.kind,
      outputId: operationInput.outputId,
      revision: operationInput.revision,
      operations: operationInput.operations,
    });
    if (!parsed.success) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
    }
    return parsed.data;
  }

  function parseCommitPayload(input: SteelReviewCommitRequest): SteelReviewCommit {
    assertOperationKeys(input, true);
    const operationInput = input as SteelReviewOperationCommit;
    const parsed = steelReviewOperationCommitSchema.safeParse({
      conversationId: operationInput.conversationId,
      messageId: operationInput.messageId,
      title: operationInput.title,
      kind: operationInput.kind,
      outputId: operationInput.outputId,
      revision: operationInput.revision,
      operations: operationInput.operations,
      operationId: operationInput.operationId,
      digest: operationInput.digest,
    });
    if (!parsed.success) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Invalid review operation');
    }
    return parsed.data;
  }

  function operationRequestDigest(
    payload: SteelReviewOperationPrepare,
    scope: Pick<SteelReviewReadInput, 'userId' | 'tenantId'>,
  ): string {
    return createHash('sha256')
      .update(
        encodeSteelReviewDigest({
          userId: scope.userId,
          tenantId: scope.tenantId ?? null,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          kind: payload.kind,
          title: payload.title,
          outputId: payload.outputId,
          revision: payload.revision,
          operationId: '',
          operations: payload.operations,
        }),
      )
      .digest('hex');
  }

  function operationIntentDigest(
    payload: SteelReviewOperationPrepare,
    operationId: string,
    scope: Pick<SteelReviewReadInput, 'userId' | 'tenantId'>,
    selectionEvidence?: SteelReviewCommitInput['selectionEvidence'],
  ): string {
    return createHash('sha256')
      .update(
        encodeSteelReviewDigest({
          userId: scope.userId,
          tenantId: scope.tenantId ?? null,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          kind: payload.kind,
          title: payload.title,
          outputId: payload.outputId,
          revision: payload.revision,
          operationId,
          operations: payload.operations,
          ...(selectionEvidence ? { selectionEvidence } : {}),
        }),
      )
      .digest('hex');
  }

  function operationPreparedFromReceipt(
    payload: SteelReviewOperationCommit,
    result: SteelReviewCommitResult,
  ): SteelReviewPrepared {
    const snapshot = result.snapshot;
    if (
      !snapshot ||
      !snapshot.target ||
      snapshot.targetText === undefined ||
      snapshot.replacementText === undefined ||
      snapshot.cleanReplacementText === undefined ||
      !snapshot.caption ||
      snapshot.requestDigest === undefined
    ) {
      throw new SteelReviewWriteError(
        'REVIEW_CONFLICT',
        'Review operation receipt snapshot is incomplete',
      );
    }
    const { operationId: _operationId, digest: _digest, ...operationRequest } = payload;
    return {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      title: payload.title,
      kind: payload.kind,
      outputId: snapshot.outputId,
      revision: snapshot.revision,
      headers: snapshot.headers,
      operationId: result.operationId,
      digest: result.digest,
      messageSha256: snapshot.messageSha256,
      target: snapshot.target,
      targetText: snapshot.targetText,
      replacementText: snapshot.replacementText,
      cleanReplacementText: snapshot.cleanReplacementText,
      rows: snapshot.rows,
      effectiveMarkdown: snapshot.effectiveMarkdown,
      displayMarkdown: snapshot.displayMarkdown,
      ...(snapshot.aiBaselineMarkdown ? { aiBaselineMarkdown: snapshot.aiBaselineMarkdown } : {}),
      ...(snapshot.aiRawMarkdown ? { aiRawMarkdown: snapshot.aiRawMarkdown } : {}),
      sourceMappings: snapshot.sourceMappings ?? [],
      ...(snapshot.selectionEvidence ? { selectionEvidence: snapshot.selectionEvidence } : {}),
      caption: snapshot.caption,
      operations: payload.operations,
      operationRequest,
      requestDigest: snapshot.requestDigest,
    } as SteelReviewPrepared;
  }

  function operationExpectedRows(
    record: SteelReviewReadRecord,
    payload: SteelReviewOperationPrepare,
    target: LocatedTable,
    currentRows: SteelReviewLedgerRow[],
  ): SteelReviewLedgerRow[] | undefined {
    if (record.revision === payload.revision) {
      return currentRows.map((row) => ({ ...row, values: { ...row.values } }));
    }
    const matchingSnapshots = (record.receipts ?? [])
      .filter((receipt) => receipt.revision === payload.revision && receipt.snapshot)
      .flatMap((receipt) => (receipt.snapshot ? [receipt.snapshot] : []))
      .filter(
        (snapshot) =>
          snapshot.outputId === record.outputId &&
          JSON.stringify(snapshot.headers) === JSON.stringify(target.headers),
      );
    if (matchingSnapshots.length === 1) {
      return normalizeSteelReviewLedgerRows(matchingSnapshots[0].rows);
    }
    if (matchingSnapshots.length > 1) {
      return undefined;
    }
    const initialOutputId = `ocr_result:${payload.revision}`;
    const isInitialOcrRevision =
      record.kind === 'ocr_result' && record.outputId === initialOutputId;
    const isSystemOrderBaseline =
      record.kind === 'system_order' &&
      record.aiBaselineMarkdown !== undefined &&
      sha256Hex(record.aiBaselineMarkdown) === payload.revision;
    if (!isInitialOcrRevision && !isSystemOrderBaseline) {
      return undefined;
    }
    const initialMarkdown = record.aiBaselineMarkdown ?? record.markdown;
    if (!initialMarkdown) {
      return undefined;
    }
    const initialTables = collectTables(initialMarkdown).filter(
      (candidate) =>
        candidate.title === payload.title &&
        candidate.title === target.title &&
        JSON.stringify(candidate.headers) === JSON.stringify(target.headers),
    );
    if (initialTables.length !== 1) {
      return undefined;
    }
    return normalizeSteelReviewLedgerRows(createRecordBaselineRows(record, initialTables[0]));
  }

  function operationRecovery(
    record: SteelReviewReadRecord,
    payload: SteelReviewOperationPrepare,
    target: LocatedTable,
    currentRows: readonly SteelReviewLedgerRow[],
    conflicts: readonly SteelReviewConflict[],
  ): SteelReviewRecovery {
    const latestOutputId = record.latestOutputId ?? record.outputId;
    const catalogCustomer = steelCatalogCustomerEvidenceForSnapshot(record.customerSnapshot);
    return {
      table: {
        conversationId: record.conversationId,
        messageId: record.messageId,
        title: record.title ?? payload.title,
        outputId: record.outputId,
        kind: record.kind,
        revision: record.revision,
        latestOutputId,
        isLatest: record.state === 'current' && latestOutputId === record.outputId,
        readOnly: record.state !== 'current' || latestOutputId !== record.outputId,
        headers: target.headers,
        rows: [...currentRows],
        effectiveMarkdown:
          record.effectiveMarkdown ?? record.humanMarkdown ?? record.markdown ?? '',
        ...(record.humanSavedAt ? { humanSavedAt: record.humanSavedAt.toISOString() } : {}),
        ...(record.aiRawMarkdown ? { aiRawMarkdown: record.aiRawMarkdown } : {}),
        ...(record.aiBaselineMarkdown ? { aiBaselineMarkdown: record.aiBaselineMarkdown } : {}),
        ...(record.sourceMappings ? { sourceMappings: record.sourceMappings } : {}),
        ...(record.kind === 'system_order' && record.ocrContext
          ? { ocrContext: record.ocrContext }
          : {}),
        ...(catalogCustomer ? { catalogCustomer } : {}),
      },
      conflicts: [...conflicts],
    };
  }

  async function loadSourceEvidence(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewOperationPrepare,
  ): Promise<SteelReviewSourceEvidence> {
    const metadataByFile = new Map<string, SteelReviewSourceMetadata | null>();
    const pageCountsByFile = new Map<string, { pageCount: number } | null>();
    if (!sourceAuthority) {
      return { metadataByFile, pageCountsByFile };
    }
    const sourceInputs = new Map<string, SteelReviewSourceIntentInput>();
    for (const operation of payload.operations) {
      const source =
        operation.type === 'add' || operation.type === 'update' ? operation.source : undefined;
      if (!source || source.fileId === null || sourceInputs.has(source.fileId)) {
        continue;
      }
      sourceInputs.set(source.fileId, {
        userId: scope.userId,
        ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
        conversationId: scope.conversationId,
        messageId: payload.messageId,
        kind: payload.kind,
        fileId: source.fileId,
      });
    }
    const metadataResults = await Promise.all(
      [...sourceInputs.entries()].map(
        async ([fileId, sourceInput]) =>
          [fileId, await sourceAuthority.readMetadata(sourceInput)] as const,
      ),
    );
    for (const [fileId, metadata] of metadataResults) {
      metadataByFile.set(fileId, metadata);
      if (metadata?.pageCount !== undefined) {
        pageCountsByFile.set(fileId, { pageCount: metadata.pageCount });
      }
    }
    if (!scope.sourceRequest) {
      return { metadataByFile, pageCountsByFile };
    }
    const pageInputs = [...sourceInputs.entries()].filter(([fileId]) => {
      const metadata = metadataByFile.get(fileId);
      return (
        metadata !== null &&
        metadata !== undefined &&
        metadata.pageCount === undefined &&
        !metadata.mediaType.toLowerCase().startsWith('image/') &&
        payload.operations.some((operation) => {
          const source =
            operation.type === 'add' || operation.type === 'update' ? operation.source : undefined;
          return (
            source?.fileId === fileId &&
            source.pageNumber !== null &&
            source.pageNumber !== undefined
          );
        })
      );
    });
    const pageResults = await Promise.all(
      pageInputs.map(
        async ([fileId, sourceInput]) =>
          [fileId, await sourceAuthority.readPageCount(sourceInput, scope.sourceRequest!)] as const,
      ),
    );
    for (const [fileId, pageCount] of pageResults) {
      pageCountsByFile.set(fileId, pageCount);
    }
    return { metadataByFile, pageCountsByFile };
  }

  async function buildTrustedOperationPrepared(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewOperationPrepare,
    operationId: string,
    trustedRecord?: SteelReviewReadRecord,
    sourceEvidence?: SteelReviewSourceEvidence,
  ): Promise<SteelReviewTrustedProjection> {
    const record = trustedRecord ?? (await reader.readSteelReview(scope));
    if (
      !record ||
      record.state !== 'current' ||
      (record.latestOutputId ?? record.outputId) !== record.outputId ||
      record.outputId !== payload.outputId
    ) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table is no longer current');
    }
    if (record.title !== payload.title) {
      throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review title authority changed');
    }
    const target = findVerifiedSaveTarget(record, record.tableId, payload.title);
    if (!target) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
    }
    const currentRows = normalizeSteelReviewLedgerRows(
      record.rows ?? createRecordBaselineRows(record, target),
    );
    const headers = record.headers ?? target.headers;
    const expectedRows = operationExpectedRows(record, payload, target, currentRows);
    if (!expectedRows) {
      throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review expected version is unavailable');
    }
    const materialCandidates = new Map<
      string,
      NonNullable<Awaited<ReturnType<SteelReviewCatalogService['resolve']>>>['candidate']
    >();
    const processingCandidates = new Map<
      string,
      NonNullable<Awaited<ReturnType<SteelReviewCatalogService['resolve']>>>['candidate']
    >();
    const selectionEvidence: NonNullable<SteelReviewCommitInput['selectionEvidence']> = [];
    for (const operation of payload.operations) {
      if (operation.type !== 'replace_material' && operation.type !== 'replace_processing')
        continue;
      if (payload.kind !== 'system_order' || !catalogService) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Material catalog selection is unavailable',
        );
      }
      try {
        const resolved = await catalogService.resolve({
          scope: {
            userId: scope.userId,
            ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
            conversationId: scope.conversationId,
          },
          messageId: payload.messageId,
          title: payload.title,
          outputId: payload.outputId,
          // Catalog authorization follows the transaction-current review. The
          // operation's captured revision remains bound by the review ledger
          // conflict checks and operation digest.
          revision: record.revision,
          rowId: operation.rowId,
          kind: operation.type === 'replace_processing' ? 'processing' : 'material',
          selection: operation.selection,
        });
        if (operation.type === 'replace_processing') {
          processingCandidates.set(operation.rowId, resolved.candidate);
        } else {
          materialCandidates.set(operation.rowId, resolved.candidate);
        }
        if (resolved.evidence) selectionEvidence.push(resolved.evidence);
      } catch (error) {
        if (error instanceof SteelReviewCatalogError) {
          throw new SteelReviewWriteError(
            error.code === 'CATALOG_CHANGED' ? 'CATALOG_CHANGED' : 'REVIEW_INVALID_OPERATION',
            error.message,
          );
        }
        throw error;
      }
    }
    const stagedExpectedKinds = new Map(
      expectedRows.map((row) => [row.rowId, row.system?.kind] as const),
    );
    const sourceIntents: SteelReviewSourceIntent[] = [];
    for (const operation of payload.operations) {
      if (operation.type === 'add' && operation.source) {
        sourceIntents.push({
          rowId: operation.rowId,
          fileId: operation.source.fileId,
          pageNumber: operation.source.pageNumber,
        });
      } else if (operation.type === 'update' && operation.source) {
        sourceIntents.push({
          rowId: operation.rowId,
          fileId: operation.source.fileId,
          pageNumber: operation.source.pageNumber,
        });
      }
    }
    for (const operation of payload.operations) {
      let changes: Array<{ header: string; value: string | null }> = [];
      if (operation.type === 'add') {
        changes = operation.changes;
      } else if (operation.type === 'update') {
        changes = operation.changes ?? [];
      }
      if (
        changes.some(
          (change) =>
            !headers.includes(change.header) || isSteelReviewSourceAssociationHeader(change.header),
        )
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Review row column is read-only',
        );
      }
      const stagedKind = stagedExpectedKinds.get(operation.rowId);
      const operationSource =
        operation.type === 'add' || operation.type === 'update' ? operation.source : undefined;
      const hasMeasurement =
        (operation.type === 'add' || operation.type === 'update') &&
        Object.prototype.hasOwnProperty.call(operation, 'measurement');
      if (
        hasMeasurement &&
        (payload.kind !== 'system_order' ||
          (operation.type === 'add' ? operation.system?.kind : stagedKind) !== 'processing')
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Only processing rows may use a measurement',
        );
      }
      if (
        payload.kind !== 'system_order' &&
        ((operation.type === 'add' && operation.system !== undefined) ||
          operation.type === 'classify' ||
          (operation.type === 'update' && operation.binding !== undefined))
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'System row identity is unavailable for OCR results',
        );
      }
      if (payload.kind === 'system_order' && operation.type === 'add' && !operation.system) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'System rows require an explicit kind',
        );
      }
      if (
        payload.kind === 'system_order' &&
        operation.type === 'classify' &&
        stagedKind !== 'unassigned'
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Only unassigned rows may be classified',
        );
      }
      if (
        payload.kind === 'system_order' &&
        operation.type === 'update' &&
        operation.binding !== undefined &&
        stagedKind !== 'processing'
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Only processing rows may be bound',
        );
      }
      if (
        payload.kind === 'system_order' &&
        operationSource !== undefined &&
        operation.type === 'update' &&
        stagedKind === 'processing'
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Processing source follows its material',
        );
      }
      if (
        payload.kind === 'system_order' &&
        operationSource !== undefined &&
        operation.type === 'add' &&
        operation.system?.kind === 'processing'
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Processing source follows its material',
        );
      }
      if (
        payload.kind === 'system_order' &&
        changes.some((change) => !isValidSystemOrderCellValue(change.header, change.value ?? ''))
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'System-order numeric input is invalid',
        );
      }
      if (operation.type === 'add' && operation.system) {
        stagedExpectedKinds.set(operation.rowId, operation.system.kind);
      } else if (operation.type === 'classify') {
        stagedExpectedKinds.set(operation.rowId, operation.system.kind);
      }
    }
    const applied = applySteelReviewOperations({
      currentRows,
      expectedRows,
      headers,
      operations: payload.operations,
      ...(materialCandidates.size > 0 ? { materialCandidates } : {}),
      ...(processingCandidates.size > 0 ? { processingCandidates } : {}),
    });
    if (!applied.ok) {
      throw new SteelReviewWriteError(
        'REVIEW_CONFLICT',
        'Review changes conflict with the latest saved table',
        operationRecovery(record, payload, target, currentRows, applied.conflicts),
      );
    }
    const stagedRows = applied.currentRows;
    const trustedSourceEvidence = sourceEvidence ?? (await loadSourceEvidence(scope, payload));
    const fullPayload: SteelReviewInternalPrepare = {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      tableId: record.tableId,
      ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
      title: payload.title,
      kind: payload.kind,
      outputId: payload.outputId,
      // The full trusted preview is based on the transaction-current record.
      // Keep the client's captured revision in the operation request and intent
      // digest; the legacy internal projection must use the current owner
      // revision so the writer can persist the merged snapshot.
      revision: record.revision,
      rows: stagedRows,
      ...(sourceIntents.length > 0 ? { sourceIntents } : {}),
      ...(selectionEvidence.length > 0 ? { selectionEvidence } : {}),
    };
    const prepared = await buildTrustedInternalPrepared(
      scope,
      fullPayload,
      operationId,
      record,
      target,
      trustedSourceEvidence,
    );
    return {
      ...prepared,
      operationRequest: payload,
      digest: operationIntentDigest(payload, operationId, scope, selectionEvidence),
      requestDigest: operationRequestDigest(payload, scope),
      ...(selectionEvidence.length > 0 ? { selectionEvidence } : {}),
    };
  }

  /**
   * Validates and projects the staged rows of an operation prepare. The caller
   * has already proven the record current and resolved its save target.
   */
  async function buildTrustedInternalPrepared(
    scope: SteelReviewPrepareInput,
    payload: SteelReviewInternalPrepare,
    operationId: string,
    record: SteelReviewReadRecord,
    target: NonNullable<ReturnType<typeof findVerifiedSaveTarget>>,
    sourceEvidence: SteelReviewSourceEvidence,
  ): Promise<Omit<SteelReviewTrustedProjection, 'digest'>> {
    const currentRows = record.rows ?? createRecordBaselineRows(record, target);
    const headers = record.headers ?? target.headers;
    const remarksBindingMode = payload.kind === 'system_order' && headers.includes('備註');
    const ledgerValidation = validateSteelReviewLedger(currentRows, payload.rows, headers);
    if (!ledgerValidation.ok) {
      throwLedgerValidationFailure(ledgerValidation);
    }
    const { currentRows: trustedCurrentRows, submittedRows, orderedRows } = ledgerValidation;
    const sourceIntents = payload.sourceIntents ?? [];
    const intentsByRow = new Map<string, SteelReviewSourceIntent>();
    for (const intent of sourceIntents) {
      if (intentsByRow.has(intent.rowId)) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Review source intent is duplicated',
        );
      }
      intentsByRow.set(intent.rowId, intent);
    }
    const sourceMappings = [
      ...(record.trustedSourceMappings ?? record.sourceMappings ?? []),
      ...(record.sourceMappingReservations ?? []),
    ];
    const trustedSourceMappings = [
      ...(record.trustedSourceMappings ?? record.sourceMappings ?? []),
    ];
    const sourceColumn = sourceHeader(headers);
    const sourceCodeReservations = trustedCurrentRows.flatMap((row) => {
      const sourceCode = sourceColumn ? row.values[sourceColumn]?.effective?.trim() : undefined;
      return sourceCode?.match(/^F[1-9]\d*$/u) ? [sourceCode] : [];
    });
    const { metadataByFile, pageCountsByFile } = sourceEvidence;
    const metadataInputs = new Map<string, SteelReviewSourceIntentInput>();
    for (const intent of sourceIntents) {
      if (intent.fileId === null || metadataInputs.has(intent.fileId)) {
        continue;
      }
      metadataInputs.set(intent.fileId, {
        userId: scope.userId,
        ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
        conversationId: scope.conversationId,
        messageId: payload.messageId,
        kind: payload.kind,
        fileId: intent.fileId,
      });
    }
    if (!sourceEvidence && sourceAuthority && metadataInputs.size > 0) {
      const metadataResults = await Promise.all(
        [...metadataInputs.entries()].map(
          async ([fileId, sourceInput]) =>
            [fileId, await sourceAuthority.readMetadata(sourceInput)] as const,
        ),
      );
      for (const [fileId, metadata] of metadataResults) {
        metadataByFile.set(fileId, metadata);
        if (metadata?.pageCount !== undefined) {
          pageCountsByFile.set(fileId, { pageCount: metadata.pageCount });
        }
      }
    }
    if (!sourceEvidence && sourceAuthority && scope.sourceRequest) {
      const pageInputs = [...metadataInputs.entries()].filter(([fileId]) => {
        const metadata = metadataByFile.get(fileId);
        return (
          metadata !== null &&
          metadata?.pageCount === undefined &&
          [...intentsByRow.values()].some(
            (intent) =>
              intent.fileId === fileId &&
              intent.pageNumber !== null &&
              !metadata?.mediaType.toLowerCase().startsWith('image/'),
          )
        );
      });
      const pageResults = await Promise.all(
        pageInputs.map(
          async ([fileId, sourceInput]) =>
            [
              fileId,
              await sourceAuthority.readPageCount(sourceInput, scope.sourceRequest!),
            ] as const,
        ),
      );
      for (const [fileId, pageCount] of pageResults) {
        pageCountsByFile.set(fileId, pageCount);
      }
    }
    const canonicalRows = [] as SteelReviewRow[];
    const knownRowIds = new Set(trustedCurrentRows.map((row) => row.rowId));
    const submittedRowIds = new Set(submittedRows.map((row) => row.rowId));
    if ([...intentsByRow.keys()].some((rowId) => !submittedRowIds.has(rowId))) {
      throw new SteelReviewWriteError(
        'REVIEW_INVALID_OPERATION',
        'Review source row is unavailable',
      );
    }
    for (const current of orderedRows) {
      const next = submittedRows.find((row) => row.rowId === current.rowId) ?? current;
      const isNewRow = !knownRowIds.has(current.rowId);
      const baselineChanged = Object.keys(current.values).some(
        (header) =>
          (current.values[header]?.baseline ?? null) !== (next?.values[header]?.baseline ?? null),
      );
      if (!next || (!isNewRow && baselineChanged)) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review AI baseline changed');
      }
      if (
        !next ||
        Object.keys(next.values).some(
          (header) => !Object.prototype.hasOwnProperty.call(current.values, header),
        )
      ) {
        throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review columns changed');
      }
      const intent = intentsByRow.get(current.rowId);
      if (intent && next.system?.kind === 'processing') {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Processing source follows its material',
        );
      }
      if (!intent) {
        if (isNewRow && next.source !== null && next.system?.kind !== 'processing') {
          throw new SteelReviewWriteError(
            'REVIEW_INVALID_OPERATION',
            'New review source selection is invalid',
          );
        }
        if (
          next.system?.kind !== 'processing' &&
          headers.some(
            (header) =>
              isSteelReviewSourceAssociationHeader(header) &&
              !sameCellProperty(
                current.values[header],
                'effective',
                next?.values[header],
                'effective',
              ),
          )
        ) {
          throw new SteelReviewReadError(
            'INVALID_REVIEW_QUERY',
            400,
            'Review source association cell changed',
          );
        }
        if (
          next.system?.kind !== 'processing' &&
          !sameSteelReviewSource(current.source, next.source)
        ) {
          throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review source changed');
        }
        canonicalRows.push(next);
        continue;
      }
      if (!sourceAuthority) {
        if (isNewRow && next.source === null) {
          canonicalRows.push({ ...next, source: null });
          continue;
        }
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Review source selection is unavailable',
        );
      }
      if (intent.fileId === null) {
        if (next.source !== null) {
          throw new SteelReviewWriteError(
            'REVIEW_INVALID_OPERATION',
            'Review source selection is invalid',
          );
        }
        canonicalRows.push(rowWithSource(next, null, headers));
        continue;
      }
      const metadata = metadataByFile.get(intent.fileId);
      if (!metadata) {
        throw new SteelReviewWriteError('REVIEW_INVALID_OPERATION', 'Review source is unavailable');
      }
      const preservesCurrentSource = sameSteelReviewSource(current.source, next.source);
      if (
        next.source &&
        !preservesCurrentSource &&
        (next.source.fileId !== metadata.fileId ||
          (next.source.filename !== undefined && next.source.filename !== metadata.filename) ||
          (next.source.mediaType !== undefined && next.source.mediaType !== metadata.mediaType))
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Review source metadata is invalid',
        );
      }
      const mediaType = metadata.mediaType.toLowerCase();
      if (intent.pageNumber !== null) {
        if (mediaType.startsWith('image/')) {
          if (intent.pageNumber !== 1) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review image page is invalid',
            );
          }
        } else {
          if (!pageCountsByFile.has(intent.fileId)) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review source page is unavailable',
            );
          }
          const pageCount = pageCountsByFile.get(intent.fileId);
          if (!pageCount || intent.pageNumber > pageCount.pageCount) {
            throw new SteelReviewWriteError(
              'REVIEW_INVALID_OPERATION',
              'Review source page is invalid',
            );
          }
        }
      }
      let mapping = trustedSourceMappings.find((candidate) => candidate.fileId === metadata.fileId);
      if (!mapping) {
        mapping = {
          fileId: metadata.fileId,
          sourceCode: nextHumanSourceCode(sourceMappings, sourceCodeReservations),
          sourceFilename: metadata.filename,
          mediaType: metadata.mediaType,
        };
        sourceMappings.push(mapping);
        trustedSourceMappings.push(mapping);
      } else if (
        mapping.sourceFilename !== metadata.filename ||
        (mapping.mediaType !== undefined && mapping.mediaType !== metadata.mediaType)
      ) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Review source mapping changed',
        );
      }
      const preservesLegacyOmittedMedia =
        mapping.mediaType === undefined &&
        next.source?.fileId === metadata.fileId &&
        next.source.mediaType === undefined;
      const canonicalMediaType = preservesLegacyOmittedMedia ? undefined : metadata.mediaType;
      canonicalRows.push(
        rowWithSource(
          next,
          {
            fileId: metadata.fileId,
            pageNumber: intent.pageNumber,
            filename: metadata.filename,
            ...(canonicalMediaType ? { mediaType: canonicalMediaType } : {}),
          },
          headers,
          mapping.sourceCode,
        ),
      );
    }
    const canonicalById = new Map(canonicalRows.map((row) => [row.rowId, row]));
    const canonicalSourceColumn = sourceHeader(headers);
    for (const row of canonicalRows) {
      if (row.system?.kind !== 'processing' || !row.system.parentRowId || row.deleted) {
        continue;
      }
      const parent = canonicalById.get(row.system.parentRowId);
      if (!parent || parent.deleted || parent.system?.kind !== 'material') {
        if (remarksBindingMode) {
          const index = canonicalRows.findIndex((candidate) => candidate.rowId === row.rowId);
          canonicalRows[index] = rowWithSource(row, null, headers);
          continue;
        }
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'Processing row requires an active material parent',
        );
      }
      const source = parent.source;
      const parentCode = canonicalSourceColumn
        ? parent.values[canonicalSourceColumn]?.effective?.trim() || undefined
        : undefined;
      const mapping = source
        ? trustedSourceMappings.find((candidate) => candidate.fileId === source.fileId)
        : undefined;
      const index = canonicalRows.findIndex((candidate) => candidate.rowId === row.rowId);
      canonicalRows[index] = rowWithSource(row, source, headers, mapping?.sourceCode ?? parentCode);
    }
    if (
      payload.rows.some(
        (row) =>
          Object.keys(row.values).length !== headers.length ||
          headers.some((header) => !Object.prototype.hasOwnProperty.call(row.values, header)),
      )
    ) {
      throw new SteelReviewReadError('INVALID_REVIEW_QUERY', 400, 'Review columns changed');
    }
    if (intentsByRow.size !== sourceIntents.length) {
      throw new SteelReviewWriteError(
        'REVIEW_INVALID_OPERATION',
        'Review source intent is duplicated',
      );
    }
    const hasOcrMetadata =
      record.kind === 'system_order' && Boolean(record.ocrContext || record.reviewMetadata);
    const rowsWithOcrLinks = hasOcrMetadata
      ? reconcileSteelReviewOcrLinks(headers, canonicalRows, record.ocrContext ?? null)
      : canonicalRows;
    const normalizedRows = validateSteelReviewLedger(currentRows, rowsWithOcrLinks, headers);
    if (!normalizedRows.ok) {
      throwLedgerValidationFailure(normalizedRows);
    }
    const canonicalLedgerRows = normalizedRows.orderedSubmittedRows;
    const normalizedCurrentRows = normalizedRows.currentRows;
    const cleanReplacementText = serializeReviewTable(
      headers,
      canonicalLedgerRows.filter((row) => !row.deleted),
    );
    const effectiveMarkdown = replaceOwnerTarget(record, cleanReplacementText, target);
    if (!effectiveMarkdown) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review table target not found');
    }
    let systemOrderMarkdown: string | undefined;
    let customerQuoteMarkdown: string | undefined;
    let customerQuoteChangedRows: number | undefined;
    let customerQuoteTotal: string | null | undefined;
    if (payload.kind === 'system_order') {
      // The ledger already contains the trusted changed-cell normalization and
      // derived values. Preserve all untouched cells byte-for-byte so legacy
      // numeric text is not rewritten as a side effect of an unrelated edit.
      systemOrderMarkdown = effectiveMarkdown;
      const nextQuote = quoteProjection(effectiveMarkdown);
      if (!nextQuote) {
        throw new SteelReviewWriteError(
          'REVIEW_INVALID_OPERATION',
          'System-order quotation is invalid',
        );
      }
      customerQuoteMarkdown = nextQuote.markdown;
      customerQuoteTotal = nextQuote.total;
      customerQuoteChangedRows = countCustomerQuoteChangedRows(
        headers,
        normalizedCurrentRows,
        canonicalLedgerRows,
      );
    }
    const previousById = new Map(normalizedCurrentRows.map((row) => [row.rowId, row]));
    const changedRowIds = canonicalLedgerRows
      .filter((row) => {
        const previous = previousById.get(row.rowId);
        return (
          !previous ||
          JSON.stringify({
            values: row.values,
            source: row.source,
            origin: row.origin,
            deleted: row.deleted,
            system: row.system ?? null,
            measurement: row.calculation?.measurement ?? null,
          }) !==
            JSON.stringify({
              values: previous.values,
              source: previous.source,
              origin: previous.origin,
              deleted: previous.deleted,
              system: previous.system ?? null,
              measurement: previous.calculation?.measurement ?? null,
            })
        );
      })
      .map((row) => row.rowId);
    const fullText = fullMessageText(record);
    if (fullText === undefined) {
      throw new SteelReviewReadError('REVIEW_NOT_FOUND', 404, 'Review message not found');
    }
    const operationBase: Omit<SteelReviewCommitInput, 'digest'> = {
      userId: scope.userId,
      ...(scope.tenantId !== undefined ? { tenantId: scope.tenantId } : {}),
      conversationId: payload.conversationId,
      kind: payload.kind,
      messageId: payload.messageId,
      tableId: record.tableId,
      ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
      title: payload.title,
      outputId: payload.outputId,
      revision: payload.revision,
      rows: canonicalLedgerRows,
      ...(sourceIntents.length > 0 ? { sourceIntents } : {}),
      sourceMappings: uniqueSourceMappings(trustedSourceMappings),
      headers,
      operationId,
      messageSha256: sha256Hex(fullText),
      target: {
        ...(target.partIndex !== undefined ? { partIndex: target.partIndex } : {}),
        start: target.start,
        end: target.end,
        sha256: sha256Hex(target.raw),
      },
      targetText: target.raw,
      replacementText: cleanReplacementText,
      cleanReplacementText,
      effectiveMarkdown,
      displayMarkdown: effectiveMarkdown,
      ...(systemOrderMarkdown ? { systemOrderMarkdown } : {}),
      ...(payload.kind === 'system_order' && (record.effectiveMarkdown ?? record.markdown)
        ? {
            systemOrderSha256: createHash('sha256')
              .update(record.effectiveMarkdown ?? record.markdown!)
              .digest('hex'),
          }
        : {}),
      ...(customerQuoteMarkdown ? { customerQuoteMarkdown } : {}),
      ...(payload.selectionEvidence ? { selectionEvidence: payload.selectionEvidence } : {}),
      ...(record.aiBaselineMarkdown || record.markdown
        ? { aiBaselineMarkdown: record.aiBaselineMarkdown ?? record.markdown }
        : {}),
      ...(record.aiRawMarkdown || record.markdown
        ? { aiRawMarkdown: record.aiRawMarkdown ?? record.markdown }
        : {}),
      caption: {
        kind: payload.kind,
        changedRows: changedRowIds.length,
        changedRowIds,
        ...(customerQuoteChangedRows !== undefined ? { customerQuoteChangedRows } : {}),
        ...(customerQuoteTotal !== undefined ? { customerQuoteTotal } : {}),
      },
    };
    return {
      ...operationBase,
      sourceMappings: operationBase.sourceMappings ?? [],
    };
  }

  function projectPrepared(
    payload: SteelReviewOperationPrepare,
    prepared: SteelReviewTrustedProjection,
  ): SteelReviewPrepared {
    return {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      title: payload.title,
      kind: payload.kind,
      outputId: prepared.outputId,
      revision: prepared.revision,
      operationId: prepared.operationId,
      digest: prepared.digest,
      headers: prepared.headers,
      messageSha256: prepared.messageSha256,
      target: prepared.target,
      targetText: prepared.targetText,
      replacementText: prepared.replacementText,
      cleanReplacementText: prepared.cleanReplacementText,
      rows: prepared.rows,
      effectiveMarkdown: prepared.effectiveMarkdown,
      displayMarkdown: prepared.displayMarkdown,
      ...(prepared.aiBaselineMarkdown ? { aiBaselineMarkdown: prepared.aiBaselineMarkdown } : {}),
      ...(prepared.aiRawMarkdown ? { aiRawMarkdown: prepared.aiRawMarkdown } : {}),
      sourceMappings: prepared.sourceMappings ?? [],
      caption: prepared.caption,
      operations: payload.operations,
      operationRequest: payload,
      ...(prepared.requestDigest ? { requestDigest: prepared.requestDigest } : {}),
      ...(prepared.selectionEvidence ? { selectionEvidence: prepared.selectionEvidence } : {}),
    };
  }

  return {
    parsePreparePayload,
    parseCommitPayload,
    operationRequestDigest,
    operationPreparedFromReceipt,
    loadSourceEvidence,
    buildTrustedOperationPrepared,
    projectPrepared,
  };
}
