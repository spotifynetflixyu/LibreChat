import { z } from 'zod';
import type { SteelReviewMarkdownTable } from './review-markdown';
import type { TMessage } from '../schemas';
import { parseSteelReviewMarkdownTables } from './review-markdown';

export const steelCustomerQuerySchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  title: z.string().regex(/^customer_data(?:[\s｜:：([{]|$)/),
  outputId: z.string().min(1),
}).strict();
export const steelCustomerTierSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
export const steelCustomerCommitSchema = steelCustomerQuerySchema.extend({
  revision: z.string().min(1),
  tier: steelCustomerTierSchema,
  expectedTier: steelCustomerTierSchema,
}).strict();
export type SteelCustomerQuery = z.infer<typeof steelCustomerQuerySchema>;
export type SteelCustomerCommit = z.infer<typeof steelCustomerCommitSchema>;
export type SteelCustomerTier = z.infer<typeof steelCustomerTierSchema>;
export interface SteelCustomerResponse extends SteelCustomerQuery {
  revision: string;
  tier: SteelCustomerTier;
  latest: boolean;
}
export interface SteelCustomerSaveResponse extends SteelCustomerResponse {
  message: Pick<TMessage, 'messageId' | 'text' | 'content'>;
}
export type SteelCustomerErrorCode =
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_INVALID_TABLE'
  | 'CUSTOMER_HISTORICAL'
  | 'CUSTOMER_CONFLICT'
  | 'CUSTOMER_BUSY';
export type SteelCustomerResult<T> = { ok: true; value: T } | {
  ok: false;
  code: SteelCustomerErrorCode;
};

export function readSteelCustomerTable(markdown: string, title: string): {
  table: SteelReviewMarkdownTable;
  column: number;
  tier: SteelCustomerTier;
} | null {
  const tables = parseSteelReviewMarkdownTables(markdown).filter((table) => table.title === title);
  if (tables.length !== 1) return null;
  const table = tables[0];
  const columns = table.headers.flatMap((header, index) =>
    header.trim().replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1') === '價格等級' ? [index] : []);
  if (columns.length !== 1 || table.rows.length !== 1 || table.rows[0].length !== table.headers.length) return null;
  const column = columns[0];
  const parsed = steelCustomerTierSchema.safeParse(table.rows[0][column].trim().replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1'));
  return parsed.success ? { table, column, tier: parsed.data } : null;
}

/** Updates the selected tier and its description, retaining the surrounding Markdown. */
export function updateSteelCustomerTier(markdown: string, title: string, tier: SteelCustomerTier): string | null {
  const parsed = readSteelCustomerTable(markdown, title);
  if (!parsed) return null;
  const lines = parsed.table.raw.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  const row = lines[2];
  if (!row) return null;
  const pipes: number[] = [];
  for (let index = 0; index < row.length; index++) {
    if (row[index] === '\\') { index++; continue; }
    if (row[index] === '|') pipes.push(index);
  }
  const descriptions = parsed.table.headers.flatMap((header, index) =>
    header.trim().replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1') === '說明' ? [index] : []);
  if (descriptions.length > 1) return null;
  const edits = [
    { column: parsed.column, value: tier, formatted: true },
    ...descriptions.map((column) => ({ column, value: `指定為${tier}等級`, formatted: false })),
  ].sort((left, right) => right.column - left.column);
  const leading = row.trimStart().startsWith('|');
  let next = row;
  for (const edit of edits) {
    const start = edit.column === 0 && !leading ? 0 : pipes[edit.column - (leading ? 0 : 1)] + 1;
    const end = pipes[edit.column + (leading ? 1 : 0)] ?? row.replace(/\r?\n$/, '').length;
    if (!Number.isFinite(start) || end < start) return null;
    const cell = row.slice(start, end);
    const wrapper = edit.formatted ? cell.trim().match(/^(\*\*|__)[A-F]\1$/)?.[1] ?? '' : '';
    next = `${next.slice(0, start)}${cell.match(/^\s*/)?.[0] ?? ''}${wrapper}${edit.value}${wrapper}${cell.match(/\s*$/)?.[0] ?? ''}${next.slice(end)}`;
  }
  lines[2] = next;
  const replacement = lines.join('');
  return `${markdown.slice(0, parsed.table.start)}${replacement}${markdown.slice(parsed.table.end)}`;
}
