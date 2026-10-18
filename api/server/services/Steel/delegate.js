const { createSteelDelegateOcrService } = require('@librechat/api');
const db = require('~/models');
const steelPostgres = require('./postgres');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const {
  createSteelOcrOrganizer,
  resolveSteelOcrPreprocessingRules,
  createSteelPaddleOcrChunkRunner,
  createSteelOcrPdfChunkArtifactStore,
} = require('./ocr');

/** Delegate OCR bound to the server models, file storage, and the OCR services in ocr.js. */
const {
  createDelegateOcrExecute,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  resolveDelegateOcrPolicyForRequest,
} = createSteelDelegateOcrService({
  db,
  client: steelPostgres.client,
  getStrategy: getStrategyFunctions,
  ocr: {
    resolvePreprocessingRules: resolveSteelOcrPreprocessingRules,
    createOrganizer: createSteelOcrOrganizer,
    createPaddleOcrChunkRunner: createSteelPaddleOcrChunkRunner,
    createPdfChunkArtifactStore: createSteelOcrPdfChunkArtifactStore,
  },
});

module.exports = {
  createDelegateOcrExecute,
  prepareDelegateOcrResume,
  executeDelegateOcrResume,
  resolveDelegateOcrPolicyForRequest,
};
