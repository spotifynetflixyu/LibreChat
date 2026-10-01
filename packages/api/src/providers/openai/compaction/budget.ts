import { isJSONObject } from '@ai-sdk/provider';
import type { JSONValue } from '@ai-sdk/provider';

export type TextTokenCounter = (text: string) => number;

export interface TokenEstimate {
  readonly knownTokens: number;
  readonly uncertain: boolean;
}

// Estimate v1: tokenize provider-visible JSON and plaintext, plus 32 tokens of
// framing per item/envelope. Bounded o200k counts approximate native OAuth;
// ciphertext and media costs are unknown and cannot prove local overflow.
const FRAMING_TOKENS = 32;
const mediaTypes = new Set([
  'input_image',
  'input_file',
  'input_audio',
  'input_video',
  'image_url',
  'file',
  'audio',
  'video',
]);

export function estimateTokens(value: JSONValue, countText: TextTokenCounter): TokenEstimate {
  let uncertain = false;
  const project = (item: JSONValue): JSONValue => {
    if (Array.isArray(item)) return item.map(project);
    if (!isJSONObject(item)) return item;
    if (typeof item.type === 'string' && mediaTypes.has(item.type)) {
      uncertain = true;
      return { type: item.type, ...(typeof item.detail === 'string' && { detail: item.detail }) };
    }
    const projected: Record<string, JSONValue> = {};
    for (const [key, child] of Object.entries(item)) {
      if (child === undefined) continue;
      if (key === 'encrypted_content') {
        uncertain = true;
        continue;
      }
      projected[key] = project(child);
    }
    return projected;
  };
  const text = JSON.stringify(project(value));
  return { knownTokens: countText(text) + FRAMING_TOKENS, uncertain };
}
