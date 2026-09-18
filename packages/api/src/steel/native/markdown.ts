import type { Response } from '../../agents/responses/types';
import { parseAssistantMarkdown } from '../ocr/result';

function getStringProperty(value: unknown, key: string): string | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}

function getNestedStringProperty(
  value: unknown,
  key: string,
  nestedKey: string,
): string | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }

  return getStringProperty((value as Record<string, unknown>)[key], nestedKey);
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      return (
        getStringProperty(part, 'text') ?? getNestedStringProperty(part, 'text', 'value') ?? ''
      );
    })
    .join('');
}

function extractOutputContentText(part: unknown): string {
  const type = getStringProperty(part, 'type');
  if (type !== 'output_text' && type !== 'text') {
    return '';
  }

  return getStringProperty(part, 'text') ?? '';
}

export function extractSteelNativeMarkdownText({
  text,
  content,
  sectionTitle,
}: {
  text?: string | null;
  content?: unknown;
  sectionTitle?: string;
}): string {
  const contentText = extractContentText(content);
  if (sectionTitle) {
    const hasSection = (markdown: string) => parseAssistantMarkdown(markdown).sections
      .some((section) => section.title === sectionTitle);
    if (!hasSection(text ?? '') && hasSection(contentText)) {
      return contentText;
    }
  }
  if (typeof text === 'string' && text.trim().length > 0) {
    return text;
  }

  return contentText;
}

export function extractSteelNativeResponseOutputText(response: Pick<Response, 'output'>): string {
  return response.output
    .map((item) => {
      if (item.type !== 'message') {
        return '';
      }

      return item.content.map(extractOutputContentText).join('');
    })
    .join('');
}
