const express = require('express');
const { createSteelAdminHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelAdminHandlers();
const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

router.use(requireJwtAuth, requireAdminAccess);
router.get('/ai/oauth-token', handlers.readOpenAIOAuthTokenStatus);
router.post('/ai/oauth-token/refresh', handlers.refreshOpenAIOAuthToken);
router.post('/ai/oauth-token/login', handlers.startOpenAIOAuthCodexLogin);
router.get('/ai/oauth-token/login/:sessionId', handlers.readOpenAIOAuthCodexLoginStatus);
router.post('/ai/oauth-token/login/:sessionId/cancel', handlers.cancelOpenAIOAuthCodexLogin);
router.post('/ai/oauth-token/logout', handlers.logoutOpenAIOAuthToken);
router.post('/ai/capability-smoke', handlers.requestCapabilitySmoke);

module.exports = router;
