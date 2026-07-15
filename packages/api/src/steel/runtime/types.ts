export type SteelRuntimeMessageRole = 'system' | 'user' | 'assistant';

export interface SteelRuntimeFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
  pageCount?: number;
}

export interface SteelRuntimeMessage {
  role: SteelRuntimeMessageRole;
  content: string;
  messageId?: string;
  files?: SteelRuntimeFile[];
}

export interface SteelRuntimeProviderResponse {
  provider: 'openai_oauth_responses';
  model: string;
  text: string;
  unsupportedSettings: string[];
  warnings: string[];
}
