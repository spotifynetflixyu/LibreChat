import { canonicalizeSystemOrderMarkdown } from './revision';

const order = [
  '## system_order｜報價單',
  '',
  '| 品名規格 | 數量 | 總數 | 單價 |',
  '| --- | --- | --- | --- |',
  '| A | 2 | 2 | 10 |',
].join('\n');

describe('Steel system-order canonicalization', () => {
  it('still canonicalizes complete system-order data for full publication callers', () => {
    const result = canonicalizeSystemOrderMarkdown(order);
    expect(result?.markdown).toBe(order);
    expect(result?.sha256).toHaveLength(64);
  });
});
