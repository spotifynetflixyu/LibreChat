const crypto = require('crypto');
const steelPostgres = require('./postgres');
const mongoose = require('mongoose');
const { logger, redactMessage } = require('@librechat/data-schemas');
const { HumanMessage } = require('@librechat/agents/langchain/messages');
const { initializeModel, isOpenAILike } = require('@librechat/agents');
const {
  buildMCPToolKey,
  upsertSteelNativePreflightToolCall,
  ensureSteelNativeHistory,
  buildSteelPaddleOcrPreflightEventEnvelopes,
  buildSteelOcrPreprocessingEventEnvelopes,
  groupSteelOcrMissingPageRangesByFileKey,
  getSteelOcrFileDescriptor,
  ocrPreprocessingPipelineVersion,
  createMongooseSteelWorkingOrderMemoryWriter,
  createMongooseOcrPdfChunkArtifactRepository,
  createSteelContextDependencies,
  createSteelDelegateOcrStateService,
  parseAssistantMarkdown,
  parseOcrResultTable,
  createOpenAIOAuthModel,
  resolveOpenAIOAuthAuthFilePath,
  buildOcrOrganizerPrompt,
  buildOcrOrganizerAttachment,
  normalizeOcrOrganizerFileKey,
  resolveOcrOrganizerRulesText,
  runOcrPreprocessingBatchPipeline,
  getPaddleOcrResultContent,
  getPaddleOcrResultError,
  isExpiredSignedUrlError,
  isPaddleOcrDiagnosticCode,
  PADDLE_OCR_MCP_SERVER_NAME: steelPaddleOcrMcpServerName,
  resolveOcrPreprocessingChunkSizePages,
  buildPdfPageChunks,
  normalizeOcrPageChunks,
  getPdfPageCount,
  hasSufficientOcrPdfChunkArtifactUrlValidity,
  isUsableOcrPdfChunkArtifactUrl,
  createPdfPageRangeChunker,
  ensurePdfChunkArtifacts,
  loadExistingPdfChunkArtifacts: loadExistingOcrPdfChunkArtifacts,
  commitOcrPdfChunkSplit,
  resolveCanonicalOcrPageChunks,
  getS3DownloadURLForKey,
  s3ObjectExistsByKey,
  saveBufferToS3StorageKey,
  getCloudFrontDownloadURLForKey,
  cloudFrontObjectExistsByKey,
  saveBufferToCloudFrontStorageKey,
} = require('@librechat/api');
const {
  Time,
  Constants,
  StepEvents,
  StepTypes,
  FileSources,
  ToolCallTypes,
} = require('librechat-data-provider');
const { streamToBuffer } = require('~/server/utils/stream');
const { reinitMCPServer } = require('~/server/services/Tools/mcp');
const { resolveMcpServerContext } = require('~/server/services/MCP');
const db = require('~/models');
const { getMCPManager } = require('~/config');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const {
  steelPaddleOcrRetryableErrorPatterns,
  steelPaddleOcrTransportErrorPatterns,
  steelPaddleOcrRetryDelayMs,
  emitSteelNativeEvents,
  steelPaddleOcrMaxAttempts,
  steelPaddleOcrCallTimeoutMs,
  steelPaddleOcrTaskIntervalMs,
  getRequestConversationId,
  steelPaddleOcrToolName,
} = require('./native');

/** @type {typeof import('~/server/services/ToolService').loadToolsForExecution | undefined} */
let loadToolsForExecution;

/** ToolService registers its execution loader so PaddleOCR preflight avoids a circular require. */
function registerSteelToolLoader(loader) {
  loadToolsForExecution = loader;
}

function getSteelFileId(file) {
  const fileId = file?.fileId ?? file?.file_id ?? file?.id;
  return typeof fileId === 'string' && fileId.trim() !== '' ? fileId : undefined;
}

function extractCanonicalDelegateOcrResult(markdown) {
  const sections = parseAssistantMarkdown(markdown).sections.filter(
    (section) => section.title.trim() === 'ocr_result',
  );
  return sections.at(-1)?.raw?.trim() || undefined;
}

function isPdfSteelFile(file) {
  const mediaType = String(file?.mediaType ?? file?.mimeType ?? file?.mimetype ?? file?.type ?? '')
    .trim()
    .toLowerCase();
  if (mediaType === 'application/pdf') {
    return true;
  }
  const filename = String(
    file?.filename ?? file?.name ?? file?.originalname ?? file?.filepath ?? '',
  )
    .trim()
    .toLowerCase();
  return filename.endsWith('.pdf');
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== ''))];
}

function buildSteelFileRecordFilter(fileIds, req) {
  if (!req?.user?.id || fileIds.length === 0) {
    return undefined;
  }
  return {
    file_id: { $in: fileIds },
    user: req.user.id,
    ...(req.user.tenantId ? { tenantId: req.user.tenantId } : {}),
  };
}

async function getSteelCurrentFileRecords(req, files) {
  const fileIds = uniqueStrings(files.map(getSteelFileId));
  const filter = buildSteelFileRecordFilter(fileIds, req);
  if (!filter) {
    return new Map();
  }

  const records = (await db.getFiles(filter, {}, {})) ?? [];
  return new Map(
    records
      .map((record) => [getSteelFileId(record), record])
      .filter(([fileId]) => fileId !== undefined),
  );
}

async function readSteelStoredFileBytes({ req, fileRecord }) {
  const source = fileRecord?.source ?? FileSources.local;
  const { getDownloadStream } = getStrategyFunctions(source);
  if (typeof getDownloadStream !== 'function') {
    throw new Error(`File source "${source}" is not downloadable`);
  }

  const filePath = fileRecord.storageKey || fileRecord.filepath;
  if (!filePath) {
    throw new Error(
      `File "${fileRecord.file_id ?? fileRecord.filename ?? 'unknown'}" has no filepath`,
    );
  }

  return streamToBuffer(await getDownloadStream(req, filePath));
}

function getSteelSourcePdfKey(file, fileRecord) {
  return (
    fileRecord?.storageKey ??
    fileRecord?.filepath ??
    file?.storageKey ??
    file?.filepath ??
    file?.ocrFileKey
  );
}

function toSteelOcrPreprocessingFile(file, fileRecord) {
  const sourcePdfKey = getSteelSourcePdfKey(file, fileRecord);
  if (!sourcePdfKey) {
    return undefined;
  }

  const sourceFilename = typeof fileRecord?.filename === 'string' ? fileRecord.filename.trim() : '';

  return {
    ...file,
    fileId: file.fileId ?? fileRecord?.file_id,
    filename: file.filename ?? fileRecord?.filename,
    mediaType: file.mediaType ?? fileRecord?.type ?? fileRecord?.mimetype,
    filepath: file.filepath ?? fileRecord?.filepath,
    storageKey: file.storageKey ?? fileRecord?.storageKey,
    ocrFileKey: file.ocrFileKey,
    sourcePdfKey,
    sourceFilename,
  };
}

function getSteelOcrSourceCode(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  return /^F[1-9][0-9]*$/u.test(value) ? value : undefined;
}

function withoutSteelOcrSourceCode(file) {
  if (!file || typeof file !== 'object') {
    return file;
  }
  const metadata = { ...file };
  delete metadata.sourceCode;
  return metadata;
}

function compactSteelText(values) {
  return values.map((value) => value?.trim()).filter((value) => value);
}

function renderSteelOcrRule(rule) {
  return compactSteelText([`## ${rule.title || 'OCR rule'}`, rule.prompt]).join('\n');
}

async function resolveSteelOcrPreprocessingRules() {
  let otherRules;
  try {
    const dependencies = createSteelContextDependencies({
      runtimeRulesClient: steelPostgres.client,
    });
    otherRules = await dependencies.listOtherGlobalRules();
  } catch (error) {
    logger.warn('[Steel OCR] Failed to load OCR rules for preprocessing; continuing fail-open', {
      error: error?.message,
    });
    return {
      ocrRulesText: '',
      ocrRuleVersion: 'ocr-rules:unavailable',
    };
  }

  const sharedRules = otherRules.ocrSharedRules ?? [];
  const visionRules = otherRules.ocrVisionRules ?? [];
  const organizerRules = otherRules.ocrOrganizerRules ?? [];
  const renderedRules = [...sharedRules, ...visionRules, ...organizerRules]
    .map(renderSteelOcrRule)
    .join('\n\n')
    .trim();
  const effectiveOrganizerRules = resolveOcrOrganizerRulesText(renderedRules);
  const versionHash = crypto.createHash('sha256').update(effectiveOrganizerRules).digest('hex');
  return {
    ocrRulesText: renderedRules,
    ocrRuleVersion: `ocr-rules:${versionHash}`,
  };
}

function getMessageContentText(message) {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part?.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter((text) => text.trim() !== '')
      .join('\n');
  }
  return String(content ?? '');
}

const steelOpenAIOAuthProvider = 'openai_oauth_responses';

function getDefinedNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getDefinedBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function getDefinedString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function getDefinedRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function getFirstDefinedNumber(parameters, keys) {
  for (const key of keys) {
    const value = getDefinedNumber(parameters[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function getFirstDefinedBoolean(parameters, keys) {
  for (const key of keys) {
    const value = getDefinedBoolean(parameters[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function getFirstDefinedString(parameters, keys) {
  for (const key of keys) {
    const value = getDefinedString(parameters[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function resolveSteelOcrOrganizerOAuthOptions(agent) {
  const parameters = agent?.model_parameters ?? {};
  const model = getFirstDefinedString(parameters, ['model']) ?? getDefinedString(agent?.model);
  if (!model) {
    throw new Error('OCR organizer requires the selected Agent model');
  }

  const reasoning = getDefinedRecord(parameters.reasoning);
  const modelKwargs = getDefinedRecord(parameters.modelKwargs);
  const modelKwargsReasoning = getDefinedRecord(modelKwargs?.reasoning);
  const reasoningEffort =
    getFirstDefinedString(parameters, ['reasoningEffort', 'reasoning_effort']) ??
    getDefinedString(reasoning?.effort) ??
    getFirstDefinedString(modelKwargs ?? {}, ['reasoning_effort']) ??
    getDefinedString(modelKwargsReasoning?.effort);
  const authFilePath =
    getFirstDefinedString(parameters, ['authFilePath', 'auth_file_path']) ??
    resolveOpenAIOAuthAuthFilePath(process.env);
  const ensureFresh = getFirstDefinedBoolean(parameters, ['ensureFresh', 'ensure_fresh']);
  const frequencyPenalty = getFirstDefinedNumber(parameters, [
    'frequencyPenalty',
    'frequency_penalty',
  ]);
  const maxOutputTokens = getFirstDefinedNumber(parameters, [
    'maxOutputTokens',
    'max_output_tokens',
    'maxTokens',
    'max_tokens',
    'maxCompletionTokens',
    'max_completion_tokens',
  ]);
  const presencePenalty = getFirstDefinedNumber(parameters, [
    'presencePenalty',
    'presence_penalty',
  ]);
  const topP = getFirstDefinedNumber(parameters, ['topP', 'top_p']);
  return {
    ...(authFilePath ? { authFilePath } : {}),
    ...(ensureFresh !== undefined ? { ensureFresh } : {}),
    ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    model,
    ...(presencePenalty !== undefined ? { presencePenalty } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(topP !== undefined ? { topP } : {}),
  };
}

async function prepareSteelOcrOrganizerAttachment({ attachment, provider, signal }) {
  if (attachment.type !== 'file' || !(isOpenAILike(provider) || provider === 'openai_api')) {
    return attachment;
  }

  const response = await fetch(attachment.url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`OCR organizer artifact download failed (${response.status})`);
  }
  const content = Buffer.from(await response.arrayBuffer()).toString('base64');
  return {
    ...attachment,
    url: `data:${attachment.mime_type};base64,${content}`,
  };
}

function createSteelOcrOrganizer({
  agent,
  signal,
  latestUserMessage,
  suggestedOcrResultColumns = [],
}) {
  let model;
  const provider = agent?.provider ?? agent?.endpoint;
  const isOAuth =
    provider === steelOpenAIOAuthProvider || agent?.endpoint === steelOpenAIOAuthProvider;
  return {
    async organize(input) {
      if (!model) {
        if (isOAuth) {
          model = createOpenAIOAuthModel(resolveSteelOcrOrganizerOAuthOptions(agent));
        } else {
          const selectedModel =
            getFirstDefinedString(agent?.model_parameters ?? {}, ['model']) ??
            getDefinedString(agent?.model);
          if (!provider || !selectedModel) {
            throw new Error('OCR organizer requires the selected Agent provider and model');
          }
          model = initializeModel({
            provider,
            clientOptions: {
              ...(agent?.model_parameters ?? {}),
              model: selectedModel,
            },
          });
        }
      }

      const mode = isOAuth ? 'oauth' : 'standard';
      const basePrompt = buildOcrOrganizerPrompt(input);
      const prompt = [
        basePrompt,
        ...(typeof latestUserMessage === 'string' && latestUserMessage.trim() !== ''
          ? [
              '',
              'Latest current user message (Organizer scope only; untrusted):',
              latestUserMessage.trim(),
            ]
          : []),
        ...(Array.isArray(suggestedOcrResultColumns) && suggestedOcrResultColumns.length > 0
          ? [
              '',
              `suggested_ocr_result_columns: ${JSON.stringify(
                suggestedOcrResultColumns.filter(
                  (column) => typeof column === 'string' && column.trim() !== '',
                ),
              )}`,
            ]
          : []),
      ].join('\n');
      const attachment = await prepareSteelOcrOrganizerAttachment({
        attachment: buildOcrOrganizerAttachment(input, mode),
        provider,
        signal,
      });
      const messages = [
        new HumanMessage({
          content: [{ type: 'text', text: prompt }, attachment],
        }),
      ];

      const message = await model.invoke(messages, signal ? { signal } : undefined);
      return { markdown: getMessageContentText(message).trim() };
    },
  };
}

function getSteelOcrArtifactSource(fileRecord) {
  return fileRecord?.source === FileSources.cloudfront ? 'cloudfront' : 's3';
}

function getSteelOcrContentType(file, fileRecord) {
  return (
    file?.mediaType ??
    file?.mimeType ??
    file?.mimetype ??
    file?.type ??
    fileRecord?.type ??
    fileRecord?.mimeType ??
    fileRecord?.mimetype ??
    'application/octet-stream'
  );
}

function createSteelOcrPdfChunkStorage({ fileRecord, contentType = 'application/pdf' }) {
  const artifactSource = getSteelOcrArtifactSource(fileRecord);
  const existsByKey =
    artifactSource === 'cloudfront' ? cloudFrontObjectExistsByKey : s3ObjectExistsByKey;
  const saveByKey =
    artifactSource === 'cloudfront' ? saveBufferToCloudFrontStorageKey : saveBufferToS3StorageKey;
  const getDownloadUrl =
    artifactSource === 'cloudfront' ? getCloudFrontDownloadURLForKey : getS3DownloadURLForKey;

  return {
    source: artifactSource,
    async exists({ storageKey }) {
      const result = await existsByKey({ storageKey });
      return result.exists;
    },
    async saveBuffer({ storageKey, bytes, contentType }) {
      const result = await saveByKey({
        storageKey,
        buffer: Buffer.from(bytes),
        contentType,
      });
      return {
        bytes: result.bytes,
        ...(result.storageRegion ? { storageRegion: result.storageRegion } : {}),
      };
    },
    async getDownloadUrl({ storageKey }) {
      return getDownloadUrl({
        storageKey,
        contentType,
      });
    },
  };
}

async function refreshSteelOcrPdfChunkArtifact({
  artifact,
  storage,
  repository,
  file,
  chunk,
  validateUrl = false,
}) {
  if (!artifact.storageKey || isHttpUrl(artifact.storageKey)) {
    return artifact;
  }
  const filepath = await storage.getDownloadUrl({ storageKey: artifact.storageKey });
  if (validateUrl && !isUsableOcrPdfChunkArtifactUrl(filepath, artifact.storageKey)) {
    throw new Error(
      `OCR artifact signer returned an invalid URL for pages ${chunk.pageStart}-${chunk.pageEnd}`,
    );
  }
  const persistedFilepath =
    repository?.compareAndSetArtifactFilepath &&
    (artifact.sourcePdfKey ?? file?.sourcePdfKey) &&
    Number.isInteger(chunk?.pageStart) &&
    Number.isInteger(chunk?.pageEnd)
      ? await repository.compareAndSetArtifactFilepath({
          sourcePdfKey: artifact.sourcePdfKey ?? file.sourcePdfKey,
          pipelineVersion: ocrPreprocessingPipelineVersion,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          previousFilepath: artifact.filepath,
          filepath,
        })
      : filepath;
  if (validateUrl && !isUsableOcrPdfChunkArtifactUrl(persistedFilepath, artifact.storageKey)) {
    throw new Error(`OCR artifact URL is invalid for pages ${chunk.pageStart}-${chunk.pageEnd}`);
  }
  return {
    ...artifact,
    filepath: persistedFilepath,
  };
}

function isSingleOriginalPdfChunk(chunks) {
  const chunk = chunks?.[0];
  return (
    chunks?.length === 1 &&
    chunk?.chunkIndex === 1 &&
    chunk?.chunkCount === 1 &&
    chunk?.pageStart === 1 &&
    chunk?.pageEnd >= chunk.pageStart &&
    chunk.pageEnd - chunk.pageStart + 1 !== 50
  );
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//iu.test(value);
}

function getOriginalPdfStorageKey(file, fileRecord) {
  return fileRecord?.storageKey ?? file?.storageKey;
}

async function createOriginalPdfChunkArtifact({
  file,
  fileRecord,
  storage,
  chunks,
  sourcePdfKey = file.sourcePdfKey,
}) {
  const chunk = chunks[0];
  const storageKey = getOriginalPdfStorageKey(file, fileRecord);
  let filepath;
  if (storageKey) {
    filepath = await storage.getDownloadUrl({ storageKey });
  } else if (isHttpUrl(fileRecord?.filepath)) {
    filepath = fileRecord.filepath;
  } else if (isHttpUrl(file?.filepath)) {
    filepath = file.filepath;
  }
  if (!chunk || !filepath) {
    return undefined;
  }

  return {
    ...chunk,
    sourcePdfKey,
    source: getSteelOcrArtifactSource(fileRecord),
    storageKey: storageKey ?? filepath,
    filepath,
    filename: file.filename ?? fileRecord?.filename ?? 'source.pdf',
    bytes: fileRecord?.bytes ?? 0,
    contentType: getSteelOcrContentType(file, fileRecord),
    artifactOrigin: 'original',
  };
}

async function persistOriginalPdfChunkArtifact({ artifact, file, fileRecord, repository }) {
  if (!artifact || !artifact.storageKey || isHttpUrl(artifact.storageKey)) {
    return;
  }
  await repository.upsert({
    sourcePdfKey: artifact.sourcePdfKey,
    sourceStorageKey: fileRecord?.storageKey,
    sourceFileId: file.fileId,
    sourceFilename: file.filename,
    sourceBytes: fileRecord?.bytes,
    pipelineVersion: ocrPreprocessingPipelineVersion,
    chunkIndex: artifact.chunkIndex,
    chunkCount: artifact.chunkCount,
    pageStart: artifact.pageStart,
    pageEnd: artifact.pageEnd,
    chunkSizePages: artifact.chunkSizePages,
    artifact: {
      source: artifact.source,
      storageKey: artifact.storageKey,
      filepath: artifact.filepath,
      filename: artifact.filename,
      bytes: artifact.bytes,
      contentType: 'application/pdf',
    },
  });
}

function mapCanonicalOriginalPdfChunkArtifact({ row, chunk, filepath = row.artifact.filepath }) {
  return {
    ...chunk,
    sourcePdfKey: row.sourcePdfKey,
    source: row.artifact.source,
    storageKey: row.artifact.storageKey,
    storageRegion: row.artifact.storageRegion,
    filepath,
    filename: row.artifact.filename,
    bytes: row.artifact.bytes,
    contentType: row.artifact.contentType,
    artifactOrigin: 'original',
  };
}

function createSteelOcrPdfChunkArtifactStore({ file, fileRecord, pdfBytes, forceSplit = false }) {
  const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);
  const storage = createSteelOcrPdfChunkStorage({ fileRecord });
  let createPdfChunkPromise;
  const getCreatePdfChunk = () => {
    createPdfChunkPromise ??= createPdfPageRangeChunker({ pdfBytes });
    return createPdfChunkPromise;
  };

  return {
    async loadExistingPdfChunkArtifacts({ sourcePdfKey, pageRanges }) {
      const artifacts = await loadExistingOcrPdfChunkArtifacts({
        sourcePdfKey,
        sourceStorageKey: fileRecord?.storageKey,
        sourceFileId: file.fileId,
        pageRanges,
        repository,
        storage,
      });
      return artifacts.map((artifact) => ({
        ...artifact,
        source: artifact.source ?? getSteelOcrArtifactSource(fileRecord),
      }));
    },
    async resolveCanonicalChunks({ sourcePdfKey, chunks }) {
      const rows = await repository.findBySourcePdfKey({
        sourcePdfKey,
        pipelineVersion: ocrPreprocessingPipelineVersion,
      });
      return resolveCanonicalOcrPageChunks({ defaultChunks: chunks, artifactRows: rows });
    },
    async ensurePdfChunkArtifacts({ sourcePdfKey, chunks }) {
      if (!forceSplit && isSingleOriginalPdfChunk(chunks)) {
        const originalChunk = chunks[0];
        const existingRows = await repository.findBySourcePdfKey({
          sourcePdfKey,
          pipelineVersion: ocrPreprocessingPipelineVersion,
        });
        const existing = existingRows.find(
          (row) =>
            row.pageStart === originalChunk.pageStart && row.pageEnd === originalChunk.pageEnd,
        );
        if (existing) {
          const objectIsPresent = await storage.exists({
            storageKey: existing.artifact.storageKey,
          });
          if (!objectIsPresent) {
            throw new Error(
              `OCR canonical original PDF object is missing for pages ${originalChunk.pageStart}-${originalChunk.pageEnd}`,
            );
          }
          if (hasSufficientOcrPdfChunkArtifactUrlValidity(existing.artifact.filepath)) {
            return [mapCanonicalOriginalPdfChunkArtifact({ row: existing, chunk: originalChunk })];
          }
          const filepath = await storage.getDownloadUrl({
            storageKey: existing.artifact.storageKey,
          });
          const persistedFilepath = await repository.compareAndSetArtifactFilepath({
            sourcePdfKey: existing.sourcePdfKey,
            pipelineVersion: existing.pipelineVersion,
            pageStart: existing.pageStart,
            pageEnd: existing.pageEnd,
            previousFilepath: existing.artifact.filepath,
            filepath,
          });
          return [
            mapCanonicalOriginalPdfChunkArtifact({
              row: existing,
              chunk: originalChunk,
              filepath: persistedFilepath,
            }),
          ];
        }
        const originalArtifact = await createOriginalPdfChunkArtifact({
          file,
          fileRecord,
          storage,
          chunks,
          sourcePdfKey,
        });
        if (originalArtifact) {
          await persistOriginalPdfChunkArtifact({
            artifact: originalArtifact,
            file,
            fileRecord,
            repository,
          });
          return [originalArtifact];
        }
      }

      const artifacts = await ensurePdfChunkArtifacts({
        sourcePdfKey,
        sourceStorageKey: fileRecord?.storageKey,
        sourceFileId: file.fileId,
        sourceFilename: file.filename,
        sourceBytes: fileRecord?.bytes,
        chunks,
        repository,
        storage,
        createPdfChunk: async ({ chunk }) => {
          const createPdfChunk = await getCreatePdfChunk();
          return createPdfChunk({
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
          });
        },
      });
      return artifacts.map((artifact) => ({
        ...artifact,
        source: artifact.source ?? getSteelOcrArtifactSource(fileRecord),
      }));
    },
    async commitPdfChunkSplit({ sourcePdfKey, parent, children, chunks }) {
      const artifacts = await commitOcrPdfChunkSplit({
        sourcePdfKey,
        sourceStorageKey: fileRecord?.storageKey,
        sourceFileId: file.fileId,
        sourceFilename: file.filename,
        sourceBytes: fileRecord?.bytes,
        parent,
        children,
        chunks,
        repository,
        storage,
        createPdfChunk: async ({ chunk }) => {
          const createPdfChunk = await getCreatePdfChunk();
          return createPdfChunk({ pageStart: chunk.pageStart, pageEnd: chunk.pageEnd });
        },
      });
      return artifacts.map((artifact) => ({
        ...artifact,
        source: artifact.source ?? getSteelOcrArtifactSource(fileRecord),
      }));
    },
    async refreshPdfChunkArtifact({ artifact, chunk }) {
      return refreshSteelOcrPdfChunkArtifact({
        artifact,
        storage,
        repository,
        file,
        chunk,
        validateUrl: true,
      });
    },
  };
}

function buildSingleOriginalOcrChunk() {
  return buildPdfPageChunks({ pageCount: 1, chunkSizePages: 1 });
}

function toReusableOcrPreprocessingChunks(state, fallbackChunkSizePages) {
  const chunks = Array.isArray(state?.chunks) ? state.chunks : [];
  if (chunks.length === 0) {
    return undefined;
  }
  const reusableChunks = chunks.filter(
    (chunk) =>
      chunk?.rawSaved &&
      chunk?.organizedSaved &&
      chunk?.organizedMarkdown !== undefined &&
      Number.isInteger(chunk.pageStart) &&
      Number.isInteger(chunk.pageEnd),
  );
  if (reusableChunks.length !== chunks.length) {
    return undefined;
  }
  try {
    return normalizeOcrPageChunks(
      reusableChunks.map((chunk) => ({
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        chunkSizePages: chunk.chunkSizePages ?? fallbackChunkSizePages,
      })),
    );
  } catch {
    return undefined;
  }
}

function createOcrPreprocessingStateInput({ conversationId, file, ocrRuleVersion }) {
  return {
    conversationId,
    sourcePdfKey: file.sourcePdfKey,
    ocrFileKey: file.ocrFileKey,
    ocrRuleVersion,
  };
}

function createSteelOcrOriginalFileArtifactStore({ file, fileRecord }) {
  const storage = createSteelOcrPdfChunkStorage({
    fileRecord,
    contentType: getSteelOcrContentType(file, fileRecord),
  });

  return {
    async ensurePdfChunkArtifacts({ chunks }) {
      const originalArtifact = await createOriginalPdfChunkArtifact({
        file,
        fileRecord,
        storage,
        chunks,
      });
      if (!originalArtifact) {
        throw new Error(`No OCR input URL available for ${file.filename ?? file.ocrFileKey}`);
      }
      return [originalArtifact];
    },
    async refreshPdfChunkArtifact({ artifact }) {
      return refreshSteelOcrPdfChunkArtifact({ artifact, storage });
    },
  };
}

function hashPaddleOcrText(text) {
  return crypto
    .createHash('sha256')
    .update(
      String(text ?? '')
        .replace(/\r\n/gu, '\n')
        .trim(),
    )
    .digest('hex');
}

function getSteelPaddleOcrPreflightToolCallId(ocrFileKey) {
  return `steel_paddleocr_preflight_${String(ocrFileKey).replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

function getSteelPaddleOcrPreflightStepId(providerToolCallId) {
  return `${providerToolCallId}_step`;
}

function stringifySteelPaddleOcrPayload(value) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      error: 'PaddleOCR payload could not be serialized',
      message: error?.message,
    });
  }
}

function getSafeSteelPaddleOcrErrorMessage(error) {
  return redactMessage(error?.message ?? 'PaddleOCR preflight failed', 512).replace(
    /https?:\/\/\S+/giu,
    '[redacted-url]',
  );
}

function isAbortError(error, signal) {
  if (signal?.aborted) {
    return true;
  }

  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const errorName = current.name;
    const errorCode = current.code;
    const errorMessage = typeof current.message === 'string' ? current.message : '';

    if (
      errorName === 'AbortError' ||
      errorCode === 'ABORT_ERR' ||
      errorMessage.includes('AbortError') ||
      /(?:operation|request|stream) was aborted/i.test(errorMessage)
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

function getParentAbortError(signal) {
  if (signal?.reason instanceof Error && signal.reason.name === 'AbortError') {
    return signal.reason;
  }
  const error = new Error(
    signal?.reason instanceof Error ? signal.reason.message : 'OCR request aborted',
  );
  error.name = 'AbortError';
  if (signal?.reason !== undefined) {
    error.cause = signal.reason;
  }
  return error;
}

function collectErrorMessages(error) {
  const messages = [];
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (typeof current.name === 'string' && current.name.trim() !== '') {
      messages.push(current.name);
    }
    if (typeof current.code === 'string' && current.code.trim() !== '') {
      messages.push(current.code);
    }
    if (typeof current.message === 'string' && current.message.trim() !== '') {
      messages.push(current.message);
    }
    current = current.cause;
  }
  if (typeof error === 'string') {
    messages.push(error);
  }
  return messages;
}

function isRetryableSteelPaddleOcrPreflightError(error) {
  if (isExpiredSignedUrlError(error)) {
    return true;
  }
  if (isPaddleOcrDiagnosticCode(error?.diagnosticCode)) {
    return [
      'ai_studio_unavailable',
      'ai_studio_rate_limited',
      'ai_studio_timeout',
      'ai_studio_job_failed',
      'ai_studio_inference',
    ].includes(error.diagnosticCode);
  }
  const combined = collectErrorMessages(error).join('\n').toLowerCase();
  return (
    Boolean(combined) &&
    steelPaddleOcrRetryableErrorPatterns.some((pattern) => combined.includes(pattern))
  );
}

function isTransportSteelPaddleOcrPreflightError(error) {
  const combined = collectErrorMessages(error).join('\n').toLowerCase();
  return (
    Boolean(combined) &&
    steelPaddleOcrTransportErrorPatterns.some((pattern) => combined.includes(pattern))
  );
}

function sleepSteelPaddleOcrDelay({ signal, delay, abortMessage }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error(abortMessage);
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error(abortMessage);
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function sleepSteelPaddleOcrRetry({ signal }) {
  return sleepSteelPaddleOcrDelay({
    signal,
    delay: steelPaddleOcrRetryDelayMs,
    abortMessage: 'OCR retry aborted',
  });
}

function retainProviderErrorWithRebuildFailure(providerError, rebuildError) {
  if (providerError && typeof providerError === 'object') {
    try {
      if (providerError.cause === undefined) {
        providerError.cause = rebuildError;
      } else {
        providerError.rebuildError = rebuildError;
      }
    } catch (error) {
      logger.debug('[Steel OCR] Could not attach PaddleOCR rebuild failure to provider error', {
        error: error?.message,
      });
    }
  }
  return providerError;
}

function createSteelPaddleOcrInvokeConfig({
  configurable,
  req,
  agent,
  conversationId,
  requestId,
  signal,
  providerToolCallId,
  toolName,
  args,
}) {
  return {
    configurable: {
      ...configurable,
      req,
      user: req.user,
      user_id: req.user?.id,
      requestBody: {
        messageId: requestId,
        conversationId,
      },
    },
    metadata: {
      provider: agent?.provider,
      thread_id: conversationId,
      run_id: requestId ?? conversationId,
    },
    signal,
    toolCall: {
      id: providerToolCallId,
      name: toolName,
      args,
    },
  };
}

function createSteelPaddleOcrCallTimeoutError() {
  const error = new Error('PaddleOCR call timed out after 10 minutes');
  Object.defineProperty(error, 'diagnosticCode', {
    value: 'ai_studio_timeout',
    enumerable: false,
    configurable: true,
  });
  return error;
}

async function loadSteelPaddleOcrPreflightTool({
  req,
  res,
  signal,
  agent,
  toolName,
  streamId,
  userMCPAuthMap,
  requestScopedConnections,
}) {
  const { loadedTools, configurable } = await loadToolsForExecution({
    req,
    res,
    signal,
    agent,
    toolNames: [toolName],
    streamId,
    actionsEnabled: false,
    allowPaddleOcr: true,
    ...(userMCPAuthMap ? { userMCPAuthMap } : {}),
    ...(requestScopedConnections ? { requestScopedConnections } : {}),
  });
  return {
    paddleTool: loadedTools.find((tool) => tool.name === toolName),
    configurable,
  };
}

async function rebuildSteelPaddleOcrPreflightTool({
  req,
  res,
  signal,
  agent,
  streamId,
  toolName,
  conversationId,
  requestId,
  file,
  error,
  userMCPAuthMap,
  requestScopedConnections,
}) {
  logger.warn('[Steel OCR] Rebuilding PaddleOCR MCP connection before retrying preflight', {
    conversationId,
    requestId,
    ocrFileKey: file?.ocrFileKey,
    error: error?.message,
  });

  const requestConnectionKey = req.user?.id
    ? `${req.user.id}:${steelPaddleOcrMcpServerName}`
    : undefined;
  const requestConnection = requestConnectionKey
    ? requestScopedConnections?.connections?.get?.(requestConnectionKey)
    : undefined;
  if (requestConnectionKey) {
    requestScopedConnections?.pending?.delete?.(requestConnectionKey);
    requestScopedConnections?.connections?.delete?.(requestConnectionKey);
  }
  if (typeof requestConnection?.disconnect === 'function') {
    try {
      await requestConnection.disconnect();
    } catch (disconnectError) {
      logger.warn(
        '[Steel OCR] Failed to disconnect request-scoped PaddleOCR connection before retry',
        {
          conversationId,
          requestId,
          ocrFileKey: file?.ocrFileKey,
          error: disconnectError?.message,
        },
      );
    }
  }

  try {
    await getMCPManager(req.user?.id)?.appConnections?.disconnect?.(steelPaddleOcrMcpServerName);
  } catch (disconnectError) {
    logger.warn('[Steel OCR] Failed to disconnect PaddleOCR app connection before retry', {
      conversationId,
      requestId,
      ocrFileKey: file?.ocrFileKey,
      error: disconnectError?.message,
    });
  }

  let configServers;
  try {
    const serverContext = await resolveMcpServerContext(req);
    configServers = serverContext?.configServers;
  } catch (configError) {
    logger.warn('[Steel OCR] Failed to resolve MCP config servers before PaddleOCR retry', {
      conversationId,
      requestId,
      ocrFileKey: file?.ocrFileKey,
      error: configError?.message,
    });
  }

  try {
    await reinitMCPServer({
      user: req.user,
      signal,
      serverName: steelPaddleOcrMcpServerName,
      ...(configServers ? { configServers } : {}),
      ...(userMCPAuthMap ? { userMCPAuthMap } : {}),
      requestBody: {
        messageId: requestId,
        conversationId,
      },
      requestScopedConnections,
      forceNew: true,
      returnOnOAuth: false,
      connectionTimeout: Time.THIRTY_SECONDS,
    });
  } catch (reinitError) {
    logger.warn('[Steel OCR] Failed to reinitialize PaddleOCR MCP before retry', {
      conversationId,
      requestId,
      ocrFileKey: file?.ocrFileKey,
      error: reinitError?.message,
    });
  }

  return loadSteelPaddleOcrPreflightTool({
    req,
    res,
    signal,
    agent,
    toolName,
    streamId,
    userMCPAuthMap,
    requestScopedConnections,
  });
}

function createSteelPaddleOcrToolCall({ providerToolCallId, toolName, args, output }) {
  return {
    id: providerToolCallId,
    name: toolName,
    args: stringifySteelPaddleOcrPayload(args),
    ...(output !== undefined ? { output: stringifySteelPaddleOcrPayload(output) } : {}),
    type: ToolCallTypes.TOOL_CALL,
  };
}

function createSteelPaddleOcrHistoryToolCall({
  providerToolCallId,
  toolName,
  args,
  output,
  progress,
}) {
  const runtimeParams = args?.runtime_params;
  const compactArgs = {
    ...(typeof args?.input_data === 'string' ? { input_data: args.input_data } : {}),
    output_mode: 'detailed',
    return_images: args?.return_images === true,
    use_doc_orientation_classify: runtimeParams?.use_doc_orientation_classify === true,
    use_doc_unwarping: runtimeParams?.use_doc_unwarping === true,
    use_layout_detection: runtimeParams?.use_layout_detection === true,
  };
  let compactOutput;
  if (typeof output === 'string') {
    compactOutput = getSafeSteelPaddleOcrErrorMessage(new Error(output));
    compactOutput = compactOutput.startsWith('Error:') ? compactOutput : `Error: ${compactOutput}`;
  } else if (output !== undefined) {
    try {
      const chunkIdentity = {
        ocrEngine: output.ocrEngine,
        ocrFileKey: String(output.ocrFileKey ?? '').slice(0, 256),
        filename: String(output.filename ?? '').slice(0, 256),
        chunkIndex: output.chunkIndex,
        chunkCount: output.chunkCount,
        pageStart: output.pageStart,
        pageEnd: output.pageEnd,
      };
      const failureMessage =
        output.paddleocr === 'fail'
          ? getSafeSteelPaddleOcrErrorMessage(
              new Error(output.errorMessage ?? 'PaddleOCR preflight failed'),
            )
          : undefined;
      const allowed =
        output.paddleocr === 'fail'
          ? {
              status: 'fail',
              paddleocr: 'fail',
              ...chunkIdentity,
              dataSizeBytes: Buffer.byteLength(stringifySteelPaddleOcrPayload(output), 'utf8'),
              attemptsUsed: output.attemptsUsed,
              ...(isPaddleOcrDiagnosticCode(output.diagnosticCode)
                ? { errorCode: output.diagnosticCode }
                : {}),
              error: failureMessage,
              errorMessage: failureMessage,
            }
          : {
              status: 'ok',
              paddleocr: 'ok',
              ...chunkIdentity,
              dataSizeBytes: output.dataSizeBytes,
            };
      compactOutput = JSON.stringify(allowed);
    } catch {
      compactOutput = 'Error: PaddleOCR output unavailable';
    }
  }
  return {
    type: 'tool_call',
    id: String(providerToolCallId ?? '').slice(0, 256),
    name: toolName,
    args: compactArgs,
    ...(compactOutput !== undefined ? { output: compactOutput } : {}),
    progress: progress === 1 ? 1 : 0,
  };
}

function createSteelPaddleOcrRunStepEvent({
  requestId,
  stepId,
  providerToolCallId,
  toolName,
  index,
}) {
  const toolCall = createSteelPaddleOcrToolCall({
    providerToolCallId,
    toolName,
    args: '',
  });

  return {
    event: StepEvents.ON_RUN_STEP,
    data: {
      runId: requestId ?? Constants.USE_PRELIM_RESPONSE_MESSAGE_ID,
      id: stepId,
      type: StepTypes.TOOL_CALLS,
      index,
      stepDetails: {
        type: StepTypes.TOOL_CALLS,
        tool_calls: [toolCall],
      },
    },
  };
}

function createSteelPaddleOcrRunStepDeltaEvent({
  stepId,
  providerToolCallId,
  toolName,
  args,
  index,
}) {
  return {
    event: StepEvents.ON_RUN_STEP_DELTA,
    data: {
      id: stepId,
      delta: {
        type: StepTypes.TOOL_CALLS,
        tool_calls: [
          {
            index,
            id: providerToolCallId,
            name: toolName,
            args: stringifySteelPaddleOcrPayload(args),
            type: ToolCallTypes.TOOL_CALL,
          },
        ],
      },
    },
  };
}

function createSteelPaddleOcrRunStepCompletedEvent({
  stepId,
  providerToolCallId,
  toolName,
  args,
  output,
  index,
}) {
  return {
    event: StepEvents.ON_RUN_STEP_COMPLETED,
    data: {
      result: {
        id: stepId,
        index,
        tool_call: {
          ...createSteelPaddleOcrToolCall({
            providerToolCallId,
            toolName,
            args,
            output,
          }),
          progress: 1,
        },
      },
    },
  };
}

async function emitSteelPaddleOcrToolStart({
  req,
  res,
  streamId,
  requestId,
  stepId,
  providerToolCallId,
  toolName,
  args,
  index,
}) {
  let historyChanged = false;
  if (typeof upsertSteelNativePreflightToolCall === 'function') {
    historyChanged = upsertSteelNativePreflightToolCall(
      req?.steelNativeContext?.steelHistory,
      createSteelPaddleOcrHistoryToolCall({
        providerToolCallId,
        toolName,
        args,
        progress: 0,
      }),
    );
  }
  await emitSteelNativeEvents({
    req,
    res,
    streamId,
    historyChanged,
    events: [
      createSteelPaddleOcrRunStepEvent({
        requestId,
        stepId,
        providerToolCallId,
        toolName,
        index,
      }),
      createSteelPaddleOcrRunStepDeltaEvent({
        stepId,
        providerToolCallId,
        toolName,
        args,
        index,
      }),
    ],
  });
}

async function emitSteelPaddleOcrToolCompleted({
  req,
  res,
  streamId,
  stepId,
  providerToolCallId,
  toolName,
  args,
  output,
  index,
}) {
  let historyChanged = false;
  if (typeof upsertSteelNativePreflightToolCall === 'function') {
    historyChanged = upsertSteelNativePreflightToolCall(
      req?.steelNativeContext?.steelHistory,
      createSteelPaddleOcrHistoryToolCall({
        providerToolCallId,
        toolName,
        args,
        output,
        progress: 1,
      }),
    );
  }
  await emitSteelNativeEvents({
    req,
    res,
    streamId,
    historyChanged,
    events: [
      createSteelPaddleOcrRunStepCompletedEvent({
        stepId,
        providerToolCallId,
        toolName,
        args,
        output,
        index,
      }),
    ],
  });
}

async function invokeLoadedTool(tool, args, config) {
  if (typeof tool?.invoke === 'function') {
    return await tool.invoke(args, config);
  }
  if (typeof tool?._call === 'function') {
    return await tool._call(args, config);
  }
  throw new Error(`Loaded tool "${tool?.name ?? 'unknown'}" is not invokable`);
}

function createSteelPaddleOcrChunkRunner({
  req,
  res,
  signal,
  agent,
  streamId,
  conversationId,
  requestId,
  toolName,
  userMCPAuthMap,
  requestScopedConnections,
  refreshArtifact,
  getNextIndex,
  onChunkResult,
}) {
  let paddleTool;
  let configurable;
  let lastTaskCompletedAt;

  const ensureTool = async () => {
    if (paddleTool) {
      return;
    }
    const loaded = await loadSteelPaddleOcrPreflightTool({
      req,
      res,
      signal,
      agent,
      toolName,
      streamId,
      userMCPAuthMap,
      requestScopedConnections,
    });
    paddleTool = loaded.paddleTool;
    configurable = loaded.configurable;
    if (!paddleTool) {
      throw new Error('missing_paddleocr_tool');
    }
  };

  const chunkExecutor = {
    async run({ file, chunk, artifact }) {
      const providerToolCallId = `${getSteelPaddleOcrPreflightToolCallId(file.ocrFileKey)}_pages_${chunk.pageStart}_${chunk.pageEnd}`;
      const stepId = getSteelPaddleOcrPreflightStepId(providerToolCallId);
      const index = getNextIndex();
      let currentArtifact = artifact;
      const createArgs = () => ({
        input_data: currentArtifact.filepath,
        output_mode: 'detailed',
        return_images: false,
        runtime_params: {
          use_doc_orientation_classify: true,
          use_doc_unwarping: true,
          use_layout_detection: true,
        },
      });
      let args = createArgs();

      await emitSteelPaddleOcrToolStart({
        req,
        res,
        streamId,
        requestId,
        stepId,
        providerToolCallId,
        toolName,
        args,
        index,
      });

      let lastError;
      let attemptsUsed = 0;
      let invokeAttemptsUsed = 0;
      for (let attemptIndex = 0; attemptIndex < steelPaddleOcrMaxAttempts; attemptIndex += 1) {
        attemptsUsed = attemptIndex + 1;
        let timeoutSignal;
        let result;
        try {
          if (attemptIndex > 0 && refreshArtifact) {
            currentArtifact = await refreshArtifact({ file, chunk, artifact: currentArtifact });
            args = createArgs();
          }
          await ensureTool();
          invokeAttemptsUsed += 1;
          timeoutSignal = AbortSignal.timeout(steelPaddleOcrCallTimeoutMs);
          const callSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
          result = await invokeLoadedTool(
            paddleTool,
            args,
            createSteelPaddleOcrInvokeConfig({
              configurable,
              req,
              agent,
              conversationId,
              requestId,
              signal: callSignal,
              providerToolCallId,
              toolName,
              args,
            }),
          );
          const resultError = getPaddleOcrResultError(result);
          if (resultError) {
            const resultErrorObject = new Error(resultError);
            if (isPaddleOcrDiagnosticCode(result?.diagnosticCode)) {
              Object.defineProperty(resultErrorObject, 'diagnosticCode', {
                value: result.diagnosticCode,
                enumerable: false,
                configurable: true,
              });
            }
            throw resultErrorObject;
          }
        } catch (caughtError) {
          if (signal?.aborted) {
            throw getParentAbortError(signal);
          }
          const error = timeoutSignal?.aborted
            ? createSteelPaddleOcrCallTimeoutError()
            : caughtError;
          if (isAbortError(error, signal)) {
            throw error;
          }
          lastError = error;
          const canRetry =
            attemptIndex < steelPaddleOcrMaxAttempts - 1 &&
            isRetryableSteelPaddleOcrPreflightError(error);
          if (!canRetry) {
            break;
          }

          await sleepSteelPaddleOcrRetry({ signal });
          if (isTransportSteelPaddleOcrPreflightError(error)) {
            try {
              const rebuilt = await rebuildSteelPaddleOcrPreflightTool({
                req,
                res,
                signal,
                agent,
                streamId,
                toolName,
                conversationId,
                requestId,
                file,
                error,
                userMCPAuthMap,
                requestScopedConnections,
              });
              if (!rebuilt.paddleTool) {
                const rebuildError = new Error('missing_paddleocr_tool_after_rebuild');
                lastError = retainProviderErrorWithRebuildFailure(error, rebuildError);
                break;
              }
              paddleTool = rebuilt.paddleTool;
              configurable = rebuilt.configurable;
            } catch (rebuildError) {
              lastError = retainProviderErrorWithRebuildFailure(error, rebuildError);
              paddleTool = undefined;
              break;
            }
          }
          continue;
        }

        const rawOcrText = getPaddleOcrResultContent(result);
        const rawResultHash = hashPaddleOcrText(rawOcrText);
        await emitSteelPaddleOcrToolCompleted({
          req,
          res,
          streamId,
          stepId,
          providerToolCallId,
          toolName,
          args,
          output: createPaddleOcrChunkToolOutput({
            file,
            chunk,
            rawOcrText,
            rawResultHash,
          }),
          index,
        });
        onChunkResult?.(
          createPaddleOcrChunkStatus({
            file,
            chunk,
            paddleocr: 'ok',
          }),
        );
        return {
          rawResult: result,
          rawOcrText,
          rawResultHash,
          artifact: currentArtifact,
        };
      }

      const error = lastError ?? new Error('PaddleOCR preflight failed');
      const safeErrorMessage = getSafeSteelPaddleOcrErrorMessage(error);
      const exhaustedError = new Error(
        attemptsUsed > 1
          ? `PaddleOCR failed for pages ${chunk.pageStart}-${chunk.pageEnd} after ${attemptsUsed} attempts: ${safeErrorMessage}`
          : safeErrorMessage,
      );
      exhaustedError.cause = error;
      if (isPaddleOcrDiagnosticCode(error?.diagnosticCode)) {
        Object.defineProperty(exhaustedError, 'diagnosticCode', {
          value: error.diagnosticCode,
          enumerable: false,
          configurable: true,
        });
      }
      if (typeof currentArtifact?.filepath === 'string') {
        exhaustedError.ocrFileUrl = currentArtifact.filepath;
      }
      exhaustedError.ocrAdaptiveSplitEligible = invokeAttemptsUsed === steelPaddleOcrMaxAttempts;
      await emitSteelPaddleOcrToolCompleted({
        req,
        res,
        streamId,
        stepId,
        providerToolCallId,
        toolName,
        args,
        output: createPaddleOcrChunkFailureToolOutput({
          file,
          chunk,
          errorMessage: exhaustedError.message,
          diagnosticCode: exhaustedError.diagnosticCode,
          attemptsUsed,
        }),
        index,
      });
      onChunkResult?.(
        createPaddleOcrChunkStatus({
          file,
          chunk,
          paddleocr: 'fail',
        }),
      );
      throw exhaustedError;
    },
  };

  return {
    async runChunk(input) {
      if (lastTaskCompletedAt !== undefined) {
        const elapsed = performance.now() - lastTaskCompletedAt;
        if (elapsed < steelPaddleOcrTaskIntervalMs) {
          await sleepSteelPaddleOcrDelay({
            signal,
            delay: steelPaddleOcrTaskIntervalMs - elapsed,
            abortMessage: 'OCR task interval aborted',
          });
        }
      }

      try {
        return await chunkExecutor.run(input);
      } finally {
        lastTaskCompletedAt = performance.now();
      }
    },
  };
}

function createPreflightResult({
  status,
  completedKeys,
  attemptedKeys,
  failedKeys,
  skippedReason,
  currentPaddleOcrResults = [],
  currentPaddleOcrStatuses = [],
  currentOcrMarkdownResults = [],
  currentOcrFailures = [],
  currentOcrSourceFileMapping = [],
  previousOcrResultMarkdown,
  suggestedOcrResultColumns = [],
  totalSavedCounts,
  totalTableCounts,
}) {
  const ocrTurnActive =
    attemptedKeys.length > 0 ||
    currentOcrMarkdownResults.length > 0 ||
    currentOcrFailures.length > 0;
  return {
    status,
    ocrTurnActive,
    completedKeys,
    attemptedKeys,
    failedKeys,
    skippedReason,
    currentPaddleOcrResults,
    ...(currentPaddleOcrStatuses.length > 0 ? { currentPaddleOcrStatuses } : {}),
    ...(currentOcrMarkdownResults.length > 0 ? { currentOcrMarkdownResults } : {}),
    ...(currentOcrFailures.length > 0 ? { currentOcrFailures } : {}),
    ...(currentOcrSourceFileMapping.length > 0 ? { currentOcrSourceFileMapping } : {}),
    ...(typeof previousOcrResultMarkdown === 'string' ? { previousOcrResultMarkdown } : {}),
    ...(suggestedOcrResultColumns.length > 0 ? { suggestedOcrResultColumns } : {}),
    ...(totalSavedCounts ? { totalSavedCounts } : {}),
    ...(totalTableCounts ? { totalTableCounts } : {}),
  };
}

function getSuggestedOcrResultColumns(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return [];
  }
  const parsedDocument = parseAssistantMarkdown(markdown);
  const resultSection = parsedDocument.sections.find(({ title }) => title === 'ocr_result');
  const parsedTable = parseOcrResultTable(resultSection?.body ?? markdown);
  return parsedTable.ok ? [...parsedTable.table.headers] : [];
}

function normalizeSafeSteelAiUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function createCurrentOcrFailureResult({ file, result, errorMessage }) {
  const fileUrl = [
    result?.fileUrl,
    result?.ocrFileUrl,
    result?.file?.filepath,
    result?.file?.path,
    file?.filepath,
    file?.path,
  ]
    .map(normalizeSafeSteelAiUrl)
    .find((value) => value !== undefined);
  const sourceCode = getSteelOcrSourceCode(result?.file?.sourceCode ?? file?.sourceCode);
  const sourceFilename = typeof file?.sourceFilename === 'string' ? file.sourceFilename : '';
  return {
    ocrFileKey: result?.file?.ocrFileKey ?? file?.ocrFileKey,
    filename: result?.file?.filename ?? file?.filename,
    mediaType: result?.file?.mediaType ?? file?.mediaType,
    ...(sourceCode ? { sourceCode } : {}),
    sourceFilename,
    ...(fileUrl ? { fileUrl } : {}),
    stage: result?.stage ?? 'preflight',
    ...(result?.chunkIndex !== undefined ? { chunkIndex: result.chunkIndex } : {}),
    ...(result?.pageStart !== undefined ? { pageStart: result.pageStart } : {}),
    ...(result?.pageEnd !== undefined ? { pageEnd: result.pageEnd } : {}),
    ...(isPaddleOcrDiagnosticCode(result?.diagnosticCode)
      ? { diagnosticCode: result.diagnosticCode }
      : {}),
    errorMessage: redactMessage(
      result?.errorMessage ?? errorMessage ?? 'OCR preprocessing failed',
      512,
    ),
  };
}

function sanitizeCurrentOcrPageRanges(pageRanges, chunkCount, { allowGaps = false } = {}) {
  if (
    !Array.isArray(pageRanges) ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 1 ||
    pageRanges.length !== chunkCount
  ) {
    return [];
  }

  const sanitized = [];
  for (const range of pageRanges) {
    if (
      !Number.isInteger(range?.pageStart) ||
      range.pageStart < 1 ||
      !Number.isInteger(range?.pageEnd) ||
      range.pageEnd < range.pageStart
    ) {
      return [];
    }
    const previous = sanitized[sanitized.length - 1];
    if (
      previous &&
      (range.pageStart <= previous.pageEnd ||
        (!allowGaps && range.pageStart !== previous.pageEnd + 1))
    ) {
      return [];
    }
    sanitized.push({ pageStart: range.pageStart, pageEnd: range.pageEnd });
  }
  return sanitized;
}

function createCurrentOcrMergedMarkdownResult({
  file,
  markdown,
  chunkCount,
  pageRanges = [],
  ocrRuleVersion,
  partial = false,
}) {
  const safeOcrFileKey = normalizeOcrOrganizerFileKey({
    fileKey:
      file?.ocrFileKey ??
      file?.fileId ??
      file?.file_id ??
      file?.id ??
      file?.storageKey ??
      file?.storage_key ??
      file?.filepath ??
      file?.path ??
      '',
    fileId: file?.fileId ?? file?.file_id ?? file?.id,
  });
  const sourcePdfKey = file?.sourcePdfKey;
  const sourceCode = getSteelOcrSourceCode(file?.sourceCode);
  const sourceFilename = typeof file?.sourceFilename === 'string' ? file.sourceFilename : '';
  const visibleFile = { ...file };
  delete visibleFile.sourceCode;
  delete visibleFile.sourceFilename;
  for (const key of [
    'sourcePdfKey',
    'filepath',
    'path',
    'fileUrl',
    'file_url',
    'ocrFileUrl',
    'ocr_file_url',
    'url',
    'downloadUrl',
    'download_url',
    'sourceUrl',
    'source_url',
  ]) {
    delete visibleFile[key];
  }
  for (const key of ['storageKey', 'storage_key']) {
    if (isHttpUrl(visibleFile[key])) {
      delete visibleFile[key];
    }
  }
  return {
    ...visibleFile,
    ...(sourceCode ? { sourceCode } : {}),
    sourceFilename,
    ocrFileKey: safeOcrFileKey,
    kind: 'ocr_preprocessing_merged_markdown',
    ocrSource: 'ocr_preprocessing_merge',
    content: labelOcrMarkdownResultContent(safeOcrFileKey, markdown),
    ocrPreprocessing: {
      pipelineVersion: ocrPreprocessingPipelineVersion,
      ...(isHttpUrl(sourcePdfKey) ? {} : { sourcePdfKey }),
      chunkCount,
      pageRanges: sanitizeCurrentOcrPageRanges(pageRanges, chunkCount, { allowGaps: partial }),
      ocrRuleVersion,
      source: 'paddleocr_markdowns',
      ...(partial ? { partial: true } : {}),
    },
  };
}

function getCurrentOcrPartialMarkdownResult({ fileResult, ocrRuleVersion }) {
  const partial = fileResult?.partial;
  let markdown = '';
  if (typeof fileResult?.partialMarkdown === 'string') {
    markdown = fileResult.partialMarkdown;
  } else if (typeof partial?.markdown === 'string') {
    markdown = partial.markdown;
  }
  if (!markdown.trim()) {
    return undefined;
  }

  let pageRanges = [];
  if (Array.isArray(partial?.pageRanges)) {
    pageRanges = partial.pageRanges;
  }
  if (Array.isArray(fileResult?.partialPageRanges)) {
    pageRanges = fileResult.partialPageRanges;
  }
  let chunkCount = pageRanges.length;
  if (Number.isInteger(partial?.chunkCount) && partial.chunkCount > 0) {
    chunkCount = partial.chunkCount;
  }
  if (Number.isInteger(fileResult?.partialChunkCount) && fileResult.partialChunkCount > 0) {
    chunkCount = fileResult.partialChunkCount;
  }
  if (chunkCount < 1) {
    return undefined;
  }

  return createCurrentOcrMergedMarkdownResult({
    file: fileResult.file,
    markdown,
    chunkCount,
    pageRanges,
    ocrRuleVersion,
    partial: true,
  });
}

function labelOcrMarkdownResultContent(ocrFileKey, markdown) {
  return `<${ocrFileKey}>\n${markdown}`;
}

function createPaddleOcrChunkToolOutput({ file, chunk, rawOcrText, rawResultHash }) {
  return {
    status: 'completed',
    paddleocr: 'ok',
    ocrEngine: 'paddleocr_vl',
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    rawTextLength: rawOcrText.length,
    dataSizeBytes: Buffer.byteLength(rawOcrText, 'utf8'),
    rawResultHash,
    outputStorage: 'steel_working_order_memory:paddleocr_preflight',
  };
}

function createPaddleOcrChunkStatus({ file, chunk, paddleocr }) {
  const isImage = String(file?.mediaType ?? '')
    .trim()
    .toLowerCase()
    .startsWith('image/');
  return {
    paddleocr,
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    mediaType: file.mediaType,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    ...(!isImage ? { pageStart: chunk.pageStart, pageEnd: chunk.pageEnd } : {}),
  };
}

function getFinalPaddleOcrChunkStatuses(statuses) {
  return statuses.filter((status, index) => {
    if (
      status.paddleocr !== 'fail' ||
      !Number.isSafeInteger(status.pageStart) ||
      !Number.isSafeInteger(status.pageEnd)
    ) {
      return true;
    }
    const childRanges = statuses
      .slice(index + 1)
      .filter(
        (candidate) =>
          candidate.ocrFileKey === status.ocrFileKey &&
          Number.isSafeInteger(candidate.pageStart) &&
          Number.isSafeInteger(candidate.pageEnd) &&
          candidate.pageStart >= status.pageStart &&
          candidate.pageEnd <= status.pageEnd &&
          (candidate.pageStart > status.pageStart || candidate.pageEnd < status.pageEnd),
      )
      .sort((left, right) => left.pageStart - right.pageStart);
    let nextPage = status.pageStart;
    for (const child of childRanges) {
      if (child.pageStart > nextPage) {
        return true;
      }
      nextPage = Math.max(nextPage, child.pageEnd + 1);
      if (nextPage > status.pageEnd) {
        return false;
      }
    }
    return true;
  });
}

function createPaddleOcrChunkFailureToolOutput({
  file,
  chunk,
  errorMessage,
  diagnosticCode,
  attemptsUsed,
}) {
  return {
    status: 'failed',
    paddleocr: 'fail',
    ocrEngine: 'paddleocr_vl',
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    attemptsUsed,
    ...(isPaddleOcrDiagnosticCode(diagnosticCode) ? { diagnosticCode } : {}),
    errorMessage: getSafeSteelPaddleOcrErrorMessage(new Error(errorMessage)),
  };
}

async function runSteelPaddleOcrPreflight({
  req,
  res,
  signal,
  agent,
  streamId = null,
  userMCPAuthMap,
  requestScopedConnections,
}) {
  if (req?.steelNativeContext) {
    ensureSteelNativeHistory(req.steelNativeContext);
  }
  const conversationId = getRequestConversationId(req);
  const turnIndex = req?.steelNativeContext?.assistantTurnIndex;
  const checkpointTurnIndex = req?.steelNativeContext?.memoryCheckpointTurnIndex;
  const requestId = req?.steelNativeContext?.requestId;
  const files = req?.steelNativeContext?.currentTurnFiles ?? [];
  const attemptedKeys = [];
  const failedKeys = [];
  const currentPaddleOcrResults = [];
  const currentPaddleOcrStatuses = [];
  const currentOcrMarkdownResults = [];
  const currentOcrFailures = [];
  let currentPaddleOcrSavedCount = 0;
  let nextToolEventIndex = 0;
  const getNextToolEventIndex = () => nextToolEventIndex++;
  const finishPreflight = async (result) => {
    await emitSteelNativeEvents({
      req,
      res,
      streamId,
      events: buildSteelPaddleOcrPreflightEventEnvelopes({
        conversationId,
        requestId,
        messageId: requestId,
        preflight: {
          ...result,
          paddleOcrSavedCount: currentPaddleOcrSavedCount,
        },
      }),
    });
    return result;
  };

  if (!conversationId) {
    return finishPreflight(
      createPreflightResult({
        status: 'skipped',
        completedKeys: [],
        attemptedKeys,
        failedKeys,
        skippedReason: 'missing_conversation_id',
      }),
    );
  }
  if (turnIndex === undefined) {
    return finishPreflight(
      createPreflightResult({
        status: 'skipped',
        completedKeys: [],
        attemptedKeys,
        failedKeys,
        skippedReason: 'missing_turn_index',
      }),
    );
  }
  if (!Array.isArray(files) || files.length === 0) {
    return finishPreflight(
      createPreflightResult({
        status: 'skipped',
        completedKeys: [],
        attemptedKeys,
        failedKeys,
        skippedReason: 'no_current_files',
      }),
    );
  }

  const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
  const ocrStateService =
    mongoose.connection.readyState === 1 ? createSteelDelegateOcrStateService(mongoose) : undefined;
  const conversationOcrState = ocrStateService
    ? await ocrStateService.readConversationOcrState(conversationId)
    : undefined;
  const previousOcrResultMarkdown = conversationOcrState?.currentOcrResultMarkdown;
  const suggestedOcrResultColumns = getSuggestedOcrResultColumns(previousOcrResultMarkdown);
  let sourceCodeIndex = 0;
  const currentTargets = files
    .map((file) => {
      const descriptor = getSteelOcrFileDescriptor(file);
      if (!descriptor) {
        return undefined;
      }
      sourceCodeIndex += 1;
      return {
        originalFile: file,
        descriptor,
        sourceCode: `F${sourceCodeIndex}`,
      };
    })
    .filter((target) => target !== undefined);
  const fileRecordsById = await getSteelCurrentFileRecords(req, files);
  for (const target of currentTargets) {
    const fileId = target.descriptor.fileId;
    const sourceFilename =
      fileId && typeof fileRecordsById.get(fileId)?.filename === 'string'
        ? fileRecordsById.get(fileId).filename.trim()
        : '';
    if (!fileId || !sourceFilename) {
      continue;
    }
    if (!ocrStateService) {
      continue;
    }
    const mapping = await ocrStateService.allocateDelegateSourceMapping({
      conversationId,
      fileId,
      sourceFilename,
    });
    target.sourceCode = mapping.sourceCode;
  }
  const currentOcrSourceFileMapping = ocrStateService
    ? (await ocrStateService.readSourceMappings(conversationId)).map(
        ({ sourceCode, sourceFilename }) => ({ sourceCode, sourceFilename }),
      )
    : currentTargets.map(({ descriptor, sourceCode }) => ({
        sourceCode,
        sourceFilename:
          descriptor.fileId && typeof fileRecordsById.get(descriptor.fileId)?.filename === 'string'
            ? fileRecordsById.get(descriptor.fileId).filename.trim()
            : '',
      }));
  const toolName = buildMCPToolKey(steelPaddleOcrToolName, steelPaddleOcrMcpServerName);

  if (currentTargets.length === 0) {
    return finishPreflight(
      createPreflightResult({
        status: 'skipped',
        completedKeys: [],
        attemptedKeys,
        failedKeys,
        skippedReason: 'no_ocr_capable_files',
      }),
    );
  }

  let ocrPreprocessingRules;
  const ocrPreprocessingChunkSizePages = resolveOcrPreprocessingChunkSizePages();
  const batchFiles = [];
  for (const target of currentTargets) {
    const fileRecord = target.descriptor.fileId
      ? fileRecordsById.get(target.descriptor.fileId)
      : undefined;
    const preprocessingFile = toSteelOcrPreprocessingFile(
      {
        ...target.originalFile,
        ...target.descriptor,
        sourceCode: target.sourceCode,
      },
      fileRecord,
    );
    if (!preprocessingFile) {
      continue;
    }

    attemptedKeys.push(preprocessingFile.ocrFileKey);
    try {
      ocrPreprocessingRules ??= await resolveSteelOcrPreprocessingRules();
      let chunks;
      let artifacts;
      const stateInput = createOcrPreprocessingStateInput({
        conversationId,
        file: preprocessingFile,
        ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
      });
      const existingState = await writer.readOcrPreprocessingState(stateInput);
      const reusableChunks = toReusableOcrPreprocessingChunks(
        existingState,
        ocrPreprocessingChunkSizePages,
      );

      if (reusableChunks && isPdfSteelFile(preprocessingFile) && fileRecord) {
        const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);
        const artifactRows =
          (await repository.findBySourcePdfKey({
            sourcePdfKey: preprocessingFile.sourcePdfKey,
            pipelineVersion: ocrPreprocessingPipelineVersion,
          })) ?? [];
        const canonicalChunks = resolveCanonicalOcrPageChunks({
          defaultChunks: reusableChunks,
          artifactRows,
        });
        const reusablePlanIsCanonical =
          canonicalChunks.length === reusableChunks.length &&
          canonicalChunks.every(
            (chunk, index) =>
              chunk.pageStart === reusableChunks[index]?.pageStart &&
              chunk.pageEnd === reusableChunks[index]?.pageEnd,
          );
        if (reusablePlanIsCanonical) {
          chunks = canonicalChunks;
          artifacts = createSteelOcrOriginalFileArtifactStore({
            file: preprocessingFile,
            fileRecord,
          });
        }
      }

      if (!chunks && reusableChunks && !(isPdfSteelFile(preprocessingFile) && fileRecord)) {
        chunks = reusableChunks;
        artifacts = createSteelOcrOriginalFileArtifactStore({
          file: preprocessingFile,
          fileRecord,
        });
      } else if (!chunks && isPdfSteelFile(preprocessingFile) && fileRecord) {
        const pdfBytes = await readSteelStoredFileBytes({ req, fileRecord });
        const pageCount = await getPdfPageCount({ pdfBytes });
        chunks = buildPdfPageChunks({
          pageCount,
          chunkSizePages: ocrPreprocessingChunkSizePages,
        });
        artifacts = createSteelOcrPdfChunkArtifactStore({
          file: preprocessingFile,
          fileRecord,
          pdfBytes,
        });
      } else if (!chunks) {
        chunks = buildSingleOriginalOcrChunk();
        artifacts = createSteelOcrOriginalFileArtifactStore({
          file: preprocessingFile,
          fileRecord,
        });
      }
      batchFiles.push({
        file: preprocessingFile,
        chunks,
        artifacts,
      });
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      const errorMessage = redactMessage(error?.message ?? 'OCR preprocessing failed', 512);
      failedKeys.push(preprocessingFile.ocrFileKey);
      await emitSteelNativeEvents({
        req,
        res,
        streamId,
        events: buildSteelOcrPreprocessingEventEnvelopes({
          conversationId,
          requestId,
          messageId: requestId,
          ocrFileKey: preprocessingFile.ocrFileKey,
          filename: preprocessingFile.filename,
          progress: {
            stage: 'failed',
            errorMessage,
          },
        }),
      });
      currentOcrFailures.push(
        createCurrentOcrFailureResult({ file: preprocessingFile, result: error, errorMessage }),
      );
      logger.warn('[Steel OCR] OCR preprocessing pipeline failed for current PDF', {
        conversationId,
        requestId,
        ocrFileKey: preprocessingFile.ocrFileKey,
        error: errorMessage,
      });
    }
  }

  if (batchFiles.length > 0) {
    try {
      ocrPreprocessingRules ??= await resolveSteelOcrPreprocessingRules();
      const preprocessingMemory = {
        readOcrPreprocessingState: (input) => writer.readOcrPreprocessingState(input),
        capturePaddleOcrChunkResult: (input) =>
          writer.capturePaddleOcrChunkResult({
            ...input,
            file: withoutSteelOcrSourceCode(input.file),
          }),
        captureOcrPreprocessingChunkMarkdown: (input) =>
          writer.captureOcrPreprocessingChunkMarkdown({
            ...input,
            file: withoutSteelOcrSourceCode(input.file),
          }),
      };
      const batchResult = await runOcrPreprocessingBatchPipeline({
        conversationId,
        requestId,
        turnIndex,
        checkpointTurnIndex: checkpointTurnIndex ?? Math.max(0, turnIndex - 1),
        signal,
        files: batchFiles,
        ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
        ocrRulesText: ocrPreprocessingRules.ocrRulesText,
        memory: preprocessingMemory,
        organizer: createSteelOcrOrganizer({ agent, signal }),
        paddleOcr: createSteelPaddleOcrChunkRunner({
          req,
          res,
          signal,
          agent,
          streamId,
          conversationId,
          requestId,
          toolName,
          userMCPAuthMap,
          requestScopedConnections,
          refreshArtifact: async ({ file, chunk, artifact }) => {
            const batchFile = batchFiles.find((entry) => entry.file.ocrFileKey === file.ocrFileKey);
            return batchFile?.artifacts.refreshPdfChunkArtifact
              ? batchFile.artifacts.refreshPdfChunkArtifact({ file, chunk, artifact })
              : artifact;
          },
          getNextIndex: getNextToolEventIndex,
          onChunkResult: (status) => currentPaddleOcrStatuses.push(status),
        }),
        onProgress: ({ file, progress }) => {
          if (progress.stage === 'paddleocr_chunk_saved') {
            currentPaddleOcrSavedCount += 1;
          }
          return emitSteelNativeEvents({
            req,
            res,
            streamId,
            events: buildSteelOcrPreprocessingEventEnvelopes({
              conversationId,
              requestId,
              messageId: requestId,
              ocrFileKey: file.ocrFileKey,
              filename: file.filename,
              progress,
            }),
          });
        },
      });

      for (const fileResult of batchResult.files) {
        if (fileResult.status === 'failed') {
          if (!failedKeys.includes(fileResult.file.ocrFileKey)) {
            failedKeys.push(fileResult.file.ocrFileKey);
          }
          const partialMarkdownResult = getCurrentOcrPartialMarkdownResult({
            fileResult,
            ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
          });
          if (partialMarkdownResult) {
            currentOcrMarkdownResults.push(partialMarkdownResult);
          }
          const failures =
            Array.isArray(fileResult.failures) && fileResult.failures.length > 0
              ? fileResult.failures
              : [fileResult];
          const currentFileFailures = failures.map((failure) =>
            createCurrentOcrFailureResult({ file: fileResult.file, result: failure }),
          );
          const missingPageRangesByFileKey =
            groupSteelOcrMissingPageRangesByFileKey(currentFileFailures);
          currentOcrFailures.push(...currentFileFailures);
          await emitSteelNativeEvents({
            req,
            res,
            streamId,
            events: buildSteelOcrPreprocessingEventEnvelopes({
              conversationId,
              requestId,
              messageId: requestId,
              ocrFileKey: fileResult.file.ocrFileKey,
              filename: fileResult.file.filename,
              progress: {
                stage: 'failed',
                errorMessage: fileResult.errorMessage,
                ...(Object.keys(missingPageRangesByFileKey).length > 0
                  ? { missingPageRangesByFileKey }
                  : {}),
              },
            }),
          });
          continue;
        }
        currentOcrMarkdownResults.push(
          createCurrentOcrMergedMarkdownResult({
            file: fileResult.file,
            markdown: fileResult.markdown,
            chunkCount: fileResult.chunkCount,
            pageRanges: fileResult.pageRanges,
            ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
          }),
        );
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      const errorMessage = redactMessage(error?.message ?? 'OCR preprocessing failed', 512);
      const failedBatchFiles = [];
      for (const entry of batchFiles) {
        const file = entry.file;
        failedBatchFiles.push(file);
        if (!failedKeys.includes(file.ocrFileKey)) {
          failedKeys.push(file.ocrFileKey);
        }
        currentOcrFailures.push(
          createCurrentOcrFailureResult({ file, result: error, errorMessage }),
        );
        await emitSteelNativeEvents({
          req,
          res,
          streamId,
          events: buildSteelOcrPreprocessingEventEnvelopes({
            conversationId,
            requestId,
            messageId: requestId,
            ocrFileKey: file.ocrFileKey,
            filename: file.filename,
            progress: {
              stage: 'failed',
              errorMessage,
            },
          }),
        });
      }
      logger.warn('[Steel OCR] OCR preprocessing batch failed for current files', {
        conversationId,
        requestId,
        ocrFileKeys: failedBatchFiles.map((file) => file.ocrFileKey),
        error: errorMessage,
      });
    }
  }

  return finishPreflight(
    createPreflightResult({
      status: failedKeys.length > 0 ? 'partial' : 'completed',
      completedKeys: uniqueStrings(attemptedKeys.filter((key) => !failedKeys.includes(key))),
      attemptedKeys,
      failedKeys,
      skippedReason: undefined,
      currentOcrSourceFileMapping,
      previousOcrResultMarkdown,
      suggestedOcrResultColumns,
      currentPaddleOcrResults,
      currentPaddleOcrStatuses: getFinalPaddleOcrChunkStatuses(currentPaddleOcrStatuses),
      currentOcrMarkdownResults,
      currentOcrFailures,
    }),
  );
}

module.exports = {
  registerSteelToolLoader,
  isHttpUrl,
  getSteelFileId,
  isPdfSteelFile,
  getMessageContentText,
  createSteelOcrOrganizer,
  runSteelPaddleOcrPreflight,
  toSteelOcrPreprocessingFile,
  buildSingleOriginalOcrChunk,
  getSuggestedOcrResultColumns,
  createSteelPaddleOcrChunkRunner,
  createSteelPaddleOcrRunStepEvent,
  resolveSteelOcrPreprocessingRules,
  extractCanonicalDelegateOcrResult,
  createSteelOcrPdfChunkArtifactStore,
  createSteelPaddleOcrRunStepDeltaEvent,
  createSteelPaddleOcrRunStepCompletedEvent,
};
