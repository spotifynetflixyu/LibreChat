const {
  createSteelNativeTool,
  createDelegateOcrTool,
  delegateOcrToolName,
  addSteelPaddleOcrMcpTool,
  getSteelNativeToolRunState,
  resolveSteelProviderToolName,
  prepareSteelNativeToolConfig,
  createSteelNativeToolExecute,
  resolveSteelTurnToolVisibility,
  mergeSteelNativeToolDefinitions,
} = require('@librechat/api');
const { AgentCapabilities } = require('librechat-data-provider');
const { createDelegateOcrExecute } = require('./delegate');
const steelPostgres = require('./postgres');

/**
 * Wraps the upstream agent tool loader so every agent gets the Steel tool
 * definitions and, when the turn carries OCR-able files, the PaddleOCR MCP
 * server. Stored Steel tool names are stripped first because the Steel
 * definitions are merged in afterwards.
 *
 * The injected PaddleOCR server is not one of the agent's own MCP tools, so it
 * must not turn an unavailable PaddleOCR server into the upstream fatal
 * "expected MCP tools unavailable" error: that case retries with the agent's
 * own tools only.
 *
 * @param {Function} loadAgentTools - Upstream `loadAgentTools`.
 * @param {object} deps
 * @param {Function} deps.resolveAgentCapabilities
 * @param {(toolName: string) => boolean} deps.isExpectedMCPTool
 * @param {(error: unknown) => boolean} deps.isExpectedMCPToolsUnavailableError
 */
function withSteelAgentTools(
  loadAgentTools,
  { resolveAgentCapabilities, isExpectedMCPTool, isExpectedMCPToolsUnavailableError },
) {
  return async function loadSteelAgentTools({ requestAttachments, ...params }) {
    const { req, agent } = params;
    const agentTools = (Array.isArray(agent.tools) ? agent.tools : []).filter(
      (tool) => !resolveSteelProviderToolName(tool),
    );
    const tools = addSteelPaddleOcrMcpTool(agentTools, req, requestAttachments);

    let result;
    try {
      result = await loadAgentTools({ ...params, agent: { ...agent, tools } });
    } catch (error) {
      const injectedOnly =
        tools !== agentTools &&
        isExpectedMCPToolsUnavailableError(error) &&
        !agentTools.some(isExpectedMCPTool);
      if (!injectedOnly) {
        throw error;
      }
      result = await loadAgentTools({ ...params, agent: { ...agent, tools: agentTools } });
    }

    if (params.definitionsOnly === false) {
      return result;
    }
    const capabilities = await resolveAgentCapabilities(req, req.config, agent.id);
    if (!capabilities.has(AgentCapabilities.tools)) {
      return result;
    }
    return mergeSteelNativeToolDefinitions(result, { initializationDefer: true });
  };
}

/** Copies the delegate OCR workflow identity onto the run's tool configurable. */
function applyDelegateOcrConfigurable(configurable, req, enableDelegateOcrStreaming) {
  if (enableDelegateOcrStreaming) {
    configurable.delegateOcrStreaming = true;
  }
  const delegateContext = req?.steelNativeContext?.delegateOcrContext;
  const workflowContext = delegateContext?.delegateOcrWorkflow ?? delegateContext;
  const claimToken = workflowContext?.delegateOcrClaimToken ?? workflowContext?.claimToken;
  if (typeof claimToken === 'string') {
    configurable.delegateOcrClaimToken = claimToken;
  }
  if (typeof workflowContext?.responseGenerationId === 'string') {
    configurable.delegateOcrGenerationId = workflowContext.responseGenerationId;
  } else if (typeof workflowContext?.generationId === 'string') {
    configurable.delegateOcrGenerationId = workflowContext.generationId;
  }
  if (typeof workflowContext?.delegateOcrAttemptToken === 'string') {
    configurable.delegateOcrAttemptToken = workflowContext.delegateOcrAttemptToken;
  }
  const canDispatchEvent =
    workflowContext?.canDispatchEvent ?? req?.steelNativeContext?.canDispatchEvent;
  if (typeof canDispatchEvent === 'function') {
    configurable.canDispatchEvent = canDispatchEvent;
  }
}

/**
 * Wraps the upstream execution-time tool loader. The turn's Steel visibility
 * is applied first, since the agents SDK event mode does no tool-name
 * membership check and this is the only hard stop for hidden tools. Steel and
 * delegate OCR tools are then built here and the rest loads upstream.
 *
 * @param {Function} loadToolsForExecution - Upstream `loadToolsForExecution`.
 */
function withSteelExecutionTools(loadToolsForExecution) {
  return async function loadSteelToolsForExecution({
    allowPaddleOcr = false,
    enableDelegateOcrStreaming = false,
    ...params
  }) {
    const { req, res, signal, agent, streamId = null } = params;
    const visible = prepareSteelNativeToolConfig(
      { tools: params.toolNames, toolRegistry: params.toolRegistry },
      { ...resolveSteelTurnToolVisibility(req?.steelNativeContext), allowPaddleOcr },
    );

    const steelToolEntries = [];
    const toolNames = [];
    let hasDelegateOcr = false;
    for (const name of visible.tools ?? []) {
      if (typeof name !== 'string') {
        continue;
      }
      const steelToolName = resolveSteelProviderToolName(name);
      if (steelToolName) {
        steelToolEntries.push({ nativeToolName: name, steelToolName });
      } else if (name === delegateOcrToolName) {
        hasDelegateOcr = true;
      } else {
        toolNames.push(name);
      }
    }

    const result = await loadToolsForExecution({
      ...params,
      toolNames,
      toolRegistry: visible.toolRegistry,
    });

    if (steelToolEntries.length > 0) {
      const execute = createSteelNativeToolExecute({
        req,
        res,
        streamId,
        client: steelPostgres.client,
        runState: getSteelNativeToolRunState({
          req,
          requestScopedConnections: result.configurable.requestScopedConnections,
        }),
      });
      result.loadedTools.push(
        ...steelToolEntries.map(({ nativeToolName, steelToolName }) =>
          createSteelNativeTool({ nativeToolName, steelToolName, execute }),
        ),
      );
    }

    if (hasDelegateOcr) {
      applyDelegateOcrConfigurable(result.configurable, req, enableDelegateOcrStreaming);
      result.loadedTools.push(
        createDelegateOcrTool({
          execute: createDelegateOcrExecute({ req, res, streamId, signal, agent }),
        }),
      );
    }

    return result;
  };
}

module.exports = { withSteelAgentTools, withSteelExecutionTools };
