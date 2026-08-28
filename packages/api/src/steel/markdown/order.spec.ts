import { createSystemOrderNormalizer, normalizeSystemOrderMarkdown } from './order';

describe('system_order Markdown normalizer', () => {
  it('normalizes every numeric header and pricing basis', () => {
    const input = [
      '## system_order｜訂單',
      '| 數量 | 單重 | 總數 | 單價 | 厚度 | 寬度 | 長度 | 肚 | 計價基準 | 其他 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 2kg | 約 2.5 公斤 | NT$ 10.2 / 公斤 | 1,234.50kg | 3mm | 4.0 mm | 5m | 6 | C | keep |',
    ].join('\n');
    expect(normalizeSystemOrderMarkdown(input)).toBe(
      [
        '## system_order｜訂單',
        '| 數量 | 單重 | 總數 | 單價 | 厚度 | 寬度 | 長度 | 肚 | 計價基準 | 其他 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 2 | 2.5 | 10.2 | 1234.50 | 3 | 4.0 | 5 | 6 | 3 | keep |',
      ].join('\n'),
    );
  });

  it('maps pricing bases A-F, numeric values, and blanks invalid values', () => {
    const rows = ['A', 'b', 'C', 'd', 'E', 'f', '12.50', 'G', '1,2', '+1', ''].map(
      (value) => `| ${value} |`,
    );
    const input = ['## system_order', '| 計價基準 |', '| --- |', ...rows].join('\n');
    const expected = ['1', '2', '3', '4', '5', '6', '12.50', '', '', '', ''].map(
      (value) => `| ${value} |`,
    );
    expect(normalizeSystemOrderMarkdown(input)).toBe(
      ['## system_order', '| 計價基準 |', '| --- |', ...expected].join('\n'),
    );
  });

  it('blanks ambiguous decimal formats and preserves non-target bytes', () => {
    const input = [
      'prefix',
      '## customer_quote',
      '| 數量 | note |',
      '| --- | --- |',
      '| 1kg | unchanged |',
      '## system_order',
      '| 數量 | note |',
      '| --- | --- |',
      '| 1/2 | A\\|B  \\path |',
      '| 1-2 | x |',
      '| 1e3 | y |',
      '| 1,23 | z |',
      '| −10 | unicode minus |',
      '| －10 | fullwidth minus |',
      '| ＋10 | fullwidth plus |',
      '| ﹣10 | small minus |',
      '| ﹢10 | small plus |',
      '| ±10 | plus-minus |',
    ].join('\n');
    const output = normalizeSystemOrderMarkdown(input);
    expect(output).toContain('| 1kg | unchanged |');
    expect(output).toContain('|  | A\\|B  \\path |');
    expect(output).toContain('|  | y |');
    expect(output).toContain('|  | z |');
    expect(output).toContain('|  | unicode minus |');
    expect(output).toContain('|  | fullwidth minus |');
    expect(output).toContain('|  | fullwidth plus |');
    expect(output).toContain('|  | small minus |');
    expect(output).toContain('|  | small plus |');
    expect(output).toContain('|  | plus-minus |');
  });

  it('ignores fenced examples and only touches first table in each section', () => {
    const input = [
      '```markdown',
      '## system_order',
      '| 數量 |',
      '| --- |',
      '| 2kg |',
      '```',
      '## system_order',
      '| 數量 |',
      '| --- |',
      '| 2kg |',
      '',
      '| 數量 |',
      '| --- |',
      '| 3kg |',
    ].join('\n');
    expect(normalizeSystemOrderMarkdown(input)).toBe(
      [
        '```markdown',
        '## system_order',
        '| 數量 |',
        '| --- |',
        '| 2kg |',
        '```',
        '## system_order',
        '| 數量 |',
        '| --- |',
        '| 2 |',
        '',
        '| 數量 |',
        '| --- |',
        '| 3kg |',
      ].join('\n'),
    );
  });

  it('handles CRLF and every streaming split boundary', () => {
    const input = '## system_order\r\n| 單價 | 計價基準 |\r\n| --- | --- |\r\n| 1,234.50kg | a |';
    const expected = normalizeSystemOrderMarkdown(input);
    for (let split = 0; split <= input.length; split += 1) {
      const normalizer = createSystemOrderNormalizer();
      const output =
        normalizer.append(input.slice(0, split)) +
        normalizer.append(input.slice(split)) +
        normalizer.finish();
      expect(output).toBe(expected);
    }
  });

  it('returns pending bytes unchanged with raw finish', () => {
    const normalizer = createSystemOrderNormalizer();
    expect(normalizer.append('## system_order\n| 數量 |\n| --- |\n| 2kg')).toBe(
      '## system_order\n| 數量 |\n| --- |\n',
    );
    expect(normalizer.finish({ raw: true })).toBe('| 2kg');
  });
});
