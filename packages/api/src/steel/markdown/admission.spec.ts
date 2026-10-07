import { admitFullOnlyMarkdown } from './admission';

const full = '## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | P1 |';

describe('admitFullOnlyMarkdown', () => {
  it('admits one exact unfenced full target', () => {
    expect(admitFullOnlyMarkdown({
      markdown: full,
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId: 'assistant-1',
    })).toMatchObject({ ok: true, title: 'ocr_result', messageId: 'assistant-1' });
  });

  it.each([
    'ocr_result_updates',
    'ocr_deletions',
    'ocr_update_summary',
    'system_order_revision',
    'system_order_updates',
    'customer_data_updates',
  ])('rejects the retired %s control section', (title) => {
    expect(admitFullOnlyMarkdown({
      markdown: `${full}\n\n## ${title}\n\nold control`,
      kind: 'ocr_result',
      title: 'ocr_result',
      messageId: 'assistant-1',
    })).toEqual({ ok: false, code: 'retired_control_section', retiredTitles: [title] });
  });

  it('rejects delta-only and duplicate full targets before table validation', () => {
    expect(admitFullOnlyMarkdown({
      markdown: '## ocr_result_updates\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | P1 |',
      kind: 'ocr_result', title: 'ocr_result', messageId: 'assistant-1',
    })).toEqual({ ok: false, code: 'retired_control_section', retiredTitles: ['ocr_result_updates'] });
    expect(admitFullOnlyMarkdown({
      markdown: `${full}\n\n${full}`,
      kind: 'ocr_result', title: 'ocr_result', messageId: 'assistant-1',
    })).toEqual({ ok: false, code: 'duplicate_full_target' });
  });

  it('ignores fenced controls and quoted historical prose', () => {
    const markdown = [
      'Historical text: ## ocr_result_updates is retired.',
      '',
      '```markdown',
      '## ocr_result_updates',
      'old example',
      '```',
      '',
      full,
    ].join('\n');
    expect(admitFullOnlyMarkdown({
      markdown, kind: 'ocr_result', title: 'ocr_result', messageId: 'assistant-1',
    })).toMatchObject({ ok: true });
  });

  it('requires the exact full title and message identity', () => {
    expect(admitFullOnlyMarkdown({
      markdown: '## system_order｜報價單\n\n| A |\n| --- |\n| 1 |',
      kind: 'system_order', title: 'system_order', messageId: 'assistant-1',
    })).toEqual({ ok: false, code: 'duplicate_full_target' });
    expect(admitFullOnlyMarkdown({
      markdown: '## system_order｜報價單\n\n| A |\n| --- |\n| 1 |',
      kind: 'system_order', title: 'system_order｜報價單', messageId: 'assistant-1',
    })).toMatchObject({ ok: true, title: 'system_order｜報價單' });
    expect(admitFullOnlyMarkdown({
      markdown: full, kind: 'ocr_result', title: 'ocr_result', messageId: ' ',
    })).toEqual({ ok: false, code: 'invalid_target' });
  });
});
