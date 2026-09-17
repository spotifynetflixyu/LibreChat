const express = require('express');
const { createSteelRouteHandlers, createQuotationRouteHandlers } = require('@librechat/api');
const db = require('~/models');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelRouteHandlers({ getModelsConfig });
const quotation = createQuotationRouteHandlers({
  ownsConversation: async (userId, conversationId) => Boolean(await db.getConvo(userId, conversationId)),
});

router.get('/ai/models', requireJwtAuth, handlers.listModels);
router.get('/ai/oauth-usage', requireJwtAuth, handlers.readOpenAIOAuthUsage);
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);
router.get('/conversations/:conversationId/quotation', requireJwtAuth, quotation.status);
router.post('/conversations/:conversationId/quotation/:index/cancel', requireJwtAuth, quotation.cancel);

module.exports = router;
