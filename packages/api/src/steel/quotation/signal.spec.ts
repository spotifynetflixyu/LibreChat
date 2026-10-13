import { AIMessage } from '@librechat/agents/langchain/messages';
import { createQuotationSignalDetector, isQuotationPreparationComplete } from './signal';

describe('quotation signal detector', () => {
  it('waits for a complete newline terminated signal while accepting CRLF and spacing', () => {
    const detector = createQuotationSignalDetector();

    expect(detector.append('  \r\n  ##  quote_signal \r\n\r\n  st')).toEqual({ state: 'pending' });
    expect(detector.append('art  \r\n')).toEqual({ state: 'matched' });
    expect(detector.disarm()).toBe('  \r\n  ##  quote_signal \r\n\r\n  start  \r\n');
  });

  it('matches a signal without a trailing newline only at text end', () => {
    const detector = createQuotationSignalDetector();

    expect(detector.append('## quote_signal\n\nstart')).toEqual({ state: 'pending' });
    expect(detector.textEnd()).toEqual({ state: 'matched' });
  });

  it('keeps an empty delta pending and accepts a CRLF split across deltas', () => {
    const detector = createQuotationSignalDetector();

    expect(detector.append('')).toEqual({ state: 'pending' });
    expect(detector.append('## quote_signal\r')).toEqual({ state: 'pending' });
    expect(detector.append('\n\r')).toEqual({ state: 'pending' });
    expect(detector.append('\nstart')).toEqual({ state: 'pending' });
    expect(detector.textEnd()).toEqual({ state: 'matched' });
  });

  it.each([
    'prose ## quote_signal\n\nstart',
    '## quote_signal\n\nstart now',
    '```\n## quote_signal\n\nstart\n```',
    '## quote_signal\n\nstart\n\n## quote_signal\n\nstart',
    '    ## quote_signal\n\nstart',
    '## quote_signal\n\n- start',
    '## quote_signal\rfoo',
  ])('disarms malformed or non-standalone text: %j', (text) => {
    const detector = createQuotationSignalDetector();

    const result = detector.append(text);
    expect(result).toEqual({ state: 'disarmed', raw: text });
    expect(detector.disarm()).toBe('');
  });

  it('disarms once after crossing the bounded candidate size', () => {
    const detector = createQuotationSignalDetector();
    const text = `${' '.repeat(257)}## quote_signal`;

    expect(detector.append(text)).toEqual({ state: 'disarmed', raw: text });
    expect(detector.append('start')).toEqual({ state: 'disarmed', raw: '' });
  });
});

describe('isQuotationPreparationComplete', () => {
  it('preserves authentic stop completion with reasoning blocks without accepting them as local handoff', () => {
    const message = new AIMessage({
      content: [
        { type: 'reasoning', text: 'reasoning metadata' },
        { type: 'text', text: '## quote_signal\n\nstart' },
      ],
      response_metadata: { finish_reason: 'stop' },
    });
    expect(isQuotationPreparationComplete(message)).toBe(true);
    expect(isQuotationPreparationComplete({
      ...message,
      response_metadata: { finish_reason: 'quotation_handoff' },
    })).toBe(false);
  });

  it('requires the canonical handoff text, finish reason, and no tools', () => {
    const message = new AIMessage({
      content: '## quote_signal\n\nstart',
      response_metadata: { finish_reason: 'quotation_handoff' },
    });

    expect(isQuotationPreparationComplete(message)).toBe(true);
    expect(isQuotationPreparationComplete({
      ...message,
      response_metadata: { finish_reason: 'stop' },
    })).toBe(true);
    expect(isQuotationPreparationComplete({
      ...message,
      response_metadata: { finish_reason: 'length' },
    })).toBe(false);
    expect(isQuotationPreparationComplete({
      ...message,
      tool_calls: [{ id: 'call', name: 'tool', args: {}, type: 'tool_call' }],
    })).toBe(false);
    expect(isQuotationPreparationComplete({
      ...message,
      content: '## quote_signal\n\nstart\nprose',
    })).toBe(false);
  });
});
