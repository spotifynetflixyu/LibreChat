import { createHash } from 'node:crypto';
import type {
  SteelQuotationCurrentSystemOrder,
  SteelQuotationScope,
} from '@librechat/data-schemas';
import { buildCustomerQuoteFromMarkdown } from '../markdown/quote';
import { normalizeSystemOrderMarkdown } from '../markdown/order';
import { escapeMarkdownTableCell } from '../markdown/row-codec';
import { parseMarkdownTables } from '../markdown/table';
import { parseAssistantMarkdown } from '../ocr/result';

const MAX_RESPONSE_ID_BYTES = 300;
const MAX_MESSAGE_ID_BYTES = 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
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
  | 'invalid_system_order';

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
  currentOrder?: { sha256: string };
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
  };
  currentSystemOrder?: SteelQuotationCurrentSystemOrder;
  updatedAt?: Date;
}

export function isCurrentSystemOrderRun(state?: SystemOrderRevisionState | null): boolean {
  const run = state?.activeRun;
  return run?.status === 'completed' && Boolean(state?.currentOrder?.sha256) &&
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

interface ParsedUpdate {
  baseHash: string;
  rowIndex: number;
  values: string[];
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

function fail(code: SystemOrderRevisionFailureCode): SystemOrderRevisionFailure {
  return { ok: false, code };
}

function rowIndex(value: string): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseUpdatesSection(
  response: string,
  expected: ParsedSystemOrder,
): ParsedUpdate[] | SystemOrderRevisionFailure {
  const sections = parseAssistantMarkdown(response).sections.filter(
    (section) => sectionBaseName(section.title) === 'system_order_updates',
  );
  if (sections.length !== 1) return fail('invalid_updates');
  const section = sections[0];
  if (!section) return fail('invalid_updates');
  const tables = parseMarkdownTables(section.body);
  if (tables.length !== 1) return fail('invalid_updates');
  const table = tables[0];
  if (!table || table.rows.length === 0 || table.headers.length !== expected.headers.length + 2 ||
    table.headers[0] !== 'base_hash' || table.headers[1] !== 'row_index' ||
    JSON.stringify(table.headers.slice(2)) !== JSON.stringify(expected.headers)) {
    return fail('invalid_updates');
  }
  const updates: ParsedUpdate[] = [];
  const seen = new Set<number>();
  for (const row of table.rows) {
    if (row.length !== table.headers.length) return fail('invalid_updates');
    const baseHash = row[0]?.trim() ?? '';
    if (!SHA256_PATTERN.test(baseHash)) return fail('invalid_base_hash');
    const index = rowIndex(row[1]?.trim() ?? '');
    if (index === undefined) return fail('invalid_updates');
    if (seen.has(index)) return fail('duplicate_row_index');
    if (index > expected.rows.length) return fail('out_of_range_row_index');
    const values = row.slice(2).map((value) => value.trim());
    if (values.some((value, valueIndex) => !validCell(expected.headers[valueIndex] ?? '', value))) {
      return fail('invalid_number');
    }
    seen.add(index);
    updates.push({ baseHash, rowIndex: index, values });
  }
  return updates;
}

function formatSnapshot(snapshot: SteelQuotationCurrentSystemOrder): string {
  const canonical = canonicalSnapshot(snapshot.markdown);
  if (!canonical) return snapshot.markdown.trimEnd();
  return canonical.markdown;
}

function revisionResponse(snapshot: SteelQuotationCurrentSystemOrder): string {
  const count = parseSystemOrder(snapshot.markdown)?.rows.length ?? 0;
  return [
    formatSnapshot(snapshot),
    snapshot.customerQuoteMarkdown,
    `## quote_summary\n\n報價表修正完成：共 ${count} 筆 system_order。`,
  ].filter(Boolean).join('\n\n');
}

export function formatSystemOrderRevisionInstruction(
  snapshot: SteelQuotationCurrentSystemOrder,
): string {
  const canonical = canonicalSnapshot(snapshot.markdown);
  const markdown = canonical?.markdown ?? formatSnapshot(snapshot);
  const rows = canonical?.parsed.rows ?? [];
  const revisionRows = rows.map((_, index) => `| ${snapshot.sha256} | ${index + 1} |`);
  return [
    markdown,
    '',
    '## system_order_revision',
    '',
    '| base_hash | row_index |',
    '| --- | --- |',
    ...revisionRows,
  ].join('\n');
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
    const hasRevision = responseSections.some(
      (section) => sectionBaseName(section.title) === 'system_order_updates',
    );
    if (!hasRevision) return fail('no_revision');
    if (responseSections.some((section) => sectionBaseName(section.title) === 'system_order')) {
      return fail('invalid_revision');
    }

    const state = await dependencies.read(input.scope);
    if (state?.activeRun && state.activeRun.status !== 'completed') {
      return fail('unfinished_active_run');
    }
    const current = await readCurrentSystemOrder(input.scope, state);
    if (!current) return fail('missing_current_system_order');
    if (current.responseId === input.responseId) {
      const result: SystemOrderRevisionSuccess = {
        ok: true,
        markdown: revisionResponse(current),
        snapshot: current,
        customerQuoteMarkdown: current.customerQuoteMarkdown ?? '',
      };
      return {
        ...result,
        commit: async () => result,
      };
    }

    const activeRun = state?.activeRun;
    if (!activeRun || activeRun.status !== 'completed') return fail('unfinished_active_run');
    if (!state?.currentOrder) return fail('stale_run');
    if (activeRun.runId !== current.runId) return fail('stale_run');

    const currentParsed = canonicalSnapshot(current.markdown);
    if (!currentParsed || currentParsed.sha256 !== current.sha256) return fail('invalid_system_order');
    const updates = parseUpdatesSection(response, currentParsed.parsed);
    if (!Array.isArray(updates)) return updates;
    for (const update of updates) {
      if (update.baseHash !== current.sha256) return fail('invalid_base_hash');
    }

    const rows = currentParsed.parsed.rows.map((row) => [...row]);
    for (const update of updates) {
      const row = rows[update.rowIndex - 1];
      if (!row) return fail('out_of_range_row_index');
      rows[update.rowIndex - 1] = update.values;
    }

    const markdown = canonicalSystemOrder({
      heading: currentParsed.parsed.heading,
      headers: currentParsed.parsed.headers,
      rows,
    });
    const quote = buildCustomerQuoteFromMarkdown(markdown);
    if (!quote) return fail('invalid_system_order');
    const now = input.now ? new Date(input.now) : new Date();
    const snapshot: SteelQuotationCurrentSystemOrder = {
      runId: current.runId,
      sha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
      markdown,
      ...(input.messageId ?? current.messageId
        ? { messageId: input.messageId ?? current.messageId }
        : {}),
      responseId: input.responseId,
      customerQuoteMarkdown: quote.markdown,
      updatedAt: now,
    };
    const saveInput: SystemOrderRevisionSaveInput = {
      scope: input.scope,
      snapshot,
      expectedRunId: current.runId,
      expectedCurrentOrderSha256: state.currentOrder.sha256,
      ...(state.currentCustomer ? { expectedCustomer: {
        customerIdentity: state.currentCustomer.customerIdentity,
        customerMarkdown: state.currentCustomer.customerMarkdown,
      } } : {}),
      ...(state?.currentSystemOrder?.sha256
        ? { expectedCurrentSystemOrderSha256: state.currentSystemOrder.sha256 }
        : {}),
      expectedCurrentSystemOrderPresent: state?.currentSystemOrder !== undefined,
    };
    let committed: SystemOrderRevisionResult | undefined;
    const commit = async (): Promise<SystemOrderRevisionResult> => {
      if (committed) return committed;
      const saved = await dependencies.saveCurrentSystemOrder(saveInput);
      if (saved) {
        committed = {
          ok: true,
          markdown: revisionResponse(saved),
          snapshot: saved,
          customerQuoteMarkdown: saved.customerQuoteMarkdown ?? quote.markdown,
        };
        return committed;
      }

      const raced = await readCurrentSystemOrder(input.scope);
      if (raced?.responseId === input.responseId) {
        committed = {
          ok: true,
          markdown: revisionResponse(raced),
          snapshot: raced,
          customerQuoteMarkdown: raced.customerQuoteMarkdown ?? '',
        };
        return committed;
      }
      return fail('concurrent_change');
    };
    return {
      ok: true,
      markdown: revisionResponse(snapshot),
      snapshot,
      customerQuoteMarkdown: quote.markdown,
      commit,
    };
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
