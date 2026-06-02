const express = require('express');
const { createSteelHandlers } = require('@librechat/api');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelHandlers({ getModelsConfig });

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
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);

module.exports = router;
