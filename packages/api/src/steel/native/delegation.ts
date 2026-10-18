import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { FileSources } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AllMethods, IMongoFile, ISteelDelegateOcrRun } from '@librechat/data-schemas';
import type {
  OcrPdfChunkArtifact,
  PaddleOcrChunkRunner,
  OcrPreprocessingArtifactStore,
  OcrPreprocessingPipelineProgress,
} from '../ocr/preprocess';
import type {
  DelegateOcrClaim,
  DelegateExecutionLease,
  SteelDelegateOcrStateService,
} from '../ocr/state';
import type {
  DelegateOcrPolicy,
  DelegateOcrFileInput,
  DelegateOcrFileRecord,
  DelegateOcrExecuteInput,
  DelegateOcrPreparedBatch,
  DelegateOcrWorkflowInput,
  DelegateOcrAvailableFile,
  DelegateOcrStoredFileRecord,
  InvokeDelegateOcrModelInput,
  RunDelegateOcrPreprocessing,
  PrepareDelegateOcrBatchesInput,
} from './delegate';
import type {
  SteelOcrFile,
  SteelOcrPreprocessingRules,
  SteelOcrPreprocessingSourceFile,
} from '../ocr/files';
import type { OcrPreprocessingPageChunk } from '../ocr/chunks';
import type { SteelRepositoryClient } from '../repositories/types';
import type { SteelNativeConversationInput } from './context';
import type { OpenAIOAuthModelOptions } from './oauth';
import type { SteelNativeHistory } from './events';
import type { SteelOcrService } from '../ocr/preflight';
import type { SteelPaddleOcrAgent } from '../ocr/paddle';
import type { SteelOcrOrganizerAgent } from '../ocr/agent';
import type { SteelOcrPdfChunkArtifactStore, SteelOcrStoredArtifact } from '../ocr/storage';
import {
  isHttpUrl,
  isPdfSteelFile,
  getSteelFileId,
  getMessageContentText,
  buildSingleOriginalOcrChunk,
  toSteelOcrPreprocessingFile,
  getSuggestedOcrResultColumns,
  extractCanonicalDelegateOcrResult,
} from '../ocr/files';
import {
  delegateOcrArgsSchema,
  resolveDelegateOcrPolicy,
  normalizeDelegateOcrChunk,
  isDelegateOcrQuoteOnlyTurn,
  createDelegateOcrRequestExecute,
} from './delegate';
import { createMongooseSteelWorkingOrderMemoryWriter } from '../memory/service';
import { buildSteelDelegateOcrStatusEventEnvelopes } from './events';
import { createSteelDelegateOcrStateService } from '../ocr/state';
import { runOcrPreprocessingBatchPipeline } from '../ocr/preprocess';
import { createSteelOcrResponseAuditService } from '../ocr/audit';
import { PADDLE_OCR_MCP_SERVER_NAME } from '../ocr/diagnostics';
import { buildDefaultSteelGlobalAgentContext } from './context';
import { buildMCPToolKey } from '~/mcp/utils';
import { steelPaddleOcrToolName } from '../ocr/paddle';
import { createOpenAIOAuthModel } from './oauth';
import { emitSteelNativeEvents } from './stream';

/** The agent config a delegate OCR run hands to the OCR organizer and PaddleOCR runner. */
export type SteelDelegateOcrAgent = SteelPaddleOcrAgent & SteelOcrOrganizerAgent;

/** The workflow object shared with the delegate executor across one tool call. */
export interface SteelDelegateOcrWorkflow extends DelegateOcrWorkflowInput {
  delegateOcrIndex?: number;
  delegateOcrClaimToken?: string;
  executionLeaseToken?: string;
  responseGenerationId?: string;
  triggeringMessageId?: string;
  previousOcrResultRevision?: string;
  sourceCodeByFileId?: Map<string, string>;
}

export type SteelDelegateOcrClaimRef = Omit<DelegateOcrClaim, 'claimedAt'>;

export interface SteelDelegateOcrResume {
  run: ISteelDelegateOcrRun;
  claim: SteelDelegateOcrClaimRef;
  lease?: DelegateExecutionLease;
  files: DelegateOcrFileInput[];
  records: IMongoFile[];
  policy: DelegateOcrPolicy;
  candidate?: NonNullable<ISteelDelegateOcrRun['finalizedCandidate']>;
}

export interface SteelDelegateOcrContext {
  modelOptions?: OpenAIOAuthModelOptions;
  steelConversation?: SteelNativeConversationInput;
  currentUserTurnText?: string;
  delegateOcrPolicy?: DelegateOcrPolicy & { reason?: string };
  delegateOcrWorkflow?: SteelDelegateOcrWorkflow;
  delegateOcrRun?: ISteelDelegateOcrRun;
  delegateOcrClaim?: SteelDelegateOcrClaimRef;
  delegateOcrExecutionLease?: DelegateExecutionLease;
  delegateOcrResume?: SteelDelegateOcrResume;
}

/** The request fields delegate OCR reads and the run state it leaves on the request. */
export interface SteelDelegateOcrRequest {
  _resumableJobCreatedAt?: number;
  user?: { id?: string; tenantId?: string };
  config?: { fileStrategy?: string };
  steelNativeContext?: {
    requestId?: string;
    conversationId?: string;
    assistantTurnIndex?: number;
    memoryCheckpointTurnIndex?: number;
    currentTurnFiles?: readonly SteelOcrFile[];
    steelHistory?: SteelNativeHistory;
    delegateOcrPolicy?: DelegateOcrPolicy;
    delegateOcrAuthorizedFilesPromise?: Promise<IMongoFile[] | null>;
    delegateOcrResume?: SteelDelegateOcrResume;
    delegateOcrContext?: SteelDelegateOcrContext;
  };
}

/** OCR building blocks delegate OCR reuses from the Steel OCR service. */
export type SteelDelegateOcrServices = Pick<
  SteelOcrService,
  | 'resolvePreprocessingRules'
  | 'createOrganizer'
  | 'createPaddleOcrChunkRunner'
  | 'createPdfChunkArtifactStore'
>;

export interface SteelDelegateOcrDependencies {
  db: Pick<AllMethods, 'getFiles'>;
  client: SteelRepositoryClient;
  getStrategy(source: string): {
    getDownloadURL?(input: { file: DelegateOcrStoredFileRecord }): Promise<string>;
  };
  ocr: SteelDelegateOcrServices;
  stateService?: SteelDelegateOcrStateService;
}

export interface CreateSteelDelegateOcrExecuteInput {
  req: SteelDelegateOcrRequest;
  res?: Response;
  streamId?: string | null;
  signal?: AbortSignal;
  agent?: SteelDelegateOcrAgent;
}

type DelegateBatchArtifactStore = OcrPreprocessingArtifactStore &
  Required<Pick<OcrPreprocessingArtifactStore, 'refreshPdfChunkArtifact'>>;

interface DelegateBatchPreprocessing {
  file: SteelOcrPreprocessingSourceFile;
  chunks: OcrPreprocessingPageChunk[];
  artifacts?: SteelOcrPdfChunkArtifactStore;
  artifact?: SteelOcrStoredArtifact;
}

type DelegateStatusEvent = Parameters<typeof buildSteelDelegateOcrStatusEventEnvelopes>[0];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function collectDelegateOcrAvailableFiles(
  req: SteelDelegateOcrRequest,
  delegateContext: SteelDelegateOcrContext | undefined,
): DelegateOcrAvailableFile[] {
  const filesById = new Map<string, DelegateOcrAvailableFile>();
  const addFiles = (files: readonly SteelOcrFile[] | undefined) => {
    for (const file of files ?? []) {
      const fileId = getSteelFileId(file);
      if (!fileId) {
        continue;
      }
      const filename = typeof file.filename === 'string' ? file.filename.trim() : undefined;
      const rawMediaType = file.mediaType ?? file.mimeType ?? file.type;
      const mediaType = typeof rawMediaType === 'string' ? rawMediaType.trim() : undefined;
      const current = filesById.get(fileId);
      const resolvedFilename = current?.filename ?? filename;
      const resolvedMediaType = current?.mediaType ?? mediaType;
      filesById.set(fileId, {
        fileId,
        ...(resolvedFilename ? { filename: resolvedFilename } : {}),
        ...(resolvedMediaType ? { mediaType: resolvedMediaType } : {}),
      });
    }
  };

  const conversation = delegateContext?.steelConversation;
  for (const message of conversation?.activeHistory ?? []) {
    addFiles(message.files);
  }
  addFiles(conversation?.currentUserTurn?.files);
  addFiles(req.steelNativeContext?.currentTurnFiles);
  return [...filesById.values()];
}

/** The user text delegate OCR answers: the controller's turn text, then the conversation's latest user turn. */
export function getDelegateOcrCurrentUserTurn(
  delegateContext: SteelDelegateOcrContext | undefined,
): string {
  if (isNonEmptyString(delegateContext?.currentUserTurnText)) {
    return delegateContext.currentUserTurnText;
  }
  const conversation = delegateContext?.steelConversation;
  const currentTurnText = getMessageContentText(conversation?.currentUserTurn);
  if (currentTurnText.trim() !== '') {
    return currentTurnText;
  }
  const latestUser = [...(conversation?.activeHistory ?? [])]
    .reverse()
    .find((message) => message.role === 'user');
  const latestUserText = getMessageContentText(latestUser);
  return latestUserText.trim() !== '' ? latestUserText : '';
}

function inferDelegateSuggestedOcrResultColumns(markdown: string): string[] {
  try {
    return getSuggestedOcrResultColumns(markdown);
  } catch {
    return [];
  }
}

/** The delegate_ocr tool params a run saved, validated against the tool schema. */
function readSavedDelegateFiles(run: ISteelDelegateOcrRun): DelegateOcrFileInput[] | undefined {
  const files = run.toolParameters?.files;
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }
  const parsed = delegateOcrArgsSchema.safeParse({ files });
  if (!parsed.success) {
    throw new Error('delegate_ocr resume parameters unavailable');
  }
  return parsed.data.files;
}

function createDelegateOcrArtifactStore({
  preprocessing,
  file,
  signedUrl,
}: {
  preprocessing: DelegateBatchPreprocessing | undefined;
  file: SteelOcrPreprocessingSourceFile;
  signedUrl: string | undefined;
}): DelegateBatchArtifactStore {
  const artifactStore = preprocessing?.artifacts;
  const preparedArtifact = preprocessing?.artifact;
  const chunk = preprocessing?.chunks[0];
  const storageKey = file.storageKey ?? file.filepath ?? signedUrl;
  const fallbackArtifact: OcrPdfChunkArtifact | undefined =
    chunk && storageKey
      ? {
          ...chunk,
          source: file.source === FileSources.cloudfront ? 'cloudfront' : 's3',
          storageKey,
          filepath: signedUrl ?? file.filepath ?? storageKey,
          artifactOrigin: 'original',
        }
      : undefined;

  return {
    async ensurePdfChunkArtifacts() {
      if (preparedArtifact) {
        return [{ ...preparedArtifact, filepath: signedUrl ?? preparedArtifact.filepath }];
      }
      if (artifactStore) {
        return artifactStore.ensurePdfChunkArtifacts({
          file,
          sourcePdfKey: file.sourcePdfKey,
          chunks: preprocessing?.chunks ?? [],
        });
      }
      if (fallbackArtifact) {
        return [fallbackArtifact];
      }
      throw new Error(`delegate_ocr preprocessing artifact is unavailable for ${file.ocrFileKey}`);
    },
    async refreshPdfChunkArtifact(input) {
      if (artifactStore) {
        return artifactStore.refreshPdfChunkArtifact({
          file,
          chunk: input.chunk,
          artifact: input.artifact,
        });
      }
      return { ...input.artifact, filepath: signedUrl ?? input.artifact.filepath };
    },
    ...(artifactStore?.commitPdfChunkSplit
      ? { commitPdfChunkSplit: artifactStore.commitPdfChunkSplit.bind(artifactStore) }
      : {}),
  };
}

function readProgressChunk(progress: OcrPreprocessingPipelineProgress): {
  chunkIndex?: number;
  chunkCount?: number;
} {
  return {
    ...('chunkIndex' in progress && progress.chunkIndex !== undefined
      ? { chunkIndex: progress.chunkIndex }
      : {}),
    ...('chunkCount' in progress && progress.chunkCount !== undefined
      ? { chunkCount: progress.chunkCount }
      : {}),
  };
}

function classifyPreprocessingProgress(
  progress: OcrPreprocessingPipelineProgress,
): Pick<DelegateStatusEvent, 'stage' | 'status'> {
  const { chunkIndex, chunkCount } = readProgressChunk(progress);
  let stage: DelegateStatusEvent['stage'] = 'reconciliation';
  if (progress.stage.startsWith('paddleocr') || progress.stage === 'pdf_chunks_ready') {
    stage = 'paddleocr';
  } else if (progress.stage.startsWith('organizer') || progress.stage.includes('markdown')) {
    stage = 'organizer';
  }
  let status: DelegateStatusEvent['status'] = 'progress';
  if (progress.stage.endsWith('_started')) {
    status = 'started';
  } else if (
    progress.stage.endsWith('_saved') &&
    chunkIndex !== undefined &&
    chunkIndex === chunkCount
  ) {
    status = 'succeeded';
  }
  return { stage, status };
}

/**
 * Builds the delegate OCR service the server wires into its tools: request
 * policy, the delegate_ocr executor with its run claim, lease, source mapping
 * and OCR preprocessing, and the resume of an unfinished run.
 */
export interface SteelDelegateOcrService {
  createDelegateOcrExecute(
    input: CreateSteelDelegateOcrExecuteInput,
  ): (input: DelegateOcrExecuteInput) => Promise<string>;
  prepareDelegateOcrResume(input: {
    req: SteelDelegateOcrRequest;
    conversationId?: string;
    triggeringMessageId?: string;
    userId?: string;
  }): Promise<SteelDelegateOcrResume | undefined>;
  executeDelegateOcrResume(
    input: CreateSteelDelegateOcrExecuteInput & {
      resume?: SteelDelegateOcrResume;
      onDelta?: DelegateOcrExecuteInput['onDelta'];
    },
  ): Promise<string>;
  resolveDelegateOcrPolicyForRequest(input: {
    req: SteelDelegateOcrRequest;
    currentUserTurn?: string;
    ocrTurnActive?: boolean;
  }): Promise<DelegateOcrPolicy>;
}

export function createSteelDelegateOcrService(
  deps: SteelDelegateOcrDependencies,
): SteelDelegateOcrService {
  const getStateService = (): SteelDelegateOcrStateService =>
    deps.stateService ?? createSteelDelegateOcrStateService(mongoose);

  async function resolveDelegateOcrPolicyForRequest({
    req,
    currentUserTurn,
    ocrTurnActive,
  }: {
    req: SteelDelegateOcrRequest;
    currentUserTurn?: string;
    ocrTurnActive?: boolean;
  }): Promise<DelegateOcrPolicy> {
    const context = req.steelNativeContext;
    const userId = req.user?.id;
    const candidateIds = [
      ...new Set(
        collectDelegateOcrAvailableFiles(req, context?.delegateOcrContext).map(
          (file) => file.fileId,
        ),
      ),
    ];
    if (
      !userId ||
      ocrTurnActive === true ||
      isDelegateOcrQuoteOnlyTurn(currentUserTurn) ||
      candidateIds.length === 0
    ) {
      return resolveDelegateOcrPolicy({ currentUserTurn, ocrTurnActive, attachmentFileKeys: [] });
    }

    const loadOwnedFiles = () =>
      deps.db.getFiles({ user: userId, $or: [{ file_id: { $in: candidateIds } }] }, {}, {});
    const pending = context
      ? (context.delegateOcrAuthorizedFilesPromise ??= loadOwnedFiles())
      : loadOwnedFiles();
    const ownedFiles = (await pending) ?? [];
    return resolveDelegateOcrPolicy({
      currentUserTurn,
      ocrTurnActive,
      attachmentFileKeys: ownedFiles
        .map((file) => getSteelFileId(file))
        .filter(isNonEmptyString)
        .map((fileId) => `file:${fileId}`),
    });
  }

  function createDefaultDelegateOcrPreprocessing({
    req,
    res,
    streamId,
    signal,
    agent,
    currentUserTurn,
    conversationId,
    workflow,
    batchPreprocessing,
    suggestedOcrResultColumns,
  }: CreateSteelDelegateOcrExecuteInput & {
    currentUserTurn: string;
    conversationId: string;
    workflow: SteelDelegateOcrWorkflow;
    batchPreprocessing: WeakMap<DelegateOcrPreparedBatch, DelegateBatchPreprocessing>;
    suggestedOcrResultColumns: readonly string[];
  }): RunDelegateOcrPreprocessing {
    let writer: ReturnType<typeof createMongooseSteelWorkingOrderMemoryWriter> | undefined;
    let ocrPreprocessingRules: SteelOcrPreprocessingRules | undefined;
    let nextToolEventIndex = 0;
    let paddleOcr: PaddleOcrChunkRunner | undefined;
    let paddleContext: {
      artifactStore: DelegateBatchArtifactStore;
      file: SteelOcrPreprocessingSourceFile;
    };

    const statusEvent = (
      event: Omit<DelegateStatusEvent, 'conversationId' | 'requestId' | 'messageId'>,
    ) => {
      const requestId = req.steelNativeContext?.requestId;
      return emitSteelNativeEvents({
        req,
        res,
        streamId,
        events: buildSteelDelegateOcrStatusEventEnvelopes({
          conversationId,
          requestId,
          messageId: requestId,
          ...event,
          ...(isNonEmptyString(workflow.claimToken) ? { claimToken: workflow.claimToken } : {}),
          ...(isNonEmptyString(workflow.generationId)
            ? { generationId: workflow.generationId }
            : {}),
        }),
      });
    };

    return async ({ file, batch, signedFiles }) => {
      const delegateOcrIndex = workflow.delegateOcrIndex;
      if (
        !Number.isSafeInteger(delegateOcrIndex) ||
        delegateOcrIndex === undefined ||
        delegateOcrIndex < 1
      ) {
        return undefined;
      }
      const preprocessing = batchPreprocessing.get(batch);
      if (!preprocessing?.file.ocrFileKey || !preprocessing.file.sourcePdfKey) {
        return undefined;
      }
      const sourceCode = workflow.sourceCodeByFileId?.get(file.fileId);
      const preprocessingFile: SteelOcrPreprocessingSourceFile = {
        ...preprocessing.file,
        ...(sourceCode ? { sourceCode } : {}),
      };
      const pageStart = file.pageStart ?? 1;
      const pageEnd = file.pageEnd ?? pageStart;
      const chunks: OcrPreprocessingPageChunk[] = preprocessing.chunks.length
        ? preprocessing.chunks
        : [
            {
              pageStart,
              pageEnd,
              chunkIndex: 1,
              chunkCount: 1,
              chunkSizePages: pageEnd - pageStart + 1,
            },
          ];
      const artifactStore = createDelegateOcrArtifactStore({
        preprocessing,
        file: preprocessingFile,
        signedUrl: signedFiles[0]?.url,
      });
      paddleContext = { artifactStore, file: preprocessingFile };
      writer ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
      ocrPreprocessingRules ??= await deps.ocr.resolvePreprocessingRules();
      const nativeContext = req.steelNativeContext;
      const requestId = nativeContext?.requestId;
      const turnIndex = nativeContext?.assistantTurnIndex ?? 0;
      const checkpointTurnIndex =
        nativeContext?.memoryCheckpointTurnIndex ?? Math.max(0, turnIndex - 1);
      const renewDelegateCheckpointLease = async () => {
        if (
          !isNonEmptyString(workflow.claimToken) ||
          !isNonEmptyString(workflow.executionLeaseToken)
        ) {
          throw new Error('delegate_ocr checkpoint lease is unavailable');
        }
        const renewed = await getStateService().acquireDelegateExecutionLease({
          claimToken: workflow.claimToken,
          leaseToken: workflow.executionLeaseToken,
        });
        if (!renewed) {
          throw new Error('delegate_ocr checkpoint lease is stale');
        }
      };
      const memoryWriter = writer;
      paddleOcr ??= deps.ocr.createPaddleOcrChunkRunner({
        req,
        res,
        signal,
        agent,
        streamId,
        conversationId,
        requestId,
        toolName: buildMCPToolKey(steelPaddleOcrToolName, PADDLE_OCR_MCP_SERVER_NAME),
        refreshArtifact: ({ artifact, chunk }) =>
          paddleContext.artifactStore.refreshPdfChunkArtifact({
            file: paddleContext.file,
            chunk,
            artifact,
          }),
        getNextIndex: () => nextToolEventIndex++,
      });
      const result = await runOcrPreprocessingBatchPipeline({
        conversationId,
        requestId,
        turnIndex,
        checkpointTurnIndex,
        signal,
        files: [{ file: preprocessingFile, chunks, artifacts: artifactStore }],
        ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
        ocrRulesText: ocrPreprocessingRules.ocrRulesText,
        memory: {
          readOcrPreprocessingState: (input) =>
            memoryWriter.readDelegateOcrPreprocessingState({ ...input, delegateOcrIndex }),
          capturePaddleOcrChunkResult: async (input) => {
            await renewDelegateCheckpointLease();
            return memoryWriter.captureDelegatePaddleOcrChunkResult({ ...input, delegateOcrIndex });
          },
          captureOcrPreprocessingChunkMarkdown: async (input) => {
            await renewDelegateCheckpointLease();
            return memoryWriter.captureDelegateOcrPreprocessingChunkMarkdown({
              ...input,
              delegateOcrIndex,
            });
          },
        },
        organizer: deps.ocr.createOrganizer({
          agent,
          signal,
          latestUserMessage: currentUserTurn,
          suggestedOcrResultColumns,
        }),
        paddleOcr,
        onProgress: ({ file: progressFile, progress }) =>
          statusEvent({
            delegateOcrIndex,
            ...classifyPreprocessingProgress(progress),
            message: `Delegate OCR ${progress.stage} (${progressFile.ocrFileKey})`,
            ...readProgressChunk(progress),
          }),
      });
      const fileResult = result.files[0];
      if (!fileResult) {
        return undefined;
      }
      if (fileResult.status === 'failed') {
        await statusEvent({
          delegateOcrIndex,
          stage: 'paddleocr',
          status: 'failed',
          message: `Delegate OCR preprocessing failed (${fileResult.file.ocrFileKey})`,
          errorMessage: fileResult.errorMessage,
        });
        return fileResult.partial?.markdown
          ? { organizerMarkdown: fileResult.partial.markdown }
          : undefined;
      }
      await statusEvent({
        delegateOcrIndex,
        stage: 'organizer',
        status: 'succeeded',
        message: `Delegate OCR Organizer completed (${fileResult.file.ocrFileKey})`,
      });
      return { organizerMarkdown: fileResult.markdown };
    };
  }

  function createDelegateOcrExecute({
    req,
    res,
    streamId = null,
    signal,
    agent,
  }: CreateSteelDelegateOcrExecuteInput) {
    return async (input: DelegateOcrExecuteInput): Promise<string> => {
      const nativeContext = req.steelNativeContext;
      const delegateContext = nativeContext?.delegateOcrContext;
      const modelOptions = delegateContext?.modelOptions;
      if (!delegateContext || !modelOptions) {
        throw new Error('delegate_ocr request context is unavailable');
      }

      const userId = req.user?.id;
      if (!userId) {
        throw new Error('delegate_ocr requires an authenticated user');
      }
      const steelConversation = delegateContext.steelConversation;
      const currentUserTurn = getDelegateOcrCurrentUserTurn(delegateContext);
      if (!currentUserTurn) {
        throw new Error('delegate_ocr current user turn is unavailable');
      }
      if (isDelegateOcrQuoteOnlyTurn(currentUserTurn)) {
        throw new Error(
          'delegate_ocr is not used for quote-only requests when OCR or table data is already available',
        );
      }

      const stateService = getStateService();
      const previous = delegateContext.delegateOcrWorkflow;
      const claimToken = previous?.delegateOcrClaimToken ?? previous?.claimToken;
      const executionLeaseToken = previous?.executionLeaseToken;
      const workflowGenerationId = previous?.responseGenerationId ?? previous?.generationId;
      const generationId = workflowGenerationId ?? nativeContext?.requestId;
      /** The workflow the delegate executor receives; kept on the request so
       * backend-only finalization provenance crosses the tool boundary. */
      const workflow: SteelDelegateOcrWorkflow = {
        ...(previous?.canonicalMapping ? { canonicalMapping: previous.canonicalMapping } : {}),
        ...(typeof previous?.previousOcrResultMarkdown === 'string'
          ? { previousOcrResultMarkdown: previous.previousOcrResultMarkdown }
          : {}),
        suggestedOcrResultColumns: previous?.suggestedOcrResultColumns ?? [],
        ...(previous?.loadSourceMapping ? { loadSourceMapping: previous.loadSourceMapping } : {}),
        ...(previous?.loadCurrentOcrResult
          ? { loadCurrentOcrResult: previous.loadCurrentOcrResult }
          : {}),
        ...(previous?.runStore ? { runStore: previous.runStore } : {}),
        ...(typeof claimToken === 'string' ? { claimToken } : {}),
        ...(typeof workflowGenerationId === 'string' ? { generationId: workflowGenerationId } : {}),
      };
      if (!workflow.runStore && isNonEmptyString(claimToken)) {
        workflow.runStore = {
          beginAttempt: async ({ attemptToken }) => {
            const run = await stateService.beginDelegateAgentAttempt({
              claimToken,
              ...(isNonEmptyString(executionLeaseToken) ? { executionLeaseToken } : {}),
              attemptToken,
            });
            return typeof run?.agentAttemptToken === 'string'
              ? { attemptToken: run.agentAttemptToken }
              : undefined;
          },
        };
      }
      delegateContext.delegateOcrWorkflow = workflow;

      const batchPreprocessing = new WeakMap<
        DelegateOcrPreparedBatch,
        DelegateBatchPreprocessing
      >();
      const triggeringMessageId =
        previous?.triggeringMessageId ??
        steelConversation?.currentUserTurn?.messageId ??
        nativeContext?.requestId;
      const conversationId = nativeContext?.conversationId ?? steelConversation?.conversationId;
      const emitStatus = (event: Omit<DelegateStatusEvent, 'conversationId'>) =>
        emitSteelNativeEvents({
          req,
          res,
          streamId,
          events: buildSteelDelegateOcrStatusEventEnvelopes({ conversationId, ...event }),
        });

      let delegateRunInitialized = false;
      const ensureDelegateRun = async (records: readonly DelegateOcrStoredFileRecord[]) => {
        if (
          delegateRunInitialized ||
          !isNonEmptyString(triggeringMessageId) ||
          !isNonEmptyString(conversationId)
        ) {
          return;
        }
        delegateRunInitialized = true;
        let run = await stateService.findResumableDelegateOcrRun({
          conversationId,
          triggeringMessageId,
        });
        const wasResumed = Boolean(run);
        let claim: SteelDelegateOcrClaimRef;
        if (run) {
          claim = {
            conversationId,
            delegateOcrIndex: run.delegateOcrIndex,
            claimToken: run.claimToken,
            triggeringMessageId,
            ...(run.responseGenerationId ? { responseGenerationId: run.responseGenerationId } : {}),
          };
        } else {
          const activeRun = await stateService.findActiveDelegateOcrRun(conversationId);
          const nextClaimToken = activeRun ? randomUUID() : undefined;
          if (activeRun && nextClaimToken) {
            const reason = 'new delegate OCR triggering message';
            await stateService.supersedeDelegateOcrRun({
              claimToken: activeRun.claimToken,
              provenance: { supersededByClaimToken: nextClaimToken, reason, at: new Date() },
            });
            await stateService.recordSupersededDelegateClaim({
              conversationId,
              claimToken: activeRun.claimToken,
              delegateOcrIndex: activeRun.delegateOcrIndex,
              supersededByClaimToken: nextClaimToken,
              reason,
            });
            await stateService.clearCompletedDelegateClaim({
              conversationId,
              claimToken: activeRun.claimToken,
              delegateOcrIndex: activeRun.delegateOcrIndex,
              ...(activeRun.executionLeaseToken
                ? { executionLeaseToken: activeRun.executionLeaseToken }
                : {}),
            });
          }
          const claimed = await stateService.claimNewDelegateOcrIndex({
            conversationId,
            triggeringMessageId,
            ...(nextClaimToken ? { claimToken: nextClaimToken } : {}),
            ...(typeof generationId === 'string' ? { responseGenerationId: generationId } : {}),
          });
          if (!claimed) {
            throw new Error('delegate_ocr active run claim is unavailable');
          }
          claim = claimed;
          try {
            run = await stateService.materializeDelegateOcrRun({
              conversationId,
              delegateOcrIndex: claim.delegateOcrIndex,
              claimToken: claim.claimToken,
              triggeringMessageId,
              triggeringMessageText: currentUserTurn,
              toolParameters: {
                files: input.files.map(({ fileKey, pageRanges }) => ({
                  fileKey,
                  ...(pageRanges
                    ? {
                        pageRanges: pageRanges.map(({ pageStart, pageEnd }) => ({
                          pageStart,
                          pageEnd,
                        })),
                      }
                    : {}),
                })),
              },
              files: records.map((record) => {
                const fileId = getSteelFileId(record) ?? 'unknown';
                const mediaType = record.type;
                return {
                  fileId,
                  filename: record.filename ?? fileId,
                  ...(record.storageKey ? { storageKey: record.storageKey } : {}),
                  ...(mediaType ? { mediaType } : {}),
                };
              }),
              ...(typeof generationId === 'string' ? { responseGenerationId: generationId } : {}),
            });
          } catch (error) {
            await stateService
              .clearCompletedDelegateClaim({
                conversationId,
                claimToken: claim.claimToken,
                delegateOcrIndex: claim.delegateOcrIndex,
              })
              .catch(() => undefined);
            throw error;
          }
        }
        const savedFiles = readSavedDelegateFiles(run);
        if (savedFiles) {
          workflow.filesOverride = savedFiles;
        }
        const lease = await stateService.acquireDelegateExecutionLease({
          claimToken: claim.claimToken,
          ...(typeof executionLeaseToken === 'string' ? { leaseToken: executionLeaseToken } : {}),
        });
        if (!lease) {
          throw new Error('delegate_ocr execution lease is unavailable');
        }

        const sourceCodeByFileId = new Map<string, string>();
        for (const record of records) {
          const fileId = getSteelFileId(record);
          if (!fileId) {
            continue;
          }
          const mapping = await stateService.allocateDelegateSourceMapping({
            conversationId,
            fileId,
            sourceFilename: String(record.filename ?? fileId).trim() || fileId,
          });
          if (mapping?.sourceCode) {
            sourceCodeByFileId.set(fileId, mapping.sourceCode);
          }
        }
        let previousOcrResultRevision: string | undefined;
        const loadPreviousOcrResult = async (): Promise<string> => {
          const current = await stateService.readCurrentOcrResult(conversationId);
          previousOcrResultRevision = isNonEmptyString(current?.generationId)
            ? current.generationId
            : undefined;
          return typeof current?.markdown === 'string' ? current.markdown : '';
        };
        const previousMarkdown = await loadPreviousOcrResult();
        const organizerSuggestedColumns = workflow.suggestedOcrResultColumns?.length
          ? workflow.suggestedOcrResultColumns
          : inferDelegateSuggestedOcrResultColumns(previousMarkdown);

        Object.assign(workflow, {
          enabled: true,
          claimToken: claim.claimToken,
          executionLeaseToken: lease.executionLeaseToken,
          delegateOcrIndex: claim.delegateOcrIndex,
          ...(typeof generationId === 'string' ? { generationId } : {}),
          sourceCodeByFileId,
          runPreprocessing: createDefaultDelegateOcrPreprocessing({
            req,
            res,
            streamId,
            signal,
            agent,
            currentUserTurn,
            conversationId,
            workflow,
            batchPreprocessing,
            suggestedOcrResultColumns: organizerSuggestedColumns,
          }),
          loadSourceMapping:
            workflow.loadSourceMapping ?? (() => stateService.readSourceMappings(conversationId)),
          loadCurrentOcrResult: workflow.loadCurrentOcrResult ?? loadPreviousOcrResult,
          ...(previousOcrResultRevision ? { previousOcrResultRevision } : {}),
          auditResponse: async ({
            assistantResponse,
            previousOcrResultMarkdown,
            attemptNumber,
            attemptToken,
          }: Parameters<NonNullable<DelegateOcrWorkflowInput['auditResponse']>>[0]) => {
            const auditUserId = req.user?.id;
            if (!auditUserId || !generationId) {
              throw new Error(
                'delegate_ocr audit requires user, conversation, message, and generation scope',
              );
            }
            await createSteelOcrResponseAuditService(mongoose).save({
              rawResponse: assistantResponse,
              sourceStage: 'delegate',
              userId: auditUserId,
              tenantId: req.user?.tenantId,
              conversationId,
              messageId: triggeringMessageId,
              generationId,
              attemptId: attemptToken,
              attemptNumber,
              ...(previousOcrResultRevision ? { baseRevision: previousOcrResultRevision } : {}),
              baseResponse: previousOcrResultMarkdown ?? previousMarkdown,
            });
          },
          suggestedOcrResultColumns: organizerSuggestedColumns,
          ...(workflow.previousOcrResultMarkdown === undefined
            ? { previousOcrResultMarkdown: previousMarkdown }
            : {}),
          runStore: workflow.runStore ?? {
            beginAttempt: async ({ attemptToken }: { attemptToken: string }) => {
              const attempt = await stateService.beginDelegateAgentAttempt({
                claimToken: claim.claimToken,
                executionLeaseToken: lease.executionLeaseToken,
                attemptToken,
              });
              return typeof attempt?.agentAttemptToken === 'string'
                ? { attemptToken: attempt.agentAttemptToken }
                : undefined;
            },
          },
        });
        delegateContext.delegateOcrRun = run;
        delegateContext.delegateOcrClaim = claim;
        delegateContext.delegateOcrExecutionLease = lease;
        if (wasResumed) {
          await emitStatus({
            requestId: generationId,
            messageId: triggeringMessageId,
            delegateOcrIndex: claim.delegateOcrIndex,
            stage: 'resume',
            status: 'started',
            message: `Resuming Delegate OCR run N=${claim.delegateOcrIndex}`,
            claimToken: claim.claimToken,
            ...(typeof generationId === 'string' ? { generationId } : {}),
          });
        }
      };

      if (isNonEmptyString(triggeringMessageId) && isNonEmptyString(conversationId)) {
        const resumable = await stateService.findResumableDelegateOcrRun({
          conversationId,
          triggeringMessageId,
        });
        const savedFiles = resumable ? readSavedDelegateFiles(resumable) : undefined;
        if (savedFiles) {
          workflow.filesOverride = savedFiles;
        }
      }

      const signStoredFile = async (file: DelegateOcrStoredFileRecord): Promise<string> => {
        const source = file.source ?? req.config?.fileStrategy ?? FileSources.local;
        const { getDownloadURL } = deps.getStrategy(source);
        if (!getDownloadURL) {
          throw new Error(`delegate_ocr file source "${source}" cannot create a signed URL`);
        }
        return getDownloadURL({ file });
      };

      const prepareBatches = async ({
        files,
        fileInputs,
        storedFiles,
      }: PrepareDelegateOcrBatchesInput): Promise<DelegateOcrPreparedBatch[]> => {
        const storedById = new Map<string, DelegateOcrStoredFileRecord>();
        for (const record of storedFiles) {
          const fileId = getSteelFileId(record);
          if (fileId) {
            storedById.set(fileId, record);
          }
        }
        if (files.length !== fileInputs.length) {
          throw new Error('delegate_ocr selected file metadata is incomplete');
        }

        const batches: DelegateOcrPreparedBatch[] = [];
        for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
          const file = files[fileIndex];
          const storedFile = storedById.get(file.fileId);
          if (!storedFile) {
            throw new Error(`delegate_ocr file record disappeared: file:${file.fileId}`);
          }
          const sourceCode = workflow.sourceCodeByFileId?.get(file.fileId);
          const preprocessingFile = toSteelOcrPreprocessingFile(
            { ...file, ocrFileKey: `file:${file.fileId}`, ...(sourceCode ? { sourceCode } : {}) },
            storedFile,
          );
          if (!isPdfSteelFile(file)) {
            const batch: DelegateOcrPreparedBatch = {
              files: [file],
              signFile: async () => signStoredFile(storedFile),
            };
            if (preprocessingFile) {
              batchPreprocessing.set(batch, {
                file: preprocessingFile,
                chunks: [buildSingleOriginalOcrChunk()[0]],
              });
            }
            batches.push(batch);
            continue;
          }
          const pageRanges = fileInputs[fileIndex]?.pageRanges;
          if (!Array.isArray(pageRanges) || pageRanges.length === 0) {
            throw new Error(`delegate_ocr PDF file requires pageRanges: file:${file.fileId}`);
          }
          const sourcePdfKey = storedFile.storageKey;
          if (
            !isNonEmptyString(sourcePdfKey) ||
            sourcePdfKey.trim() !== sourcePdfKey ||
            isHttpUrl(sourcePdfKey)
          ) {
            throw new Error(`delegate_ocr PDF storage key is unavailable for file:${file.fileId}`);
          }
          if (!preprocessingFile) {
            throw new Error(`delegate_ocr PDF source is unavailable for file:${file.fileId}`);
          }
          preprocessingFile.sourcePdfKey = sourcePdfKey;
          const artifactStore = deps.ocr.createPdfChunkArtifactStore({
            file: preprocessingFile,
            fileRecord: storedFile,
          });
          let artifacts: SteelOcrStoredArtifact[];
          try {
            artifacts = await artifactStore.loadExistingPdfChunkArtifacts({
              sourcePdfKey,
              pageRanges,
            });
          } catch (error) {
            throw new Error(
              `delegate_ocr failed preparing file:${file.fileId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { cause: error },
            );
          }
          for (const artifact of artifacts) {
            const range = { pageStart: artifact.pageStart, pageEnd: artifact.pageEnd };
            const chunk: OcrPreprocessingPageChunk = {
              ...range,
              chunkIndex: artifact.chunkIndex ?? 1,
              chunkCount: artifact.chunkCount ?? artifacts.length,
              chunkSizePages: artifact.chunkSizePages ?? range.pageEnd - range.pageStart + 1,
            };
            let currentArtifact = artifact;
            let artifactSignCount = 0;
            const artifactFile: DelegateOcrFileRecord = {
              ...file,
              fileId: `${file.fileId}#${range.pageStart}-${range.pageEnd}`,
              filename: artifact.filename,
              filepath: artifact.filepath,
              storageKey: artifact.storageKey,
              mediaType: 'application/pdf',
              pageStart: range.pageStart,
              pageEnd: range.pageEnd,
            };
            const batch: DelegateOcrPreparedBatch = {
              files: [artifactFile],
              range,
              signFile: async (batchFile) => {
                if (!batchFile.filepath) {
                  throw new Error(
                    `delegate_ocr range artifact URL is unavailable for pages ${batchFile.pageStart}-${batchFile.pageEnd}`,
                  );
                }
                if (artifactSignCount === 0) {
                  artifactSignCount += 1;
                  return currentArtifact.filepath;
                }
                const refreshed = await artifactStore.refreshPdfChunkArtifact({
                  file: preprocessingFile,
                  chunk,
                  artifact: currentArtifact,
                });
                currentArtifact = refreshed;
                artifactFile.filepath = refreshed.filepath;
                artifactFile.storageKey = refreshed.storageKey;
                artifactFile.filename = refreshed.filename;
                artifactSignCount += 1;
                return refreshed.filepath;
              },
            };
            batchPreprocessing.set(batch, {
              file: preprocessingFile,
              chunks: [chunk],
              artifacts: artifactStore,
              artifact,
            });
            batches.push(batch);
          }
        }
        return batches;
      };

      const invokeModel = async ({
        messages,
        modelOptions: invokeOptions,
        signal: modelSignal,
        onDelta,
        attemptNumber = 1,
        attemptToken,
      }: InvokeDelegateOcrModelInput): Promise<string> => {
        const delegateOcrIndex = workflow.delegateOcrIndex;
        const eventInput = {
          requestId: generationId,
          messageId: triggeringMessageId,
          stage: 'agent' as const,
          ...(isNonEmptyString(workflow.claimToken) ? { claimToken: workflow.claimToken } : {}),
          ...(typeof generationId === 'string' ? { generationId } : {}),
          ...(typeof attemptToken === 'string' ? { attemptToken } : {}),
        };
        const emitAgentStatus = (
          event: Pick<DelegateStatusEvent, 'status' | 'message' | 'errorMessage'>,
        ) =>
          delegateOcrIndex === undefined
            ? undefined
            : emitStatus({ ...eventInput, delegateOcrIndex, ...event });
        await emitAgentStatus({
          status: attemptNumber > 1 ? 'retrying' : 'started',
          message:
            attemptNumber > 1
              ? `Retrying Delegate OCR Agent (${attemptNumber}/3)`
              : 'Delegate OCR Agent started',
        });
        try {
          const model = createOpenAIOAuthModel(invokeOptions);
          const stream = await model.stream(
            messages,
            modelSignal ? { signal: modelSignal } : undefined,
          );
          let answer = '';
          for await (const chunk of stream) {
            const delta = normalizeDelegateOcrChunk(chunk.content);
            if (delta === '') {
              continue;
            }
            await onDelta?.(delta);
            answer += delta;
          }
          await emitAgentStatus({
            status: 'succeeded',
            message: 'Delegate OCR Agent completed',
          });
          return answer;
        } catch (error) {
          await emitAgentStatus({
            status: 'failed',
            message: 'Delegate OCR Agent failed',
            errorMessage: error instanceof Error ? error.message : undefined,
          });
          throw error;
        }
      };

      const execute = createDelegateOcrRequestExecute({
        currentUserTurn,
        policy: delegateContext.delegateOcrPolicy ?? nativeContext?.delegateOcrPolicy,
        modelOptions,
        userId,
        availableFiles: collectDelegateOcrAvailableFiles(req, delegateContext),
        getOwnedFileRecords: async (filter) => {
          const records = (await deps.db.getFiles(filter, {}, {})) ?? [];
          await ensureDelegateRun(records);
          return records;
        },
        signStoredFile,
        prepareBatches,
        loadOcrRules: async () => {
          if (!steelConversation) {
            throw new Error('delegate_ocr conversation context is unavailable');
          }
          const context = await buildDefaultSteelGlobalAgentContext({
            runtimeRulesClient: deps.client,
            conversation: steelConversation,
            renderProfile: 'agent_client',
            mode: 'delegate_ocr',
          });
          const rulesText = context.instructionPrefix?.trim();
          if (!rulesText) {
            throw new Error(
              'delegate_ocr could not load OCR main merge, final Markdown, and delegate update rules',
            );
          }
          return rulesText;
        },
        invokeModel,
        signal,
        workflow,
      });

      return execute(input);
    };
  }

  /**
   * Resolves an unfinished delegate OCR run for the exact triggering user
   * message. It never falls back to a different message and re-authorizes every
   * saved file id before allowing a resume.
   */
  async function prepareDelegateOcrResume({
    req,
    conversationId,
    triggeringMessageId,
    userId,
  }: {
    req: SteelDelegateOcrRequest;
    conversationId?: string;
    triggeringMessageId?: string;
    userId?: string;
  }): Promise<SteelDelegateOcrResume | undefined> {
    if (
      !isNonEmptyString(conversationId) ||
      !isNonEmptyString(triggeringMessageId) ||
      !isNonEmptyString(userId)
    ) {
      return undefined;
    }

    const context = (req.steelNativeContext ??= {});
    const delegateContext = context.delegateOcrContext ?? {};
    const stateService = getStateService();
    const run = await stateService.findResumableDelegateOcrRun({
      conversationId,
      triggeringMessageId,
    });
    if (!run) {
      return undefined;
    }

    const claim: SteelDelegateOcrClaimRef = {
      conversationId,
      delegateOcrIndex: run.delegateOcrIndex,
      claimToken: run.claimToken,
      triggeringMessageId,
      ...(run.responseGenerationId ? { responseGenerationId: run.responseGenerationId } : {}),
    };
    const files = readSavedDelegateFiles(run);
    if (!files) {
      throw new Error('delegate_ocr resume parameters unavailable');
    }
    const fileIds = (Array.isArray(run.files) ? run.files : [])
      .map(getSteelFileId)
      .filter(isNonEmptyString);
    if (fileIds.length !== files.length) {
      throw new Error('delegate_ocr resume file metadata is unavailable');
    }
    if (new Set(fileIds).size !== fileIds.length) {
      throw new Error('delegate_ocr resume contains duplicate file ids');
    }

    const records =
      (await deps.db.getFiles(
        {
          user: userId,
          file_id: { $in: fileIds },
          ...(req.user?.tenantId ? { tenantId: req.user.tenantId } : {}),
        },
        {},
        {},
      )) ?? [];
    const ownedIds = new Set(
      records.map((record) => getSteelFileId(record)).filter(isNonEmptyString),
    );
    if (ownedIds.size !== fileIds.length || fileIds.some((fileId) => !ownedIds.has(fileId))) {
      throw new Error('delegate_ocr resume authorization failed');
    }

    /** Acquire the run lease only after every persisted file is re-authorized for this user. */
    const lease = await stateService.acquireDelegateExecutionLease({
      claimToken: run.claimToken,
      leaseToken: randomUUID(),
      expectedConversationId: conversationId,
      expectedDelegateOcrIndex: run.delegateOcrIndex,
      expectedTriggeringMessageId: triggeringMessageId,
      expectedLeaseToken: run.executionLeaseToken ?? null,
    });
    if (!lease) {
      throw new Error('delegate_ocr resume execution lease is unavailable');
    }

    const resume: SteelDelegateOcrResume = {
      run,
      claim,
      lease,
      files,
      records,
      policy: {
        resolved: true,
        allowed: true,
        allowedFileKeys: [
          ...new Set([
            ...files.map(({ fileKey }) => fileKey),
            ...fileIds.map((fileId) => `file:${fileId}`),
          ]),
        ],
      },
      candidate:
        typeof run.finalizedCandidate?.markdown === 'string' ? run.finalizedCandidate : undefined,
    };
    context.delegateOcrResume = resume;
    context.delegateOcrContext = {
      ...delegateContext,
      delegateOcrRun: run,
      delegateOcrClaim: claim,
      delegateOcrExecutionLease: lease,
      delegateOcrResume: resume,
      delegateOcrPolicy: {
        resolved: true,
        allowed: false,
        allowedFileKeys: [],
        reason: 'delegate_ocr_resume',
      },
      delegateOcrWorkflow: {
        ...delegateContext.delegateOcrWorkflow,
        enabled: true,
        claimToken: run.claimToken,
        delegateOcrClaimToken: run.claimToken,
        delegateOcrIndex: run.delegateOcrIndex,
        responseGenerationId: run.responseGenerationId,
        triggeringMessageId,
        filesOverride: files,
        executionLeaseToken: lease.executionLeaseToken,
      },
    };
    return resume;
  }

  /** Executes a prepared resume after OAuth model options have been resolved. */
  async function executeDelegateOcrResume({
    req,
    res,
    streamId = null,
    signal,
    agent,
    resume,
    onDelta,
  }: CreateSteelDelegateOcrExecuteInput & {
    resume?: SteelDelegateOcrResume;
    onDelta?: DelegateOcrExecuteInput['onDelta'];
  }): Promise<string> {
    if (!resume?.run || resume.files.length === 0) {
      throw new Error('delegate_ocr resume state is unavailable');
    }
    const delegateContext = req.steelNativeContext?.delegateOcrContext;

    /** A finalized candidate is already the terminal answer: re-emit it and
     * leave persistence to the normal root path without rerunning OCR or the agent. */
    if (resume.candidate && ['finalizing', 'save_failed'].includes(resume.run.status)) {
      const canonicalOcrResultMarkdown =
        resume.candidate.source === 'backend'
          ? extractCanonicalDelegateOcrResult(resume.candidate.markdown)
          : undefined;
      const workflow = delegateContext?.delegateOcrWorkflow;
      if (workflow && canonicalOcrResultMarkdown) {
        workflow.finalizedByBackend = true;
        workflow.finalizedResponse = {
          ok: true,
          finalResponse: resume.candidate.markdown,
          ocrResultMarkdown: canonicalOcrResultMarkdown,
        };
      }
      await onDelta?.(resume.candidate.markdown, {
        claimToken: resume.run.claimToken,
        generationId: resume.run.responseGenerationId,
        attemptToken: resume.run.agentAttemptToken,
      });
      return resume.candidate.markdown;
    }

    if (!delegateContext?.modelOptions) {
      throw new Error('delegate_ocr resume model context unavailable');
    }

    delegateContext.delegateOcrPolicy = resume.policy;
    delegateContext.delegateOcrWorkflow = {
      ...delegateContext.delegateOcrWorkflow,
      enabled: true,
      claimToken: resume.run.claimToken,
      delegateOcrClaimToken: resume.run.claimToken,
      delegateOcrIndex: resume.run.delegateOcrIndex,
      responseGenerationId: resume.run.responseGenerationId,
      triggeringMessageId: resume.run.triggeringMessageId,
      filesOverride: resume.files,
    };
    const execute = createDelegateOcrExecute({ req, res, streamId, signal, agent });
    return execute({ files: resume.files, onDelta });
  }

  return {
    createDelegateOcrExecute,
    prepareDelegateOcrResume,
    executeDelegateOcrResume,
    resolveDelegateOcrPolicyForRequest,
  };
}
