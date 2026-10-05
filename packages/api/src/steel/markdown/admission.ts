import type { MarkdownSection, ParsedAssistantMarkdown } from './parser';
import { parseAssistantMarkdown } from './parser';

export const fullOnlyMarkdownKinds = ['ocr_result', 'system_order', 'customer_data'] as const;
export type FullOnlyMarkdownKind = (typeof fullOnlyMarkdownKinds)[number];

export const retiredMarkdownSectionTitles = [
  'ocr_result_updates',
  'ocr_deletions',
  'ocr_update_summary',
  'system_order_revision',
  'system_order_updates',
  'customer_data_updates',
] as const;

export type RetiredMarkdownSectionTitle = (typeof retiredMarkdownSectionTitles)[number];

export interface FullOnlyMarkdownAdmissionInput {
  readonly markdown: string;
  readonly kind: FullOnlyMarkdownKind;
  readonly title: string;
  readonly messageId: string;
}

export interface FullOnlyMarkdownAdmissionSuccess {
  readonly ok: true;
  readonly document: ParsedAssistantMarkdown;
  readonly target: MarkdownSection;
  readonly kind: FullOnlyMarkdownKind;
  readonly title: string;
  readonly messageId: string;
}

export type FullOnlyMarkdownAdmissionFailureCode =
  | 'invalid_target'
  | 'retired_control_section'
  | 'missing_full_target'
  | 'duplicate_full_target';

export interface FullOnlyMarkdownAdmissionFailure {
  readonly ok: false;
  readonly code: FullOnlyMarkdownAdmissionFailureCode;
  readonly retiredTitles?: readonly RetiredMarkdownSectionTitle[];
}

export type FullOnlyMarkdownAdmission =
  | FullOnlyMarkdownAdmissionSuccess
  | FullOnlyMarkdownAdmissionFailure;

function baseTitle(title: string): string {
  return title.split(/[｜|]/u)[0]?.trim() ?? '';
}

function isFullOnlyKind(value: string): value is FullOnlyMarkdownKind {
  return fullOnlyMarkdownKinds.includes(value as FullOnlyMarkdownKind);
}

function retiredTitle(title: string): RetiredMarkdownSectionTitle | undefined {
  const base = baseTitle(title);
  return retiredMarkdownSectionTitles.includes(base as RetiredMarkdownSectionTitle)
    ? base as RetiredMarkdownSectionTitle
    : undefined;
}

/**
 * Admit one exact, unfenced full Markdown target and reject retired control sections.
 * The parser deliberately only sees real H2 headings, so fenced examples and quoted
 * historical prose remain ordinary model content.
 */
export function admitFullOnlyMarkdown(
  input: FullOnlyMarkdownAdmissionInput,
): FullOnlyMarkdownAdmission {
  const title = input.title.trim();
  const messageId = input.messageId.trim();
  if (!isFullOnlyKind(input.kind) || !title || !messageId || baseTitle(title) !== input.kind) {
    return { ok: false, code: 'invalid_target' };
  }

  const document = parseAssistantMarkdown(input.markdown);
  const retiredTitles = [...new Set(document.sections
    .map((section) => retiredTitle(section.title))
    .filter((section): section is RetiredMarkdownSectionTitle => section !== undefined))];
  if (retiredTitles.length > 0) {
    return { ok: false, code: 'retired_control_section', retiredTitles };
  }

  const fullSections = document.sections.filter((section) => baseTitle(section.title) === input.kind);
  if (fullSections.length === 0) {
    return { ok: false, code: 'missing_full_target' };
  }
  if (fullSections.length !== 1 || fullSections[0]?.title !== title) {
    return { ok: false, code: 'duplicate_full_target' };
  }

  return {
    ok: true,
    document,
    target: fullSections[0],
    kind: input.kind,
    title,
    messageId,
  };
}
