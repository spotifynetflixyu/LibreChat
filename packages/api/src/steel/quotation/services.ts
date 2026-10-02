import { extractSteelNativeMarkdownText } from '../native/markdown';
import { steelDataSectionTitles } from './next';

export function extractSteelAgentResponseMarkdown(
  response: Parameters<typeof extractSteelNativeMarkdownText>[0],
): string {
  return extractSteelNativeMarkdownText({ ...response, sectionTitles: steelDataSectionTitles });
}
