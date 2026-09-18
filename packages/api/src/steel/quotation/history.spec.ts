import { upsertQuotationToolContent } from './history';
import type { SteelNativePreflightToolCall } from '../native/events';

it('reserves stable tool slots after existing signal text and before final quotation text', () => {
  const signal = { type: 'text', text: '## quote_signal\n\nstart' };
  const parts: unknown[] = [signal];
  const call: SteelNativePreflightToolCall = {
    type: 'tool_call', id: 'lookup-1', name: 'search_price_candidates',
    args: { queries: [{ queryId: 'q1' }] }, progress: 0,
  };
  expect(upsertQuotationToolContent(parts, call)).toBe(1);
  expect(upsertQuotationToolContent(parts, { ...call, id: 'lookup-2' })).toBe(2);
  const output = JSON.stringify({ ok: true, toolName: call.name, data: {} });
  expect(upsertQuotationToolContent(parts, { ...call, output, progress: 1 })).toBe(1);
  expect(parts[0]).toBe(signal);
  expect(parts[1]).toEqual({ type: 'tool_call', tool_call: {
    type: 'tool_call', id: call.id, name: call.name,
    args: JSON.stringify(call.args), output, progress: 1,
  } });
  expect(parts).toHaveLength(3);
  parts.push({ type: 'text', text: '## system_order\ncomplete' });
  expect(upsertQuotationToolContent(parts, { ...call, output, progress: 1 })).toBe(1);
  expect(parts).toHaveLength(4);
  expect(parts[3]).toEqual({ type: 'text', text: '## system_order\ncomplete' });
});
