import { readSteelCustomerTable, updateSteelCustomerTier, steelCustomerCommitSchema } from './customer';

const markdown = 'before\r\n\r\n## customer_data ｜ 客戶\r\n\r\n| 名称 | **價格等級** | 說明 |\r\n| --- | --- | --- |\r\n| 甲\\|乙 | B | keep \\\\ text |\r\n\r\nafter';
it('preserves escaped cells, whitespace, title and CRLF while changing the selected grade', () => {
  expect(readSteelCustomerTable(markdown, 'customer_data ｜ 客戶')).toMatchObject({ tier: 'B', column: 1 });
  expect(updateSteelCustomerTier(markdown, 'customer_data ｜ 客戶', 'F')).toBe(markdown.replace('| B |', '| F |').replace('keep \\\\ text', '指定為F等級'));
});
it('rejects ambiguous titles, grade columns, multiple rows and missing grades', () => {
  expect(readSteelCustomerTable(`${markdown}\n${markdown}`, 'customer_data ｜ 客戶')).toBeNull();
  expect(readSteelCustomerTable(markdown.replace('**價格等級**', 'other'), 'customer_data ｜ 客戶')).toBeNull();
  expect(readSteelCustomerTable(markdown.replace('| B |', '| |'), 'customer_data ｜ 客戶')).toBeNull();
  expect(readSteelCustomerTable(markdown.replace('\r\n\r\nafter', '\r\n| 乙 | C | extra |'), 'customer_data ｜ 客戶')).toBeNull();
});
it('accepts only A-F and rejects forged write properties', () => {
  const input = { conversationId: 'conversation', messageId: 'message', title: 'customer_data', outputId: 'output', revision: 'revision', tier: 'A', expectedTier: 'B' };
  expect(steelCustomerCommitSchema.safeParse(input).success).toBe(true);
  expect(steelCustomerCommitSchema.safeParse({ ...input, tier: 'G' }).success).toBe(false);
  expect(steelCustomerCommitSchema.safeParse({ ...input, userId: 'other' }).success).toBe(false);
});

it.each(['**', '__'])('retains %s formatting on a tier cell', (wrapper) => {
  const formatted = markdown.replace('| B |', `| ${wrapper}B${wrapper} |`);
  expect(updateSteelCustomerTier(formatted, 'customer_data ｜ 客戶', 'F')).toBe(formatted.replace(`${wrapper}B${wrapper}`, `${wrapper}F${wrapper}`).replace('keep \\\\ text', '指定為F等級'));
});

it('updates the description even when the selected tier is unchanged', () => {
  expect(updateSteelCustomerTier(markdown, 'customer_data ｜ 客戶', 'B')).toBe(
    markdown.replace('keep \\\\ text', '指定為B等級'),
  );
});
it('rejects duplicate description columns', () => {
  expect(updateSteelCustomerTier(markdown.replace('名称', '說明'), 'customer_data ｜ 客戶', 'F')).toBeNull();
});

it('updates a description column located before the tier cell', () => {
  const reordered = '## customer_data\n\n| 說明 | 價格等級 | 客戶名稱 |\n| --- | --- | --- |\n| 舊說明 | B | 甲 |';
  expect(updateSteelCustomerTier(reordered, 'customer_data', 'A')).toBe(
    reordered.replace('舊說明', '指定為A等級').replace('| B |', '| A |'),
  );
});
