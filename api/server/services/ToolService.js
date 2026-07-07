const crypto = require('crypto');
const mongoose = require('mongoose');
const { logger, redactMessage } = require('@librechat/data-schemas');
const { HumanMessage, SystemMessage } = require('@librechat/agents/langchain/messages');
const { tool: toolFn, DynamicStructuredTool } = require('@librechat/agents/langchain/tools');
const {
  sleep,
  createToolSearch,
  createBashExecutionTool,
  Constants: AgentConstants,
  createBashProgrammaticToolCallingTool,
} = require('@librechat/agents');
const {
  sendEvent,
  getToolkitKey,
  getUserMCPAuthMap,
  loadToolDefinitions,
  GenerationJobManager,
  isActionDomainAllowed,
  buildWebSearchContext,
  buildImageToolContext,
  buildToolClassification,
  getMissingCustomUserVars,
  buildWebSearchDynamicContext,
  getCodeApiAuthHeaders,
  getReplayablePendingMCPOAuthStart,
  getMCPServerNamesFromTools,
  buildMCPAuthToolCall,
  buildMCPAuthStepId,
  buildMCPToolKey,
  buildMCPAuthRunStepEvent,
  buildMCPAuthRunStepDeltaEvent,
  buildMCPAuthRunStepCompletedEvent,
  captureSteelNativeToolResult,
  buildSteelNativeEventEnvelopes,
  buildSteelPaddleOcrPreflightEventEnvelopes,
  buildSteelOcrPreprocessingEventEnvelopes,
  isFileAuthoringToolDefinition,
  createSteelNativeTool,
  createSteelPostgresPool,
  createSteelToolRunState,
  executeSteelTool,
  mergeSteelToolDefinitions,
  resolveSteelProviderToolName,
  getSteelOcrFileDescriptor,
  ocrPreprocessingPipelineVersion,
  createMongooseSteelOutputSheetMemoryReader,
  createMongooseSteelWorkingOrderMemoryWriter,
  createMongooseOcrPdfChunkArtifactRepository,
  createSteelContextDependencies,
  createOpenAIOAuthModel,
  parseOpenAIConfig,
  resolveOpenAIOAuthAuthFilePath,
  buildOcrOrganizerPrompt,
  mergeOcrPreprocessingStateMarkdown,
  runOcrPreprocessingBatchPipeline,
  getPaddleOcrResultContent,
  resolveOcrPreprocessingChunkSizePages,
  buildPdfPageChunks,
  getPdfPageCount,
  createPdfPageRangeChunker,
  ensurePdfChunkArtifacts,
  getS3DownloadURLForKey,
  s3ObjectExistsByKey,
  saveBufferToS3StorageKey,
  getCloudFrontDownloadURLForKey,
  cloudFrontObjectExistsByKey,
  saveBufferToCloudFrontStorageKey,
} = require('@librechat/api');
const {
  Time,
  Tools,
  Constants,
  CacheKeys,
  ErrorTypes,
  ContentTypes,
  StepEvents,
  StepTypes,
  FileSources,
  imageGenTools,
  EModelEndpoint,
  EToolResources,
  ToolCallTypes,
  isActionTool,
  actionDelimiter,
  ImageVisionTool,
  openapiToFunction,
  AgentCapabilities,
  isEphemeralAgentId,
  validateActionDomain,
  actionDomainSeparator,
  defaultAgentCapabilities,
  validateAndParseOpenAPISpec,
} = require('librechat-data-provider');
const { streamToBuffer } = require('~/server/utils/stream');
const {
  createActionTool,
  legacyDomainEncode,
  decryptMetadata,
  loadActionSets,
  domainParser,
} = require('./ActionService');
const {
  getEndpointsConfig,
  getMCPServerTools,
  getCachedTools,
} = require('~/server/services/Config');
const { processFileURL, uploadImageBuffer } = require('~/server/services/Files/process');
const { primeFiles: primeSearchFiles } = require('~/app/clients/tools/util/fileSearch');
const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
const { manifestToolMap, toolkits } = require('~/app/clients/tools/manifest');
const { createOnSearchResults } = require('~/server/services/Tools/search');
const { reinitMCPServer } = require('~/server/services/Tools/mcp');
const { createMCPPermissionContext, resolveConfigServers } = require('~/server/services/MCP');
const { getMCPRequestContext } = require('~/server/services/MCPRequestContext');
const { recordUsage } = require('~/server/services/Threads');
const { loadTools } = require('~/app/clients/tools/util');
const { findPluginAuthsByKeys } = require('~/models');
const db = require('~/models');
const { getFlowStateManager, getMCPManager, getMCPServersRegistry } = require('~/config');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getLogStores } = require('~/cache');

const domainSeparatorRegex = new RegExp(actionDomainSeparator, 'g');

/**
 * Collapse every `actionDomainSeparator` sequence in the encoded-domain
 * suffix of a fully-qualified action tool name to an underscore. Agents
 * can store tool names in the raw `domainParser(..., true)` output,
 * which for short hostnames is a `---`-separated string (e.g.
 * `medium---com`). The lookup maps below are always keyed with the
 * `_`-collapsed domain, so every read must normalize that suffix or
 * short-hostname tools silently fail to resolve.
 *
 * The operationId portion (everything before the last `actionDelimiter`)
 * is deliberately left untouched: `openapiToFunction` preserves hyphens
 * in generated operationIds, so two specs can legitimately produce
 * operationIds that differ only in hyphens-vs-underscores (e.g.
 * `get_foo---bar` vs `get_foo_bar`). Collapsing the operationId would
 * merge those into a single map slot and silently drop one tool.
 */
const normalizeActionToolName = (toolName) => {
  const delimiterIndex = toolName.lastIndexOf(actionDelimiter);
  if (delimiterIndex === -1) {
    return toolName;
  }
  const prefixEnd = delimiterIndex + actionDelimiter.length;
  const encodedDomain = toolName.slice(prefixEnd);
  return toolName.slice(0, prefixEnd) + encodedDomain.replace(domainSeparatorRegex, '_');
};

/**
 * Populate a `toolToAction` map with one slot per fully-qualified tool
 * name (`<operationId><actionDelimiter><encoded-domain>`). Both the new
 * and the legacy encodings of the domain are registered for every
 * function so agents whose stored tool names predate the current
 * encoding still resolve correctly.
 *
 * Indexing on the full tool name instead of the encoded domain alone is
 * what makes multi-action agents work when two actions share a hostname:
 * the operationId disambiguates them, so neither overwrites the other.
 *
 * Two actions that additionally share the same operationId still
 * collide (nothing in the key distinguishes them). That case is
 * pathological — `sanitizeOperationId` plus OpenAPI's own uniqueness
 * requirement make it very unlikely — but when it does happen we log
 * a warning so the silent-overwrite mode from the original bug cannot
 * reappear under a different disguise.
 */
const registerActionTools = ({
  toolToAction,
  functionSignatures,
  normalizedDomain,
  legacyNormalized,
  makeEntry,
}) => {
  const setKey = (key, entry) => {
    if (toolToAction.has(key)) {
      logger.warn(
        `[Actions] operationId collision: "${key}" already registered; ` +
          `action "${entry.action?.action_id}" overwrites the previous entry. ` +
          `Two actions share both the operationId and the encoded hostname.`,
      );
    }
    toolToAction.set(key, entry);
  };

  for (const sig of functionSignatures) {
    const entry = makeEntry(sig);
    // Use `sig.name` verbatim: `openapiToFunction` keeps hyphens in
    // generated operationIds, so `get_foo---bar` and `get_foo_bar` are
    // distinct operations on the same spec. `normalizeActionToolName`
    // only touches the encoded-domain suffix at lookup time, so map
    // keys and lookups stay consistent without merging distinct
    // operationIds into the same slot.
    setKey(`${sig.name}${actionDelimiter}${normalizedDomain}`, entry);
    if (legacyNormalized !== normalizedDomain) {
      setKey(`${sig.name}${actionDelimiter}${legacyNormalized}`, entry);
    }
  }
};

/**
 * Resolves the set of enabled agent capabilities from endpoints config,
 * falling back to app-level or default capabilities for ephemeral agents.
 * @param {ServerRequest} req
 * @param {Object} appConfig
 * @param {string} agentId
 * @returns {Promise<Set<string>>}
 */
async function resolveAgentCapabilities(req, appConfig, agentId) {
  const endpointsConfig = await getEndpointsConfig(req);
  let capabilities = new Set(endpointsConfig?.[EModelEndpoint.agents]?.capabilities ?? []);
  if (capabilities.size === 0 && isEphemeralAgentId(agentId)) {
    capabilities = new Set(
      appConfig.endpoints?.[EModelEndpoint.agents]?.capabilities ?? defaultAgentCapabilities,
    );
  }
  return capabilities;
}

/**
 * Processes the required actions by calling the appropriate tools and returning the outputs.
 * @param {OpenAIClient} client - OpenAI or StreamRunManager Client.
 * @param {RequiredAction} requiredActions - The current required action.
 * @returns {Promise<ToolOutput>} The outputs of the tools.
 */
const processVisionRequest = async (client, currentAction) => {
  if (!client.visionPromise) {
    return {
      tool_call_id: currentAction.toolCallId,
      output: 'No image details found.',
    };
  }

  /** @type {ChatCompletion | undefined} */
  const completion = await client.visionPromise;
  if (completion && completion.usage) {
    recordUsage({
      user: client.req.user.id,
      model: client.req.body.model,
      conversationId: (client.responseMessage ?? client.finalMessage).conversationId,
      ...completion.usage,
    });
  }
  const output = completion?.choices?.[0]?.message?.content ?? 'No image details found.';
  return {
    tool_call_id: currentAction.toolCallId,
    output,
  };
};

/**
 * Processes return required actions from run.
 * @param {OpenAIClient | StreamRunManager} client - OpenAI (legacy) or StreamRunManager Client.
 * @param {RequiredAction[]} requiredActions - The required actions to submit outputs for.
 * @returns {Promise<ToolOutputs>} The outputs of the tools.
 */
async function processRequiredActions(client, requiredActions) {
  logger.debug(
    `[required actions] user: ${client.req.user.id} | thread_id: ${requiredActions[0].thread_id} | run_id: ${requiredActions[0].run_id}`,
    requiredActions,
  );
  const appConfig = client.req.config;
  const toolDefinitions = (await getCachedTools()) ?? {};
  const seenToolkits = new Set();
  const tools = requiredActions
    .map((action) => {
      const toolName = action.tool;
      const toolDef = toolDefinitions[toolName];
      if (toolDef && !manifestToolMap[toolName]) {
        for (const toolkit of toolkits) {
          if (seenToolkits.has(toolkit.pluginKey)) {
            return;
          } else if (toolName.startsWith(`${toolkit.pluginKey}_`)) {
            seenToolkits.add(toolkit.pluginKey);
            return toolkit.pluginKey;
          }
        }
      }
      return toolName;
    })
    .filter((toolName) => !!toolName);

  const { loadedTools } = await loadTools({
    user: client.req.user.id,
    model: client.req.body.model ?? 'gpt-4o-mini',
    tools,
    functions: true,
    endpoint: client.req.body.endpoint,
    options: {
      processFileURL,
      req: client.req,
      uploadImageBuffer,
      openAIApiKey: client.apiKey,
      returnMetadata: true,
    },
    webSearch: appConfig.webSearch,
    fileStrategy: appConfig.fileStrategy,
    imageOutputType: appConfig.imageOutputType,
  });

  const ToolMap = loadedTools.reduce((map, tool) => {
    map[tool.name] = tool;
    return map;
  }, {});

  const promises = [];

  let actionSetsData = null;
  let isActionTool = false;
  const ActionToolMap = {};
  const ActionBuildersMap = {};

  for (let i = 0; i < requiredActions.length; i++) {
    const currentAction = requiredActions[i];
    if (currentAction.tool === ImageVisionTool.function.name) {
      promises.push(processVisionRequest(client, currentAction));
      continue;
    }
    let tool = ToolMap[currentAction.tool] ?? ActionToolMap[currentAction.tool];

    const handleToolOutput = async (output) => {
      requiredActions[i].output = output;

      /** @type {FunctionToolCall & PartMetadata} */
      const toolCall = {
        function: {
          name: currentAction.tool,
          arguments: JSON.stringify(currentAction.toolInput),
          output,
        },
        id: currentAction.toolCallId,
        type: 'function',
        progress: 1,
        action: isActionTool,
      };

      const toolCallIndex = client.mappedOrder.get(toolCall.id);

      if (imageGenTools.has(currentAction.tool)) {
        const imageOutput = output;
        toolCall.function.output = `${currentAction.tool} displayed an image. All generated images are already plainly visible, so don't repeat the descriptions in detail. Do not list download links as they are available in the UI already. The user may download the images by clicking on them, but do not mention anything about downloading to the user.`;

        // Streams the "Finished" state of the tool call in the UI
        client.addContentData({
          [ContentTypes.TOOL_CALL]: toolCall,
          index: toolCallIndex,
          type: ContentTypes.TOOL_CALL,
        });

        await sleep(500);

        /** @type {ImageFile} */
        const imageDetails = {
          ...imageOutput,
          ...currentAction.toolInput,
        };

        const image_file = {
          [ContentTypes.IMAGE_FILE]: imageDetails,
          type: ContentTypes.IMAGE_FILE,
          // Replace the tool call output with Image file
          index: toolCallIndex,
        };

        client.addContentData(image_file);

        // Update the stored tool call
        client.seenToolCalls && client.seenToolCalls.set(toolCall.id, toolCall);

        return {
          tool_call_id: currentAction.toolCallId,
          output: toolCall.function.output,
        };
      }

      client.seenToolCalls && client.seenToolCalls.set(toolCall.id, toolCall);
      client.addContentData({
        [ContentTypes.TOOL_CALL]: toolCall,
        index: toolCallIndex,
        type: ContentTypes.TOOL_CALL,
        // TODO: to append tool properties to stream, pass metadata rest to addContentData
        // result: tool.result,
      });

      return {
        tool_call_id: currentAction.toolCallId,
        output,
      };
    };

    if (!tool) {
      // throw new Error(`Tool ${currentAction.tool} not found.`);

      if (!actionSetsData) {
        /** @type {Action[]} */
        const actionSets =
          (await loadActionSets({
            assistant_id: client.req.body.assistant_id,
          })) ?? [];

        // See registerActionTools for the key-shape rationale.
        const toolToAction = new Map();

        for (const action of actionSets) {
          const domain = await domainParser(action.metadata.domain, true);
          const normalizedDomain = domain.replace(domainSeparatorRegex, '_');
          const legacyDomain = legacyDomainEncode(action.metadata.domain);
          const legacyNormalized = legacyDomain.replace(domainSeparatorRegex, '_');

          const isDomainAllowed = await isActionDomainAllowed(
            action.metadata.domain,
            appConfig?.actions?.allowedDomains,
            appConfig?.actions?.allowedAddresses,
          );
          if (!isDomainAllowed) {
            continue;
          }

          // Validate and parse OpenAPI spec
          const validationResult = validateAndParseOpenAPISpec(action.metadata.raw_spec);
          if (!validationResult.spec || !validationResult.serverUrl) {
            throw new Error(
              `Invalid spec: user: ${client.req.user.id} | thread_id: ${requiredActions[0].thread_id} | run_id: ${requiredActions[0].run_id}`,
            );
          }

          // SECURITY: Validate the domain from the spec matches the stored domain
          // This is defense-in-depth to prevent any stored malicious actions
          const domainValidation = validateActionDomain(
            action.metadata.domain,
            validationResult.serverUrl,
          );
          if (!domainValidation.isValid) {
            logger.error(`Domain mismatch in stored action: ${domainValidation.message}`, {
              userId: client.req.user.id,
              action_id: action.action_id,
            });
            continue; // Skip this action rather than failing the entire request
          }

          // Process the OpenAPI spec
          const { requestBuilders, functionSignatures } = openapiToFunction(validationResult.spec);

          // Store encrypted values for OAuth flow
          const encrypted = {
            oauth_client_id: action.metadata.oauth_client_id,
            oauth_client_secret: action.metadata.oauth_client_secret,
          };

          // Decrypt metadata
          const decryptedAction = { ...action };
          decryptedAction.metadata = await decryptMetadata(action.metadata);

          registerActionTools({
            toolToAction,
            functionSignatures,
            normalizedDomain,
            legacyNormalized,
            makeEntry: (sig) => ({
              action: decryptedAction,
              requestBuilder: requestBuilders[sig.name],
              encrypted,
            }),
          });

          // Store builders for reuse
          ActionBuildersMap[action.metadata.domain] = requestBuilders;
        }

        actionSetsData = toolToAction;
      }

      const entry = actionSetsData.get(normalizeActionToolName(currentAction.tool));
      if (!entry) {
        continue;
      }

      const { action, requestBuilder, encrypted } = entry;

      // We've already decrypted the metadata, so we can pass it directly
      const _allowedDomains = appConfig?.actions?.allowedDomains;
      const _allowedAddresses = appConfig?.actions?.allowedAddresses;
      tool = await createActionTool({
        userId: client.req.user.id,
        res: client.res,
        action,
        requestBuilder,
        // Note: intentionally not passing zodSchema, name, and description for assistants API
        encrypted, // Pass the encrypted values for OAuth flow
        useSSRFProtection: !Array.isArray(_allowedDomains) || _allowedDomains.length === 0,
        allowedAddresses: _allowedAddresses,
      });
      if (!tool) {
        logger.warn(
          `Invalid action: user: ${client.req.user.id} | thread_id: ${requiredActions[0].thread_id} | run_id: ${requiredActions[0].run_id} | toolName: ${currentAction.tool}`,
        );
        throw new Error(`{"type":"${ErrorTypes.INVALID_ACTION}"}`);
      }
      isActionTool = !!tool;
      ActionToolMap[currentAction.tool] = tool;
    }

    if (currentAction.tool === 'calculator') {
      currentAction.toolInput = currentAction.toolInput.input;
    }

    const handleToolError = (error) => {
      logger.error(
        `tool_call_id: ${currentAction.toolCallId} | Error processing tool ${currentAction.tool}`,
        error,
      );
      return {
        tool_call_id: currentAction.toolCallId,
        output: `Error processing tool ${currentAction.tool}: ${redactMessage(error.message, 256)}`,
      };
    };

    try {
      const promise = tool
        ._call(currentAction.toolInput)
        .then(handleToolOutput)
        .catch(handleToolError);
      promises.push(promise);
    } catch (error) {
      const toolOutputError = handleToolError(error);
      promises.push(Promise.resolve(toolOutputError));
    }
  }

  return {
    tool_outputs: await Promise.all(promises),
  };
}

/**
 * Processes the runtime tool calls and returns the tool classes.
 * @param {Object} params - Run params containing user and request information.
 * @param {ServerRequest} params.req - The request object.
 * @param {ServerResponse} params.res - The request object.
 * @param {AbortSignal} params.signal
 * @param {Pick<Agent, 'id' | 'provider' | 'model' | 'tools'} params.agent - The agent to load tools for.
 * @param {string | undefined} [params.openAIApiKey] - The OpenAI API key.
 * @returns {Promise<{
 *   tools?: StructuredTool[];
 *   toolContextMap?: Record<string, unknown>;
 *   dynamicToolContextMap?: Record<string, unknown>;
 *   userMCPAuthMap?: Record<string, Record<string, string>>;
 *   toolRegistry?: Map<string, import('~/utils/toolClassification').LCTool>;
 *   hasDeferredTools?: boolean;
 * }>} The agent tools and registry.
 */
/** Native LibreChat tools that are not in the manifest */
const nativeTools = new Set([
  Tools.execute_code,
  Tools.file_search,
  Tools.web_search,
  Tools.memory,
]);
const defaultSteelNativeToolMaxCalls = 8;
const steelPaddleOcrMcpServerName = process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME || 'PaddleOCR';
const steelPaddleOcrToolName = 'paddleocr_vl';
const steelPaddleOcrRetryableErrorPatterns = [
  'connection reset by peer',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host paddleocr.aistudio-app.com',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
];
let defaultSteelNativeToolClient;

/** Checks if a tool name is a known built-in tool */
const isBuiltInTool = (toolName) =>
  Boolean(
    manifestToolMap[toolName] ||
      toolkits.some((t) => t.pluginKey === toolName) ||
      nativeTools.has(toolName),
  );

function getDefaultSteelNativeToolClient() {
  defaultSteelNativeToolClient ??= createSteelPostgresPool();
  return defaultSteelNativeToolClient;
}

function getRequestConversationId(req) {
  const conversationId = req.body?.conversationId ?? req.steelNativeContext?.conversationId;
  return typeof conversationId === 'string' && conversationId.trim() !== ''
    ? conversationId
    : undefined;
}

function collectSteelOcrCandidateDescriptors(req, requestAttachments) {
  const candidateGroups = [
    req?.steelNativeContext?.currentTurnFiles,
    requestAttachments,
    req?.body?.files,
    req?.body?.attachments,
  ];
  const candidates = [];
  const seen = new Set();

  for (const group of candidateGroups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const file of group) {
      if (!file || typeof file !== 'object') {
        continue;
      }
      const descriptor = getSteelOcrFileDescriptor(file);
      if (!descriptor || seen.has(descriptor.ocrFileKey)) {
        continue;
      }
      seen.add(descriptor.ocrFileKey);
      candidates.push(descriptor);
    }
  }

  return candidates;
}

function addSteelPaddleOcrMcpTool(selectedTools, req, requestAttachments) {
  const serverToken = `${Constants.mcp_all}${Constants.mcp_delimiter}${steelPaddleOcrMcpServerName}`;
  if (
    selectedTools.some(
      (tool) =>
        tool === serverToken ||
        tool?.endsWith(`${Constants.mcp_delimiter}${steelPaddleOcrMcpServerName}`),
    )
  ) {
    return selectedTools;
  }

  const ocrableFiles = collectSteelOcrCandidateDescriptors(req, requestAttachments);
  if (ocrableFiles.length === 0) {
    return selectedTools;
  }

  logger.debug('[Steel OCR] Injecting PaddleOCR MCP server during tool initialization', {
    serverName: steelPaddleOcrMcpServerName,
    files: ocrableFiles.map((file) => ({
      fileId: file.fileId,
      filename: file.filename,
      mediaType: file.mediaType,
    })),
  });
  return [...selectedTools, serverToken];
}

function mergeSteelNativeToolDefinitions(result) {
  const merged = mergeSteelToolDefinitions({
    toolDefinitions: result.toolDefinitions ?? [],
    toolRegistry: result.toolRegistry,
  });

  return {
    ...result,
    toolDefinitions: merged.toolDefinitions,
    toolRegistry: merged.toolRegistry,
  };
}

async function emitSteelNativeEvents({ events, res, streamId }) {
  for (const event of events) {
    if (streamId) {
      await GenerationJobManager.emitChunk(streamId, event);
    } else if (typeof res?.write === 'function' && !res.writableEnded) {
      sendEvent(res, event);
    }
  }
}

function createSteelNativeToolExecute({ req, res, streamId, runState }) {
  const conversationId = getRequestConversationId(req);
  let workingOrderMemoryWriter;
  let outputSheetMemoryReader;

  const getWorkingOrderMemoryWriter = () => {
    if (!conversationId) {
      return undefined;
    }
    workingOrderMemoryWriter ??= createMongooseSteelWorkingOrderMemoryWriter(mongoose);
    return workingOrderMemoryWriter;
  };

  const getOutputSheetMemoryReader = () => {
    if (!conversationId) {
      return undefined;
    }
    outputSheetMemoryReader ??= createMongooseSteelOutputSheetMemoryReader(
      mongoose,
      conversationId,
    );
    return outputSheetMemoryReader;
  };

  return async ({ toolName, arguments: args, providerToolCallId }) => {
    const result = await executeSteelTool({
      client: getDefaultSteelNativeToolClient(),
      toolName,
      arguments: args,
      providerToolCallId,
      runState,
      outputSheetMemoryReader: getOutputSheetMemoryReader(),
    });
    const captureResult = await captureSteelNativeToolResult({
      writer: getWorkingOrderMemoryWriter(),
      conversationId,
      requestId: req.steelNativeContext?.requestId,
      providerToolCallId,
      toolName,
      turnIndex: req.steelNativeContext?.assistantTurnIndex,
      checkpointTurnIndex: req.steelNativeContext?.memoryCheckpointTurnIndex,
      result,
    });

    logger.debug('[ToolService] Steel native tool result capture', {
      toolName,
      providerToolCallId,
      status: captureResult.status,
      reason: captureResult.status === 'skipped' ? captureResult.reason : undefined,
      savedCounts:
        captureResult.status === 'captured' ? captureResult.result.savedCounts : undefined,
    });
    await emitSteelNativeEvents({
      res,
      streamId,
      events: buildSteelNativeEventEnvelopes({
        source: 'tool_result',
        conversationId,
        requestId: req.steelNativeContext?.requestId,
        toolName,
        providerToolCallId,
        capture: captureResult,
      }),
    });

    return result;
  };
}

function getSteelFileId(file) {
  const fileId = file?.fileId ?? file?.file_id ?? file?.id;
  return typeof fileId === 'string' && fileId.trim() !== '' ? fileId : undefined;
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

  return {
    ...file,
    fileId: file.fileId ?? fileRecord?.file_id,
    filename: file.filename ?? fileRecord?.filename,
    mediaType: file.mediaType ?? fileRecord?.type ?? fileRecord?.mimetype,
    storageKey: file.storageKey ?? fileRecord?.storageKey,
    ocrFileKey: file.ocrFileKey,
    sourcePdfKey,
  };
}

function compactSteelText(values) {
  return values.map((value) => value?.trim()).filter((value) => value);
}

function renderSteelOcrRule(rule) {
  return compactSteelText([
    `## ${rule.slug}`,
    rule.title,
    `ruleType: ${rule.ruleType}`,
    Array.isArray(rule.ruleSections) ? `ruleSections: ${rule.ruleSections.join(', ')}` : undefined,
    rule.prompt,
    rule.toolPolicy ? `toolPolicy: ${JSON.stringify(rule.toolPolicy)}` : undefined,
    rule.outputPolicy ? `outputPolicy: ${JSON.stringify(rule.outputPolicy)}` : undefined,
  ]).join('\n');
}

async function resolveSteelOcrPreprocessingRules() {
  try {
    const dependencies = createSteelContextDependencies();
    const otherRules = await dependencies.listOtherGlobalRules();
    const ocrRulesText = (otherRules.ocrRules ?? []).map(renderSteelOcrRule).join('\n\n');
    const versionHash = crypto.createHash('sha256').update(ocrRulesText).digest('hex');
    return {
      ocrRulesText,
      ocrRuleVersion: `ocr-rules:${versionHash}`,
    };
  } catch (error) {
    logger.warn('[Steel OCR] Failed to load OCR rules for preprocessing; continuing fail-open', {
      error: error?.message,
    });
    return {
      ocrRulesText: '',
      ocrRuleVersion: 'ocr-rules:unavailable',
    };
  }
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

function createSteelOcrOrganizer({ signal }) {
  let model;
  return {
    async organize(input) {
      if (!model) {
        const config = parseOpenAIConfig(process.env);
        model = createOpenAIOAuthModel({
          authFilePath: resolveOpenAIOAuthAuthFilePath(process.env),
          maxOutputTokens: 16000,
          model: config.model,
          reasoningEffort: 'none',
          temperature: 0.1,
        });
      }

      const message = await model.invoke(
        [
          new SystemMessage(
            'You organize a single PaddleOCR chunk into Steel OCR Markdown. Return only Markdown.',
          ),
          new HumanMessage(buildOcrOrganizerPrompt(input)),
        ],
        signal ? { signal } : undefined,
      );
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

function isSingleOriginalPdfChunk(chunks) {
  const chunk = chunks?.[0];
  return (
    chunks?.length === 1 &&
    chunk?.chunkIndex === 1 &&
    chunk?.chunkCount === 1 &&
    chunk?.pageStart === 1
  );
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//iu.test(value);
}

function getOriginalPdfStorageKey(file, fileRecord) {
  return fileRecord?.storageKey ?? file?.storageKey;
}

async function createOriginalPdfChunkArtifact({ file, fileRecord, storage, chunks }) {
  const chunk = chunks[0];
  const storageKey = getOriginalPdfStorageKey(file, fileRecord);
  const filepath = storageKey
    ? await storage.getDownloadUrl({ storageKey })
    : isHttpUrl(fileRecord?.filepath)
      ? fileRecord.filepath
      : isHttpUrl(file?.filepath)
        ? file.filepath
        : undefined;
  if (!chunk || !filepath) {
    return undefined;
  }

  return {
    ...chunk,
    sourcePdfKey: file.sourcePdfKey,
    source: getSteelOcrArtifactSource(fileRecord),
    storageKey: storageKey ?? filepath,
    filepath,
    filename: file.filename ?? fileRecord?.filename ?? 'source.pdf',
    bytes: fileRecord?.bytes ?? 0,
    contentType: getSteelOcrContentType(file, fileRecord),
    artifactOrigin: 'original',
  };
}

function createSteelOcrPdfChunkArtifactStore({ file, fileRecord, pdfBytes }) {
  const repository = createMongooseOcrPdfChunkArtifactRepository(mongoose);
  const storage = createSteelOcrPdfChunkStorage({ fileRecord });
  let createPdfChunkPromise;
  const getCreatePdfChunk = () => {
    createPdfChunkPromise ??= createPdfPageRangeChunker({ pdfBytes });
    return createPdfChunkPromise;
  };

  return {
    async ensurePdfChunkArtifacts({ sourcePdfKey, chunks }) {
      if (isSingleOriginalPdfChunk(chunks)) {
        const originalArtifact = await createOriginalPdfChunkArtifact({
          file,
          fileRecord,
          storage,
          chunks,
        });
        if (originalArtifact) {
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
  };
}

function buildSingleOriginalOcrChunk() {
  return buildPdfPageChunks({ pageCount: 1, chunkSizePages: 1 });
}

function toReusableOcrPreprocessingChunks(state, fallbackChunkSizePages) {
  const chunks = Array.isArray(state?.chunks) ? state.chunks : [];
  const expectedChunkCount = state?.chunkCount ?? chunks[0]?.chunkCount ?? chunks.length;
  if (!Number.isInteger(expectedChunkCount) || expectedChunkCount <= 0) {
    return undefined;
  }
  if (chunks.length !== expectedChunkCount) {
    return undefined;
  }

  const reusableChunks = chunks
    .filter(
      (chunk) =>
        chunk?.rawSaved &&
        chunk?.organizedSaved &&
        chunk?.organizedMarkdown !== undefined &&
        Number.isInteger(chunk.chunkIndex) &&
        Number.isInteger(chunk.pageStart) &&
        Number.isInteger(chunk.pageEnd),
    )
    .sort((first, second) => first.chunkIndex - second.chunkIndex)
    .map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount ?? expectedChunkCount,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      chunkSizePages: chunk.chunkSizePages ?? fallbackChunkSizePages,
    }));

  return reusableChunks.length === expectedChunkCount ? reusableChunks : undefined;
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
  };
}

function hashPaddleOcrResult(result) {
  return hashPaddleOcrText(getPaddleOcrResultContent(result));
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
  const combined = collectErrorMessages(error).join('\n').toLowerCase();
  if (!combined) {
    return false;
  }
  return steelPaddleOcrRetryableErrorPatterns.some((pattern) => combined.includes(pattern));
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
    transformSteelPaddleOcrResults: false,
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
    configServers = await resolveConfigServers(req);
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
  res,
  streamId,
  requestId,
  stepId,
  providerToolCallId,
  toolName,
  args,
  index,
}) {
  await emitSteelNativeEvents({
    res,
    streamId,
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
  res,
  streamId,
  stepId,
  providerToolCallId,
  toolName,
  args,
  output,
  index,
}) {
  await emitSteelNativeEvents({
    res,
    streamId,
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
  getNextIndex,
}) {
  let paddleTool;
  let configurable;

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

  return {
    async runChunk({ file, chunk, artifact }) {
      await ensureTool();

      const providerToolCallId = `${getSteelPaddleOcrPreflightToolCallId(file.ocrFileKey)}_chunk_${chunk.chunkIndex}`;
      const stepId = getSteelPaddleOcrPreflightStepId(providerToolCallId);
      const index = getNextIndex();
      const args = {
        input_data: artifact.filepath,
        output_mode: 'detailed',
        return_images: false,
        runtime_params: {
          use_doc_orientation_classify: true,
          use_doc_unwarping: true,
          use_layout_detection: true,
        },
      };

      await emitSteelPaddleOcrToolStart({
        res,
        streamId,
        requestId,
        stepId,
        providerToolCallId,
        toolName,
        args,
        index,
      });

      let result;
      try {
        try {
          result = await invokeLoadedTool(
            paddleTool,
            args,
            createSteelPaddleOcrInvokeConfig({
              configurable,
              req,
              agent,
              conversationId,
              requestId,
              signal,
              providerToolCallId,
              toolName,
              args,
            }),
          );
        } catch (error) {
          if (isAbortError(error, signal) || !isRetryableSteelPaddleOcrPreflightError(error)) {
            throw error;
          }
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
            throw error;
          }
          paddleTool = rebuilt.paddleTool;
          configurable = rebuilt.configurable;
          result = await invokeLoadedTool(
            paddleTool,
            args,
            createSteelPaddleOcrInvokeConfig({
              configurable,
              req,
              agent,
              conversationId,
              requestId,
              signal,
              providerToolCallId,
              toolName,
              args,
            }),
          );
        }

        const rawOcrText = getPaddleOcrResultContent(result);
        const rawResultHash = hashPaddleOcrText(rawOcrText);
        await emitSteelPaddleOcrToolCompleted({
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
        return {
          rawResult: result,
          rawOcrText,
          rawResultHash,
        };
      } catch (error) {
        if (isAbortError(error, signal)) {
          throw error;
        }
        await emitSteelPaddleOcrToolCompleted({
          res,
          streamId,
          stepId,
          providerToolCallId,
          toolName,
          args,
          output: `Error: ${redactMessage(error?.message ?? 'PaddleOCR preflight failed')}`,
          index,
        });
        throw error;
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
  currentOcrMarkdownResults = [],
  totalSavedCounts,
  totalTableCounts,
}) {
  return {
    status,
    completedKeys,
    attemptedKeys,
    failedKeys,
    skippedReason,
    currentPaddleOcrResults,
    ...(currentOcrMarkdownResults.length > 0 ? { currentOcrMarkdownResults } : {}),
    ...(totalSavedCounts ? { totalSavedCounts } : {}),
    ...(totalTableCounts ? { totalTableCounts } : {}),
  };
}

function createCurrentOcrMergedMarkdownResult({ file, markdown, chunkCount, ocrRuleVersion }) {
  const { sourcePdfKey, ...visibleFile } = file;
  return {
    ...visibleFile,
    kind: 'ocr_preprocessing_merged_markdown',
    ocrSource: 'ocr_preprocessing_merge',
    content: labelOcrMarkdownResultContent(file.ocrFileKey, markdown),
    ocrPreprocessing: {
      pipelineVersion: ocrPreprocessingPipelineVersion,
      sourcePdfKey,
      chunkCount,
      ocrRuleVersion,
      source: 'paddleocr_markdowns',
    },
  };
}

function labelOcrMarkdownResultContent(ocrFileKey, markdown) {
  return `<${ocrFileKey}>\n${markdown}`;
}

function createPaddleOcrChunkToolOutput({ file, chunk, rawOcrText, rawResultHash }) {
  return {
    status: 'completed',
    ocrEngine: 'paddleocr_vl',
    ocrFileKey: file.ocrFileKey,
    filename: file.filename,
    chunkIndex: chunk.chunkIndex,
    chunkCount: chunk.chunkCount,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    rawTextLength: rawOcrText.length,
    rawResultHash,
    outputStorage: 'steel_working_order_memory:paddleocr_preflight',
  };
}

function isSteelPaddleOcrMcpToolName(toolName) {
  const expectedToolName = buildMCPToolKey(steelPaddleOcrToolName, steelPaddleOcrMcpServerName);
  return (
    toolName === expectedToolName ||
    toolName === steelPaddleOcrToolName ||
    (typeof toolName === 'string' &&
      toolName.includes(steelPaddleOcrToolName) &&
      toolName.endsWith(`${Constants.mcp_delimiter}${steelPaddleOcrMcpServerName}`))
  );
}

function getDirectPaddleOcrInputData(args) {
  if (typeof args === 'string') {
    return args.trim() || undefined;
  }
  if (!args || typeof args !== 'object') {
    return undefined;
  }

  const candidates = [
    args.input_data,
    args.inputData,
    args.file,
    args.filepath,
    args.path,
    args.url,
    args.pdf,
    args.image,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
    if (candidate && typeof candidate === 'object') {
      const nested = getDirectPaddleOcrInputData(candidate);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function normalizeDirectPaddleOcrLookup(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function directPaddleOcrFileMatches(inputData, file, fileRecord) {
  const inputLookup = normalizeDirectPaddleOcrLookup(inputData);
  if (!inputLookup) {
    return false;
  }
  const values = [
    file?.ocrFileKey,
    file?.fileId,
    file?.file_id,
    file?.id,
    file?.storageKey,
    file?.storage_key,
    file?.filepath,
    file?.path,
    file?.filename,
    file?.name,
    fileRecord?.file_id,
    fileRecord?.storageKey,
    fileRecord?.filepath,
    fileRecord?.filename,
  ]
    .map(normalizeDirectPaddleOcrLookup)
    .filter(Boolean);

  return values.some(
    (value) => inputLookup === value || inputLookup.includes(value) || value.includes(inputLookup),
  );
}

async function resolveDirectPaddleOcrFile({ req, args }) {
  const inputData = getDirectPaddleOcrInputData(args);
  const files = Array.isArray(req?.steelNativeContext?.currentTurnFiles)
    ? req.steelNativeContext.currentTurnFiles
    : [];
  const fileRecordsById = await getSteelCurrentFileRecords(req, files);
  const candidates = files
    .map((file) => {
      const descriptor = getSteelOcrFileDescriptor(file);
      if (!descriptor) {
        return undefined;
      }
      const fileId = getSteelFileId(file);
      const fileRecord = fileId ? fileRecordsById.get(fileId) : undefined;
      const preprocessingFile = toSteelOcrPreprocessingFile(descriptor, fileRecord);
      if (!preprocessingFile) {
        return undefined;
      }
      return { file, fileRecord, preprocessingFile };
    })
    .filter(Boolean);

  const matched =
    candidates.find(({ file, fileRecord }) =>
      directPaddleOcrFileMatches(inputData, file, fileRecord),
    ) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (matched) {
    return {
      inputData,
      file: matched.preprocessingFile,
    };
  }

  if (!inputData) {
    return undefined;
  }
  const fallbackKey = `direct-paddleocr:${hashPaddleOcrText(inputData).slice(0, 16)}`;
  const fallbackDescriptor = getSteelOcrFileDescriptor({
    storageKey: fallbackKey,
    filepath: inputData,
    filename: inputData.includes('.') ? inputData : 'paddleocr-input.pdf',
    mediaType: 'application/pdf',
  });
  if (!fallbackDescriptor) {
    return undefined;
  }
  return {
    inputData,
    file: {
      ...fallbackDescriptor,
      sourcePdfKey: inputData,
    },
  };
}

function createDirectPaddleOcrChunk({ sourcePdfKey, inputData, chunkSizePages }) {
  const filepath = inputData || sourcePdfKey;
  const storageKey = sourcePdfKey && !sourcePdfKey.startsWith('file:') ? sourcePdfKey : filepath;
  return {
    pipelineVersion: ocrPreprocessingPipelineVersion,
    sourcePdfKey,
    chunkIndex: 1,
    chunkCount: 1,
    pageStart: 1,
    pageEnd: 1,
    chunkSizePages,
    pdfChunk: {
      source: 's3',
      storageKey,
      filepath,
    },
  };
}

function mergeSavedDirectOcrMarkdown({ state, ocrFileKey, ocrRuleVersion }) {
  const markdown = mergeOcrPreprocessingStateMarkdown({ state, ocrFileKey, ocrRuleVersion });
  if (!markdown) {
    return undefined;
  }
  return {
    chunkCount: state.chunkCount || state.chunks.length,
    markdown,
  };
}

function replaceToolResultContent(result, content) {
  if (result && typeof result === 'object') {
    return {
      ...result,
      content,
      artifact: undefined,
    };
  }
  return {
    content,
    artifact: undefined,
  };
}

function isDirectPaddleOcrForceNew(args) {
  return args?.new === true || args?.new === 'true';
}

function stripDirectPaddleOcrControlArgs(args) {
  if (!args || typeof args !== 'object' || !Object.prototype.hasOwnProperty.call(args, 'new')) {
    return args;
  }

  const { new: _new, ...toolArgs } = args;
  return toolArgs;
}

function appendCurrentOcrMarkdownResultToRequest(req, result) {
  if (!req || !result?.ocrFileKey) {
    return;
  }

  const existing = req.steelNativeContext?.paddleOcrPreflight?.currentOcrMarkdownResults ?? [];
  const next = [...existing.filter((entry) => entry?.ocrFileKey !== result.ocrFileKey), result];
  req.steelNativeContext = {
    ...(req.steelNativeContext ?? {}),
    paddleOcrPreflight: {
      ...(req.steelNativeContext?.paddleOcrPreflight ?? {}),
      currentOcrMarkdownResults: next,
    },
  };
}

async function emitDirectOcrProgress({
  res,
  streamId,
  conversationId,
  requestId,
  toolName,
  providerToolCallId,
  ocrFileKey,
  progress,
}) {
  await emitSteelNativeEvents({
    res,
    streamId,
    events: buildSteelOcrPreprocessingEventEnvelopes({
      conversationId,
      requestId,
      messageId: requestId,
      toolName,
      providerToolCallId,
      ocrFileKey,
      progress,
    }),
  });
}

async function prepareDirectPaddleOcrContext({ req, args }) {
  const conversationId = getRequestConversationId(req);
  const turnIndex = req?.steelNativeContext?.assistantTurnIndex;
  if (!conversationId || turnIndex === undefined) {
    return undefined;
  }

  const resolved = await resolveDirectPaddleOcrFile({ req, args });
  if (!resolved?.file) {
    throw new Error('PaddleOCR result cannot be converted to OCR Markdown without file context');
  }

  const requestId = req?.steelNativeContext?.requestId;
  const checkpointTurnIndex =
    req?.steelNativeContext?.memoryCheckpointTurnIndex ?? Math.max(0, turnIndex - 1);
  const writer = createMongooseSteelWorkingOrderMemoryWriter(mongoose);
  const rules = await resolveSteelOcrPreprocessingRules();

  return {
    conversationId,
    turnIndex,
    requestId,
    checkpointTurnIndex,
    resolved,
    writer,
    rules,
    stateInput: {
      conversationId,
      sourcePdfKey: resolved.file.sourcePdfKey,
      ocrFileKey: resolved.file.ocrFileKey,
      ocrRuleVersion: rules.ocrRuleVersion,
    },
  };
}

async function readExistingDirectOcrMarkdown({
  context,
  req,
  res,
  streamId,
  toolName,
  providerToolCallId,
}) {
  if (!context) {
    return undefined;
  }

  const officialMarkdown =
    typeof context.writer.readOfficialOcrMarkdown === 'function'
      ? await context.writer.readOfficialOcrMarkdown(context.stateInput)
      : undefined;
  if (officialMarkdown) {
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: { stage: 'merged_markdowns_read', chunkCount: officialMarkdown.chunkCount },
    });
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: {
        stage: 'processing_with_merged_markdown',
        chunkCount: officialMarkdown.chunkCount,
      },
    });
    appendCurrentOcrMarkdownResultToRequest(
      req,
      createCurrentOcrMergedMarkdownResult({
        file: context.resolved.file,
        markdown: officialMarkdown.markdown,
        chunkCount: officialMarkdown.chunkCount,
        ocrRuleVersion: context.rules.ocrRuleVersion,
      }),
    );
    return {
      content: labelOcrMarkdownResultContent(
        context.resolved.file.ocrFileKey,
        officialMarkdown.markdown,
      ),
    };
  }

  const existingState = await context.writer.readOcrPreprocessingState(context.stateInput);
  const existingMarkdown = mergeSavedDirectOcrMarkdown({
    state: existingState,
    ocrFileKey: context.resolved.file.ocrFileKey,
    ocrRuleVersion: context.rules.ocrRuleVersion,
  });
  if (!existingMarkdown) {
    return undefined;
  }

  await emitDirectOcrProgress({
    res,
    streamId,
    conversationId: context.conversationId,
    requestId: context.requestId,
    toolName,
    providerToolCallId,
    ocrFileKey: context.resolved.file.ocrFileKey,
    progress: { stage: 'merged_markdowns_read', chunkCount: existingMarkdown.chunkCount },
  });
  await emitDirectOcrProgress({
    res,
    streamId,
    conversationId: context.conversationId,
    requestId: context.requestId,
    toolName,
    providerToolCallId,
    ocrFileKey: context.resolved.file.ocrFileKey,
    progress: {
      stage: 'processing_with_merged_markdown',
      chunkCount: existingMarkdown.chunkCount,
    },
  });

  appendCurrentOcrMarkdownResultToRequest(
    req,
    createCurrentOcrMergedMarkdownResult({
      file: context.resolved.file,
      markdown: existingMarkdown.markdown,
      chunkCount: existingMarkdown.chunkCount,
      ocrRuleVersion: context.rules.ocrRuleVersion,
    }),
  );

  return {
    content: labelOcrMarkdownResultContent(
      context.resolved.file.ocrFileKey,
      existingMarkdown.markdown,
    ),
  };
}

async function throwDirectOcrMarkdownError({
  context,
  res,
  streamId,
  toolName,
  providerToolCallId,
  error,
}) {
  const errorMessage = redactMessage(error?.message ?? 'OCR markdown process failed', 512);
  if (context?.resolved?.file?.ocrFileKey) {
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: { stage: 'failed', errorMessage },
    });
  }
  throw new Error(
    `OCR markdown process failed for ${
      context?.resolved?.file?.filename ?? context?.resolved?.file?.ocrFileKey ?? 'PaddleOCR result'
    }: ${errorMessage}`,
  );
}

async function transformDirectPaddleOcrResultToMarkdown({
  req,
  res,
  signal,
  streamId,
  toolName,
  args,
  result,
  providerToolCallId,
  directContext,
  checkedExistingMarkdown = false,
}) {
  const context = directContext ?? (await prepareDirectPaddleOcrContext({ req, args }));
  if (!context) {
    return result;
  }

  try {
    if (!checkedExistingMarkdown && !isDirectPaddleOcrForceNew(args)) {
      const existing = await readExistingDirectOcrMarkdown({
        context,
        req,
        res,
        streamId,
        toolName,
        providerToolCallId,
      });
      if (existing) {
        return replaceToolResultContent(result, existing.content);
      }
    }

    const rawOcrText = getPaddleOcrResultContent(result);
    const rawResultHash = hashPaddleOcrText(rawOcrText);
    const chunkSizePages = resolveOcrPreprocessingChunkSizePages();
    const chunk = createDirectPaddleOcrChunk({
      sourcePdfKey: context.resolved.file.sourcePdfKey,
      inputData: context.resolved.inputData,
      chunkSizePages,
    });

    await context.writer.capturePaddleOcrChunkResult({
      conversationId: context.conversationId,
      requestId: context.requestId,
      providerToolCallId,
      turnIndex: context.turnIndex,
      checkpointTurnIndex: context.checkpointTurnIndex,
      file: context.resolved.file,
      chunk,
      rawResultHash,
      data: result,
      includeTotals: false,
    });
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: { stage: 'paddleocr_chunk_saved', chunkIndex: 1, chunkCount: 1 },
    });
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: { stage: 'organizer_chunk_started', chunkIndex: 1, chunkCount: 1 },
    });
    const organized = await createSteelOcrOrganizer({ signal }).organize({
      ocrRulesText: context.rules.ocrRulesText,
      file: context.resolved.file,
      chunk: {
        pipelineVersion: chunk.pipelineVersion ?? ocrPreprocessingPipelineVersion,
        sourcePdfKey: chunk.sourcePdfKey,
        ocrFileKey: context.resolved.file.ocrFileKey,
        ...(context.resolved.file.fileId !== undefined
          ? { fileId: context.resolved.file.fileId }
          : {}),
        ...(context.resolved.file.filename !== undefined
          ? { filename: context.resolved.file.filename }
          : {}),
        chunkIndex: chunk.chunkIndex,
        chunkCount: chunk.chunkCount,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        chunkSizePages: chunk.chunkSizePages,
      },
      rawOcrText,
    });
    await context.writer.captureOcrPreprocessingChunkMarkdown({
      conversationId: context.conversationId,
      requestId: context.requestId,
      turnIndex: context.turnIndex,
      checkpointTurnIndex: context.checkpointTurnIndex,
      file: context.resolved.file,
      chunk,
      rawResultHash,
      ocrRuleVersion: context.rules.ocrRuleVersion,
      content: organized.markdown,
      includeTotals: false,
    });
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: { stage: 'organizer_chunk_saved', chunkIndex: 1, chunkCount: 1 },
    });

    const finalState = await context.writer.readOcrPreprocessingState(context.stateInput);
    const mergedMarkdown = mergeSavedDirectOcrMarkdown({
      state: finalState,
      ocrFileKey: context.resolved.file.ocrFileKey,
      ocrRuleVersion: context.rules.ocrRuleVersion,
    }) ?? { chunkCount: 1, markdown: organized.markdown };
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: { stage: 'merged_markdowns_read', chunkCount: mergedMarkdown.chunkCount },
    });
    await emitDirectOcrProgress({
      res,
      streamId,
      conversationId: context.conversationId,
      requestId: context.requestId,
      toolName,
      providerToolCallId,
      ocrFileKey: context.resolved.file.ocrFileKey,
      progress: {
        stage: 'processing_with_merged_markdown',
        chunkCount: mergedMarkdown.chunkCount,
      },
    });

    appendCurrentOcrMarkdownResultToRequest(
      req,
      createCurrentOcrMergedMarkdownResult({
        file: context.resolved.file,
        markdown: mergedMarkdown.markdown,
        chunkCount: mergedMarkdown.chunkCount,
        ocrRuleVersion: context.rules.ocrRuleVersion,
      }),
    );

    return replaceToolResultContent(
      result,
      labelOcrMarkdownResultContent(context.resolved.file.ocrFileKey, mergedMarkdown.markdown),
    );
  } catch (error) {
    return throwDirectOcrMarkdownError({
      context,
      res,
      streamId,
      toolName,
      providerToolCallId,
      error,
    });
  }
}

function wrapSteelPaddleOcrToolsForMarkdown({
  loadedTools,
  req,
  res,
  signal,
  streamId,
  transformSteelPaddleOcrResults,
}) {
  if (!transformSteelPaddleOcrResults) {
    return;
  }
  for (const tool of loadedTools) {
    if (!isSteelPaddleOcrMcpToolName(tool?.name) || typeof tool.invoke !== 'function') {
      continue;
    }
    const originalInvoke = tool.invoke.bind(tool);
    tool.invoke = async (args, config) => {
      const providerToolCallId = config?.toolCall?.id;
      const forceNew = isDirectPaddleOcrForceNew(args);
      const toolArgs = stripDirectPaddleOcrControlArgs(args);
      let directContext;
      try {
        directContext = await prepareDirectPaddleOcrContext({ req, args: toolArgs });
        if (!forceNew) {
          const existing = await readExistingDirectOcrMarkdown({
            context: directContext,
            req,
            res,
            streamId,
            toolName: tool.name,
            providerToolCallId,
          });
          if (existing) {
            return replaceToolResultContent({}, existing.content);
          }
        }
      } catch (error) {
        return throwDirectOcrMarkdownError({
          context: directContext,
          res,
          streamId,
          toolName: tool.name,
          providerToolCallId,
          error,
        });
      }

      if (directContext?.resolved?.file?.ocrFileKey) {
        await emitDirectOcrProgress({
          res,
          streamId,
          conversationId: directContext.conversationId,
          requestId: directContext.requestId,
          toolName: tool.name,
          providerToolCallId,
          ocrFileKey: directContext.resolved.file.ocrFileKey,
          progress: { stage: 'paddleocr_chunk_started', chunkIndex: 1, chunkCount: 1 },
        });
      }

      const result = await originalInvoke(toolArgs, config);
      return transformDirectPaddleOcrResultToMarkdown({
        req,
        res,
        signal,
        streamId,
        toolName: tool.name,
        args: toolArgs,
        result,
        providerToolCallId,
        directContext,
        checkedExistingMarkdown: true,
      });
    };
  }
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
  const conversationId = getRequestConversationId(req);
  const turnIndex = req?.steelNativeContext?.assistantTurnIndex;
  const checkpointTurnIndex = req?.steelNativeContext?.memoryCheckpointTurnIndex;
  const requestId = req?.steelNativeContext?.requestId;
  const files = req?.steelNativeContext?.currentTurnFiles ?? [];
  const attemptedKeys = [];
  const failedKeys = [];
  const currentPaddleOcrResults = [];
  const currentOcrMarkdownResults = [];
  let nextToolEventIndex = 0;
  const getNextToolEventIndex = () => nextToolEventIndex++;
  const finishPreflight = async (result) => {
    await emitSteelNativeEvents({
      res,
      streamId,
      events: buildSteelPaddleOcrPreflightEventEnvelopes({
        conversationId,
        requestId,
        messageId: requestId,
        preflight: result,
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
  const currentTargets = files
    .map((file) => {
      const descriptor = getSteelOcrFileDescriptor(file);
      return descriptor ? { originalFile: file, descriptor } : undefined;
    })
    .filter((target) => target !== undefined);
  const fileRecordsById = await getSteelCurrentFileRecords(req, files);
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
      const existingOfficialMarkdown =
        typeof writer.readOfficialOcrMarkdown === 'function'
          ? await writer.readOfficialOcrMarkdown(stateInput)
          : undefined;
      const existingState = existingOfficialMarkdown
        ? undefined
        : await writer.readOcrPreprocessingState(stateInput);
      const reusableChunks = toReusableOcrPreprocessingChunks(
        existingState,
        ocrPreprocessingChunkSizePages,
      );

      if (existingOfficialMarkdown || reusableChunks) {
        chunks = reusableChunks ?? buildSingleOriginalOcrChunk();
        artifacts = createSteelOcrOriginalFileArtifactStore({
          file: preprocessingFile,
          fileRecord,
        });
      } else if (isPdfSteelFile(preprocessingFile) && fileRecord) {
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
      } else {
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
        res,
        streamId,
        events: buildSteelOcrPreprocessingEventEnvelopes({
          conversationId,
          requestId,
          messageId: requestId,
          ocrFileKey: preprocessingFile.ocrFileKey,
          progress: {
            stage: 'failed',
            errorMessage,
          },
        }),
      });
      logger.warn('[Steel OCR] OCR preprocessing pipeline failed for current PDF', {
        conversationId,
        requestId,
        ocrFileKey: preprocessingFile.ocrFileKey,
        error: errorMessage,
      });
      throw new Error(
        `OCR preprocessing failed for ${
          preprocessingFile.filename ?? preprocessingFile.ocrFileKey
        }: ${errorMessage}`,
      );
    }
  }

  if (batchFiles.length > 0) {
    try {
      ocrPreprocessingRules ??= await resolveSteelOcrPreprocessingRules();
      const batchResult = await runOcrPreprocessingBatchPipeline({
        conversationId,
        requestId,
        turnIndex,
        checkpointTurnIndex: checkpointTurnIndex ?? Math.max(0, turnIndex - 1),
        files: batchFiles,
        ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
        ocrRulesText: ocrPreprocessingRules.ocrRulesText,
        memory: writer,
        organizer: createSteelOcrOrganizer({ signal }),
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
          getNextIndex: getNextToolEventIndex,
        }),
        onProgress: ({ file, progress }) =>
          emitSteelNativeEvents({
            res,
            streamId,
            events: buildSteelOcrPreprocessingEventEnvelopes({
              conversationId,
              requestId,
              messageId: requestId,
              ocrFileKey: file.ocrFileKey,
              progress,
            }),
          }),
      });

      for (const fileResult of batchResult.files) {
        currentOcrMarkdownResults.push(
          createCurrentOcrMergedMarkdownResult({
            file: fileResult.file,
            markdown: fileResult.markdown,
            chunkCount: fileResult.chunkCount,
            ocrRuleVersion: ocrPreprocessingRules.ocrRuleVersion,
          }),
        );
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      const errorMessage = redactMessage(error?.message ?? 'OCR preprocessing failed', 512);
      const failedBatchFiles = batchFiles.map((entry) => entry.file);
      for (const file of failedBatchFiles) {
        failedKeys.push(file.ocrFileKey);
        await emitSteelNativeEvents({
          res,
          streamId,
          events: buildSteelOcrPreprocessingEventEnvelopes({
            conversationId,
            requestId,
            messageId: requestId,
            ocrFileKey: file.ocrFileKey,
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
      const firstFailedFile = failedBatchFiles[0];
      if (failedBatchFiles.length === 1 && firstFailedFile) {
        throw new Error(
          `OCR preprocessing failed for ${
            firstFailedFile.filename ?? firstFailedFile.ocrFileKey
          }: ${errorMessage}`,
        );
      }
      throw new Error(`OCR preprocessing failed for current files: ${errorMessage}`);
    }
  }

  return createPreflightResult({
    status: failedKeys.length > 0 ? 'partial' : 'completed',
    completedKeys: uniqueStrings(attemptedKeys.filter((key) => !failedKeys.includes(key))),
    attemptedKeys,
    failedKeys,
    skippedReason: undefined,
    currentPaddleOcrResults,
    currentOcrMarkdownResults,
  });
}

/**
 * Loads only tool definitions without creating tool instances.
 * This is the efficient path for event-driven mode where tools are loaded on-demand.
 *
 * @param {Object} params
 * @param {ServerRequest} params.req - The request object
 * @param {ServerResponse} [params.res] - The response object for SSE events
 * @param {Object} params.agent - The agent configuration
 * @param {string|null} [params.streamId] - Stream ID for resumable mode
 * @returns {Promise<{
 *   toolDefinitions?: import('@librechat/api').LCTool[];
 *   toolRegistry?: Map<string, import('@librechat/api').LCTool>;
 *   mcpAvailableTools?: Record<string, import('@librechat/api').LCAvailableTools>;
 *   userMCPAuthMap?: Record<string, Record<string, string>>;
 *   hasDeferredTools?: boolean;
 * }>}
 */
async function loadToolDefinitionsWrapper({
  req,
  res,
  agent,
  streamId = null,
  tool_resources,
  requestAttachments,
}) {
  const appConfig = req.config;
  const enabledCapabilities = await resolveAgentCapabilities(req, appConfig, agent.id);
  const selectedTools = addSteelPaddleOcrMcpTool(
    Array.isArray(agent.tools) ? agent.tools : [],
    req,
    requestAttachments,
  );
  const checkCapability = (capability) => enabledCapabilities.has(capability);
  const areToolsEnabled = checkCapability(AgentCapabilities.tools);
  const actionsEnabled = checkCapability(AgentCapabilities.actions);
  const deferredToolsEnabled = checkCapability(AgentCapabilities.deferred_tools);
  const programmaticToolsEnabled = enabledCapabilities.has(AgentCapabilities.programmatic_tools);
  const codeExecutionEnabled =
    selectedTools.includes(Tools.execute_code) === true &&
    enabledCapabilities.has(AgentCapabilities.execute_code);
  const hasMCPTools = selectedTools.some((tool) => tool?.includes(Constants.mcp_delimiter));
  const mcpPermissionContext = createMCPPermissionContext(req);
  const canUseMCP = hasMCPTools ? await mcpPermissionContext.canUseServers(req.user) : true;

  const filteredTools = selectedTools.filter((tool) => {
    if (tool === AgentCapabilities.context || tool === AgentCapabilities.ocr) {
      return false;
    }
    if (tool === Tools.file_search) {
      return checkCapability(AgentCapabilities.file_search);
    }
    if (tool === Tools.execute_code) {
      return checkCapability(AgentCapabilities.execute_code);
    }
    if (tool === Tools.web_search) {
      return checkCapability(AgentCapabilities.web_search);
    }
    if (tool === Tools.memory) {
      return checkCapability(AgentCapabilities.memory);
    }
    if (isActionTool(tool)) {
      return actionsEnabled;
    }
    if (tool?.includes(Constants.mcp_delimiter)) {
      return areToolsEnabled && canUseMCP;
    }
    if (resolveSteelProviderToolName(tool)) {
      return false;
    }
    if (!areToolsEnabled) {
      return false;
    }
    return true;
  });

  if (!filteredTools || filteredTools.length === 0) {
    const baseResult = {
      toolDefinitions: [],
      toolRegistry: new Map(),
      actionsEnabled,
    };
    return areToolsEnabled ? mergeSteelNativeToolDefinitions(baseResult) : baseResult;
  }

  /** @type {Record<string, Record<string, string>>} */
  let userMCPAuthMap;
  if (filteredTools?.some((t) => t.includes(Constants.mcp_delimiter))) {
    userMCPAuthMap = await getUserMCPAuthMap({
      tools: filteredTools,
      userId: req.user.id,
      findPluginAuthsByKeys,
    });
  }

  const flowsCache = getLogStores(CacheKeys.FLOWS);
  const flowManager = getFlowStateManager(flowsCache);
  const configServers = await resolveConfigServers(req);
  const pendingOAuthServers = new Set();
  const pendingOAuthStarts = new Map();
  const emittedOAuthStarts = new Map();
  const oauthToolCallIds = new Map();
  const oauthStepIndexes = new Map();
  /** @type {Record<string, import('@librechat/api').LCAvailableTools>} */
  const mcpAvailableTools = {};
  const requestScopedConnections = getMCPRequestContext(req, res);
  const rememberMCPAvailableTools = (serverName, availableTools) => {
    if (!availableTools || Object.keys(availableTools).length === 0) {
      return;
    }
    mcpAvailableTools[serverName] = availableTools;
  };

  const createOAuthEmitter = (serverName, index) => {
    return async (authURL, options) => {
      if (emittedOAuthStarts.get(serverName) === authURL) {
        return;
      }
      emittedOAuthStarts.set(serverName, authURL);

      const flowId =
        oauthToolCallIds.get(serverName) ?? `${req.user.id}:${serverName}:${Date.now()}`;
      const stepId = buildMCPAuthStepId(serverName);
      oauthToolCallIds.set(serverName, flowId);
      oauthStepIndexes.set(serverName, index);
      const toolCall = buildMCPAuthToolCall({
        id: flowId,
        serverName,
      });

      const runStepEvent = buildMCPAuthRunStepEvent({ stepId, toolCall, index });
      const runStepDeltaEvent = buildMCPAuthRunStepDeltaEvent({
        authURL,
        stepId,
        toolCall,
        options,
      });

      if (streamId) {
        await GenerationJobManager.emitChunk(streamId, runStepEvent);
        await GenerationJobManager.emitChunk(streamId, runStepDeltaEvent);
      } else if (res && !res.writableEnded) {
        sendEvent(res, runStepEvent);
        sendEvent(res, runStepDeltaEvent);
      } else {
        logger.warn(
          `[Tool Definitions] Cannot emit OAuth event for ${serverName}: no streamId and res not available`,
        );
      }
    };
  };

  const createOAuthEndEmitter = (serverName) => {
    return async () => {
      const stepId = buildMCPAuthStepId(serverName);
      const toolCall = buildMCPAuthToolCall({
        id: oauthToolCallIds.get(serverName),
        args: '',
        output: 'OAuth authentication completed',
        serverName,
        type: 'tool_call',
      });
      const runStepCompletedEvent = buildMCPAuthRunStepCompletedEvent({
        stepId,
        toolCall,
        index: oauthStepIndexes.get(serverName) ?? 0,
      });

      if (streamId) {
        await GenerationJobManager.emitChunk(streamId, runStepCompletedEvent);
      } else if (res && !res.writableEnded) {
        sendEvent(res, runStepCompletedEvent);
      } else {
        logger.warn(
          `[Tool Definitions] Cannot emit OAuth completion for ${serverName}: no streamId and res not available`,
        );
      }
    };
  };

  const getPendingOAuthStartForEmit = async (serverName) => {
    const cachedOAuthStart = pendingOAuthStarts.get(serverName);
    if (cachedOAuthStart?.options?.expiresAt != null) {
      return cachedOAuthStart;
    }

    const pendingOAuthStart = await getReplayablePendingMCPOAuthStart({
      flowManager,
      userId: req.user.id,
      serverName,
    });
    if (!pendingOAuthStart) {
      return cachedOAuthStart;
    }

    if (!cachedOAuthStart || pendingOAuthStart.authURL === cachedOAuthStart.authURL) {
      pendingOAuthStarts.set(serverName, pendingOAuthStart);
      return pendingOAuthStart;
    }

    return cachedOAuthStart;
  };

  const getOrFetchMCPServerTools = async (userId, serverName) => {
    const addPendingOAuthServer = async () => {
      const pendingOAuthStart = await getReplayablePendingMCPOAuthStart({
        flowManager,
        userId,
        serverName,
      });
      if (!pendingOAuthStart) {
        return false;
      }

      pendingOAuthServers.add(serverName);
      pendingOAuthStarts.set(serverName, pendingOAuthStart);
      return true;
    };

    let serverConfig;
    try {
      serverConfig =
        configServers?.[serverName] ??
        (await getMCPServersRegistry().getServerConfig(serverName, userId, configServers));
    } catch (err) {
      logger.warn(
        `[Tool Definitions] MCP registry unavailable while resolving '${serverName}': ${
          err?.message ?? err
        }. Skipping MCP tool exposure for this lookup.`,
      );
      return null;
    }

    if (!serverConfig) {
      logger.warn(
        `[Tool Definitions] Skipping MCP server '${serverName}': no server config found (server may have been removed).`,
      );
      return null;
    }

    const customUserVars = userMCPAuthMap?.[`${Constants.mcp_prefix}${serverName}`];
    const missingUserVars = getMissingCustomUserVars(serverConfig, customUserVars);
    if (missingUserVars.length > 0) {
      logger.warn(
        `[Tool Definitions] Skipping MCP server '${serverName}': required user-provided variable(s) not set: ${missingUserVars.join(
          ', ',
        )}. Tools will not be exposed until the user configures them.`,
      );
      return null;
    }

    if (mcpAvailableTools[serverName]) {
      return mcpAvailableTools[serverName];
    }

    const cached = await getMCPServerTools(userId, serverName, serverConfig);
    if (cached) {
      rememberMCPAvailableTools(serverName, cached);
      await addPendingOAuthServer();
      return cached;
    }

    if (await addPendingOAuthServer()) {
      return null;
    }

    const oauthStart = async (authURL, options) => {
      pendingOAuthServers.add(serverName);
      if (typeof authURL === 'string' && authURL.length > 0) {
        pendingOAuthStarts.set(serverName, { authURL, options });
      }
    };

    const result = await reinitMCPServer({
      user: req.user,
      oauthStart,
      flowManager,
      serverName,
      configServers,
      userMCPAuthMap,
      requestBody: req.body,
      requestScopedConnections,
    });

    rememberMCPAvailableTools(serverName, result?.availableTools);
    return result?.availableTools || null;
  };

  const getActionToolDefinitions = async (agentId, actionToolNames) => {
    const actionSets = (await loadActionSets({ agent_id: agentId })) ?? [];
    if (actionSets.length === 0) {
      return [];
    }

    const definitions = [];
    const allowedDomains = appConfig?.actions?.allowedDomains;
    const allowedAddresses = appConfig?.actions?.allowedAddresses;
    const normalizedToolNames = new Set(
      actionToolNames.map((n) => n.replace(domainSeparatorRegex, '_')),
    );

    for (const action of actionSets) {
      const domain = await domainParser(action.metadata.domain, true);
      const normalizedDomain = domain.replace(domainSeparatorRegex, '_');

      const legacyDomain = legacyDomainEncode(action.metadata.domain);
      const legacyNormalized = legacyDomain.replace(domainSeparatorRegex, '_');

      const isDomainAllowed = await isActionDomainAllowed(
        action.metadata.domain,
        allowedDomains,
        allowedAddresses,
      );
      if (!isDomainAllowed) {
        logger.warn(
          `[Actions] Domain "${action.metadata.domain}" not in allowedDomains. ` +
            `Add it to librechat.yaml actions.allowedDomains to enable this action.`,
        );
        continue;
      }

      const validationResult = validateAndParseOpenAPISpec(action.metadata.raw_spec);
      if (!validationResult.spec || !validationResult.serverUrl) {
        logger.warn(`[Actions] Invalid OpenAPI spec for domain: ${domain}`);
        continue;
      }

      const { functionSignatures } = openapiToFunction(validationResult.spec, true);

      for (const sig of functionSignatures) {
        const toolName = `${sig.name}${actionDelimiter}${normalizedDomain}`;
        const legacyToolName = `${sig.name}${actionDelimiter}${legacyNormalized}`;
        if (!normalizedToolNames.has(toolName) && !normalizedToolNames.has(legacyToolName)) {
          continue;
        }

        definitions.push({
          name: toolName,
          description: sig.description,
          parameters: sig.parameters,
        });
      }
    }

    return definitions;
  };

  let { toolDefinitions, toolRegistry, hasDeferredTools } = await loadToolDefinitions(
    {
      userId: req.user.id,
      agentId: agent.id,
      tools: filteredTools,
      toolOptions: agent.tool_options,
      deferredToolsEnabled,
      programmaticToolsEnabled,
      codeExecutionEnabled,
      provider: agent.provider,
    },
    {
      isBuiltInTool,
      getOrFetchMCPServerTools,
      getActionToolDefinitions,
    },
  );

  for (const serverName of getMCPServerNamesFromTools(filteredTools)) {
    if (pendingOAuthServers.has(serverName)) {
      continue;
    }

    const pendingOAuthStart = await getReplayablePendingMCPOAuthStart({
      flowManager,
      userId: req.user.id,
      serverName,
    });
    if (pendingOAuthStart) {
      pendingOAuthServers.add(serverName);
      pendingOAuthStarts.set(serverName, pendingOAuthStart);
    }
  }

  if (pendingOAuthServers.size > 0 && (res || streamId)) {
    const serverNames = Array.from(pendingOAuthServers);
    logger.info(
      `[Tool Definitions] OAuth required for ${serverNames.length} server(s): ${serverNames.join(', ')}. Emitting events and waiting.`,
    );

    const oauthWaitPromises = serverNames.map(async (serverName, index) => {
      try {
        const pendingOAuthStart = await getPendingOAuthStartForEmit(serverName);
        const oauthStart = createOAuthEmitter(serverName, index);
        if (pendingOAuthStart) {
          await oauthStart(pendingOAuthStart.authURL, pendingOAuthStart.options);
        }

        const result = await reinitMCPServer({
          user: req.user,
          serverName,
          configServers,
          userMCPAuthMap,
          flowManager,
          requestBody: req.body,
          returnOnOAuth: false,
          oauthStart,
          oauthEnd: createOAuthEndEmitter(serverName),
          connectionTimeout: Time.TWO_MINUTES,
        });

        if (result?.availableTools) {
          rememberMCPAvailableTools(serverName, result.availableTools);
          logger.info(`[Tool Definitions] OAuth completed for ${serverName}, tools available`);
          return { serverName, success: true };
        }
        return { serverName, success: false };
      } catch (error) {
        logger.debug(`[Tool Definitions] OAuth wait failed for ${serverName}:`, error?.message);
        return { serverName, success: false };
      }
    });

    const results = await Promise.allSettled(oauthWaitPromises);
    const successfulServers = results
      .filter((r) => r.status === 'fulfilled' && r.value.success)
      .map((r) => r.value.serverName);

    if (successfulServers.length > 0) {
      logger.info(
        `[Tool Definitions] Reloading tools after OAuth for: ${successfulServers.join(', ')}`,
      );
      const reloadResult = await loadToolDefinitions(
        {
          userId: req.user.id,
          agentId: agent.id,
          tools: filteredTools,
          toolOptions: agent.tool_options,
          deferredToolsEnabled,
          programmaticToolsEnabled,
          codeExecutionEnabled,
          provider: agent.provider,
        },
        {
          isBuiltInTool,
          getOrFetchMCPServerTools,
          getActionToolDefinitions,
        },
      );
      toolDefinitions = reloadResult.toolDefinitions;
      toolRegistry = reloadResult.toolRegistry;
      hasDeferredTools = reloadResult.hasDeferredTools;
    }
  }

  /** @type {Record<string, string>} */
  const toolContextMap = {};
  /** @type {Record<string, string>} */
  const dynamicToolContextMap = {};
  const hasWebSearch = filteredTools.includes(Tools.web_search);
  const hasFileSearch = filteredTools.includes(Tools.file_search);
  const hasExecuteCode = filteredTools.includes(Tools.execute_code);

  if (hasWebSearch) {
    toolContextMap[Tools.web_search] = buildWebSearchContext();
    dynamicToolContextMap[Tools.web_search] = buildWebSearchDynamicContext(
      req.conversationCreatedAt,
    );
  }

  /**
   * `files` carry the upload session_ids; we surface them so client.js can
   * seed `Graph.sessions[EXECUTE_CODE]` before run start. Without that seed,
   * the agents-side `ToolNode.getCodeSessionContext` returns undefined on
   * call #1, `_injected_files` is never set on the tool call, and the
   * sandbox can't see the prior turn's generated artifacts on first read.
   */
  let primedCodeFiles;
  if (hasExecuteCode && tool_resources) {
    try {
      const { toolContext, files } = await primeCodeFiles({
        req,
        tool_resources,
        agentId: agent.id,
      });
      if (toolContext) {
        dynamicToolContextMap[Tools.execute_code] = toolContext;
      }
      if (files?.length) {
        primedCodeFiles = files;
      }
    } catch (error) {
      logger.error('[loadToolDefinitionsWrapper] Error priming code files:', error);
    }
  }

  if (hasFileSearch && tool_resources) {
    try {
      const { toolContext } = await primeSearchFiles({
        req,
        tool_resources,
        agentId: agent.id,
      });
      if (toolContext) {
        dynamicToolContextMap[Tools.file_search] = toolContext;
      }
    } catch (error) {
      logger.error('[loadToolDefinitionsWrapper] Error priming search files:', error);
    }
  }

  const imageFiles = tool_resources?.[EToolResources.image_edit]?.files ?? [];
  if (imageFiles.length > 0) {
    const hasOaiImageGen = filteredTools.includes('image_gen_oai');
    const hasGeminiImageGen = filteredTools.includes('gemini_image_gen');

    if (hasOaiImageGen) {
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: `${EToolResources.image_edit}_oai`,
        contextDescription: 'image editing',
      });
      if (toolContext) {
        dynamicToolContextMap.image_edit_oai = toolContext;
      }
    }

    if (hasGeminiImageGen) {
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: 'gemini_image_gen',
        contextDescription: 'image context',
      });
      if (toolContext) {
        dynamicToolContextMap.gemini_image_gen = toolContext;
      }
    }
  }

  if (areToolsEnabled) {
    const mergedResult = mergeSteelNativeToolDefinitions({
      toolDefinitions,
      toolRegistry,
    });
    toolDefinitions = mergedResult.toolDefinitions;
    toolRegistry = mergedResult.toolRegistry;
  }

  return {
    toolRegistry,
    mcpAvailableTools,
    requestScopedConnections,
    userMCPAuthMap,
    toolContextMap,
    dynamicToolContextMap,
    toolDefinitions,
    hasDeferredTools,
    actionsEnabled,
    primedCodeFiles,
  };
}

/**
 * Loads agent tools for initialization or execution.
 * @param {Object} params
 * @param {ServerRequest} params.req - The request object
 * @param {ServerResponse} params.res - The response object
 * @param {Object} params.agent - The agent configuration
 * @param {AbortSignal} [params.signal] - Abort signal
 * @param {Object} [params.tool_resources] - Tool resources
 * @param {Array<Object>} [params.requestAttachments] - Files attached to the current request
 * @param {string} [params.openAIApiKey] - OpenAI API key
 * @param {string|null} [params.streamId] - Stream ID for resumable mode
 * @param {boolean} [params.definitionsOnly=true] - When true, returns only serializable
 *   tool definitions without creating full tool instances. Use for event-driven mode
 *   where tools are loaded on-demand during execution.
 */
async function loadAgentTools({
  req,
  res,
  agent,
  signal,
  tool_resources,
  requestAttachments,
  openAIApiKey,
  streamId = null,
  definitionsOnly = true,
}) {
  if (definitionsOnly) {
    return loadToolDefinitionsWrapper({
      req,
      res,
      agent,
      streamId,
      tool_resources,
      requestAttachments,
    });
  }

  const selectedTools = addSteelPaddleOcrMcpTool(
    Array.isArray(agent.tools) ? agent.tools : [],
    req,
    requestAttachments,
  );

  if (selectedTools.length === 0) {
    return { toolDefinitions: [] };
  } else if (
    selectedTools.length === 1 &&
    /** Legacy handling for `ocr` as may still exist in existing Agents */
    (selectedTools[0] === AgentCapabilities.context || selectedTools[0] === AgentCapabilities.ocr)
  ) {
    return { toolDefinitions: [] };
  }

  const appConfig = req.config;
  const enabledCapabilities = await resolveAgentCapabilities(req, appConfig, agent.id);
  const checkCapability = (capability) => {
    const enabled = enabledCapabilities.has(capability);
    if (!enabled) {
      const isToolCapability = [
        AgentCapabilities.file_search,
        AgentCapabilities.execute_code,
        AgentCapabilities.web_search,
      ].includes(capability);
      const suffix = isToolCapability ? ' despite configured tool.' : '.';
      logger.warn(
        `Capability "${capability}" disabled${suffix} User: ${req.user.id} | Agent: ${agent.id}`,
      );
    }
    return enabled;
  };
  const areToolsEnabled = checkCapability(AgentCapabilities.tools);
  const actionsEnabled = checkCapability(AgentCapabilities.actions);
  const hasMCPTools = selectedTools.some((tool) => tool?.includes(Constants.mcp_delimiter));
  const mcpPermissionContext = createMCPPermissionContext(req);
  const canUseMCP = hasMCPTools ? await mcpPermissionContext.canUseServers(req.user) : true;

  let includesWebSearch = false;
  const _agentTools = selectedTools.filter((tool) => {
    if (tool === Tools.file_search) {
      return checkCapability(AgentCapabilities.file_search);
    } else if (tool === Tools.execute_code) {
      return checkCapability(AgentCapabilities.execute_code);
    } else if (tool === Tools.web_search) {
      includesWebSearch = checkCapability(AgentCapabilities.web_search);
      return includesWebSearch;
    } else if (tool === Tools.memory) {
      return checkCapability(AgentCapabilities.memory);
    } else if (isActionTool(tool)) {
      return actionsEnabled;
    } else if (tool?.includes(Constants.mcp_delimiter)) {
      return areToolsEnabled && canUseMCP;
    } else if (!areToolsEnabled) {
      return false;
    }
    return true;
  });

  if (!_agentTools || _agentTools.length === 0) {
    return {};
  }
  /** @type {ReturnType<typeof createOnSearchResults>} */
  let webSearchCallbacks;
  if (includesWebSearch) {
    webSearchCallbacks = createOnSearchResults(res, streamId);
  }

  /** @type {Record<string, Record<string, string>>} */
  let userMCPAuthMap;
  if (_agentTools?.some((t) => t.includes(Constants.mcp_delimiter))) {
    userMCPAuthMap = await getUserMCPAuthMap({
      tools: _agentTools,
      userId: req.user.id,
      findPluginAuthsByKeys,
    });
  }

  const { loadedTools, toolContextMap, dynamicToolContextMap, primedCodeFiles } = await loadTools({
    agent,
    signal,
    userMCPAuthMap,
    functions: true,
    user: req.user.id,
    tools: _agentTools,
    options: {
      req,
      res,
      openAIApiKey,
      tool_resources,
      processFileURL,
      uploadImageBuffer,
      returnMetadata: true,
      mcpPermissionContext,
      requestScopedConnections: getMCPRequestContext(req, res),
      [Tools.web_search]: webSearchCallbacks,
    },
    webSearch: appConfig.webSearch,
    fileStrategy: appConfig.fileStrategy,
    imageOutputType: appConfig.imageOutputType,
  });

  /** Build tool registry from MCP tools and create PTC/tool search tools if configured */
  const deferredToolsEnabled = checkCapability(AgentCapabilities.deferred_tools);
  const programmaticToolsEnabled = enabledCapabilities.has(AgentCapabilities.programmatic_tools);
  const codeExecutionEnabled =
    agent.tools?.includes(Tools.execute_code) === true &&
    enabledCapabilities.has(AgentCapabilities.execute_code);
  const { toolRegistry, toolDefinitions, additionalTools, hasDeferredTools } =
    await buildToolClassification({
      loadedTools,
      userId: req.user.id,
      agentId: agent.id,
      agentToolOptions: agent.tool_options,
      deferredToolsEnabled,
      programmaticToolsEnabled,
      codeExecutionEnabled,
      authHeaders: () => getCodeApiAuthHeaders(req),
    });

  const agentTools = [];
  for (let i = 0; i < loadedTools.length; i++) {
    const tool = loadedTools[i];
    if (tool.name && (tool.name === Tools.execute_code || tool.name === Tools.file_search)) {
      agentTools.push(tool);
      continue;
    }

    if (!areToolsEnabled) {
      continue;
    }

    if (tool.mcp === true) {
      agentTools.push(tool);
      continue;
    }

    if (tool instanceof DynamicStructuredTool) {
      agentTools.push(tool);
      continue;
    }

    const toolDefinition = {
      name: tool.name,
      schema: tool.schema,
      description: tool.description,
    };

    if (imageGenTools.has(tool.name)) {
      toolDefinition.responseFormat = 'content_and_artifact';
    }

    const toolInstance = toolFn(async (...args) => {
      return tool['_call'](...args);
    }, toolDefinition);

    agentTools.push(toolInstance);
  }

  const ToolMap = loadedTools.reduce((map, tool) => {
    map[tool.name] = tool;
    return map;
  }, {});

  agentTools.push(...additionalTools);

  const hasActionTools = _agentTools.some((t) => isActionTool(t));
  if (!hasActionTools) {
    return {
      toolRegistry,
      requestScopedConnections: getMCPRequestContext(req, res),
      userMCPAuthMap,
      toolContextMap,
      dynamicToolContextMap,
      toolDefinitions,
      hasDeferredTools,
      actionsEnabled,
      tools: agentTools,
      primedCodeFiles,
    };
  }

  const actionSets = (await loadActionSets({ agent_id: agent.id })) ?? [];
  if (actionSets.length === 0) {
    if (_agentTools.length > 0 && agentTools.length === 0) {
      logger.warn(`No tools found for the specified tool calls: ${_agentTools.join(', ')}`);
    }
    return {
      toolRegistry,
      requestScopedConnections: getMCPRequestContext(req, res),
      userMCPAuthMap,
      toolContextMap,
      dynamicToolContextMap,
      toolDefinitions,
      hasDeferredTools,
      actionsEnabled,
      tools: agentTools,
      primedCodeFiles,
    };
  }

  // See registerActionTools for the key-shape rationale.
  const toolToAction = new Map();

  for (const action of actionSets) {
    const domain = await domainParser(action.metadata.domain, true);
    const normalizedDomain = domain.replace(domainSeparatorRegex, '_');
    const legacyDomain = legacyDomainEncode(action.metadata.domain);
    const legacyNormalized = legacyDomain.replace(domainSeparatorRegex, '_');

    const isDomainAllowed = await isActionDomainAllowed(
      action.metadata.domain,
      appConfig?.actions?.allowedDomains,
      appConfig?.actions?.allowedAddresses,
    );
    if (!isDomainAllowed) {
      continue;
    }

    // Validate and parse OpenAPI spec once per action set
    const validationResult = validateAndParseOpenAPISpec(action.metadata.raw_spec);
    if (!validationResult.spec || !validationResult.serverUrl) {
      continue;
    }

    // SECURITY: Validate the domain from the spec matches the stored domain
    // This is defense-in-depth to prevent any stored malicious actions
    const domainValidation = validateActionDomain(
      action.metadata.domain,
      validationResult.serverUrl,
    );
    if (!domainValidation.isValid) {
      logger.error(`Domain mismatch in stored action: ${domainValidation.message}`, {
        userId: req.user.id,
        agent_id: agent.id,
        action_id: action.action_id,
      });
      continue; // Skip this action rather than failing the entire request
    }

    const encrypted = {
      oauth_client_id: action.metadata.oauth_client_id,
      oauth_client_secret: action.metadata.oauth_client_secret,
    };

    // Decrypt metadata once per action set
    const decryptedAction = { ...action };
    decryptedAction.metadata = await decryptMetadata(action.metadata);

    // Process the OpenAPI spec once per action set
    const { requestBuilders, functionSignatures, zodSchemas } = openapiToFunction(
      validationResult.spec,
      true,
    );

    registerActionTools({
      toolToAction,
      functionSignatures,
      normalizedDomain,
      legacyNormalized,
      makeEntry: (sig) => ({
        action: decryptedAction,
        requestBuilder: requestBuilders[sig.name],
        zodSchema: zodSchemas[sig.name],
        functionSignature: sig,
        encrypted,
      }),
    });
  }

  // Now map tools to the processed action sets
  const ActionToolMap = {};

  for (const toolName of _agentTools) {
    if (ToolMap[toolName]) {
      continue;
    }

    const entry = toolToAction.get(normalizeActionToolName(toolName));
    if (!entry) {
      continue;
    }

    const { action, encrypted, zodSchema, requestBuilder, functionSignature } = entry;
    const _allowedDomains = appConfig?.actions?.allowedDomains;
    const _allowedAddresses = appConfig?.actions?.allowedAddresses;
    const tool = await createActionTool({
      userId: req.user.id,
      res,
      action,
      requestBuilder,
      zodSchema,
      encrypted,
      name: toolName,
      description: functionSignature.description,
      streamId,
      useSSRFProtection: !Array.isArray(_allowedDomains) || _allowedDomains.length === 0,
      allowedAddresses: _allowedAddresses,
    });

    if (!tool) {
      logger.warn(
        `Invalid action: user: ${req.user.id} | agent_id: ${agent.id} | toolName: ${toolName}`,
      );
      throw new Error(`{"type":"${ErrorTypes.INVALID_ACTION}"}`);
    }

    agentTools.push(tool);
    ActionToolMap[toolName] = tool;
  }

  if (_agentTools.length > 0 && agentTools.length === 0) {
    logger.warn(`No tools found for the specified tool calls: ${_agentTools.join(', ')}`);
    return {};
  }

  return {
    toolRegistry,
    requestScopedConnections: getMCPRequestContext(req, res),
    toolContextMap,
    dynamicToolContextMap,
    userMCPAuthMap,
    toolDefinitions,
    hasDeferredTools,
    actionsEnabled,
    tools: agentTools,
    primedCodeFiles,
  };
}

/**
 * Loads tools for event-driven execution (ON_TOOL_EXECUTE handler).
 * This function encapsulates all dependencies needed for tool loading,
 * so callers don't need to import processFileURL, uploadImageBuffer, etc.
 *
 * Handles both regular tools (MCP, built-in) and action tools.
 *
 * @param {Object} params
 * @param {ServerRequest} params.req - The request object
 * @param {ServerResponse} params.res - The response object
 * @param {AbortSignal} [params.signal] - Abort signal
 * @param {Object} params.agent - The agent object
 * @param {string[]} params.toolNames - Names of tools to load
 * @param {Map} [params.toolRegistry] - Tool registry
 * @param {Record<string, import('@librechat/api').LCAvailableTools>} [params.mcpAvailableTools] - Run-scoped MCP tool definitions
 * @param {import('@librechat/api').RequestScopedMCPConnectionStore} [params.requestScopedConnections] - Run-scoped MCP connections
 * @param {Record<string, Record<string, string>>} [params.userMCPAuthMap] - User MCP auth map
 * @param {Object} [params.tool_resources] - Tool resources
 * @param {string|null} [params.streamId] - Stream ID for web search callbacks
 * @param {boolean} [params.actionsEnabled] - Whether the actions capability is enabled
 * @returns {Promise<{ loadedTools: Array, configurable: Object }>}
 */
async function loadToolsForExecution({
  req,
  res,
  signal,
  agent,
  toolNames,
  toolRegistry,
  mcpAvailableTools,
  requestScopedConnections,
  userMCPAuthMap,
  tool_resources,
  streamId = null,
  actionsEnabled,
  transformSteelPaddleOcrResults = true,
}) {
  const appConfig = req.config;
  const allLoadedTools = [];
  const mcpRequestScopedConnections = requestScopedConnections ?? getMCPRequestContext(req, res);
  const configurable = { userMCPAuthMap, requestScopedConnections: mcpRequestScopedConnections };

  const isToolSearch = toolNames.includes(AgentConstants.TOOL_SEARCH);
  const ptcToolNames = [
    AgentConstants.BASH_PROGRAMMATIC_TOOL_CALLING,
    AgentConstants.PROGRAMMATIC_TOOL_CALLING,
  ].filter((name) => toolNames.includes(name));
  const isPTCRequested = ptcToolNames.length > 0;
  const isBashToolRequested = toolNames.includes(AgentConstants.BASH_TOOL);
  const isLegacyExecuteCodeRequested = toolNames.includes(Tools.execute_code);
  const isCodeExecutionToolRequested = isBashToolRequested || isLegacyExecuteCodeRequested;

  let enabledCapabilities;
  if (actionsEnabled === undefined || isPTCRequested || isCodeExecutionToolRequested) {
    enabledCapabilities = await resolveAgentCapabilities(req, appConfig, agent?.id);
  }
  if (actionsEnabled === undefined) {
    actionsEnabled = enabledCapabilities.has(AgentCapabilities.actions);
  }
  const codeExecutionEnabled =
    enabledCapabilities?.has(AgentCapabilities.execute_code) === true &&
    agent?.tools?.includes(Tools.execute_code) === true;

  const isPTC =
    isPTCRequested &&
    enabledCapabilities.has(AgentCapabilities.programmatic_tools) &&
    codeExecutionEnabled;

  logger.debug(
    `[loadToolsForExecution] isToolSearch: ${isToolSearch}, toolRegistry: ${toolRegistry?.size ?? 'undefined'}`,
  );

  if (isToolSearch && toolRegistry) {
    const toolSearchTool = createToolSearch({
      mode: 'local',
      toolRegistry,
    });
    allLoadedTools.push(toolSearchTool);
    configurable.toolRegistry = toolRegistry;
  }

  if (isPTC && toolRegistry) {
    configurable.toolRegistry = toolRegistry;
    try {
      /**
       * LibreChat threads per-request Code API auth through the agents
       * library so PTC calls share the same managed auth context.
       */
      for (const name of ptcToolNames) {
        const ptcTool = createBashProgrammaticToolCallingTool({
          authHeaders: () => getCodeApiAuthHeaders(req),
        });
        ptcTool.name = name;
        allLoadedTools.push(ptcTool);
      }
    } catch (error) {
      logger.error('[loadToolsForExecution] Error creating PTC tool:', error);
    }
  }

  const isBashTool =
    isBashToolRequested &&
    codeExecutionEnabled &&
    toolRegistry?.has(AgentConstants.BASH_TOOL) === true;
  if (isBashToolRequested && !isBashTool) {
    logger.warn(
      `[loadToolsForExecution] Skipping unregistered or unauthorized ${AgentConstants.BASH_TOOL}. ` +
        `User: ${req.user.id} | Agent: ${agent?.id ?? 'unknown'}`,
    );
  }
  if (isBashTool) {
    try {
      const bashTool = createBashExecutionTool({
        authHeaders: () => getCodeApiAuthHeaders(req),
      });
      allLoadedTools.push(bashTool);
    } catch (error) {
      logger.error('[loadToolsForExecution] Failed to create bash_tool', error);
    }
  }

  const fileAuthoringToolNames = new Set(
    toolRegistry
      ? Array.from(toolRegistry.values())
          .filter((definition) => isFileAuthoringToolDefinition(definition))
          .map((definition) => definition.name)
      : [],
  );
  const specialToolNames = new Set([
    AgentConstants.TOOL_SEARCH,
    AgentConstants.PROGRAMMATIC_TOOL_CALLING,
    AgentConstants.BASH_PROGRAMMATIC_TOOL_CALLING,
    AgentConstants.BASH_TOOL,
    AgentConstants.SKILL_TOOL,
    AgentConstants.READ_FILE,
    ...fileAuthoringToolNames,
  ]);

  let ptcOrchestratedToolNames = [];
  if (isPTC && toolRegistry) {
    ptcOrchestratedToolNames = Array.from(toolRegistry.keys()).filter(
      (name) => !specialToolNames.has(name),
    );
  }

  const requestedNonSpecialToolNames = toolNames.filter((name) => !specialToolNames.has(name));
  const allowedNonSpecialToolNames = requestedNonSpecialToolNames.filter((name) => {
    if (name !== Tools.execute_code) {
      return true;
    }
    const allowed = codeExecutionEnabled && toolRegistry?.has(Tools.execute_code) === true;
    if (!allowed) {
      logger.warn(
        `[loadToolsForExecution] Skipping unregistered or unauthorized ${Tools.execute_code}. ` +
          `User: ${req.user.id} | Agent: ${agent?.id ?? 'unknown'}`,
      );
    }
    return allowed;
  });
  const allToolNamesToLoad = isPTC
    ? [...new Set([...allowedNonSpecialToolNames, ...ptcOrchestratedToolNames])]
    : allowedNonSpecialToolNames;

  const steelToolEntries = [];
  const actionToolNames = [];
  const regularToolNames = [];
  for (const name of allToolNamesToLoad) {
    const steelToolName = resolveSteelProviderToolName(name);
    if (steelToolName) {
      steelToolEntries.push({ nativeToolName: name, steelToolName });
    } else {
      (isActionTool(name) ? actionToolNames : regularToolNames).push(name);
    }
  }

  if (steelToolEntries.length > 0) {
    const execute = createSteelNativeToolExecute({
      req,
      res,
      streamId,
      runState: createSteelToolRunState(defaultSteelNativeToolMaxCalls),
    });
    allLoadedTools.push(
      ...steelToolEntries.map(({ nativeToolName, steelToolName }) =>
        createSteelNativeTool({
          nativeToolName,
          steelToolName,
          execute,
        }),
      ),
    );
  }

  if (regularToolNames.length > 0) {
    const includesWebSearch = regularToolNames.includes(Tools.web_search);
    const webSearchCallbacks = includesWebSearch ? createOnSearchResults(res, streamId) : undefined;

    const { loadedTools } = await loadTools({
      agent,
      signal,
      userMCPAuthMap,
      functions: true,
      tools: regularToolNames,
      user: req.user.id,
      options: {
        req,
        res,
        tool_resources,
        processFileURL,
        uploadImageBuffer,
        returnMetadata: true,
        mcpAvailableTools,
        requestScopedConnections: mcpRequestScopedConnections,
        [Tools.web_search]: webSearchCallbacks,
      },
      webSearch: appConfig?.webSearch,
      fileStrategy: appConfig?.fileStrategy,
      imageOutputType: appConfig?.imageOutputType,
    });

    if (loadedTools) {
      allLoadedTools.push(...loadedTools);
    }
  }

  if (actionToolNames.length > 0 && agent && actionsEnabled) {
    const actionTools = await loadActionToolsForExecution({
      req,
      res,
      agent,
      appConfig,
      streamId,
      actionToolNames,
    });
    allLoadedTools.push(...actionTools);
  } else if (actionToolNames.length > 0 && agent && !actionsEnabled) {
    logger.warn(
      `[loadToolsForExecution] Capability "${AgentCapabilities.actions}" disabled. ` +
        `Skipping action tool execution. User: ${req.user.id} | Agent: ${agent.id} | Tools: ${actionToolNames.join(', ')}`,
    );
  }

  wrapSteelPaddleOcrToolsForMarkdown({
    loadedTools: allLoadedTools,
    req,
    res,
    signal,
    streamId,
    transformSteelPaddleOcrResults,
  });

  if (isPTC && allLoadedTools.length > 0) {
    const ptcToolMap = new Map();
    for (const tool of allLoadedTools) {
      if (
        tool.name &&
        tool.name !== AgentConstants.PROGRAMMATIC_TOOL_CALLING &&
        tool.name !== AgentConstants.BASH_PROGRAMMATIC_TOOL_CALLING
      ) {
        ptcToolMap.set(tool.name, tool);
      }
    }
    configurable.ptcToolMap = ptcToolMap;
  }

  return {
    configurable,
    loadedTools: allLoadedTools,
  };
}

/**
 * Loads action tools for event-driven execution.
 * @param {Object} params
 * @param {ServerRequest} params.req - The request object
 * @param {ServerResponse} params.res - The response object
 * @param {Object} params.agent - The agent object
 * @param {Object} params.appConfig - App configuration
 * @param {string|null} params.streamId - Stream ID
 * @param {string[]} params.actionToolNames - Action tool names to load
 * @returns {Promise<Array>} Loaded action tools
 */
async function loadActionToolsForExecution({
  req,
  res,
  agent,
  appConfig,
  streamId,
  actionToolNames,
}) {
  const loadedActionTools = [];

  const actionSets = (await loadActionSets({ agent_id: agent.id })) ?? [];
  if (actionSets.length === 0) {
    return loadedActionTools;
  }

  // See registerActionTools for the key-shape rationale.
  const toolToAction = new Map();
  const allowedDomains = appConfig?.actions?.allowedDomains;
  const allowedAddresses = appConfig?.actions?.allowedAddresses;

  for (const action of actionSets) {
    const domain = await domainParser(action.metadata.domain, true);
    const normalizedDomain = domain.replace(domainSeparatorRegex, '_');
    const legacyDomain = legacyDomainEncode(action.metadata.domain);
    const legacyNormalized = legacyDomain.replace(domainSeparatorRegex, '_');

    const isDomainAllowed = await isActionDomainAllowed(
      action.metadata.domain,
      allowedDomains,
      allowedAddresses,
    );
    if (!isDomainAllowed) {
      logger.warn(
        `[Actions] Domain "${action.metadata.domain}" not in allowedDomains. ` +
          `Add it to librechat.yaml actions.allowedDomains to enable this action.`,
      );
      continue;
    }

    const validationResult = validateAndParseOpenAPISpec(action.metadata.raw_spec);
    if (!validationResult.spec || !validationResult.serverUrl) {
      logger.warn(`[Actions] Invalid OpenAPI spec for domain: ${domain}`);
      continue;
    }

    const domainValidation = validateActionDomain(
      action.metadata.domain,
      validationResult.serverUrl,
    );
    if (!domainValidation.isValid) {
      logger.error(`Domain mismatch in stored action: ${domainValidation.message}`, {
        userId: req.user.id,
        agent_id: agent.id,
        action_id: action.action_id,
      });
      continue;
    }

    const encrypted = {
      oauth_client_id: action.metadata.oauth_client_id,
      oauth_client_secret: action.metadata.oauth_client_secret,
    };

    const decryptedAction = { ...action };
    decryptedAction.metadata = await decryptMetadata(action.metadata);

    const { requestBuilders, functionSignatures, zodSchemas } = openapiToFunction(
      validationResult.spec,
      true,
    );

    registerActionTools({
      toolToAction,
      functionSignatures,
      normalizedDomain,
      legacyNormalized,
      makeEntry: (sig) => ({
        action: decryptedAction,
        requestBuilder: requestBuilders[sig.name],
        zodSchema: zodSchemas[sig.name],
        functionSignature: sig,
        encrypted,
      }),
    });
  }

  for (const toolName of actionToolNames) {
    const entry = toolToAction.get(normalizeActionToolName(toolName));
    if (!entry) {
      continue;
    }

    const { action, encrypted, zodSchema, requestBuilder, functionSignature } = entry;
    const tool = await createActionTool({
      userId: req.user.id,
      res,
      action,
      streamId,
      zodSchema,
      encrypted,
      requestBuilder,
      name: toolName,
      description: functionSignature.description,
      useSSRFProtection: !Array.isArray(allowedDomains) || allowedDomains.length === 0,
      allowedAddresses,
    });

    if (!tool) {
      logger.warn(`[Actions] Failed to create action tool: ${toolName}`);
      continue;
    }

    loadedActionTools.push(tool);
  }

  return loadedActionTools;
}

module.exports = {
  loadTools,
  isBuiltInTool,
  getToolkitKey,
  loadAgentTools,
  loadToolsForExecution,
  runSteelPaddleOcrPreflight,
  processRequiredActions,
  resolveAgentCapabilities,
};
