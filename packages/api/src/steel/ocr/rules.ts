import { createHash } from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import type { SteelRepositoryClient } from '../repositories/types';
import type { SteelOcrPreprocessingRules } from './files';
import { createSteelContextDependencies } from '../native/context';
import { resolveOcrOrganizerRulesText } from './organizer';

function renderSteelOcrRule(rule: { title?: string; prompt?: string }): string {
  return [`## ${rule.title || 'OCR rule'}`, rule.prompt]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Loads the shared, vision and organizer OCR rules for preprocessing. A rules
 * outage fails open with empty rules so OCR still runs.
 */
export async function resolveSteelOcrPreprocessingRules(
  client: SteelRepositoryClient,
): Promise<SteelOcrPreprocessingRules> {
  let otherRules;
  try {
    otherRules = await createSteelContextDependencies({
      runtimeRulesClient: client,
    }).listOtherGlobalRules();
  } catch (error) {
    logger.warn('[Steel OCR] Failed to load OCR rules for preprocessing; continuing fail-open', {
      error: error instanceof Error ? error.message : undefined,
    });
    return { ocrRulesText: '', ocrRuleVersion: 'ocr-rules:unavailable' };
  }

  const renderedRules = [
    ...(otherRules.ocrSharedRules ?? []),
    ...(otherRules.ocrVisionRules ?? []),
    ...(otherRules.ocrOrganizerRules ?? []),
  ]
    .map(renderSteelOcrRule)
    .join('\n\n')
    .trim();
  const versionHash = createHash('sha256')
    .update(resolveOcrOrganizerRulesText(renderedRules))
    .digest('hex');
  return { ocrRulesText: renderedRules, ocrRuleVersion: `ocr-rules:${versionHash}` };
}
