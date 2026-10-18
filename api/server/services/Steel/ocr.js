const { createSteelOcrService } = require('@librechat/api');
const db = require('~/models');
const steelPostgres = require('./postgres');
const { getMCPManager } = require('~/config');
const { reinitMCPServer } = require('~/server/services/Tools/mcp');
const { resolveMcpServerContext } = require('~/server/services/MCP');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');

/** @type {typeof import('~/server/services/ToolService').loadToolsForExecution | undefined} */
let loadToolsForExecution;

/** ToolService registers its execution loader so PaddleOCR preflight avoids a circular require. */
function registerSteelToolLoader(loader) {
  loadToolsForExecution = loader;
}

/** Steel OCR bound to the server models, file storage, tool loader, and MCP connections. */
const steelOcr = createSteelOcrService({
  db,
  client: steelPostgres.client,
  getStrategy: getStrategyFunctions,
  server: {
    loadTools: (input) => loadToolsForExecution(input),
    disconnectAppConnection: async ({ userId, serverName }) => {
      await getMCPManager(userId)?.appConnections?.disconnect?.(serverName);
    },
    resolveConfigServers: async (req) => (await resolveMcpServerContext(req))?.configServers,
    reinitServer: (input) => reinitMCPServer(input),
  },
});

module.exports = {
  steelOcr,
  registerSteelToolLoader,
  runSteelPaddleOcrPreflight: steelOcr.runSteelPaddleOcrPreflight,
};
