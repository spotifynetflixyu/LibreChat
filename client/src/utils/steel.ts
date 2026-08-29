import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function getPersistedSteelActivityEvents(
  metadata: TMessage['metadata'],
): readonly unknown[] | undefined {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.steel)) {
    return undefined;
  }

  const activityEvents = metadata.steel.activityEvents;
  return Array.isArray(activityEvents) ? activityEvents : undefined;
}

type PersistedSteelPreflightToolCall = {
  type: 'tool_call';
  id: string;
  name: string;
  args: {
    input_data?: string;
    output_mode: 'detailed';
    return_images: boolean;
    use_doc_orientation_classify: boolean;
    use_doc_unwarping: boolean;
    use_layout_detection: boolean;
  };
  output?: string;
  progress: 0 | 1;
};

const preflightOutputMaxBytes = 4 * 1024;
const preflightStringMaxLength = 256;
const preflightErrorMaxLength = 512;
const preflightDiagnosticCodeMaxLength = 128;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return actualKeys.join(',') === [...keys].sort().join(',');
}

function isBoundedString(value: unknown, maxLength: number, nonEmpty = true): value is string {
  return typeof value === 'string' && (!nonEmpty || value.length > 0) && value.length <= maxLength;
}

const paddleOcrOutputIdentityKeys = [
  'ocrEngine',
  'ocrFileKey',
  'filename',
  'chunkIndex',
  'chunkCount',
  'pageStart',
  'pageEnd',
] as const;

const paddleOcrCompactSuccessKeys = [
  'status',
  'paddleocr',
  ...paddleOcrOutputIdentityKeys,
  'dataSizeBytes',
] as const;

const paddleOcrHistoricalSuccessKeys = [
  'status',
  'paddleocr',
  ...paddleOcrOutputIdentityKeys,
  'rawTextLength',
  'rawResultHash',
  'outputStorage',
] as const;

const paddleOcrLegacySuccessKeys = [
  'status',
  ...paddleOcrOutputIdentityKeys,
  'rawTextLength',
  'rawResultHash',
  'outputStorage',
] as const;

const paddleOcrCompactFailureKeys = [
  'status',
  'paddleocr',
  ...paddleOcrOutputIdentityKeys,
  'dataSizeBytes',
  'attemptsUsed',
  'error',
  'errorMessage',
] as const;

const paddleOcrHistoricalFailureKeys = [
  'status',
  'paddleocr',
  ...paddleOcrOutputIdentityKeys,
  'attemptsUsed',
  'errorMessage',
] as const;

function isPaddleOcrChunkBounds(parsed: Record<string, unknown>): boolean {
  const chunkIndex = parsed.chunkIndex;
  const chunkCount = parsed.chunkCount;
  const pageStart = parsed.pageStart;
  const pageEnd = parsed.pageEnd;
  return (
    Number.isSafeInteger(chunkIndex) &&
    Number.isSafeInteger(chunkCount) &&
    Number.isSafeInteger(pageStart) &&
    Number.isSafeInteger(pageEnd) &&
    (chunkIndex as number) >= 0 &&
    (chunkCount as number) >= 1 &&
    (pageStart as number) >= 1 &&
    (pageEnd as number) >= (pageStart as number)
  );
}

function isPaddleOcrSuccessOutput(parsed: Record<string, unknown>): boolean {
  const isCompactSuccess = hasExactKeys(parsed, paddleOcrCompactSuccessKeys);
  const isHistoricalSuccess = hasExactKeys(parsed, paddleOcrHistoricalSuccessKeys);
  const isLegacySuccess = hasExactKeys(parsed, paddleOcrLegacySuccessKeys);
  if (!isCompactSuccess && !isHistoricalSuccess && !isLegacySuccess) {
    return false;
  }
  if (
    (isCompactSuccess ? parsed.status !== 'ok' : parsed.status !== 'completed') ||
    (isCompactSuccess && parsed.paddleocr !== 'ok') ||
    (isHistoricalSuccess && parsed.paddleocr !== 'ok') ||
    parsed.ocrEngine !== 'paddleocr_vl' ||
    !isBoundedString(parsed.ocrFileKey, preflightStringMaxLength, false) ||
    !isBoundedString(parsed.filename, preflightStringMaxLength, false) ||
    !isPaddleOcrChunkBounds(parsed) ||
    !Number.isSafeInteger(isCompactSuccess ? parsed.dataSizeBytes : parsed.rawTextLength) ||
    ((isCompactSuccess ? parsed.dataSizeBytes : parsed.rawTextLength) as number) < 0
  ) {
    return false;
  }
  if (!isCompactSuccess) {
    return (
      isBoundedString(parsed.rawResultHash, 128, false) &&
      parsed.outputStorage === 'steel_working_order_memory:paddleocr_preflight'
    );
  }
  return true;
}

function isPaddleOcrFailureOutput(parsed: Record<string, unknown>): boolean {
  const isCompactFailure = hasExactKeys(parsed, paddleOcrCompactFailureKeys);
  const isCompactFailureWithCode = hasExactKeys(parsed, [
    ...paddleOcrCompactFailureKeys,
    'errorCode',
  ]);
  const isHistoricalFailure = hasExactKeys(parsed, paddleOcrHistoricalFailureKeys);
  const isHistoricalFailureWithCode = hasExactKeys(parsed, [
    ...paddleOcrHistoricalFailureKeys,
    'diagnosticCode',
  ]);
  if (
    (!isCompactFailure &&
      !isCompactFailureWithCode &&
      !isHistoricalFailure &&
      !isHistoricalFailureWithCode) ||
    (isCompactFailure || isCompactFailureWithCode
      ? parsed.status !== 'fail'
      : parsed.status !== 'failed') ||
    parsed.paddleocr !== 'fail' ||
    parsed.ocrEngine !== 'paddleocr_vl' ||
    !isBoundedString(parsed.ocrFileKey, preflightStringMaxLength, false) ||
    !isBoundedString(parsed.filename, preflightStringMaxLength, false) ||
    !isPaddleOcrChunkBounds(parsed) ||
    !Number.isSafeInteger(parsed.attemptsUsed) ||
    (parsed.attemptsUsed as number) < 1 ||
    ((isCompactFailure || isCompactFailureWithCode) &&
      (!Number.isSafeInteger(parsed.dataSizeBytes) ||
        (parsed.dataSizeBytes as number) < 0 ||
        !isBoundedString(parsed.error, 1_024) ||
        /https?:\/\//iu.test(parsed.error))) ||
    !isBoundedString(parsed.errorMessage, preflightErrorMaxLength) ||
    parsed.errorMessage.trim().length === 0 ||
    /https?:\/\//iu.test(parsed.errorMessage)
  ) {
    return false;
  }
  if (isCompactFailureWithCode) {
    return isBoundedString(parsed.errorCode, preflightDiagnosticCodeMaxLength);
  }
  if (isHistoricalFailureWithCode) {
    return isBoundedString(parsed.diagnosticCode, preflightDiagnosticCodeMaxLength);
  }
  return true;
}

function isPersistedSteelPreflightToolCall(
  value: unknown,
): value is PersistedSteelPreflightToolCall {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = ['args', 'id', 'name', 'output', 'progress', 'type'];
  if (
    !keys.every((key) => expectedKeys.includes(key)) ||
    !['args', 'id', 'name', 'progress', 'type'].every((key) => key in value)
  ) {
    return false;
  }
  if (
    value.type !== 'tool_call' ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    utf8ByteLength(value.id) > preflightStringMaxLength ||
    typeof value.name !== 'string' ||
    (value.name !== 'paddleocr_vl' &&
      !/^paddleocr_vl(?:---|_mcp_)[A-Za-z0-9_-]+$/u.test(value.name)) ||
    (value.progress !== 0 && value.progress !== 1) ||
    (value.output !== undefined && typeof value.output !== 'string')
  ) {
    return false;
  }
  const args = value.args;
  if (!isPlainObject(args)) {
    return false;
  }
  const argKeys = Object.keys(args).sort();
  if (
    argKeys.join(',') !==
    [
      ...(args.input_data !== undefined ? ['input_data'] : []),
      'output_mode',
      'return_images',
      'use_doc_orientation_classify',
      'use_doc_unwarping',
      'use_layout_detection',
    ]
      .sort()
      .join(',')
  ) {
    return false;
  }
  if (
    (args.input_data !== undefined && typeof args.input_data !== 'string') ||
    args.output_mode !== 'detailed' ||
    typeof args.return_images !== 'boolean' ||
    typeof args.use_doc_orientation_classify !== 'boolean' ||
    typeof args.use_doc_unwarping !== 'boolean' ||
    typeof args.use_layout_detection !== 'boolean'
  ) {
    return false;
  }
  if (value.output?.startsWith('Error:')) {
    return (
      utf8ByteLength(value.output) <= preflightOutputMaxBytes &&
      value.output.length <= preflightErrorMaxLength &&
      !/https?:\/\//iu.test(value.output)
    );
  }
  if (value.output !== undefined) {
    if (utf8ByteLength(value.output) > preflightOutputMaxBytes) {
      return false;
    }
    try {
      const parsed = JSON.parse(value.output);
      if (!isPlainObject(parsed)) {
        return false;
      }
      return isPaddleOcrSuccessOutput(parsed) || isPaddleOcrFailureOutput(parsed);
    } catch {
      return false;
    }
  }
  return true;
}

function clonePersistedSteelPreflightToolCall(
  value: PersistedSteelPreflightToolCall,
): TMessageContentParts {
  let runStepStatus: 'completed' | 'failed' | undefined;
  if (value.output?.startsWith('Error:')) {
    runStepStatus = 'failed';
  } else if (value.output !== undefined) {
    const parsed = JSON.parse(value.output) as Record<string, unknown>;
    runStepStatus = isPaddleOcrFailureOutput(parsed) ? 'failed' : 'completed';
  }
  return {
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      type: ToolCallTypes.TOOL_CALL,
      id: value.id,
      name: value.name,
      args: { ...value.args },
      ...(value.output !== undefined ? { output: value.output } : {}),
      ...(runStepStatus !== undefined ? { runStepStatus } : {}),
      progress: value.progress,
    },
  } as TMessageContentParts;
}

export function getPersistedSteelPreflightToolCallParts(
  metadata: TMessage['metadata'],
): TMessageContentParts[] {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.steel)) {
    return [];
  }
  const cards = metadata.steel.preflightToolCalls;
  if (!Array.isArray(cards)) {
    return [];
  }
  const seen = new Set<string>();
  const parts: TMessageContentParts[] = [];
  for (const card of cards) {
    if (seen.size >= 100) {
      break;
    }
    if (!isPersistedSteelPreflightToolCall(card) || seen.has(card.id)) {
      continue;
    }
    seen.add(card.id);
    parts.push(clonePersistedSteelPreflightToolCall(card));
  }
  return parts;
}

export function prependPersistedSteelPreflightToolCallParts(
  content: Array<TMessageContentParts | undefined> | undefined,
  persistedPreflightToolCallParts: TMessageContentParts[],
): Array<TMessageContentParts | undefined> {
  const safeContent = Array.isArray(content) ? content : [];
  if (persistedPreflightToolCallParts.length === 0) {
    return safeContent;
  }
  const existingToolCallIds = new Set<string>();
  for (const part of safeContent) {
    if (part?.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const id = (part[ContentTypes.TOOL_CALL] as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && id.length > 0) {
      existingToolCallIds.add(id);
    }
  }
  return [
    ...persistedPreflightToolCallParts.filter(
      (part) => !existingToolCallIds.has((part[ContentTypes.TOOL_CALL] as { id: string }).id),
    ),
    ...safeContent,
  ];
}
