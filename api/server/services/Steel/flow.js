const mongoose = require('mongoose');
const { createSteelFlowLifecycle } = require('@librechat/api');

module.exports = createSteelFlowLifecycle(mongoose);
