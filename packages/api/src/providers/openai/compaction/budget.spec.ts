import type { TextTokenCounter } from './budget';
import Tokenizer from '~/utils/tokenizer';
import { estimateTokens } from './budget';

let count: TextTokenCounter;
beforeAll(async () => {
  count = await Tokenizer.createExactTokenCounter('o200k_base');
});

it('counts large plaintext in tokens rather than UTF-8 bytes', () => {
  const estimate = estimateTokens({ role: 'user', content: 'A'.repeat(260000) }, count);
  expect(estimate.knownTokens).toBeLessThan(40000);
  expect(estimate.uncertain).toBe(false);
});

it('does not tokenize ciphertext or media and marks their costs unknown', () => {
  const seen: string[] = [];
  const counter = (text: string) => {
    seen.push(text);
    return count(text);
  };
  const estimate = estimateTokens(
    [
      { type: 'compaction', encrypted_content: 'PRIVATE_CIPHERTEXT'.repeat(10000) },
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/png;base64,PRIVATE_IMAGE' },
          { type: 'input_file', file_data: 'PRIVATE_FILE' },
          { type: 'input_text', text: 'visible caption' },
        ],
      },
    ],
    counter,
  );
  expect(estimate.uncertain).toBe(true);
  expect(estimate.knownTokens).toBeLessThan(200);
  expect(seen.join('')).toContain('visible caption');
  expect(seen.join('')).not.toContain('PRIVATE_');
});

it('counts tool names, arguments, results and schema text', () => {
  const short = estimateTokens(
    { type: 'function_call_output', call_id: 'call', output: 'answer' },
    count,
  );
  const long = estimateTokens(
    { type: 'function_call_output', call_id: 'call', output: 'word '.repeat(500) },
    count,
  );
  expect(long.knownTokens - short.knownTokens).toBeGreaterThan(450);
  expect(
    estimateTokens({ tools: [{ name: 'lookup', description: 'word '.repeat(500) }] }, count)
      .knownTokens,
  ).toBeGreaterThan(500);
});
