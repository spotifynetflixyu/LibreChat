import { steelQuotationMessagePublicationSchema } from 'librechat-data-provider';
import type { IMessage } from '~/types';

export function quotationTextContentIndex(metadata: IMessage['metadata']): number | undefined {
  if (!metadata?.steelQuotation) return undefined;
  const publication = steelQuotationMessagePublicationSchema.safeParse(metadata.steelQuotation);
  return publication.success ? publication.data.tableContentIndex : undefined;
}

export function renderMessageTextContent(content: readonly unknown[], quotationContentIndex?: number): string {
  let rendered = '';
  for (let index = 0; index < content.length; index++) {
    const part = content[index];
    if (!part || typeof part !== 'object' || Array.isArray(part) || Reflect.get(part, 'type') !== 'text') continue;
    const text = Reflect.get(part, 'text');
    if (typeof text !== 'string' || text.length === 0) continue;
    if (rendered.length === 0) {
      rendered = text;
      continue;
    }
    let separator = rendered.endsWith(' ') || text.startsWith(' ') ? '' : ' ';
    if (quotationContentIndex !== undefined && index >= quotationContentIndex) separator = '\n\n';
    rendered += `${separator}${text}`;
  }
  return rendered;
}

export function hasConsistentMessageText(message: Pick<IMessage, 'text' | 'content' | 'metadata'>): boolean {
  if (typeof message.text !== 'string' || !Array.isArray(message.content)) return false;
  const legacy = renderMessageTextContent(message.content);
  const quotationIndex = quotationTextContentIndex(message.metadata);
  if (quotationIndex === undefined) return legacy === message.text;
  const text = message.text.trim();
  return renderMessageTextContent(message.content, quotationIndex).trim() === text || legacy.trim() === text;
}
