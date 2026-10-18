const crypto = require('crypto');
const steelPostgres = require('./postgres');
const mongoose = require('mongoose');
const {
  buildMCPToolKey,
  buildSteelDelegateOcrStatusEventEnvelopes,
  buildDefaultSteelGlobalAgentContext,
  createDelegateOcrRequestExecute,
  isDelegateOcrQuoteOnlyTurn,
  resolveDelegateOcrPolicy,
  normalizeDelegateOcrChunk,
  createMongooseSteelWorkingOrderMemoryWriter,
  createSteelDelegateOcrStateService,
  createSteelOcrResponseAuditService,
  createOpenAIOAuthModel,
  runOcrPreprocessingBatchPipeline,
  steelPaddleOcrToolName,
  emitSteelNativeEvents,
  PADDLE_OCR_MCP_SERVER_NAME: steelPaddleOcrMcpServerName,
} = require('@librechat/api');
const { FileSources } = require('librechat-data-provider');
const db = require('~/models');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const {
  getSteelFileId,
  getMessageContentText,
  getSuggestedOcrResultColumns,
  resolveSteelOcrPreprocessingRules,
  createSteelPaddleOcrChunkRunner,
  createSteelOcrOrganizer,
  isPdfSteelFile,
  toSteelOcrPreprocessingFile,
  buildSingleOriginalOcrChunk,
  isHttpUrl,
  createSteelOcrPdfChunkArtifactStore,
  extractCanonicalDelegateOcrResult,
} = require('./ocr');

function collectDelegateOcrAvailableFiles(req, delegateContext) {
  const filesById = new Map();
  const addFiles = (files) => {
    for (const file of files ?? []) {
      const fileId = getSteelFileId(file);
      if (!fileId) {
        continue;
      }
      const filename = typeof file?.filename === 'string' ? file.filename.trim() : undefined;
      const rawMediaType = file?.mediaType ?? file?.mimeType ?? file?.type;
      const mediaType = typeof rawMediaType === 'string' ? rawMediaType.trim() : undefined;
      const current = filesById.get(fileId) ?? {};
      const resolvedFilename = current.filename ?? filename;
      const resolvedMediaType = current.mediaType ?? mediaType;
      filesById.set(fileId, {
        fileId,
        ...(resolvedFilename ? { filename: resolvedFilename } : {}),
        ...(resolvedMediaType ? { mediaType: resolvedMediaType } : {}),
      });
    }
  };

  for (const message of delegateContext?.steelConversation?.activeHistory ?? []) {
    addFiles(message.files);
  }
  addFiles(delegateContext?.steelConversation?.currentUserTurn?.files);
  addFiles(req?.steelNativeContext?.currentTurnFiles);
  return [...filesById.values()];
}

function getDelegateOcrCurrentUserTurn(delegateContext) {
  const rawCurrentTurnText = delegateContext?.currentUserTurnText;
  if (typeof rawCurrentTurnText === 'string' && rawCurrentTurnText.trim() !== '') {
    return rawCurrentTurnText;
  }
  const currentTurn = delegateContext?.steelConversation?.currentUserTurn;
  const currentTurnText = getMessageContentText(currentTurn);
  if (currentTurnText.trim() !== '') {
    return currentTurnText;
  }
  const activeHistory = delegateContext?.steelConversation?.activeHistory;
  if (Array.isArray(activeHistory)) {
    const latestUser = [...activeHistory].reverse().find((message) => message?.role === 'user');
    const latestUserText = getMessageContentText(latestUser);
    if (latestUserText.trim() !== '') {
      return latestUserText;
    }
  }
  return '';
}

async function resolveDelegateOcrPolicyForRequest({ req, currentUserTurn, ocrTurnActive }) {
  const context = req?.steelNativeContext ?? {};
  const delegateContext = context.delegateOcrContext;
  const userId = req?.user?.id;
  const availableFiles = collectDelegateOcrAvailableFiles(req, delegateContext);
  const candidateIds = [
    ...new Set(
      availableFiles
        .map((file) => file.fileId)
        .filter((fileId) => typeof fileId === 'string' && fileId.trim() !== ''),
    ),
  ];
  if (
    !userId ||
    ocrTurnActive === true ||
    isDelegateOcrQuoteOnlyTurn(currentUserTurn) ||
    candidateIds.length === 0
  ) {
    return resolveDelegateOcrPolicy({
      currentUserTurn,
      ocrTurnActive,
      attachmentFileKeys: [],
    });
  }

  if (!context.delegateOcrAuthorizedFilesPromise) {
    context.delegateOcrAuthorizedFilesPromise = db.getFiles(
      { user: userId, $or: [{ file_id: { $in: candidateIds } }] },
      {},
      {},
    );
  }
  const ownedFiles = (await context.delegateOcrAuthorizedFilesPromise) ?? [];
  const ownedIds = ownedFiles
    .map((file) => getSteelFileId(file))
    .filter((fileId) => typeof fileId === 'string' && fileId.trim() !== '');
  return resolveDelegateOcrPolicy({
    currentUserTurn,
    ocrTurnActive,
    attachmentFileKeys: ownedIds.map((fileId) => `file:${fileId}`),
  });
}

function inferDelegateSuggestedOcrResultColumns(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return [];
  }
  try {
    return getSuggestedOcrResultColumns(markdown);
  } catch {
    return [];
  }
}

function createDelegateOcrArtifactStore({ batch, file, signedFile }) {
  const metadata = batch?._delegatePreprocessing;
  const artifactStore = metadata?.artifacts;
  const preparedArtifact = metadata?.artifact;
  const chunk = metadata?.chunks?.[0];
  const fallbackArtifact = chunk
    ? {
        ...chunk,
        sourcePdfKey: file.sourcePdfKey,
        source: file.source === FileSources.cloudfront ? 'cloudfront' : 's3',
        storageKey: file.storageKey ?? file.filepath ?? signedFile?.url,
        filepath: signedFile?.url ?? file.filepath,
        filename: file.filename,
        contentType: file.mediaType ?? file.type,
        artifactOrigin: 'original',
      }
    : undefined;

  return {
    async ensurePdfChunkArtifacts() {
      if (preparedArtifact) {
        return [{ ...preparedArtifact, filepath: signedFile?.url ?? preparedArtifact.filepath }];
      }
      if (artifactStore?.ensurePdfChunkArtifacts) {
        return artifactStore.ensurePdfChunkArtifacts({
          file,
          sourcePdfKey: file.sourcePdfKey,
          chunks: metadata?.chunks ?? [],
        });
      }
      if (fallbackArtifact) {
        return [fallbackArtifact];
      }
      throw new Error(`delegate_ocr preprocessing artifact is unavailable for ${file.ocrFileKey}`);
    },
    async refreshPdfChunkArtifact(input) {
      if (artifactStore?.refreshPdfChunkArtifact) {
        return artifactStore.refreshPdfChunkArtifact(input);
      }
      return {
        ...input.artifact,
        filepath: signedFile?.url ?? input.artifact.filepath,
      };
    },
    ...(artifactStore?.commitPdfChunkSplit
      ? { commitPdfChunkSplit: (input) => artifactStore.commitPdfChunkSplit(input) }
      : {}),
  };
}

function createDefaultDelegateOcrPreprocessing({
  req,
  res,
  streamId,
  signal,
  agent,
  delegateContext,
  currentUserTurn,
  conversationId,
  workflowRef,
  suggestedOcrResultColumns,
}) {
  let writer;
  let ocrPreprocessingRules;
  let nextToolEventIndex = 0;
  let paddleOcr;
  let paddleContext;

  return async ({ file, batch, signedFiles }) => {
    const delegateOcrIndex = workflowRef?.delegateOcrIndex;
    if (!Number.isSafeInteger(delegateOcrIndex) || delegateOcrIndex < 1) {
      return undefined;
    }
    const signedFile = signedFiles?.[0];
    const metadata = batch?._delegatePreprocessing;
    const preprocessingFile = {
      ...(metadata?.file ?? file),
      ...(workflowRef?.sourceCodeByFileId?.get(file.fileId)
        ? { sourceCode: workflowRef.sourceCodeByFileId.get(file.fileId) }
        : {}),
    };
    if (!preprocessingFile.ocrFileKey || !preprocessingFile.sourcePdfKey) {
      return undefined;
    }
    const chunks = metadata?.chunks?.length
      ? metadata.chunks
      : [
          {
            pageStart: file.pageStart ?? 1,
            pageEnd: file.pageEnd ?? file.pageStart ?? 1,
            chunkIndex: 1,
            chunkCount: 1,
            chunkSizePages: (file.pageEnd ?? file.pageStart ?? 1) - (file.pageStart ?? 1) + 1,
          },
        ];
    const artifactStore = createDelegateOcrArtifactStore({
      batch,
      file: preprocessingFile,
      signedFile,
    });
    paddleContext = { artifactStore, file: preprocessingFile };
    writer ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    ocrPreprocessingRules ??= await resolveSteelOcrPreprocessingRules();
    const requestId = req?.steelNativeContext?.requestId;
    const turnIndex = req?.steelNativeContext?.assistantTurnIndex ?? 0;
    const checkpointTurnIndex =
      req?.steelNativeContext?.memoryCheckpointTurnIndex ?? Math.max(0, turnIndex - 1);
    const renewDelegateCheckpointLease = async () => {
      const stateService = workflowRef?.delegateOcrStateService;
      const claimToken = workflowRef?.claimToken;
      const executionLeaseToken = workflowRef?.executionLeaseToken;
      if (
        typeof stateService?.acquireDelegateExecutionLease !== 'function' ||
        typeof claimToken !== 'string' ||
        typeof executionLeaseToken !== 'string'
      ) {
        throw new Error('delegate_ocr checkpoint lease is unavailable');
      }
      const renewed = await stateService.acquireDelegateExecutionLease({
        claimToken,
        leaseToken: executionLeaseToken,
      });
      if (!renewed) {
        throw new Error('delegate_ocr checkpoint lease is stale');
      }
    };
    const memory = {
      readOcrPreprocessingState: (input) =>
        writer.readDelegateOcrPreprocessingState({
          ...input,
          delegateOcrIndex,
        }),
      capturePaddleOcrChunkResult: async (input) => {
        await renewDelegateCheckpointLease();
        return writer.captureDelegatePaddleOcrChunkResult({
          ...input,
          delegateOcrIndex,
        });
      },
      captureOcrPreprocessingChunkMarkdown: async (input) => {
        await renewDelegateCheckpointLease();
        return writer.captureDelegateOcrPreprocessingChunkMarkdown({
          ...input,
          delegateOcrIndex,
        });
      },
    };
    paddleOcr ??= createSteelPaddleOcrChunkRunner({
      req,
      res,
      signal,
      agent,
      streamId,
      conversationId,
      requestId,
      toolName: buildMCPToolKey(steelPaddleOcrToolName, steelPaddleOcrMcpServerName),
      userMCPAuthMap: delegateContext?.userMCPAuthMap,
      requestScopedConnections: delegateContext?.requestScopedConnections,
      refreshArtifact: async ({ artifact, chunk }) =>
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
      files: [
        {
          file: preprocessingFile,
          chunks,
          artifacts: artifactStore,
        },
      ],
      ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
      ocrRulesText: ocrPreprocessingRules.ocrRulesText,
      memory,
      organizer: createSteelOcrOrganizer({
        agent,
        signal,
        latestUserMessage: currentUserTurn,
        suggestedOcrResultColumns,
      }),
      paddleOcr,
      onProgress: ({ file: progressFile, progress }) => {
        let stage = 'reconciliation';
        if (progress.stage.startsWith('paddleocr') || progress.stage === 'pdf_chunks_ready') {
          stage = 'paddleocr';
        } else if (progress.stage.startsWith('organizer') || progress.stage.includes('markdown')) {
          stage = 'organizer';
        }
        let status = 'progress';
        if (progress.stage.endsWith('_started')) {
          status = 'started';
        } else if (
          progress.stage.endsWith('_saved') &&
          progress.chunkIndex !== undefined &&
          progress.chunkIndex === progress.chunkCount
        ) {
          status = 'succeeded';
        }
        return emitSteelNativeEvents({
          req,
          res,
          streamId,
          events: buildSteelDelegateOcrStatusEventEnvelopes({
            conversationId,
            requestId,
            messageId: requestId,
            delegateOcrIndex,
            stage,
            status,
            message: `Delegate OCR ${progress.stage} (${progressFile.ocrFileKey})`,
            ...(progress.chunkIndex !== undefined ? { chunkIndex: progress.chunkIndex } : {}),
            ...(progress.chunkCount !== undefined ? { chunkCount: progress.chunkCount } : {}),
            ...(typeof workflowRef.claimToken === 'string'
              ? { claimToken: workflowRef.claimToken }
              : {}),
            ...(typeof workflowRef.generationId === 'string'
              ? { generationId: workflowRef.generationId }
              : {}),
          }),
        });
      },
    });
    const fileResult = result?.files?.[0];
    if (!fileResult) {
      return undefined;
    }
    if (fileResult.status === 'failed') {
      await emitSteelNativeEvents({
        req,
        res,
        streamId,
        events: buildSteelDelegateOcrStatusEventEnvelopes({
          conversationId,
          requestId,
          messageId: requestId,
          delegateOcrIndex,
          stage: 'paddleocr',
          status: 'failed',
          message: `Delegate OCR preprocessing failed (${fileResult.file.ocrFileKey})`,
          errorMessage: fileResult.errorMessage,
          ...(typeof workflowRef.claimToken === 'string'
            ? { claimToken: workflowRef.claimToken }
            : {}),
          ...(typeof workflowRef.generationId === 'string'
            ? { generationId: workflowRef.generationId }
            : {}),
        }),
      });
      return fileResult.partial?.markdown
        ? { organizerMarkdown: fileResult.partial.markdown }
        : undefined;
    }
    await emitSteelNativeEvents({
      req,
      res,
      streamId,
      events: buildSteelDelegateOcrStatusEventEnvelopes({
        conversationId,
        requestId,
        messageId: requestId,
        delegateOcrIndex,
        stage: 'organizer',
        status: 'succeeded',
        message: `Delegate OCR Organizer completed (${fileResult.file.ocrFileKey})`,
        ...(typeof workflowRef.claimToken === 'string'
          ? { claimToken: workflowRef.claimToken }
          : {}),
        ...(typeof workflowRef.generationId === 'string'
          ? { generationId: workflowRef.generationId }
          : {}),
      }),
    });
    return { organizerMarkdown: fileResult.markdown };
  };
}

function createDelegateOcrExecute({ req, res, streamId = null, signal, agent }) {
  return async (input) => {
    const delegateContext = req?.steelNativeContext?.delegateOcrContext;
    if (!delegateContext?.modelOptions) {
      throw new Error('delegate_ocr request context is unavailable');
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

    const workflowContext = delegateContext.delegateOcrWorkflow ?? delegateContext;
    const runPreprocessing =
      workflowContext.runDelegateOcrPreprocessing ??
      workflowContext.preprocessSelectedFiles ??
      workflowContext.runOcrPreprocessing;
    const loadSourceMapping =
      workflowContext.loadDelegateOcrSourceMapping ?? workflowContext.loadSourceMapping;
    const loadCurrentOcrResult =
      workflowContext.loadCurrentDelegateOcrResult ?? workflowContext.loadCurrentOcrResult;
    const finalize = workflowContext.finalizeDelegateOcr ?? workflowContext.finalizeOcrResponse;
    const saveFailed =
      workflowContext.saveDelegateOcrFailure ?? workflowContext.saveFailedDelegateOcr;
    let runStore = workflowContext.delegateOcrRunStore ?? workflowContext.runStore;
    const stateService =
      workflowContext.delegateOcrStateService ??
      workflowContext.stateService ??
      (typeof createSteelDelegateOcrStateService === 'function'
        ? createSteelDelegateOcrStateService(mongoose)
        : undefined);
    const claimToken = workflowContext.delegateOcrClaimToken ?? workflowContext.claimToken;
    const executionLeaseToken = workflowContext.executionLeaseToken;
    if (
      !runStore &&
      stateService &&
      typeof stateService.beginDelegateAgentAttempt === 'function' &&
      typeof claimToken === 'string' &&
      claimToken.trim() !== ''
    ) {
      runStore = {
        beginAttempt: async ({ attemptToken }) => {
          const run = await stateService.beginDelegateAgentAttempt({
            claimToken,
            ...(typeof executionLeaseToken === 'string' && executionLeaseToken.trim() !== ''
              ? { executionLeaseToken }
              : {}),
            attemptToken,
          });
          return typeof run?.agentAttemptToken === 'string'
            ? { attemptToken: run.agentAttemptToken }
            : undefined;
        },
      };
    }
    const canonicalMapping = workflowContext.canonicalMapping ?? workflowContext.sourceFileMapping;
    const previousOcrResultMarkdown =
      workflowContext.previousOcrResultMarkdown ?? workflowContext.currentOcrResultMarkdown;
    const suggestedOcrResultColumns = workflowContext.suggestedOcrResultColumns ?? [];
    let workflow =
      typeof runPreprocessing === 'function' ||
      typeof loadSourceMapping === 'function' ||
      typeof loadCurrentOcrResult === 'function' ||
      typeof finalize === 'function' ||
      typeof saveFailed === 'function' ||
      runStore ||
      Array.isArray(canonicalMapping) ||
      typeof previousOcrResultMarkdown === 'string' ||
      suggestedOcrResultColumns.length > 0
        ? {
            ...(Array.isArray(canonicalMapping) ? { canonicalMapping } : {}),
            ...(typeof previousOcrResultMarkdown === 'string' ? { previousOcrResultMarkdown } : {}),
            ...(Array.isArray(suggestedOcrResultColumns) ? { suggestedOcrResultColumns } : {}),
            ...(typeof runPreprocessing === 'function' ? { runPreprocessing } : {}),
            ...(typeof loadSourceMapping === 'function' ? { loadSourceMapping } : {}),
            ...(typeof loadCurrentOcrResult === 'function' ? { loadCurrentOcrResult } : {}),
            ...(typeof finalize === 'function' ? { finalize } : {}),
            ...(typeof saveFailed === 'function' ? { saveFailed } : {}),
            ...(runStore ? { runStore } : {}),
            ...(typeof claimToken === 'string' ? { claimToken } : {}),
            ...(typeof workflowContext.responseGenerationId === 'string'
              ? { generationId: workflowContext.responseGenerationId }
              : {}),
            ...(typeof workflowContext.responseGenerationId !== 'string' &&
            typeof workflowContext.generationId === 'string'
              ? { generationId: workflowContext.generationId }
              : {}),
            ...(typeof workflowContext.delegateOcrAttemptToken === 'string'
              ? { attemptToken: workflowContext.delegateOcrAttemptToken }
              : {}),
          }
        : undefined;
    const workflowRef =
      workflow ??
      (stateService &&
      typeof stateService.claimNewDelegateOcrIndex === 'function' &&
      typeof stateService.materializeDelegateOcrRun === 'function' &&
      typeof stateService.acquireDelegateExecutionLease === 'function'
        ? {}
        : undefined);
    if (workflowRef && !workflow) {
      workflow = workflowRef;
    }
    if (workflowRef) {
      // Keep the controller's context pointed at the mutable workflow object
      // that the delegate executor receives. This carries backend-only
      // finalization provenance across the tool boundary.
      delegateContext.delegateOcrWorkflow = workflowRef;
    }

    let delegateRunInitialized = false;
    const triggeringMessageId =
      workflowContext.triggeringMessageId ??
      steelConversation?.currentUserTurn?.messageId ??
      steelConversation?.currentUserTurn?.message_id ??
      req?.steelNativeContext?.requestId;
    const conversationId =
      req?.steelNativeContext?.conversationId ?? steelConversation?.conversationId;
    const generationId =
      workflowContext.responseGenerationId ??
      workflowContext.generationId ??
      req?.steelNativeContext?.requestId;
    const ensureDelegateRun = async (records) => {
      if (
        delegateRunInitialized ||
        !workflowRef ||
        !stateService ||
        typeof triggeringMessageId !== 'string' ||
        triggeringMessageId.trim() === '' ||
        typeof conversationId !== 'string' ||
        conversationId.trim() === ''
      ) {
        return;
      }
      delegateRunInitialized = true;
      let run =
        typeof stateService.findResumableDelegateOcrRun === 'function'
          ? await stateService.findResumableDelegateOcrRun({
              conversationId,
              triggeringMessageId,
            })
          : undefined;
      const wasResumed = Boolean(run);
      let activeRun;
      const findActiveRun = stateService.findActiveDelegateOcrRun ?? stateService.findActiveRun;
      if (
        !run &&
        typeof findActiveRun === 'function' &&
        typeof stateService.supersedeDelegateOcrRun === 'function'
      ) {
        activeRun = stateService.findActiveDelegateOcrRun
          ? await findActiveRun(conversationId)
          : await findActiveRun({ conversationId });
      }
      let claim;
      if (run) {
        claim = {
          conversationId,
          delegateOcrIndex: run.delegateOcrIndex,
          claimToken: run.claimToken,
          triggeringMessageId,
          ...(run.responseGenerationId ? { responseGenerationId: run.responseGenerationId } : {}),
        };
      } else {
        const nextClaimToken = activeRun ? crypto.randomUUID() : undefined;
        if (activeRun && typeof stateService.supersedeDelegateOcrRun === 'function') {
          await stateService.supersedeDelegateOcrRun({
            claimToken: activeRun.claimToken,
            provenance: {
              supersededByClaimToken: nextClaimToken,
              reason: 'new delegate OCR triggering message',
              at: new Date(),
            },
          });
          if (typeof stateService.recordSupersededDelegateClaim === 'function') {
            await stateService.recordSupersededDelegateClaim({
              conversationId,
              claimToken: activeRun.claimToken,
              delegateOcrIndex: activeRun.delegateOcrIndex,
              supersededByClaimToken: nextClaimToken,
              reason: 'new delegate OCR triggering message',
            });
          }
          if (typeof stateService.clearCompletedDelegateClaim === 'function') {
            await stateService.clearCompletedDelegateClaim({
              conversationId,
              claimToken: activeRun.claimToken,
              delegateOcrIndex: activeRun.delegateOcrIndex,
              ...(activeRun.executionLeaseToken
                ? { executionLeaseToken: activeRun.executionLeaseToken }
                : {}),
            });
          }
        }
        claim = await stateService.claimNewDelegateOcrIndex({
          conversationId,
          triggeringMessageId,
          ...(nextClaimToken ? { claimToken: nextClaimToken } : {}),
          ...(typeof generationId === 'string' ? { responseGenerationId: generationId } : {}),
        });
        if (!claim) {
          throw new Error('delegate_ocr active run claim is unavailable');
        }
      }
      if (!run) {
        const toolFiles = records.map((record) => ({
          fileId: getSteelFileId(record) ?? 'unknown',
          filename: record.filename ?? getSteelFileId(record) ?? 'unknown',
          ...(record.storageKey ? { storageKey: record.storageKey } : {}),
          ...(record.type || record.mimetype ? { mediaType: record.type ?? record.mimetype } : {}),
        }));
        try {
          run = await stateService.materializeDelegateOcrRun({
            conversationId,
            delegateOcrIndex: claim.delegateOcrIndex,
            claimToken: claim.claimToken,
            triggeringMessageId,
            ...(typeof currentUserTurn === 'string'
              ? { triggeringMessageText: currentUserTurn }
              : {}),
            toolParameters: { files: input.files },
            files: toolFiles,
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
      if (Array.isArray(run?.toolParameters?.files)) {
        workflowRef.filesOverride = run.toolParameters.files;
      }
      const lease = await stateService.acquireDelegateExecutionLease({
        claimToken: claim.claimToken,
        ...(typeof executionLeaseToken === 'string' ? { leaseToken: executionLeaseToken } : {}),
      });
      if (!lease) {
        throw new Error('delegate_ocr execution lease is unavailable');
      }
      const beginAttempt = async ({ attemptToken }) => {
        const attempt = await stateService.beginDelegateAgentAttempt({
          claimToken: claim.claimToken,
          executionLeaseToken: lease.executionLeaseToken,
          attemptToken,
        });
        return typeof attempt?.agentAttemptToken === 'string'
          ? { attemptToken: attempt.agentAttemptToken }
          : undefined;
      };

      const sourceCodeByFileId = new Map();
      if (typeof stateService.allocateDelegateSourceMapping === 'function') {
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
      }
      const loadCanonicalMapping = async () => {
        if (typeof stateService.readSourceMappings !== 'function') {
          return [];
        }
        return stateService.readSourceMappings(conversationId);
      };
      let previousOcrResultRevision;
      const loadPreviousOcrResult = async () => {
        if (typeof stateService.readCurrentOcrResult !== 'function') {
          return '';
        }
        const result = await stateService.readCurrentOcrResult(conversationId);
        previousOcrResultRevision =
          typeof result?.generationId === 'string' && result.generationId.trim() !== ''
            ? result.generationId
            : undefined;
        return typeof result?.markdown === 'string' ? result.markdown : '';
      };
      const previousMarkdown = await loadPreviousOcrResult();
      const suggestedColumns = inferDelegateSuggestedOcrResultColumns(previousMarkdown);
      const organizerSuggestedColumns =
        Array.isArray(workflowRef.suggestedOcrResultColumns) &&
        workflowRef.suggestedOcrResultColumns.length > 0
          ? workflowRef.suggestedOcrResultColumns
          : suggestedColumns;
      const runDelegatePreprocessing =
        typeof runPreprocessing === 'function'
          ? runPreprocessing
          : createDefaultDelegateOcrPreprocessing({
              req,
              res,
              streamId,
              signal,
              agent: agent ?? delegateContext.agent,
              delegateContext,
              currentUserTurn,
              conversationId,
              workflowRef,
              suggestedOcrResultColumns: organizerSuggestedColumns,
            });
      Object.assign(workflowRef, {
        enabled: true,
        delegateOcrStateService: stateService,
        claimToken: claim.claimToken,
        executionLeaseToken: lease.executionLeaseToken,
        delegateOcrIndex: claim.delegateOcrIndex,
        generationId,
        sourceCodeByFileId,
        ...(typeof runDelegatePreprocessing === 'function'
          ? { runPreprocessing: runDelegatePreprocessing }
          : {}),
        loadSourceMapping: loadSourceMapping ?? loadCanonicalMapping,
        loadCurrentOcrResult: loadCurrentOcrResult ?? loadPreviousOcrResult,
        ...(previousOcrResultRevision ? { previousOcrResultRevision } : {}),
        auditResponse: async ({
          assistantResponse,
          previousOcrResultMarkdown,
          attemptNumber,
          attemptToken,
        }) => {
          const auditUserId = req?.user?.id;
          if (!auditUserId || !conversationId || !triggeringMessageId || !generationId) {
            throw new Error(
              'delegate_ocr audit requires user, conversation, message, and generation scope',
            );
          }
          await createSteelOcrResponseAuditService(mongoose).save({
            rawResponse: assistantResponse,
            sourceStage: 'delegate',
            userId: auditUserId,
            tenantId: req?.user?.tenantId,
            conversationId,
            messageId: triggeringMessageId,
            generationId,
            attemptId: attemptToken,
            attemptNumber,
            ...(typeof previousOcrResultRevision === 'string'
              ? { baseRevision: previousOcrResultRevision }
              : {}),
            baseResponse: previousOcrResultMarkdown ?? previousMarkdown ?? '',
          });
        },
        ...(organizerSuggestedColumns.length > 0 &&
        (!Array.isArray(workflowRef.suggestedOcrResultColumns) ||
          workflowRef.suggestedOcrResultColumns.length === 0)
          ? { suggestedOcrResultColumns: organizerSuggestedColumns }
          : {}),
        ...(typeof previousMarkdown === 'string' &&
        workflowRef.previousOcrResultMarkdown === undefined
          ? { previousOcrResultMarkdown: previousMarkdown }
          : {}),
        ...(workflowRef.runStore ? {} : { runStore: { beginAttempt } }),
      });
      delegateContext.delegateOcrRun = run;
      delegateContext.delegateOcrClaim = claim;
      delegateContext.delegateOcrExecutionLease = lease;
      if (wasResumed) {
        await emitSteelNativeEvents({
          req,
          res,
          streamId,
          events: buildSteelDelegateOcrStatusEventEnvelopes({
            conversationId,
            requestId: generationId,
            messageId: triggeringMessageId,
            delegateOcrIndex: claim.delegateOcrIndex,
            stage: 'resume',
            status: 'started',
            message: `Resuming Delegate OCR run N=${claim.delegateOcrIndex}`,
            claimToken: claim.claimToken,
            ...(typeof generationId === 'string' ? { generationId } : {}),
          }),
        });
      }
    };

    if (
      workflowRef &&
      stateService &&
      typeof stateService.findResumableDelegateOcrRun === 'function' &&
      typeof triggeringMessageId === 'string' &&
      triggeringMessageId.trim() !== '' &&
      typeof conversationId === 'string' &&
      conversationId.trim() !== ''
    ) {
      const resumable = await stateService.findResumableDelegateOcrRun({
        conversationId,
        triggeringMessageId,
      });
      if (
        Array.isArray(resumable?.toolParameters?.files) &&
        resumable.toolParameters.files.length > 0
      ) {
        workflowRef.filesOverride = resumable.toolParameters.files;
      }
    }

    const signStoredFile = async (file) => {
      const source = file.source ?? req.config?.fileStrategy ?? FileSources.local;
      const { getDownloadURL } = getStrategyFunctions(source);
      if (typeof getDownloadURL !== 'function') {
        throw new Error(`delegate_ocr file source "${source}" cannot create a signed URL`);
      }
      return getDownloadURL({ file });
    };

    const prepareBatches = async ({ files, fileInputs, storedFiles }) => {
      const storedById = new Map(
        storedFiles.map((record) => [getSteelFileId(record), record]).filter(([fileId]) => fileId),
      );
      if (files.length !== fileInputs.length) {
        throw new Error('delegate_ocr selected file metadata is incomplete');
      }

      const batches = [];
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        const fileInput = fileInputs[fileIndex];
        const storedFile = storedById.get(file.fileId);
        if (!storedFile) {
          throw new Error(`delegate_ocr file record disappeared: file:${file.fileId}`);
        }
        if (!isPdfSteelFile(file)) {
          const sourceCode = workflowRef?.sourceCodeByFileId?.get(file.fileId);
          const preprocessingFile = toSteelOcrPreprocessingFile(
            {
              ...file,
              ocrFileKey: `file:${file.fileId}`,
              ...(sourceCode ? { sourceCode } : {}),
            },
            storedFile,
          );
          batches.push({
            files: [file],
            signFile: async () => signStoredFile(storedFile),
            ...(preprocessingFile
              ? {
                  _delegatePreprocessing: {
                    file: preprocessingFile,
                    chunks: [buildSingleOriginalOcrChunk()[0]],
                  },
                }
              : {}),
          });
          continue;
        }
        const pageRanges = fileInput?.pageRanges;
        if (!Array.isArray(pageRanges) || pageRanges.length === 0) {
          throw new Error(`delegate_ocr PDF file requires pageRanges: file:${file.fileId}`);
        }
        const sourcePdfKey = storedFile.storageKey;
        if (
          typeof sourcePdfKey !== 'string' ||
          sourcePdfKey.trim() === '' ||
          sourcePdfKey.trim() !== sourcePdfKey ||
          isHttpUrl(sourcePdfKey)
        ) {
          throw new Error(`delegate_ocr PDF storage key is unavailable for file:${file.fileId}`);
        }
        const sourceCode = workflowRef?.sourceCodeByFileId?.get(file.fileId);
        const preprocessingFile = toSteelOcrPreprocessingFile(
          {
            ...file,
            ocrFileKey: `file:${file.fileId}`,
            ...(sourceCode ? { sourceCode } : {}),
          },
          storedFile,
        );
        if (!preprocessingFile) {
          throw new Error(`delegate_ocr PDF source is unavailable for file:${file.fileId}`);
        }
        preprocessingFile.sourcePdfKey = sourcePdfKey;
        const artifactStore = createSteelOcrPdfChunkArtifactStore({
          file: preprocessingFile,
          fileRecord: storedFile,
        });
        let artifacts;
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
          let currentArtifact = artifact;
          let artifactSignCount = 0;
          const artifactFile = {
            ...file,
            fileId: `${file.fileId}#${range.pageStart}-${range.pageEnd}`,
            filename: artifact.filename,
            filepath: artifact.filepath,
            storageKey: artifact.storageKey,
            mediaType: 'application/pdf',
            pageStart: range.pageStart,
            pageEnd: range.pageEnd,
          };
          batches.push({
            files: [artifactFile],
            range,
            _delegatePreprocessing: {
              file: preprocessingFile,
              chunks: [
                {
                  pageStart: range.pageStart,
                  pageEnd: range.pageEnd,
                  chunkIndex: artifact.chunkIndex ?? 1,
                  chunkCount: artifact.chunkCount ?? artifacts.length,
                  chunkSizePages: artifact.chunkSizePages ?? range.pageEnd - range.pageStart + 1,
                },
              ],
              artifacts: artifactStore,
              artifact,
            },
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
                chunk: range,
                artifact: currentArtifact,
              });
              currentArtifact = refreshed;
              artifactFile.filepath = refreshed.filepath;
              artifactFile.storageKey = refreshed.storageKey;
              artifactFile.filename = refreshed.filename;
              artifactSignCount += 1;
              return refreshed.filepath;
            },
          });
        }
      }
      return batches;
    };

    const execute = createDelegateOcrRequestExecute({
      currentUserTurn,
      policy: delegateContext.delegateOcrPolicy ?? req?.steelNativeContext?.delegateOcrPolicy,
      modelOptions: delegateContext.modelOptions,
      userId: req.user?.id,
      availableFiles: collectDelegateOcrAvailableFiles(req, delegateContext),
      getOwnedFileRecords: async (filter) => {
        const records = (await db.getFiles(filter, {}, {})) ?? [];
        await ensureDelegateRun(records);
        return records;
      },
      signStoredFile,
      prepareBatches,
      loadOcrRules: async () => {
        const context = await buildDefaultSteelGlobalAgentContext({
          runtimeRulesClient: steelPostgres.client,
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
      invokeModel: async ({
        messages,
        modelOptions,
        signal: modelSignal,
        onDelta,
        attemptNumber = 1,
        attemptToken,
      }) => {
        const eventInput = {
          conversationId,
          requestId: generationId,
          messageId: triggeringMessageId,
          delegateOcrIndex: workflowRef.delegateOcrIndex,
          stage: 'agent',
          ...(typeof workflowRef.claimToken === 'string'
            ? { claimToken: workflowRef.claimToken }
            : {}),
          ...(typeof generationId === 'string' ? { generationId } : {}),
          ...(typeof attemptToken === 'string' ? { attemptToken } : {}),
        };
        await emitSteelNativeEvents({
          req,
          res,
          streamId,
          events: buildSteelDelegateOcrStatusEventEnvelopes({
            ...eventInput,
            status: attemptNumber > 1 ? 'retrying' : 'started',
            message:
              attemptNumber > 1
                ? `Retrying Delegate OCR Agent (${attemptNumber}/3)`
                : 'Delegate OCR Agent started',
          }),
        });
        try {
          const model = createOpenAIOAuthModel(modelOptions);
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
          await emitSteelNativeEvents({
            req,
            res,
            streamId,
            events: buildSteelDelegateOcrStatusEventEnvelopes({
              ...eventInput,
              status: 'succeeded',
              message: 'Delegate OCR Agent completed',
            }),
          });
          return answer;
        } catch (error) {
          await emitSteelNativeEvents({
            req,
            res,
            streamId,
            events: buildSteelDelegateOcrStatusEventEnvelopes({
              ...eventInput,
              status: 'failed',
              message: 'Delegate OCR Agent failed',
              errorMessage: error?.message,
            }),
          });
          throw error;
        }
      },
      signal,
      workflow: workflowRef,
    });

    return execute(input);
  };
}

/**
 * Resolve an unfinished delegate OCR run for the exact triggering user
 * message. This is intentionally a narrow adapter for the agents controller:
 * it never falls back to a different message and re-authorizes every saved
 * file id before allowing a resume.
 *
 * @param {{ req: Object, conversationId: string, triggeringMessageId: string, userId?: string }} input
 * @returns {Promise<Object | undefined>}
 */
async function prepareDelegateOcrResume({ req, conversationId, triggeringMessageId, userId }) {
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim() === '' ||
    typeof triggeringMessageId !== 'string' ||
    triggeringMessageId.trim() === '' ||
    typeof userId !== 'string' ||
    userId.trim() === ''
  ) {
    return undefined;
  }

  const context = req?.steelNativeContext ?? {};
  const delegateContext = context.delegateOcrContext ?? {};
  const workflowContext = delegateContext.delegateOcrWorkflow ?? delegateContext;
  const stateService =
    workflowContext.delegateOcrStateService ??
    workflowContext.stateService ??
    (typeof createSteelDelegateOcrStateService === 'function'
      ? createSteelDelegateOcrStateService(mongoose)
      : undefined);
  if (typeof stateService?.findResumableDelegateOcrRun !== 'function') {
    return undefined;
  }

  const run = await stateService.findResumableDelegateOcrRun({
    conversationId,
    triggeringMessageId,
  });
  if (!run) {
    return undefined;
  }

  const claim = {
    conversationId,
    delegateOcrIndex: run.delegateOcrIndex,
    claimToken: run.claimToken,
    triggeringMessageId,
    ...(run.responseGenerationId ? { responseGenerationId: run.responseGenerationId } : {}),
  };
  const savedInputs = run.toolParameters?.files;
  if (!Array.isArray(savedInputs) || savedInputs.length === 0) {
    throw new Error('delegate_ocr resume parameters unavailable');
  }
  const fileIds = (Array.isArray(run.files) ? run.files : []).map(getSteelFileId).filter(Boolean);
  if (fileIds.length !== savedInputs.length) {
    throw new Error('delegate_ocr resume file metadata is unavailable');
  }
  const normalizedInputs = savedInputs.map((fileInput) => {
    if (typeof fileInput?.fileKey !== 'string' || fileInput.fileKey.trim() === '') {
      throw new Error('delegate_ocr resume parameters unavailable');
    }
    /** Preserve the exact persisted tool params (including aliases and PDF
     * ranges); the native resolver will canonicalize them against the
     * owner-authorized records below. */
    return fileInput;
  });
  if (new Set(fileIds).size !== fileIds.length) {
    throw new Error('delegate_ocr resume contains duplicate file ids');
  }

  const records =
    (await db.getFiles(
      {
        user: userId,
        file_id: { $in: fileIds },
        ...(req?.user?.tenantId ? { tenantId: req.user.tenantId } : {}),
      },
      {},
      {},
    )) ?? [];
  const ownedIds = new Set(records.map(getSteelFileId).filter(Boolean));
  if (ownedIds.size !== fileIds.length || fileIds.some((fileId) => !ownedIds.has(fileId))) {
    throw new Error('delegate_ocr resume authorization failed');
  }

  /** Do not renew or acquire a run lease until every persisted file has been
   * re-authorized for the current user. */
  const lease =
    typeof stateService.acquireDelegateExecutionLease === 'function'
      ? await stateService.acquireDelegateExecutionLease({
          claimToken: run.claimToken,
          leaseToken: crypto.randomUUID(),
          expectedConversationId: conversationId,
          expectedDelegateOcrIndex: run.delegateOcrIndex,
          expectedTriggeringMessageId: triggeringMessageId,
          expectedLeaseToken: run.executionLeaseToken ?? null,
        })
      : undefined;
  if (typeof stateService.acquireDelegateExecutionLease === 'function' && !lease) {
    throw new Error('delegate_ocr resume execution lease is unavailable');
  }

  const resumePolicy = {
    resolved: true,
    allowed: true,
    allowedFileKeys: [
      ...new Set([
        ...normalizedInputs.map(({ fileKey }) => fileKey),
        ...fileIds.map((fileId) => `file:${fileId}`),
      ]),
    ],
  };
  const resume = {
    run,
    claim,
    lease,
    files: normalizedInputs,
    records,
    stateService,
    policy: resumePolicy,
    candidate:
      run.finalizedCandidate && typeof run.finalizedCandidate.markdown === 'string'
        ? run.finalizedCandidate
        : undefined,
  };
  context.delegateOcrResume = resume;
  context.delegateOcrContext = {
    ...delegateContext,
    delegateOcrRun: run,
    delegateOcrClaim: claim,
    ...(lease ? { delegateOcrExecutionLease: lease } : {}),
    delegateOcrResume: resume,
    delegateOcrPolicy: {
      resolved: true,
      allowed: false,
      allowedFileKeys: [],
      reason: 'delegate_ocr_resume',
    },
    delegateOcrWorkflow: {
      ...workflowContext,
      enabled: true,
      delegateOcrStateService: stateService,
      claimToken: run.claimToken,
      delegateOcrClaimToken: run.claimToken,
      delegateOcrIndex: run.delegateOcrIndex,
      responseGenerationId: run.responseGenerationId,
      triggeringMessageId,
      filesOverride: normalizedInputs,
      ...(lease?.executionLeaseToken ? { executionLeaseToken: lease.executionLeaseToken } : {}),
    },
  };
  return resume;
}

/** Execute a prepared resume after OAuth model options have been resolved. */
async function executeDelegateOcrResume({
  req,
  res,
  streamId = null,
  signal,
  agent,
  resume,
  onDelta,
}) {
  if (!resume?.run || !Array.isArray(resume.files) || resume.files.length === 0) {
    throw new Error('delegate_ocr resume state is unavailable');
  }
  const delegateContext = req?.steelNativeContext?.delegateOcrContext;

  /** A finalized candidate is already the terminal answer. Re-emit it for the
   * controller while leaving persistence/finalization to the normal root path;
   * importantly, do not rerun Paddle/Organizer/Delegate AI. */
  if (
    resume.candidate &&
    typeof resume.candidate.markdown === 'string' &&
    ['finalizing', 'save_failed'].includes(resume.run.status)
  ) {
    const canonicalOcrResultMarkdown =
      resume.candidate.source === 'backend'
        ? extractCanonicalDelegateOcrResult(resume.candidate.markdown)
        : undefined;
    const workflow = delegateContext?.delegateOcrWorkflow ?? delegateContext;
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
    ...(delegateContext.delegateOcrWorkflow ?? {}),
    enabled: true,
    delegateOcrStateService: resume.stateService,
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

module.exports = {
  createDelegateOcrExecute,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  getDelegateOcrCurrentUserTurn,
  resolveDelegateOcrPolicyForRequest,
};
