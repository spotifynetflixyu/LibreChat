const express = require('express');
const { createSteelAdminHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createSteelAdminHandlers();
const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

router.use(requireJwtAuth, requireAdminAccess);
router.post('/ai/capability-smoke', handlers.requestCapabilitySmoke);

module.exports = router;
