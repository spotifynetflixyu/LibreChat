import {
  cleanSystemOrderDimension,
  createSystemOrderNormalizer,
  normalizeSystemOrderMarkdown,
} from './order';

const legacyHeaders = [
  '型號',
  '品名規格',
  '材質編號',
  '單位',
  '數量',
  '單重',
  '總數',
  '單價',
  '計價基準',
  '公式編號',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '類別',
  '備註',
];
const orderedHeaders = [
  '型號',
  '品名規格',
  '材質編號',
  '單價',
  '數量',
  '總數',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '單位',
  '類別',
  '單重',
  '計價基準',
  '公式編號',
  '備註',
];

describe('system_order Markdown normalizer', () => {
  it('reorders full tables, alignment markers, and escaped cells at every streaming boundary', () => {
    const row = [
      'ERP-1',
      '鋼板 A\\|B',
      '黑鐵',
      'Kg',
      '2支',
      '0.942',
      '1.884',
      '20元',
      'B',
      'PL',
      '6mm',
      '100mm',
      '200mm',
      '',
      '鐵板',
      '保留\\|',
    ];
    const separators = legacyHeaders.map((_, index) => (index === 3 ? ':---:' : '---'));
    const input = [
      '## system_order',
      `| ${legacyHeaders.map((header) => `**${header}**`).join(' | ')} |`,
      `| ${separators.join(' | ')} |`,
      `| ${row.join(' | ')} |`,
    ].join('\r\n');
    const expected = [
      '## system_order',
      `| ${orderedHeaders.map((header) => `**${header}**`).join(' | ')} |`,
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | :---: | --- | --- | --- | --- | --- |',
      '| ERP-1 | 鋼板 A\\|B | 黑鐵 | 20 | 2 | 1.884 | 6 | 100 | 200 |  | Kg | 鐵板 | 0.942 | 2 | PL | 保留\\| |',
    ].join('\r\n');
    expect(normalizeSystemOrderMarkdown(input)).toBe(expected);
    expect(normalizeSystemOrderMarkdown(expected)).toBe(expected);
    for (let split = 0; split <= input.length; split += 1) {
      const normalizer = createSystemOrderNormalizer();
      expect(
        normalizer.append(input.slice(0, split)) +
          normalizer.append(input.slice(split)) +
          normalizer.finish(),
      ).toBe(expected);
    }
  });

  it('leaves incomplete, ambiguous, fenced, and non-order headers in their original order', () => {
    for (const headers of [
      legacyHeaders.slice(1),
      legacyHeaders.map((header) => (header === '單位' ? '未知' : header)),
      legacyHeaders.map((header) => (header === '單位' ? '型號' : header)),
    ]) {
      const input = `## system_order\n| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
      expect(normalizeSystemOrderMarkdown(input)).toBe(input);
    }
    const header = `| ${legacyHeaders.join(' | ')} |`;
    for (const input of [
      `## system_order\n${header}`,
      `## system_order\n${header}\nnot a separator`,
      `## customer_quote\n${header}\n| ${legacyHeaders.map(() => '---').join(' | ')} |`,
      `\x60\x60\x60markdown\n## system_order\n${header}\n| ${legacyHeaders.map(() => '---').join(' | ')} |\n\x60\x60\x60`,
    ]) {
      expect(normalizeSystemOrderMarkdown(input)).toBe(input);
    }
    const normalizer = createSystemOrderNormalizer();
    expect(normalizer.append(`## system_order\n${header}\n`)).toBe('## system_order\n');
    expect(normalizer.finish({ raw: true })).toBe(header + '\n');
  });

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
        '| 2 | 2.5 | 10.2 | 1234.50 | 3 | 4 | 5000 | 6 | 3 | keep |',
      ].join('\n'),
    );
  });

  it('ceilings length and width in mm while rounding thickness and web half up', () => {
    const input =
      '## system_order\n| 厚度 | 寬度 | 長度 | 肚 | 單重 | 總數 |\n| --- | --- | --- | --- | --- | --- |\n| 6.35mm | 6.35mm | 762.5 mm | 0.2mm | 0.942 kg | 1.884 kg |\n| 1.5mm | 2.3mm | 1.25 m | 0.25 inch | 1.25 | 2.5 |';
    expect(normalizeSystemOrderMarkdown(input)).toContain('| 6 | 7 | 763 | 0 | 0.942 | 1.884 |');
    expect(normalizeSystemOrderMarkdown(input)).toContain('| 2 | 3 | 1250 | 6 | 1.25 | 2.5 |');
  });

  it('ceilings converted dimensions exactly at every streaming boundary and preserves originals', () => {
    const input =
      '## system_order\n| 長度 | 寬度 | 備註 |\n| --- | --- | --- |\n| 483.1mm | 0.25 inch | 保留 |\n| 0.483m | 20.00cm | |\n| 0 | 1/2 | |';
    const expected =
      '## system_order\n| 長度 | 寬度 | 備註 |\n| --- | --- | --- |\n| 484 | 7 | 保留；原長度 483.1 mm；原寬度 6.35 mm |\n| 483 | 200 | |\n| 0 |  | |';
    expect(normalizeSystemOrderMarkdown(input)).toBe(expected);
    expect(normalizeSystemOrderMarkdown(expected)).toBe(expected);
    for (let split = 0; split <= input.length; split += 1) {
      const normalizer = createSystemOrderNormalizer();
      expect(
        normalizer.append(input.slice(0, split)) +
          normalizer.append(input.slice(split)) +
          normalizer.finish(),
      ).toBe(expected);
    }
  });

  it('retains nonzero decimal digits beyond floating point precision when ceiling to mm', () => {
    expect(cleanSystemOrderDimension('0.483000000000000001m', 'ceil')).toBe('484');
    expect(cleanSystemOrderDimension('200.000000000000000001mm', 'ceil')).toBe('201');
    expect(cleanSystemOrderDimension('200.000000000000000000mm', 'ceil')).toBe('200');
  });

  it.each(['system_order_chunk', 'system_order_updates'])('cleans %s rows locally', (title) => {
    const input = `## ${title}\n| 長度 | 數量 |\n| --- | --- |\n| 762.5mm | 2支 |`;
    expect(normalizeSystemOrderMarkdown(input)).toContain('| 763 | 2 |');
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
