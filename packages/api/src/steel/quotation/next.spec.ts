import { appendSteelNextStep, hasSteelCustomerTier } from './next';

const order = '## ocr_result\n\n| 來源 | 零件編號 | 類別 | 數量 |\n| --- | --- | --- | --- |\n| F1 | P1 | 鋼板 | 2 |';
const customer = '## customer_data\n\n| 客戶名稱 | 價格等級 |\n| --- | --- |\n| 未指定客戶 | B |';
const base = { markdown: customer, completed: true };

it.each(['', 'Hello **world**', '1. Confirm order', '```markdown\n## customer_data\n```'])('does not treat plain or fenced text as named data: %s', (markdown) => {
  expect(appendSteelNextStep({ ...base, markdown, order, customer })).toBe(markdown);
});

it('uses the saved order and valid tier for the three states in each language', () => {
  expect(appendSteelNextStep({ ...base, language: 'zh-TW' })).toContain('請先提供材料訂單');
  expect(appendSteelNextStep({ ...base })).toContain('Please provide a material order first');
  expect(appendSteelNextStep({ ...base, order, language: 'zh-CN' })).toContain('或回覆「使用預設 B 級進行報價」');
  expect(appendSteelNextStep({ ...base, order })).toContain('Use default Tier B for the quote');
  expect(appendSteelNextStep({ ...base, order, customer, language: 'zh-TW' })).toContain('請確認資料後回覆「報價」');
  expect(appendSteelNextStep({ ...base, order, customer, language: 'en-US' })).toContain('reply “Quote”');
});

it('requires a single valid tier rather than customer markdown presence', () => {
  expect(hasSteelCustomerTier(customer)).toBe(true);
  expect(hasSteelCustomerTier(customer.replace('| B |', '| |'))).toBe(false);
  expect(hasSteelCustomerTier(customer.replace('| B |', '| G |'))).toBe(false);
  expect(hasSteelCustomerTier(customer + '\n| Another | A |')).toBe(false);
});

it('suppresses unfinished responses, system orders and signals', () => {
  expect(appendSteelNextStep({ ...base, completed: false })).toBe(customer);
  for (const markdown of [customer + '\n\n## system_order\n\n| x |\n| --- |\n| 1 |', customer + '\n\n## quote_signal\n\nstart']) {
    expect(appendSteelNextStep({ ...base, markdown, order })).toBe(markdown);
  }
});

it('does not duplicate the backend footer on retry', () => {
  const once = appendSteelNextStep({ ...base, order, customer });
  expect(appendSteelNextStep({ ...base, markdown: once, order, customer })).toBe(once);
});

it('preserves trailing streamed whitespace when appending the footer', () => {
  const markdown = `${customer}\n\n`;
  expect(appendSteelNextStep({ ...base, markdown, order, customer }).startsWith(markdown)).toBe(true);
});
