import { configSchema, oauthCompactionConfigSchema } from './config';

it('keeps native OAuth compaction opt-in with bounded defaults', () => {
  expect(configSchema.parse({ version: '1.3.1' }).oauthCompaction).toBeUndefined();
  expect(oauthCompactionConfigSchema.parse({})).toEqual({
    enabled: false,
    triggerRatio: 0.85,
    maxContextTokens: 258400,
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

it('applies the Codex effective context budget to enabled compaction and preserves overrides', () => {
  const config = configSchema.parse({ version: '1.3.1', oauthCompaction: { enabled: true } });
  expect(config.oauthCompaction?.maxContextTokens).toBe(258400);
  expect(config.oauthCompaction?.triggerRatio).toBe(0.85);

  expect(oauthCompactionConfigSchema.parse({ maxContextTokens: 196608 }).maxContextTokens).toBe(
    196608,
  );
});
