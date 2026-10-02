import { normalizeSteelChunkMarkdown } from './chunk';

const table = [
  '| 來源 | 零件編號 |',
  '| --- | --- |',
  '| F1 | P1 |',
].join('\n');

describe('normalizeSteelChunkMarkdown', () => {
  it('adds the backend-owned heading to a headingless table', () => {
    expect(normalizeSteelChunkMarkdown('ocr_result_chunk', table)).toBe(
      `## ocr_result_chunk\n\n${table}`,
    );
  });

  it('accepts one legacy matching heading and rebuilds it canonically', () => {
    expect(normalizeSteelChunkMarkdown('system_order_chunk', `## system_order_chunk｜chunk 1\n\n${table}`)).toBe(
      `## system_order_chunk\n\n${table}`,
    );
  });

  it.each([
    ['ocr_result_chunk', '## system_order_chunk'],
    ['system_order_chunk', '## ocr_result'],
  ] as const)('rejects a conflicting data section label for %s', (kind, heading) => {
    expect(() => normalizeSteelChunkMarkdown(kind, `${heading}\n\n${table}`)).toThrow(/conflicting data section/u);
  });

  it.each(['ocr_result_chunk', 'system_order_chunk'] as const)('rejects duplicate %s sections', (kind) => {
    expect(() => normalizeSteelChunkMarkdown(kind, `## ${kind}\n\n${table}\n\n## ${kind}\n\n${table}`)).toThrow(
      /duplicate data sections/u,
    );
  });
});
