import type { TMessage } from 'librechat-data-provider';

export function preferDefinedString(value?: string | null, fallback?: string): string | undefined {
  return value != null && value !== '' ? value : fallback;
}

export function toResumeTimestamp(value?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

export function withResumeTimestamp(message: TMessage, timestamp?: string): TMessage {
  if (!timestamp) {
    return message;
  }
  return {
    ...message,
    createdAt: message.createdAt ?? timestamp,
    clientTimestamp: message.clientTimestamp ?? timestamp,
  };
}
