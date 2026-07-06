const express = require('express');
const { createSteelHandlers, resolveEvidenceFileForProvider } = require('@librechat/api');
const { getFiles } = require('~/models');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

async function streamToUint8Array(stream) {
  if (stream && typeof stream.arrayBuffer === 'function') {
    return new Uint8Array(await stream.arrayBuffer());
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Uint8Array(Buffer.concat(chunks));
}

async function resolveEvidenceFile({ fileId, request, userId, conversationId }) {
  return resolveEvidenceFileForProvider({
    fileId,
    userId,
    conversationId,
    findFile: async (id) => {
      const files = await getFiles({ file_id: { $in: [id] } }, null, { text: 0 });
      return files?.[0] ?? null;
    },
    readFileBytes: async (attachment) => {
      const { getDownloadStream } = getStrategyFunctions(attachment.fileRef.source);
      if (!getDownloadStream) {
        throw new Error(`Steel evidence file source ${attachment.fileRef.source} cannot be read`);
      }

      const stream = await getDownloadStream(request, attachment.fileRef.filepath);
      return streamToUint8Array(stream);
    },
  });
}

const handlers = createSteelHandlers({ getModelsConfig, resolveEvidenceFile });

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendSteelRouteError(res, error) {
  const model =
    process.env.OPENAI_DEFAULT_MODEL || process.env.STEEL_OPENAI_DEFAULT_MODEL || 'unknown';
  res.status(500).json({
    provider: 'openai_oauth_responses',
    model,
    text: '',
    unsupportedSettings: [],
    warnings: [],
    errorCategory: 'unknown',
    errorSummary:
      process.env.NODE_ENV === 'production'
        ? 'Steel stream request failed.'
        : getErrorMessage(error),
  });
}

function steelAsyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (res.headersSent) {
        next(error);
        return;
      }

      sendSteelRouteError(res, error);
    }
  };
}

function requireJwtUnlessGuestToken(req, res, next) {
  if (req.headers['x-steel-guest-token']) {
    next();
    return;
  }

  requireJwtAuth(req, res, next);
}

function isSteelOAuthChatDevRouteEnabled(env = process.env) {
  return env.NODE_ENV !== 'production';
}

function requireSteelOAuthChatDevRoute(_req, res, next) {
  if (isSteelOAuthChatDevRouteEnabled()) {
    next();
    return;
  }

  res.status(404).json({ message: 'Not found' });
}

router.post(
  '/conversations/authenticated',
  requireSteelOAuthChatDevRoute,
  requireJwtAuth,
  handlers.createAuthenticatedConversation,
);
router.post(
  '/conversations/guest',
  requireSteelOAuthChatDevRoute,
  handlers.createGuestConversation,
);
router.get(
  '/conversations/:conversationId/messages',
  requireSteelOAuthChatDevRoute,
  requireJwtAuth,
  handlers.readConversationMessages,
);
router.get(
  '/conversations/:conversationMetaId',
  requireSteelOAuthChatDevRoute,
  requireJwtUnlessGuestToken,
  handlers.readConversation,
);
router.get('/ai/models', requireJwtAuth, handlers.listModels);
router.get('/ai/oauth-usage', requireJwtAuth, handlers.readOpenAIOAuthUsage);
router.post('/ai/chat', requireSteelOAuthChatDevRoute, requireJwtAuth, handlers.chat);
router.post(
  '/ai/chat/stream',
  requireSteelOAuthChatDevRoute,
  requireJwtAuth,
  steelAsyncRoute(handlers.streamChat),
);
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);

module.exports = router;
