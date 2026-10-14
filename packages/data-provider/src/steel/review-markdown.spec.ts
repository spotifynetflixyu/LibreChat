import {
  isSteelSectionTitle,
  parseSteelSectionTitle,
  steelSectionBaseTitle,
  parseSteelReviewMarkdownRow,
  parseSteelReviewMarkdownTables,
} from './review-markdown';

describe('Steel section titles', () => {
  it.each(['system_order｜A.pdf', 'system_order|A.pdf', 'system_order:A.pdf', 'system_order：A.pdf'])(
    'accepts %s as a labeled system_order section',
    (title) => {
      expect(steelSectionBaseTitle(title)).toBe('system_order');
      expect(parseSteelSectionTitle(title)).toEqual({ base: 'system_order', label: 'A.pdf' });
      expect(isSteelSectionTitle(title, 'system_order')).toBe(true);
    },
  );

  it('requires a label after a separator and an exact base', () => {
    expect(isSteelSectionTitle('system_order', 'system_order')).toBe(true);
    expect(isSteelSectionTitle('system_order｜ ', 'system_order')).toBe(false);
    expect(isSteelSectionTitle('system_order_chunk', 'system_order')).toBe(false);
    expect(isSteelSectionTitle('注意：說明', 'system_order')).toBe(false);
    expect(steelSectionBaseTitle('  ocr_result  ')).toBe('ocr_result');
  });
});


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
