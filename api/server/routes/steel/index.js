const express = require('express');
const {
  createMongooseSteelFileAnalysisRepository,
  createSteelFileAnalysisService,
  createSteelHandlers,
  resolveEvidenceFileForProvider,
} = require('@librechat/api');
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

const fileAnalysisService = createSteelFileAnalysisService({
  repository: createMongooseSteelFileAnalysisRepository(require('mongoose')),
});

const handlers = createSteelHandlers({ getModelsConfig, resolveEvidenceFile, fileAnalysisService });

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendSteelRouteError(res, error) {
  res.status(500).json({
    provider: 'openai_oauth_responses',
    model: process.env.STEEL_OPENAI_DEFAULT_MODEL || 'unknown',
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

router.post(
  '/conversations/authenticated',
  requireJwtAuth,
  handlers.createAuthenticatedConversation,
);
router.post('/conversations/guest', handlers.createGuestConversation);
router.get(
  '/conversations/:conversationMetaId',
  requireJwtUnlessGuestToken,
  handlers.readConversation,
);
router.get('/ai/models', requireJwtAuth, handlers.listModels);
router.post('/ai/chat', requireJwtAuth, handlers.chat);
router.post('/ai/chat/stream', requireJwtAuth, steelAsyncRoute(handlers.streamChat));
router.post('/workbooks', requireJwtAuth, handlers.createWorkbook);
router.get(
  '/workbooks/by-conversation/:conversationId',
  requireJwtAuth,
  handlers.readWorkbookByConversation,
);
router.patch(
  '/workbooks/by-conversation/:conversationId',
  requireJwtAuth,
  handlers.patchWorkbookByConversation,
);
router.get('/workbooks/:workbookId', requireJwtAuth, handlers.readWorkbook);
router.patch('/workbooks/:workbookId', requireJwtAuth, handlers.patchWorkbook);
router.post('/workbooks/:workbookId/export', requireJwtAuth, handlers.exportWorkbook);
router.get(
  '/file-analysis/by-conversation/:conversationId',
  requireJwtAuth,
  handlers.readFileAnalysisDataByConversation,
);
router.patch(
  '/file-analysis/by-conversation/:conversationId',
  requireJwtAuth,
  handlers.patchFileAnalysisDataByConversation,
);
router.patch('/file-analysis/:fileAnalysisDataId', requireJwtAuth, handlers.patchFileAnalysisData);
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);

module.exports = router;
