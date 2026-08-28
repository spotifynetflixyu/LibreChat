import { buildCustomerQuoteFromMarkdown, createCustomerQuoteParser } from './quote';

describe('Steel customer quote composer', () => {
  it('composes a quote with exact decimal arithmetic and the source suffix', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order｜報價單 A',
        '',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | ---: | ---: |',
        '| 雷射板 | 2.060154 | 38.5 |',
      ].join('\n'),
    );

    expect(result?.markdown).toBe(
      [
        '## customer_quote｜報價單 A',
        '',
        '| 項目 | 總數 | 小計 |',
        '| --- | --- | --- |',
        '| 雷射板 | 2.060154 | 80 |',
        '| 總計 |  | 80 |',
      ].join('\n'),
    );
  });

  it('accepts grouped numbers and preserves blank rows', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 單價 | 品名規格 | 備註 | 總數 |',
        '| ---: | --- | --- | ---: |',
        '| 1,234.50 | 鋼板 |  | 2 |',
        '|  | 空白數量 |  |  |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 鋼板 | 2 | 2469 |');
    expect(result?.markdown).toContain('| 空白數量 |  |  |');
    expect(result?.markdown).toContain('| 總計 |  | 2469 |');
  });

  it('sums only usable rows when some numeric cells are invalid', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 單價 | 總數 |',
        '| --- | ---: | ---: |',
        '| 有效 | 10 | 2 |',
        '| 缺單價 |  | 3 |',
        '| 壞格式 | 1e2 | 3 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 有效 | 2 | 20 |');
    expect(result?.markdown).toContain('| 缺單價 | 3 |  |');
    expect(result?.markdown).toContain('| 壞格式 | 3 |  |');
    expect(result?.markdown).toContain('| 總計 |  | 20 |');
  });

  it('leaves total blank when every row lacks a usable subtotal', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | ---: | ---: |',
        '| A | NaN | 2 |',
        '| B |  | 3 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 總計 |  |  |');
  });

  it('extracts numbers around labels while rejecting ambiguous numeric formats', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | ---: | ---: |',
        '| 零 | 0 | 12 |',
        '| 符號 | -1 | 12 |',
        '| 指數 | 1e2 | 12 |',
        '| 分組 | 12,34 | 12 |',
        '| 單位 | 2 kg | 12 |',
        '| 標籤 | 約 2.5 公斤 | NT$ 10.2 / 公斤 |',
        '| 緊鄰單位 | 2kg | USD10 |',
        '| 分數 | 1/2 kg | 10 |',
        '| 多組數字 | 2 x 3 kg | 10 |',
        '| 負幣別 | 1 | -NT$10 |',
        '| 正幣別 | 1 | +$10 |',
        '| 尾隨符號 | 1 | 10- |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 零 | 0 | 0 |');
    expect(result?.markdown).toContain('| 符號 | -1 |  |');
    expect(result?.markdown).toContain('| 指數 | 1e2 |  |');
    expect(result?.markdown).toContain('| 分組 | 12,34 |  |');
    expect(result?.markdown).toContain('| 單位 | 2 kg | 24 |');
    expect(result?.markdown).toContain('| 標籤 | 約 2.5 公斤 | 26 |');
    expect(result?.markdown).toContain('| 緊鄰單位 | 2kg | 20 |');
    expect(result?.markdown).toContain('| 分數 | 1/2 kg |  |');
    expect(result?.markdown).toContain('| 多組數字 | 2 x 3 kg |  |');
    expect(result?.markdown).toContain('| 負幣別 | 1 |  |');
    expect(result?.markdown).toContain('| 正幣別 | 1 |  |');
    expect(result?.markdown).toContain('| 尾隨符號 | 1 |  |');
    expect(result?.markdown).toContain('| 總計 |  | 70 |');
  });

  it('handles pipes inside inline code spans', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | ---: | ---: |',
        '| `A\\|B` | 1 | 2 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| `A\\|B` | 1 | 2 |');
  });

  it('keeps short rows and continues parsing later complete rows', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| 只有品名 |',
        '| 完整 | 2 | 3 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 只有品名 |  |  |');
    expect(result?.markdown).toContain('| 完整 | 2 | 6 |');
    expect(result?.markdown).toContain('| 總計 |  | 6 |');
  });

  it('escapes backslashes in output cells', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| C:\\path | 1 | 2 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| C:\\\\path | 1 | 2 |');
  });

  it('uses reordered required columns, keeps extra columns, and escapes item pipes', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 備註 | 單價 | 品名規格 | 總數 |',
        '| --- | ---: | --- | ---: |',
        '| note | 4 | 零件 \\| 特殊 | 2 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 零件 \\| 特殊 | 2 | 8 |');
  });

  it('ignores fenced fake sections and tables', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '```markdown',
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| 假資料 | 9 | 9 |',
        '```',
        '',
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| 真資料 | 1 | 7 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| 真資料 | 1 | 7 |');
    expect(result?.markdown).not.toContain('假資料');
  });

  it('does not join a table header and separator across a fenced block', () => {
    expect(
      buildCustomerQuoteFromMarkdown(
        [
          '## system_order',
          '| 品名規格 | 總數 | 單價 |',
          '```text',
          'fenced interruption',
          '```',
          '| --- | --- | --- |',
          '| A | 1 | 2 |',
        ].join('\n'),
      ),
    ).toBeUndefined();
  });

  it('stops table rows when a fenced block interrupts the table', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| fence 前 | 1 | 2 |',
        '```text',
        'fenced interruption',
        '```',
        '| fence 後 | 3 | 4 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| fence 前 | 1 | 2 |');
    expect(result?.markdown).not.toContain('fence 後');
    expect(result?.markdown).toContain('| 總計 |  | 2 |');
  });

  it.each(['## customer_quote', '## customer_quote｜既有報價'])(
    'returns undefined when an outside-fence customer quote already exists: %s',
    (heading) => {
      expect(
        buildCustomerQuoteFromMarkdown(
          [
            '## system_order',
            '| 品名規格 | 總數 | 單價 |',
            '| --- | --- | --- |',
            '| A | 1 | 2 |',
            '',
            heading,
            '',
            '| 項目 | 總數 | 小計 |',
            '| --- | --- | --- |',
            '| A | 1 | 2 |',
          ].join('\n'),
        ),
      ).toBeUndefined();
    },
  );

  it('ignores a fenced customer quote when checking idempotency', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '```markdown',
        '## customer_quote｜假資料',
        '```',
        '',
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| A | 1 | 2 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('| A | 1 | 2 |');
  });

  it('returns undefined when section, table, or required headers are missing', () => {
    expect(
      buildCustomerQuoteFromMarkdown('## other\n| A | B |\n| --- | --- |\n| 1 | 2 |'),
    ).toBeUndefined();
    expect(buildCustomerQuoteFromMarkdown('## system_order\nno table')).toBeUndefined();
    expect(
      buildCustomerQuoteFromMarkdown(
        '## system_order\n| 品名規格 | 總數 |\n| --- | --- |\n| A | 1 |',
      ),
    ).toBeUndefined();
  });

  it('uses first table in section and does not skip it for a later table', () => {
    expect(
      buildCustomerQuoteFromMarkdown(
        [
          '## system_order',
          '| 備註 | 內容 |',
          '| --- | --- |',
          '| 先出現 | table |',
          '',
          '| 品名規格 | 總數 | 單價 |',
          '| --- | --- | --- |',
          '| 不應採用 | 1 | 1 |',
        ].join('\n'),
      ),
    ).toBeUndefined();
  });

  it('uses a later system_order section when an earlier section is not calculable', () => {
    const result = buildCustomerQuoteFromMarkdown(
      [
        '## system_order｜無效',
        '| 備註 | 內容 |',
        '| --- | --- |',
        '| 缺少 | 必要欄位 |',
        '',
        '## system_order｜有效',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| 後段資料 | 2 | 4 |',
      ].join('\n'),
    );

    expect(result?.markdown).toContain('## customer_quote｜有效');
    expect(result?.markdown).toContain('| 後段資料 | 2 | 8 |');
  });

  it('parses fragmented rows incrementally and freezes only the trailing summary', () => {
    const prefix = ['## system_order｜訂單', '品名規格 | 總數 | 單價', '---|---:|---:', ''].join(
      '\n',
    );
    const parser = createCustomerQuoteParser();
    parser.append(prefix);
    expect(parser.getSafeTextEnd()).toBe(prefix.length);

    parser.append('A ');
    expect(parser.getSafeTextEnd()).toBe(prefix.length);

    parser.append('| 2 | 10.5');
    expect(parser.getSafeTextEnd()).toBe(prefix.length + 'A | 2 | 10.5'.length);

    parser.append('\n查價輸出完成');
    const rowEnd = prefix.length + 'A | 2 | 10.5\n'.length;
    expect(parser.getSafeTextEnd()).toBe(rowEnd);
    expect(parser.finish()).toEqual(
      expect.objectContaining({
        sourceEnd: rowEnd,
        markdown: expect.stringContaining('| A | 2 | 21 |'),
      }),
    );
  });

  it('does not advance past a fragmented fence opener containing a pipe after the table', () => {
    const table =
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| A | 1 | 2 |',
      ].join('\n') + '\n';
    const parser = createCustomerQuoteParser();
    parser.append(table);
    const tableEnd = parser.getSafeTextEnd();
    expect(tableEnd).toBe(table.length);

    parser.append('~~~text | note');
    expect(parser.getSafeTextEnd()).toBe(tableEnd);

    parser.append('\nfenced | content\n~~~\n');
    expect(parser.getSafeTextEnd()).toBe(tableEnd);
    expect(parser.finish()).toEqual(expect.objectContaining({ sourceEnd: tableEnd }));
  });

  it('does not advance past a fragmented H2 control line containing a pipe after the table', () => {
    const table =
      [
        '## system_order',
        '| 品名規格 | 總數 | 單價 |',
        '| --- | --- | --- |',
        '| A | 1 | 2 |',
      ].join('\n') + '\n';
    const parser = createCustomerQuoteParser();
    parser.append(table);
    const tableEnd = parser.getSafeTextEnd();

    parser.append('## follow_up | note');
    expect(parser.getSafeTextEnd()).toBe(tableEnd);

    parser.append('\nsummary\n');
    expect(parser.getSafeTextEnd()).toBe(tableEnd);
    expect(parser.finish()).toEqual(expect.objectContaining({ sourceEnd: tableEnd }));
  });

  it('releases a buffered table unchanged when a fragmented customer_quote follows', () => {
    const systemOrder = [
      '## system_order',
      '| 品名規格 | 總數 | 單價 |',
      '| --- | --- | --- |',
      '| A | 1 | 2 |',
    ].join('\n');
    const parser = createCustomerQuoteParser();
    parser.append(`${systemOrder}\n\n## customer_`);
    expect(parser.getSafeTextEnd()).toBeLessThan(systemOrder.length + 16);

    parser.append('quote\n| existing |');
    expect(parser.getSafeTextEnd()).toBe(
      `${systemOrder}\n\n## customer_quote\n| existing |`.length,
    );
    expect(parser.finish()).toBeUndefined();
  });

  it('matches full parsing when CRLF and fences are split across chunks', () => {
    const markdown = [
      '```markdown',
      '## system_order｜假資料',
      '| 品名規格 | 總數 | 單價 |',
      '| --- | --- | --- |',
      '| 假 | 9 | 9 |',
      '```',
      '## system_order｜真資料',
      '| 品名規格 | 總數 | 單價 |',
      '| --- | --- | --- |',
      '| 真 | 2 | 3 |',
    ].join('\r\n');
    const expected = buildCustomerQuoteFromMarkdown(markdown);

    for (let split = 0; split <= markdown.length; split += 1) {
      const parser = createCustomerQuoteParser();
      parser.append(markdown.slice(0, split));
      parser.append(markdown.slice(split));
      expect(parser.finish()).toEqual(expected);
    }

    expect(expected?.markdown).toContain('| 真 | 2 | 6 |');
  });
});
