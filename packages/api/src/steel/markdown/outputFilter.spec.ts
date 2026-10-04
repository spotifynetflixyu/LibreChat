import { createSteelMarkdownOutputFilter, stripCustomerQuoteSections } from './outputFilter';
import { createSystemOrderNormalizer } from './order';

describe('Steel Markdown output filter', () => {
  it('removes customer quote sections while retaining following sections', () => {
    expect(stripCustomerQuoteSections([
      '## system_order',
      '',
      '| A |',
      '| --- |',
      '| 1 |',
      '',
      '## customer_quote',
      '',
      '| internal |',
      '| --- |',
      '| 1 |',
      '',
      '## quote_summary',
      '',
      'done',
    ].join('\n'))).toBe([
      '## system_order',
      '',
      '| A |',
      '| --- |',
      '| 1 |',
      '',
      '## quote_summary',
      '',
      'done',
    ].join('\n'));
  });

  it('handles split headings and preserves fenced examples', () => {
    const filter = createSteelMarkdownOutputFilter();
    const output = [
      filter.append('## system_order\n\nrows\n\n## custo'),
      filter.append('mer_quote｜internal\n\nbody\n\n## notes\n\nnext\n'),
      filter.append('```markdown\n## customer_quote\n\nexample\n```\n'),
      filter.finish(),
    ].join('');
    expect(output).toContain('## system_order');
    expect(output).not.toContain('## customer_quote｜internal');
    expect(output).not.toContain('\nbody\n');
    expect(output).toContain('## notes');
    expect(output).toContain('```markdown\n## customer_quote\n\nexample\n```');
  });

  it('removes fenced blocks inside a suppressed quote while retaining later examples', () => {
    const markdown = [
      '## system_order',
      '',
      'rows',
      '',
      '## customer_quote',
      '',
      '```markdown',
      '## customer_quote',
      '',
      'internal example',
      '```',
      '',
      '## notes',
      '',
      '```markdown',
      '## customer_quote',
      '',
      'retained example',
      '```',
    ].join('\n');

    expect(stripCustomerQuoteSections(markdown)).toBe([
      '## system_order',
      '',
      'rows',
      '',
      '## notes',
      '',
      '```markdown',
      '## customer_quote',
      '',
      'retained example',
      '```',
    ].join('\n'));
  });

  it('does not remove inline mentions or third-level headings', () => {
    const markdown = 'Use ## customer_quote as a label\n\n### customer_quote\n\ntext';
    expect(stripCustomerQuoteSections(markdown)).toBe(`${markdown}`);
  });

  it('flushes ordinary trailing text without a newline', () => {
    const markdown = '## system_order\n\nrows\n\n查價輸出完成。';
    const filter = createSteelMarkdownOutputFilter();
    expect(filter.append(markdown.slice(0, -1))).toBe(markdown.slice(0, -1));
    expect(filter.append(markdown.slice(-1))).toBe('。');
  });

  it('composes with the system order normalizer', () => {
    const markdown = '## system_order｜訂單\n\n| 品名規格 | 總數 | 單價 |\n|---|---:|---:|\n| A | 2 | 10.5 |\n\n查價輸出完成。';
    const normalizer = createSystemOrderNormalizer();
    const filter = createSteelMarkdownOutputFilter();
    const first = filter.append(normalizer.append(markdown));
    const second = filter.append(normalizer.finish({ raw: false }));
    const third = filter.finish();
    expect(`${first}${second}${third}`).toBe(markdown);
  });
});
