const { createSteelPostgresService, createSteelPostgresPool } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

module.exports = createSteelPostgresService({
  createPool: createSteelPostgresPool,
  onWarning: logger.warn.bind(logger, '[SteelPostgresPool]'),
});
