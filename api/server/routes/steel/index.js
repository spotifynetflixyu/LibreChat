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
router.post('/ai/chat/stream', requireJwtAuth, handlers.streamChat);
router.post('/workbooks', requireJwtAuth, handlers.createWorkbook);
router.get('/workbooks/:workbookId', requireJwtAuth, handlers.readWorkbook);
router.patch('/workbooks/:workbookId', requireJwtAuth, handlers.patchWorkbook);
router.post('/workbooks/:workbookId/export', requireJwtAuth, handlers.exportWorkbook);
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);

module.exports = router;
