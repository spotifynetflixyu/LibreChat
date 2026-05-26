const express = require('express');
const { createSteelHandlers } = require('@librechat/api');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelHandlers({ getModelsConfig });

router.get('/ai/models', requireJwtAuth, handlers.listModels);
router.post('/ai/chat', requireJwtAuth, handlers.chat);

module.exports = router;
