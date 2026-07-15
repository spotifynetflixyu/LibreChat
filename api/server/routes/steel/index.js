const express = require('express');
const { createSteelRouteHandlers } = require('@librechat/api');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelRouteHandlers({ getModelsConfig });

router.get('/ai/models', requireJwtAuth, handlers.listModels);
router.get('/ai/oauth-usage', requireJwtAuth, handlers.readOpenAIOAuthUsage);
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);

module.exports = router;
