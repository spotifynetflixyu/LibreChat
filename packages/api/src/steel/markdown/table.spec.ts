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

  it('keeps escaped pipes and backslashes inside their cells', () => {
    expect(
      parseMarkdownTables(
        ['| name | path |', '| --- | --- |', '| A\\|B | C:\\\\path |'].join('\n'),
      ),
    ).toEqual([
      {
        headers: ['name', 'path'],
        rows: [['A|B', 'C:\\path']],
      },
    ]);
  });

  it('rejects a table whose separator width differs from its header', () => {
    expect(parseMarkdownTables(['| A | B |', '| --- |', '| 1 | 2 |'].join('\n'))).toEqual([]);
  });
});
