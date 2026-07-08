import { Constants } from 'librechat-data-provider';

export function isOAuthToolCallName(name: unknown): name is string {
  return typeof name === 'string' && name.startsWith(`oauth${Constants.mcp_delimiter}`);
}
