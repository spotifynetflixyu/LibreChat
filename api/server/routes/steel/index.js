const express = require('express');
const {
  createSteelRouteHandlers,
  createSteelReviewService,
  createSteelReviewCatalogService,
  createSteelReviewCatalogClient,
  createSteelPostgresPool,
  createSteelReviewSourceService,
  createSteelReviewSourceStorageReader,
  createQuotationRouteHandlers,
  resolveDownloadPath,
} = require('@librechat/api');
const db = require('~/models');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');

const router = express.Router();
const sourceService = createSteelReviewSourceService({
  reader: db,
  readStream: createSteelReviewSourceStorageReader({
    getStrategy: getStrategyFunctions,
    resolvePath: resolveDownloadPath,
  }),
});
const catalogService = createSteelReviewCatalogService({
  reader: db,
  client: createSteelReviewCatalogClient(createSteelPostgresPool),
});
const handlers = createSteelRouteHandlers({
  getModelsConfig,
  catalogService,
  reviewService: createSteelReviewService({ reader: db, writer: db, sourceAuthority: sourceService, catalogService }),
  sourceService,
});
const quotation = createQuotationRouteHandlers({
  ownsConversation: async (userId, conversationId) => Boolean(await db.getConvo(userId, conversationId)),
});

router.get('/ai/models', requireJwtAuth, handlers.listModels);
router.get('/ai/oauth-usage', requireJwtAuth, handlers.readOpenAIOAuthUsage);
router.post('/rule-proposals', requireJwtAuth, handlers.createRuleProposal);
router.get('/conversations/:conversationId/review/:kind', requireJwtAuth, handlers.readReview);
router.get('/conversations/:conversationId/review/system_order/catalog', requireJwtAuth, handlers.readReviewCatalog);
router.get('/conversations/:conversationId/review/:kind/receipt', requireJwtAuth, handlers.readReviewReceipt);
router.post('/conversations/:conversationId/review/:kind/prepare', requireJwtAuth, handlers.prepareReview);
router.post('/conversations/:conversationId/review/:kind/commit', requireJwtAuth, handlers.commitReview);
router.get('/conversations/:conversationId/review/:kind/sources', requireJwtAuth, handlers.listReviewSources);
router.get('/conversations/:conversationId/review/:kind/sources/:fileId', requireJwtAuth, handlers.readReviewSource);
router.get('/conversations/:conversationId/review/:kind/sources/:fileId/page-count', requireJwtAuth, handlers.readReviewSourcePageCount);
router.get('/conversations/:conversationId/quotation', requireJwtAuth, quotation.status);
router.post('/conversations/:conversationId/quotation/:index/cancel', requireJwtAuth, quotation.cancel);

module.exports = router;
