const { createSteelQuotationWorkflow } = require('@librechat/api');
const steelPostgres = require('./postgres');
const db = require('~/models');

/** Shared post-response/pre-turn quotation adapter for chat and Responses transports. */
const executeSteelQuotationWorkflow = createSteelQuotationWorkflow({
  db,
  client: steelPostgres.client,
});

module.exports = { executeSteelQuotationWorkflow };
