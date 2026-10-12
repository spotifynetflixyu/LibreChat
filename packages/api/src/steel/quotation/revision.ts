import { createHash } from 'node:crypto';
import type {
  SteelQuotationCurrentSystemOrder,
  SteelQuotationOcrSelection,
} from '@librechat/data-schemas';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { parseMarkdownTables } from '../markdown/table';
import { parseAssistantMarkdown } from '../ocr/result';
import { sameQuotationOcrSource } from './input';

const DECIMAL_PATTERN = /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/u;
const NUMERIC_HEADERS = new Set(['數量', '單重', '總數', '單價', '厚度', '寬度', '長度', '肚']);

export interface CurrentSystemOrderState {
  currentOrder?: { sha256: string; ocrSelection?: SteelQuotationOcrSelection };
  currentCustomer?: { customerIdentity: string; customerMarkdown: string };
  tickets?: readonly {
    acceptedRunId?: string;
    orderHash: string;
    customerIdentity?: string;
    customerMarkdown?: string;
  }[];
  activeRun?: {
    runId: string;
    status: string;
    targetMessageId?: string;
    ocrSelection?: SteelQuotationOcrSelection;
  };
  currentSystemOrder?: SteelQuotationCurrentSystemOrder;
  updatedAt?: Date;
}

export function isCurrentSystemOrderRun(state?: CurrentSystemOrderState | null): boolean {
  const run = state?.activeRun;
  return run?.status === 'completed' && !state?.currentSystemOrder?.needsRequote &&
    sameQuotationOcrSource(run.ocrSelection, state?.currentOrder?.ocrSelection) && Boolean(state?.currentOrder?.sha256) &&
    Boolean(state?.currentCustomer) && state?.tickets?.some((ticket) => ticket.acceptedRunId === run.runId &&
      ticket.orderHash === state.currentOrder?.sha256 &&
      ticket.customerIdentity === state.currentCustomer?.customerIdentity &&
      ticket.customerMarkdown === state.currentCustomer?.customerMarkdown) === true;
}

interface ParsedSystemOrder {
  heading: string;
  headers: string[];
  rows: string[][];
}

function sectionBaseName(title: string): string {
  return title.split('｜', 1)[0]?.trim() ?? '';
}

function validDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

function validCell(header: string, value: string): boolean {
  if (value === '') return true;
  if (NUMERIC_HEADERS.has(header)) return validDecimal(value);
  if (header === '計價基準') return /^\d+(?:\.\d+)?$|^[A-F]$/u.test(value.toUpperCase());
  return true;
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const header = `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function parseSystemOrder(markdown: string): ParsedSystemOrder | undefined {
  const sections = parseAssistantMarkdown(markdown).sections.filter(
    (section) => sectionBaseName(section.title) === 'system_order',
  );
  if (sections.length !== 1) return undefined;
  const section = sections[0];
  if (!section) return undefined;
  const tables = parseMarkdownTables(section.body);
  if (tables.length !== 1) return undefined;
  const table = tables[0];
  if (!table || table.headers.length === 0 || new Set(table.headers).size !== table.headers.length) {
    return undefined;
  }
  const headers = table.headers.map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) return undefined;
  const rows = table.rows.map((row) => row.map((value) => value.trim()));
  if (rows.some((row) => row.length !== headers.length)) return undefined;
  if (rows.some((row) => row.some((value, index) => !validCell(headers[index] ?? '', value)))) {
    return undefined;
  }
  return { heading: `## ${section.title.trim()}`, headers, rows };
}

function canonicalSystemOrder(parsed: ParsedSystemOrder): string {
  return `${parsed.heading}\n\n${renderTable(parsed.headers, parsed.rows)}`;
}

function canonicalSnapshot(markdown: string): { markdown: string; sha256: string; parsed: ParsedSystemOrder } | undefined {
  const parsed = parseSystemOrder(markdown);
  if (!parsed) return undefined;
  const normalized = canonicalSystemOrder(parsed);
  return {
    markdown: normalized,
    sha256: createHash('sha256').update(normalized, 'utf8').digest('hex'),
    parsed,
  };
}

export function canonicalizeSystemOrderMarkdown(
  markdown: string,
): { markdown: string; sha256: string } | undefined {
  const canonical = canonicalSnapshot(markdown);
  return canonical ? { markdown: canonical.markdown, sha256: canonical.sha256 } : undefined;
}
