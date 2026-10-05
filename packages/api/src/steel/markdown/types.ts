import type { SteelMarkdownPublicationInput, SteelMarkdownPublicationResult } from '@librechat/data-schemas';

export type SteelFullPublication = Omit<SteelMarkdownPublicationInput, 'message' | 'saveContext'> & { markdown: string; parentMessageId?: string };
export type SteelFullPublisher = (input: SteelFullPublication) => Promise<SteelMarkdownPublicationResult>;
