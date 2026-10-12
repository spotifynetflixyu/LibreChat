import { parseSteelReviewMarkdownTables, parseSteelReviewMarkdownRow } from './review-markdown';

describe('Steel review Markdown authority parser', () => {
  it('keeps global table indexes and physical CRLF offsets across parts', () => {
    const markdown = [
      '# prefix',
      '| outside | value |',
      '| --- | --- |',
      '| one | 1 |',
      '',
      '## ocr_result',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P\\|1 |',
      '```md',
      '| ignored | table |',
      '| --- | --- |',
      '| no | authority |',
      '```',
    ].join('\r\n');
    const tables = parseSteelReviewMarkdownTables(markdown);
    expect(tables.map((table) => ({ index: table.index, title: table.title }))).toEqual([
      { index: 1, title: undefined },
      { index: 2, title: 'ocr_result' },
    ]);
    const managed = tables[1];
    expect(managed?.headers).toEqual(['來源', '零件編號']);
    expect(managed?.rows).toEqual([['A', 'P|1']]);
    expect(managed?.raw).toContain('P\\|1');
    expect(managed ? markdown.slice(managed.start, managed.end) : '').toBe(managed?.raw);
    expect(managed?.start).toBe(markdown.indexOf('| 來源'));
  });

  it('preserves malformed physical rows for stable row-index identity', () => {
    const tables = parseSteelReviewMarkdownTables([
      '## ocr_result',
      '| A | B |',
      '| --- | --- |',
      '| valid | row |',
      '| malformed |',
      '| next | row |',
    ].join('\n'));
    expect(tables[0]?.rows).toEqual([['valid', 'row'], ['malformed'], ['next', 'row']]);
    expect(parseSteelReviewMarkdownRow('| escaped \\| pipe | slash \\\\ |')).toEqual(['escaped | pipe', 'slash \\']);
  });
});
