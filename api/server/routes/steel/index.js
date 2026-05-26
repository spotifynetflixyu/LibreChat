const express = require('express');
const { createSteelHandlers } = require('@librechat/api');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelHandlers({ getModelsConfig });

router.get('/ai/models', requireJwtAuth, handlers.listModels);

module.exports = router;
