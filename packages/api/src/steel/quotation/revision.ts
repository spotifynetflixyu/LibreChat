import { createHash } from 'node:crypto';
import type {
  SteelQuotationCurrentSystemOrder,
  SteelQuotationSourceSnapshot,
  SteelQuotationOcrSelection,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import { retiredMarkdownSectionTitles } from '../markdown/admission';
import { normalizeSystemOrderMarkdown } from '../markdown/order';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { parseMarkdownTables } from '../markdown/table';
import { parseAssistantMarkdown } from '../ocr/result';
import { sameQuotationOcrSource } from './input';

const MAX_RESPONSE_ID_BYTES = 300;
const MAX_MESSAGE_ID_BYTES = 1_000;
const DECIMAL_PATTERN = /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/u;
const NUMERIC_HEADERS = new Set(['數量', '單重', '總數', '單價', '厚度', '寬度', '長度', '肚']);

export type SystemOrderRevisionFailureCode =
  | 'no_revision'
  | 'missing_current_system_order'
  | 'unfinished_active_run'
  | 'stale_run'
  | 'invalid_revision'
  | 'invalid_updates'
  | 'invalid_base_hash'
  | 'duplicate_row_index'
  | 'out_of_range_row_index'
  | 'invalid_number'
  | 'dependent_total_required'
  | 'concurrent_change'
  | 'invalid_system_order'
  | 'retired_control_section';

export interface SystemOrderRevisionFailure {
  ok: false;
  code: SystemOrderRevisionFailureCode;
}

export interface SystemOrderRevisionSuccess {
  ok: true;
  markdown: string;
  snapshot: SteelQuotationCurrentSystemOrder;
  customerQuoteMarkdown: string;
}

export type SystemOrderRevisionResult = SystemOrderRevisionSuccess | SystemOrderRevisionFailure;

export interface PreparedSystemOrderRevisionSuccess extends SystemOrderRevisionSuccess {
  commit(): Promise<SystemOrderRevisionResult>;
}

export type SystemOrderRevisionPreparation =
  | PreparedSystemOrderRevisionSuccess
  | SystemOrderRevisionFailure;

export type SystemOrderRevisionPreparedSuccess = PreparedSystemOrderRevisionSuccess;

export interface SystemOrderRevisionState {
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

export function isCurrentSystemOrderRun(state?: SystemOrderRevisionState | null): boolean {
  const run = state?.activeRun;
  return run?.status === 'completed' && !state?.currentSystemOrder?.needsRequote &&
    sameQuotationOcrSource(run.ocrSelection, state?.currentOrder?.ocrSelection) && Boolean(state?.currentOrder?.sha256) &&
    state?.tickets?.some((ticket) => ticket.acceptedRunId === run.runId &&
      ticket.orderHash === state.currentOrder?.sha256 && (!state.currentCustomer ||
        (ticket.customerIdentity === state.currentCustomer.customerIdentity &&
          ticket.customerMarkdown === state.currentCustomer.customerMarkdown))) === true;
}

export interface SystemOrderRevisionSaveInput {
  scope: SteelQuotationScope;
  snapshot: SteelQuotationCurrentSystemOrder;
  expectedRunId: string;
  expectedCurrentOrderSha256: string;
  expectedCustomer?: { customerIdentity: string; customerMarkdown: string };
  expectedCurrentSystemOrderSha256?: string;
  expectedCurrentSystemOrderPresent: boolean;
}

export interface SystemOrderRevisionDependencies {
  read(scope: SteelQuotationScope): Promise<SystemOrderRevisionState | null>;
  readCurrentSystemOrder(scope: SteelQuotationScope): Promise<SteelQuotationCurrentSystemOrder | undefined>;
  readCheckpoint(input: {
    scope: SteelQuotationScope;
    runId: string;
    operationId: string;
  }): Promise<string | undefined>;
  saveCurrentSystemOrder(
    input: SystemOrderRevisionSaveInput,
  ): Promise<SteelQuotationCurrentSystemOrder | undefined>;
  sourceSnapshot?: SteelQuotationSourceSnapshot;
}

export interface SystemOrderRevisionFinalizeInput {
  scope: SteelQuotationScope;
  response: string;
  responseId: string;
  messageId?: string;
  now?: Date;
}

export interface SystemOrderRevisionService {
  readCurrentSystemOrder(
    scope: SteelQuotationScope,
    preloadedState?: SystemOrderRevisionState | null,
  ): Promise<SteelQuotationCurrentSystemOrder | undefined>;
  formatSystemOrderRevisionInstruction(snapshot: SteelQuotationCurrentSystemOrder): string;
  prepareSystemOrderUpdates(
    input: SystemOrderRevisionFinalizeInput,
  ): Promise<SystemOrderRevisionPreparation>;
  finalizeSystemOrderUpdates(
    input: SystemOrderRevisionFinalizeInput,
  ): Promise<SystemOrderRevisionResult>;
}

interface ParsedSystemOrder {
  heading: string;
  headers: string[];
  rows: string[][];
}

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function normalizeScope(scope: SteelQuotationScope): void {
  if (!scope.userId || !scope.conversationId || (scope.tenantId !== undefined && !scope.tenantId)) {
    throw new Error('quotation scope requires userId and conversationId');
  }
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

function fail(code: SystemOrderRevisionFailureCode): SystemOrderRevisionFailure {
  return { ok: false, code };
}

function formatSnapshot(snapshot: SteelQuotationCurrentSystemOrder): string {
  const canonical = canonicalSnapshot(snapshot.markdown);
  if (!canonical) return snapshot.markdown.trimEnd();
  return canonical.markdown;
}

export function formatSystemOrderRevisionInstruction(
  snapshot: SteelQuotationCurrentSystemOrder,
): string {
  const canonical = canonicalSnapshot(snapshot.markdown);
  return [
    canonical?.markdown ?? formatSnapshot(snapshot),
    'For any system-order correction, output one complete ## system_order table using the existing pricing rules and confirmed customer context. Do not output system_order_revision or system_order_updates.',
  ].join('\n\n');
}

export function createSystemOrderRevisionService(
  dependencies: SystemOrderRevisionDependencies,
): SystemOrderRevisionService {
  async function readCurrentSystemOrder(
    scope: SteelQuotationScope,
    preloadedState?: SystemOrderRevisionState | null,
  ): Promise<SteelQuotationCurrentSystemOrder | undefined> {
    normalizeScope(scope);
    const state = preloadedState ?? await dependencies.read(scope);
    const activeRun = state?.activeRun;
    if (!activeRun || !isCurrentSystemOrderRun(state)) return undefined;

    const stored = state.currentSystemOrder;
    if (stored && stored.runId === activeRun.runId) {
      const canonical = canonicalSnapshot(stored.markdown);
      if (canonical && canonical.sha256 === stored.sha256) {
        return { ...stored, markdown: canonical.markdown };
      }
      return undefined;
    }

    const finalMarkdown = await dependencies.readCheckpoint({
      scope,
      runId: activeRun.runId,
      operationId: 'final',
    });
    if (!finalMarkdown) return undefined;
    const canonical = canonicalSnapshot(finalMarkdown);
    if (!canonical) return undefined;
    return {
      runId: activeRun.runId,
      sha256: canonical.sha256,
      markdown: canonical.markdown,
      ...(activeRun.targetMessageId ? { messageId: activeRun.targetMessageId } : {}),
      ...(state?.updatedAt ? { updatedAt: new Date(state.updatedAt) } : { updatedAt: new Date() }),
    };
  }

  async function prepareSystemOrderUpdates(
    input: SystemOrderRevisionFinalizeInput,
  ): Promise<SystemOrderRevisionPreparation> {
    normalizeScope(input.scope);
    if (!input.responseId || bytes(input.responseId) > MAX_RESPONSE_ID_BYTES) {
      throw new Error('responseId must not be empty and must fit the response id limit');
    }
    if (input.messageId !== undefined && (!input.messageId || bytes(input.messageId) > MAX_MESSAGE_ID_BYTES)) {
      throw new Error('messageId must not be empty and must fit the message id limit');
    }

    const response = normalizeSystemOrderMarkdown(input.response);
    const responseSections = parseAssistantMarkdown(response).sections;
    const hasRetiredControl = responseSections.some((section) =>
      retiredMarkdownSectionTitles.includes(
        sectionBaseName(section.title) as (typeof retiredMarkdownSectionTitles)[number],
      ),
    );
    if (hasRetiredControl) return fail('retired_control_section');

    // This service is retained as a read-only compatibility boundary for callers
    // that still need the current frozen order. Corrections are admitted and
    // published by the full-output completion transaction; row deltas never reach
    // current state or customer-quote mirrors here.
    return fail('no_revision');
  }

  async function finalizeSystemOrderUpdates(
    input: SystemOrderRevisionFinalizeInput,
  ): Promise<SystemOrderRevisionResult> {
    const prepared = await prepareSystemOrderUpdates(input);
    if (!prepared.ok) return prepared;
    return prepared.commit();
  }

  return {
    readCurrentSystemOrder,
    formatSystemOrderRevisionInstruction,
    prepareSystemOrderUpdates,
    finalizeSystemOrderUpdates,
  };
}
