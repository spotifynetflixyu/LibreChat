import { configSchema, oauthCompactionConfigSchema } from './config';

it('keeps native OAuth compaction opt-in with bounded defaults', () => {
  expect(configSchema.parse({ version: '1.3.1' }).oauthCompaction).toBeUndefined();
  expect(oauthCompactionConfigSchema.parse({})).toEqual({
    enabled: false,
    triggerRatio: 0.75,
    maxContextTokens: 196608,
    outputReserveTokens: 8192,
    timeoutMs: 300000,
    maxResponseBytes: 8388608,
    retentionDays: 30,
  });
});

it.each([
  { outputReserveTokens: 8192, maxContextTokens: 4096 },
  { triggerRatio: 1 },
  { timeoutMs: -1 },
  { retentionDays: 0 },
])('rejects invalid compaction budgets and resource bounds', (config) => {
  expect(oauthCompactionConfigSchema.safeParse(config).success).toBe(false);
});
