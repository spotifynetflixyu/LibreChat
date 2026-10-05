import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createModels, createMethods } from '@librechat/data-schemas';
import {
  buildQuotationChunks,
  runQuotationPreflight,
  renderQuotationCustomerMarkdown,
  createSteelQuotationStateService,
  createSteelQuotationPublicationPublisher,
  quotationChildSystemOrderColumns,
} from '@librechat/api';
import type { ISteelQuotationState, ISteelReviewOutput, IMessage } from '@librechat/data-schemas';
import type { SteelReviewTable, SteelReviewOperationPrepare, SteelReviewOperationPrepared, SteelReviewSaveResponse } from 'librechat-data-provider';
import type { Page, Locator } from '@playwright/test';
import { seedConversations, withMongo } from './db';
import { getE2EUser } from '../../setup/user';

export type Mode = 'plate' | 'profile' | 'unknown' | 'square' | 'squareDensityOnly' | 'round' | 'flat';
export type Auth = { Authorization: string };
export type Fixture = { conversationId: string; messageId: string; runId: string; lookups: number };

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

/** A normal runner/lookup/checkpoint/publication produces the review authority. */
export async function seedCalculation(mode: Mode = 'plate', notes = '', processingRows = false): Promise<Fixture> {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const email = getE2EUser().email;
  await seedConversations(email, [{ conversationId, title: 'Material calculation review', updatedAt: new Date() }]);
  const userId = await withMongo(async (database) => {
    const user = await database.collection('users').findOne({ email });
    if (!user) throw new Error('Missing authenticated fixture owner');
    return String(user._id);
  });
  const runtimePath = process.env.E2E_RUNTIME_ENV_PATH ?? `${process.cwd()}/e2e/specs/.test-results/runtime-env.json`;
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as { MONGO_URI: string };
  await mongoose.connect(runtime.MONGO_URI);
  try {
    const scope = { userId, conversationId };
    const service = createSteelQuotationStateService(mongoose);
    const category = { plate: '鐵板', profile: 'H型鋼', unknown: '鐵板', square: '方鐵', squareDensityOnly: '方鐵', round: '圓條', flat: '平鐵' }[mode];
    const code = { plate: 'PLATE', profile: 'PROFILE', unknown: 'UNKNOWN', square: 'SQUARE', squareDensityOnly: 'SQUARE-DENSITY', round: 'ROUND', flat: 'FLAT' }[mode];
    const sourceRows = ['A', 'B'].map((part) => ['', part, category, '2', '6', '100', '200']);
    const order = `## ocr_result\n\n${table(['來源', '零件編號', '類別', '數量', '厚度', '寬度', '長度'], sourceRows)}`;
    const state = await service.setOrder({ scope, fullMarkdown: order });
    const customerMarkdown = renderQuotationCustomerMarkdown({ tier: 'B' });
    await service.saveCustomer({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'material-user', responseId: messageId,
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'material-user' },
      orderHash: state.currentOrder!.sha256 });
    const ticket = await service.issueTicket({ scope, customerMarkdown, customerIdentity: 'explicit-default:B',
      triggeringMessageId: 'material-user',
      selectionProvenance: { method: 'default_tier', selectionMessageId: 'material-user' } });
    const chunks = buildQuotationChunks(order);
    const run = await service.acceptSignal({ scope, index: ticket.index, token: ticket.token,
      orderHash: ticket.orderHash, customerMarkdown, customerIdentity: ticket.customerIdentity,
      prompts: { child: 'material fixture child', main: 'material fixture review' },
      chunks: chunks.map((chunk) => ({ index: chunk.chunkIndex, sourceRowCount: chunk.sourceRows.length })),
      targetMessageId: messageId });
    createModels(mongoose);
    const methods = createMethods(mongoose);
    let lookups = 0;
    const candidate = {
      id: { plate: 1, profile: 2, unknown: 3, square: 4, squareDensityOnly: 7, round: 5, flat: 6 }[mode], erpItemCode: code, productName: `REVIEW-${code}`, category,
      material: 'M1', unit: mode === 'unknown' ? 'pc' : 'kg', quoteEligible: true,
      ...(mode === 'plate' ? { density: 7.85, exactPhysical: { density: '7.85' } } : {}),
      ...(mode === 'squareDensityOnly' ? { density: 7.85, exactPhysical: { density: '7.85' } } : {}),
      ...(mode === 'square' ? { density: 7.85, widthMm: 100, exactPhysical: { density: '7.85', widthMm: '100' } } : {}),
      ...(['round', 'flat'].includes(mode) ? { unitWeightValue: 1, unitWeightBasis: 'kg_per_m',
        exactPhysical: { unitWeightValue: '1' } } : {}),
      ...(mode === 'profile' ? { unitWeightValue: 1, lengthMm: 3,
        unitWeightBasis: 'kg_per_piece_or_stock_length', exactPhysical: { unitWeightValue: '1', lengthMm: '3' } } : {}),
      tierPrices: { A: 11, B: 10, C: 9, D: 8, E: 7, F: 6 },
    };
    const result = await runQuotationPreflight({ scope,
      modelOptions: { model: 'external-fixture-model' }, signal: new AbortController().signal,
      executeLookup: async () => {
        lookups += 1;
        return { ok: true, toolName: 'search_price_candidates',
          data: { queryResults: [{ queryId: 'q1', status: 'ok', candidates: [candidate] }] },
          durationMs: 1, redactionVersion: 1 };
      },
      invokeModel: async (input) => {
        if (input.role === 'main') return { markdown: '無待複核事項。', lookups: [], pythonEvidence: [] };
        if (!input.lookup) throw new Error('Missing real runner lookup seam');
        await input.lookup('material-lookup', { queries: [{ queryId: 'q1', categories: [category] }] });
        return { markdown: `## system_order_chunk\n\n${table(quotationChildSystemOrderColumns,
          ['A', 'B'].map((part) => [code, `REVIEW-${code}-${part}`, 'M1', mode === 'unknown' ? 'pc' : 'kg',
            '2', '1', mode === 'unknown' ? '3' : '2', '10', '2', '', '6', '100', '200', '', category, part, notes]).concat(processingRows ? [['PROCESS', 'REVIEW-PROCESS', '', '刀', '2', '', '2', '10', '1', '', '', '', '', '', '加工/切工', 'A', notes]] : []))}`,
        lookups: [], pythonEvidence: [] };
      },
      publishFinal: createSteelQuotationPublicationPublisher({ scope,
        buildMessage: ({ markdown }) => {
          const text = `MATERIAL-PREFIX\n\n${markdown}\n\nMATERIAL-SUFFIX`;
          return { user: userId, messageId, conversationId,
            parentMessageId: '00000000-0000-0000-0000-000000000000',
            text, content: [{ type: 'text', text }], isCreatedByUser: false, sender: 'Assistant' };
        },
        savePublication: methods.saveSteelQuotationMessage,
      }),
    });
    expect(result.status).toBe('completed');
    expect(lookups).toBe(1);
    return { conversationId, messageId, runId: run.runId, lookups };
  } finally {
    await mongoose.disconnect();
  }
}

export function reviewUrl(conversationId: string): string {
  return `/api/steel/conversations/${conversationId}/review/system_order`;
}

export async function readTable(page: Page, auth: Auth, fixture: Fixture): Promise<SteelReviewTable> {
  const response = await page.request.get(`${reviewUrl(fixture.conversationId)}?${new URLSearchParams({
    messageId: fixture.messageId, title: 'system_order' })}`, { headers: auth });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json() as { table: SteelReviewTable }).table;
}

export function requestFor(owner: SteelReviewTable, changes: Array<{ header: string; value: string }>): SteelReviewOperationPrepare {
  return { conversationId: owner.conversationId, messageId: owner.messageId, kind: owner.kind,
    title: owner.title, outputId: owner.outputId, revision: owner.revision,
    operations: [{ type: 'update', rowId: owner.rows[0].rowId, changes }] };
}

export async function prepare(page: Page, auth: Auth, input: SteelReviewOperationPrepare): Promise<SteelReviewOperationPrepared> {
  const response = await page.request.post(`${reviewUrl(input.conversationId)}/prepare`, { headers: auth, data: input });
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<SteelReviewOperationPrepared>;
}

export async function commit(page: Page, auth: Auth, prepared: SteelReviewOperationPrepared) {
  return page.request.post(`${reviewUrl(prepared.conversationId)}/commit`, { headers: auth,
    data: { ...prepared.operationRequest, operationId: prepared.operationId, digest: prepared.digest } });
}

export async function saveApi(page: Page, auth: Auth, input: SteelReviewOperationPrepare): Promise<SteelReviewSaveResponse> {
  const prepared = await prepare(page, auth, input);
  const response = await commit(page, auth, prepared);
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<SteelReviewSaveResponse>;
}

export async function readback(fixture: Fixture) {
  return withMongo(async (database) => ({
    messages: await database.collection<Pick<IMessage, 'messageId' | 'text' | 'content' | 'metadata'>>('messages')
      .find({ conversationId: fixture.conversationId }).toArray(),
    reviews: await database.collection<ISteelReviewOutput>('steel_review_outputs')
      .find({ conversationId: fixture.conversationId }).toArray(),
    quotation: await database.collection<ISteelQuotationState>('steel_quotation_states')
      .findOne({ conversationId: fixture.conversationId }),
    artifacts: await database.collection('steel_quotation_artifacts').find({ conversationId: fixture.conversationId })
      .sort({ operationId: 1 }).toArray(),
  }));
}

export async function openEditor(page: Page, fixture: Fixture): Promise<Locator> {
  await page.goto(`/c/${fixture.conversationId}`);
  await expect(page.getByText('MATERIAL-SUFFIX', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Steel review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Steel source review' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function saveUi(page: Page, dialog: Locator): Promise<SteelReviewSaveResponse> {
  const responseReady = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/review/system_order/commit'));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await responseReady;
  expect(response.status(), await response.text()).toBe(200);
  const saved = await response.json() as SteelReviewSaveResponse;
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  return saved;
}

export async function editBusinessValue(dialog: Locator, rowId: string, header: string, value: string): Promise<void> {
  if (header === '類別') {
    await dialog.getByRole('combobox', { name: `${header} ${rowId}`, exact: true }).click();
    await dialog.page().getByRole('option', { name: value || 'No category', exact: true }).click();
    return;
  }
  await dialog.getByRole('textbox', { name: `${header} ${rowId}`, exact: true }).fill(value);
}

export async function expectBusinessEditable(dialog: Locator, rowId: string, headers: readonly string[]): Promise<void> {
  for (const header of headers) {
    if (['類別', '型號', '品名規格'].includes(header)) {
      await expect(dialog.getByRole('combobox', { name: `${header} ${rowId}`, exact: true })).toBeEnabled();
    } else {
      await expect(dialog.getByRole('textbox', { name: `${header} ${rowId}`, exact: true })).toBeEditable();
    }
  }
}

export function effective(owner: Pick<SteelReviewTable, 'rows'>, header: string): string | null {
  return owner.rows[0].values[header].effective;
}
