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
    output_mode: 'detailed';
    return_images: boolean;
    use_doc_orientation_classify: boolean;
    use_doc_unwarping: boolean;
    use_layout_detection: boolean;
  };
  output?: string;
  progress: 0 | 1;
};

function isPersistedSteelPreflightToolCall(
  value: unknown,
): value is PersistedSteelPreflightToolCall {
  if (!isPlainObject(value)) {
    return false;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > 4 * 1024) {
      return false;
    }
  } catch {
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
    new TextEncoder().encode(value.id).length > 256 ||
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
    args.output_mode !== 'detailed' ||
    typeof args.return_images !== 'boolean' ||
    typeof args.use_doc_orientation_classify !== 'boolean' ||
    typeof args.use_doc_unwarping !== 'boolean' ||
    typeof args.use_layout_detection !== 'boolean'
  ) {
    return false;
  }
  if (value.output?.startsWith('Error:')) {
    return value.output.length <= 512 && !/https?:\/\//iu.test(value.output);
  }
  if (value.output !== undefined) {
    try {
      const parsed = JSON.parse(value.output);
      if (!isPlainObject(parsed)) {
        return false;
      }
      const outputKeys = Object.keys(parsed).sort();
      const expectedOutputKeys = [
        'chunkCount',
        'chunkIndex',
        'filename',
        'ocrEngine',
        'ocrFileKey',
        'outputStorage',
        'pageEnd',
        'pageStart',
        'rawResultHash',
        'rawTextLength',
        'status',
      ].sort();
      if (outputKeys.join(',') !== expectedOutputKeys.join(',')) {
        return false;
      }
      const chunkIndex = parsed.chunkIndex;
      const chunkCount = parsed.chunkCount;
      const pageStart = parsed.pageStart;
      const pageEnd = parsed.pageEnd;
      const rawTextLength = parsed.rawTextLength;
      return (
        parsed.status === 'completed' &&
        parsed.ocrEngine === 'paddleocr_vl' &&
        parsed.outputStorage === 'steel_working_order_memory:paddleocr_preflight' &&
        typeof parsed.ocrFileKey === 'string' &&
        parsed.ocrFileKey.length <= 256 &&
        typeof parsed.filename === 'string' &&
        parsed.filename.length <= 256 &&
        typeof parsed.rawResultHash === 'string' &&
        parsed.rawResultHash.length <= 128 &&
        Number.isSafeInteger(chunkIndex) &&
        Number.isSafeInteger(chunkCount) &&
        Number.isSafeInteger(pageStart) &&
        Number.isSafeInteger(pageEnd) &&
        Number.isSafeInteger(rawTextLength) &&
        (chunkIndex as number) >= 0 &&
        (chunkCount as number) >= 1 &&
        (pageStart as number) >= 1 &&
        (pageEnd as number) >= (pageStart as number) &&
        (rawTextLength as number) >= 0
      );
    } catch {
      return false;
    }
  }
  return true;
}

function clonePersistedSteelPreflightToolCall(
  value: PersistedSteelPreflightToolCall,
): TMessageContentParts {
  return {
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      type: ToolCallTypes.TOOL_CALL,
      id: value.id,
      name: value.name,
      args: { ...value.args },
      ...(value.output !== undefined ? { output: value.output } : {}),
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
