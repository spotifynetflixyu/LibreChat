import { countMarkdownTables, parseMarkdownTables } from './table';

describe('Steel Markdown table parser', () => {
  it('parses pipe Markdown tables and ignores malformed pipe blocks', () => {
    const tables = parseMarkdownTables(
      [
        'before',
        '| 項次 | 型號 | 品名規格 |',
        '| ---: | --- | --- |',
        '| 1 | DNB70060 | 6.0m/mOT板雷射切割 |',
        '',
        '| malformed | table |',
        '| no separator | row |',
        '',
        '| key | value |',
        '| --- | --- |',
        '| a | b |',
      ].join('\n'),
    );

    expect(tables).toEqual([
      {
        headers: ['項次', '型號', '品名規格'],
        rows: [['1', 'DNB70060', '6.0m/mOT板雷射切割']],
      },
      {
        headers: ['key', 'value'],
        rows: [['a', 'b']],
      },
    ]);
    expect(countMarkdownTables(tables)).toBe(2);
  });

  it('can count tables directly from Markdown text', () => {
    expect(countMarkdownTables('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nnot a table')).toBe(1);
  });
});
