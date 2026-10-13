import type { AIMessage } from '@librechat/agents/langchain/messages';
import { quotationSignal } from './protocol';

const MAX_QUOTATION_SIGNAL_BYTES = 256;
const HORIZONTAL_WHITESPACE = '[ \\t]';
const HEADING_LINE = `${HORIZONTAL_WHITESPACE}{0,3}##${HORIZONTAL_WHITESPACE}+quote_signal${HORIZONTAL_WHITESPACE}*`;
const LEADING_BLANK_LINES = `(?:${HORIZONTAL_WHITESPACE}*\\n)*`;
const SIGNAL_BODY_PREFIX = `${HORIZONTAL_WHITESPACE}*start${HORIZONTAL_WHITESPACE}*`;

const newlineTerminatedSignal = new RegExp(
  `^${LEADING_BLANK_LINES}${HEADING_LINE}\\n(?:${HORIZONTAL_WHITESPACE}*\\n)+${SIGNAL_BODY_PREFIX}\\n(?:${HORIZONTAL_WHITESPACE}*\\n)*$`,
  'u',
);
const textEndSignal = new RegExp(
  `^${LEADING_BLANK_LINES}${HEADING_LINE}\\n(?:${HORIZONTAL_WHITESPACE}*\\n)+${SIGNAL_BODY_PREFIX}$`,
  'u',
);
const exactHeading = new RegExp(`^${HEADING_LINE}$`, 'u');
const exactBlankLine = new RegExp(`^${HORIZONTAL_WHITESPACE}*$`, 'u');
const exactBody = new RegExp(`^${SIGNAL_BODY_PREFIX}$`, 'u');

export type QuotationSignalDetectorState = 'pending' | 'matched' | 'disarmed';

export type QuotationSignalDetectorResult =
  | { state: 'pending' }
  | { state: 'matched' }
  | { state: 'disarmed'; raw: string };

export interface QuotationSignalDetector {
  append(delta: string): QuotationSignalDetectorResult;
  textEnd(): QuotationSignalDetectorResult;
  disarm(): string;
  getState(): QuotationSignalDetectorState;
}

function normalizeLineEndings(text: string): string | undefined {
  if (/\r(?!\n)/u.test(text)) {
    return undefined;
  }
  return text.replace(/\r\n/gu, '\n');
}

function isHeadingPrefix(line: string): boolean {
  if (/^ {0,3}#?$/u.test(line)) {
    return true;
  }

  const match = line.match(/^ {0,3}##(.*)$/u);
  if (!match) {
    return false;
  }

  const rest = match[1] ?? '';
  if (rest === '' || /^[ \t]+$/u.test(rest)) {
    return true;
  }
  if (!/^[ \t]+/u.test(rest)) {
    return false;
  }

  const title = rest.replace(/^[ \t]+/u, '');
  const titleWithoutTrailingWhitespace = title.replace(/[ \t]+$/u, '');
  if (titleWithoutTrailingWhitespace === '') {
    return true;
  }
  if (!'quote_signal'.startsWith(titleWithoutTrailingWhitespace)) {
    return false;
  }
  return titleWithoutTrailingWhitespace !== 'quote_signal' || /^[ \t]*$/u.test(title.slice(12));
}

function isBodyPrefix(line: string): boolean {
  const body = line.replace(/^[ \t]*/u, '');
  const bodyWithoutTrailingWhitespace = body.replace(/[ \t]+$/u, '');
  if (bodyWithoutTrailingWhitespace === '') {
    return true;
  }
  if (!'start'.startsWith(bodyWithoutTrailingWhitespace)) {
    return false;
  }
  return bodyWithoutTrailingWhitespace !== 'start' || /^[ \t]*$/u.test(body.slice(5));
}

function isPotentialPrefix(text: string): boolean {
  const normalized = normalizeLineEndings(text);
  if (normalized === undefined) {
    return text.endsWith('\r');
  }

  const hasTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  const trailing = hasTrailingNewline ? undefined : lines.pop();
  let phase: 'leading' | 'heading' | 'body' | 'after-body' = 'leading';
  let hasBodyBlankLine = false;

  for (const line of lines) {
    if (phase === 'leading') {
      if (exactBlankLine.test(line)) {
        continue;
      }
      if (!exactHeading.test(line)) {
        return false;
      }
      phase = 'heading';
      continue;
    }

    if (phase === 'heading') {
      if (exactBlankLine.test(line)) {
        hasBodyBlankLine = true;
        continue;
      }
      if (!hasBodyBlankLine || !exactBody.test(line)) {
        return false;
      }
      phase = 'after-body';
      continue;
    }

    if (phase === 'after-body') {
      if (!exactBlankLine.test(line)) {
        return false;
      }
      continue;
    }

    return false;
  }

  if (trailing === undefined) {
    return true;
  }

  if (phase === 'leading') {
    return isHeadingPrefix(trailing);
  }
  if (phase === 'heading') {
    return exactBlankLine.test(trailing) || isBodyPrefix(trailing);
  }
  if (phase === 'after-body') {
    return exactBlankLine.test(trailing);
  }
  return false;
}

function classify(text: string, allowTextEnd: boolean): 'pending' | 'matched' | 'disarmed' {
  if (text.length > MAX_QUOTATION_SIGNAL_BYTES) {
    return 'disarmed';
  }

  const normalized = normalizeLineEndings(text);
  if (normalized === undefined) {
    return text.endsWith('\r') ? 'pending' : 'disarmed';
  }
  if (newlineTerminatedSignal.test(normalized)) {
    return 'matched';
  }
  if (allowTextEnd && textEndSignal.test(normalized)) {
    return 'matched';
  }
  return isPotentialPrefix(text) ? 'pending' : 'disarmed';
}

export function createQuotationSignalDetector(): QuotationSignalDetector {
  let state: QuotationSignalDetectorState = 'pending';
  let buffered = '';

  const disarm = (): string => {
    if (state === 'disarmed') {
      state = 'disarmed';
      buffered = '';
      return '';
    }
    state = 'disarmed';
    const raw = buffered;
    buffered = '';
    return raw;
  };

  const evaluate = (allowTextEnd: boolean): QuotationSignalDetectorResult => {
    const classification = classify(buffered, allowTextEnd);
    if (classification === 'matched') {
      state = 'matched';
      return { state: 'matched' };
    }
    if (classification === 'disarmed') {
      const raw = disarm();
      return { state: 'disarmed', raw };
    }
    return { state: 'pending' };
  };

  return {
    append(delta) {
      if (delta === '') {
        if (state === 'disarmed') return { state, raw: '' };
        if (state === 'matched') return { state };
        return { state: 'pending' };
      }
      if (state !== 'pending') {
        if (state === 'disarmed') return { state, raw: '' };
        return { state: 'matched' };
      }
      if (buffered.length + delta.length > MAX_QUOTATION_SIGNAL_BYTES) {
        const raw = buffered + delta;
        state = 'disarmed';
        buffered = '';
        return { state: 'disarmed', raw };
      }
      buffered += delta;
      return evaluate(false);
    },
    textEnd() {
      if (state !== 'pending') {
        if (state === 'disarmed') return { state, raw: '' };
        return { state: 'matched' };
      }
      return evaluate(true);
    },
    disarm,
    getState() {
      return state;
    },
  };
}

export function isQuotationPreparationComplete(
  message: Pick<AIMessage, 'content' | 'response_metadata' | 'tool_calls'>,
): boolean {
  if (message.tool_calls && message.tool_calls.length > 0) {
    return false;
  }
  const finishReason = message.response_metadata?.finish_reason;
  if (finishReason === 'stop') {
    return true;
  }
  if (finishReason !== 'quotation_handoff') {
    return false;
  }

  let content: string;
  if (typeof message.content === 'string') {
    content = message.content;
  } else {
    const textParts: string[] = [];
    for (const part of message.content) {
      if (typeof part === 'string') {
        textParts.push(part);
        continue;
      }
      if (
        typeof part !== 'object' ||
        part === null ||
        part.type !== 'text' ||
        typeof part.text !== 'string'
      ) {
        return false;
      }
      textParts.push(part.text);
    }
    content = textParts.join('');
  }
  return content === quotationSignal;
}
