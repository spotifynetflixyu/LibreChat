const { createSteelDelegateOcrService } = require('@librechat/api');
const db = require('~/models');
const steelPostgres = require('./postgres');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { steelOcr } = require('./ocr');

/** Delegate OCR bound to the server models, file storage, and the Steel OCR service. */
const {
  createDelegateOcrExecute,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  resolveDelegateOcrPolicyForRequest,
} = createSteelDelegateOcrService({
  db,
  client: steelPostgres.client,
  getStrategy: getStrategyFunctions,
  ocr: steelOcr,
});

module.exports = {
  createDelegateOcrExecute,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  resolveDelegateOcrPolicyForRequest,
};
