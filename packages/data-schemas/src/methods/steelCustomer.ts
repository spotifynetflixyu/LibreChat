import { createHash, randomUUID } from 'node:crypto';
import { readSteelCustomerTable, updateSteelCustomerTier } from 'librechat-data-provider';
import type { SteelCustomerQuery, SteelCustomerCommit, SteelCustomerResponse, SteelCustomerSaveResponse, SteelCustomerResult, TMessage } from 'librechat-data-provider';
import type { ClientSession } from 'mongoose';
import type { IMessage, ISteelQuotationState, ISteelQuotationArtifact, SteelQuotationScope, SteelMarkdownReference } from '~/types';
import { createSteelQuotationStateModel, createSteelQuotationArtifactModel } from '~/models/steel';
import { createSteelQuotationPublicationProof } from './published';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';

type Mongoose = typeof import('mongoose');
type CustomerRead = SteelCustomerQuery & SteelQuotationScope;
type CustomerCommit = SteelCustomerCommit & SteelQuotationScope;
type CustomerSnapshot = {
  message: IMessage;
  state: ISteelQuotationState | null;
  reference: SteelMarkdownReference;
  revision: string;
  latest: boolean;
  tier: SteelCustomerResponse['tier'];
};
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const tenantFilter = (scope: SteelQuotationScope) => scope.tenantId === undefined
  ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }
  : { tenantId: scope.tenantId };
const scopeFilter = (scope: SteelQuotationScope) => ({ userId: scope.userId, conversationId: scope.conversationId, ...tenantFilter(scope) });
const messageFilter = (scope: SteelQuotationScope) => ({ user: scope.userId, conversationId: scope.conversationId, ...tenantFilter(scope) });

export interface SteelCustomerMethods {
  readSteelCustomer(input: CustomerRead): Promise<SteelCustomerResult<SteelCustomerResponse>>;
  commitSteelCustomer(input: CustomerCommit): Promise<SteelCustomerResult<SteelCustomerSaveResponse>>;
}

function response(input: CustomerRead, snapshot: CustomerSnapshot): SteelCustomerResponse {
  return { conversationId: input.conversationId, messageId: input.messageId, title: input.title,
    outputId: input.outputId, revision: snapshot.revision, tier: snapshot.tier, latest: snapshot.latest };
}

function textPart(part: object): part is { type: 'text'; text: string } {
  return Reflect.get(part, 'type') === 'text' && typeof Reflect.get(part, 'text') === 'string';
}

function replaceContent(message: IMessage, title: string, tier: SteelCustomerCommit['tier'], nextText: string): TMessage['content'] | null | undefined {
  if (message.content === undefined) return undefined;
  const parts = message.content;
  let found = 0;
  let rendered = '';
  const next = parts.map((part) => {
    if (typeof part !== 'object' || part === null || !textPart(part)) return part;
    let text = part.text;
    if (readSteelCustomerTable(text, title)) {
      found++;
      text = updateSteelCustomerTier(text, title, tier) ?? text;
    }
    rendered += rendered && text && !rendered.endsWith(' ') && !text.startsWith(' ') ? ` ${text}` : text;
    return text === part.text ? part : { ...part, text };
  });
  if (found !== 1 || rendered !== nextText) return null;
  return next as TMessage['content'];
}

export function createSteelCustomerMethods(mongoose: Mongoose): SteelCustomerMethods {
  const Conversation = createConversationModel(mongoose);
  const Message = createMessageModel(mongoose);
  const State = createSteelQuotationStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);

  async function snapshot(input: CustomerRead, session?: ClientSession): Promise<SteelCustomerResult<CustomerSnapshot>> {
    const conversation = await Conversation.exists({ ...messageFilter(input), ...activeExpirationFilter() }).session(session ?? null);
    if (!conversation) return { ok: false, code: 'CUSTOMER_NOT_FOUND' };
    const message = await Message.findOne({ ...messageFilter(input), ...activeExpirationFilter(), messageId: input.messageId,
      isCreatedByUser: false, unfinished: { $ne: true } }).session(session ?? null).lean<IMessage>();
    if (!message?.text) return { ok: false, code: 'CUSTOMER_NOT_FOUND' };
    const metadata = message.metadata?.steelMarkdownOwners;
    const owner = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? Reflect.get(metadata, 'customer_data') : null;
    if (!owner || typeof owner !== 'object' || Reflect.get(owner, 'outputId') !== input.outputId ||
      Reflect.get(owner, 'title') !== input.title || Reflect.get(owner, 'messageId') !== input.messageId) return { ok: false, code: 'CUSTOMER_NOT_FOUND' };
    const artifacts = await Artifact.find({ ...scopeFilter(input), 'markdownPublication.reference.source': 'ai',
      'markdownPublication.reference.kind': 'customer_data', 'markdownPublication.reference.outputId': input.outputId,
      'markdownPublication.reference.messageId': input.messageId, 'markdownPublication.reference.title': input.title })
      .session(session ?? null).lean<ISteelQuotationArtifact[]>();
    const original = artifacts.length === 1 ? artifacts[0].markdownPublication : undefined;
    if (!original || !Object.entries(original.reference).every(([key, value]) => JSON.stringify(value) === JSON.stringify(Reflect.get(owner, key))) || sha(original.baselineMarkdown) !== original.reference.sha256) {
      return { ok: false, code: 'CUSTOMER_NOT_FOUND' };
    }
    const parsed = readSteelCustomerTable(message.text, input.title);
    if (!parsed) return { ok: false, code: 'CUSTOMER_INVALID_TABLE' };
    const state = await State.findOne(scopeFilter(input)).session(session ?? null).lean<ISteelQuotationState>();
    const current = state?.markdownPublication?.current?.customer_data;
    const latest = Boolean(current?.ai.outputId === input.outputId && current.ai.messageId === input.messageId && current.ai.title === input.title);
    if (latest && current && (current.effective.kind !== 'customer_data' ||
      current.effective.messageId !== input.messageId || current.effective.title !== input.title ||
      current.effective.outputId !== input.outputId)) return { ok: false, code: 'CUSTOMER_CONFLICT' };
    return { ok: true, value: { message, state, reference: original.reference, tier: parsed.tier,
      revision: latest && current ? current.effective.revision : original.reference.revision, latest } };
  }

  async function readSteelCustomer(input: CustomerRead): Promise<SteelCustomerResult<SteelCustomerResponse>> {
    const read = await snapshot(input);
    return read.ok ? { ok: true, value: response(input, read.value) } : read;
  }

  async function commitSteelCustomer(input: CustomerCommit): Promise<SteelCustomerResult<SteelCustomerSaveResponse>> {
    const session = await mongoose.startSession();
    let result: SteelCustomerResult<SteelCustomerSaveResponse> = { ok: false, code: 'CUSTOMER_CONFLICT' };
    try {
      await session.withTransaction(async () => {
        result = { ok: false, code: 'CUSTOMER_CONFLICT' };
        const read = await snapshot(input, session);
        if (!read.ok) { result = read; return; }
        const current = read.value;
        if (!current.latest) { result = { ok: false, code: 'CUSTOMER_HISTORICAL' }; return; }
        if (current.revision !== input.revision || current.tier !== input.expectedTier) return;
        const state = current.state;
        const customer = state?.currentCustomer;
        const owner = state?.markdownPublication?.current?.customer_data;
        if (!state || !customer || !owner || customer.responseId !== input.messageId) return;
        const savedTable = readSteelCustomerTable(customer.customerMarkdown, input.title);
        const messageTable = readSteelCustomerTable(current.message.text ?? '', input.title);
        if (!savedTable || !messageTable || JSON.stringify(savedTable.table.headers) !== JSON.stringify(messageTable.table.headers) ||
          JSON.stringify(savedTable.table.rows) !== JSON.stringify(messageTable.table.rows) || sha(customer.customerMarkdown) !== owner.effective.sha256) return;
        const active = state.activeRun;
        if (active && active.status !== 'cancelled' &&
          (active.status !== 'completed' || !await createSteelQuotationPublicationProof(Artifact, session).isPublished(input, active))) {
          result = { ok: false, code: 'CUSTOMER_BUSY' }; return;
        }
        const nextText = updateSteelCustomerTier(current.message.text ?? '', input.title, input.tier);
        const markdown = updateSteelCustomerTier(customer.customerMarkdown, input.title, input.tier);
        if (!nextText || !markdown) { result = { ok: false, code: 'CUSTOMER_INVALID_TABLE' }; return; }
        const content = replaceContent(current.message, input.title, input.tier, nextText);
        if (content === null) return;
        const nextResponse = { ...response(input, current), tier: input.tier,
          message: { messageId: input.messageId, text: nextText, ...(content !== undefined ? { content } : {}) } };
        if (nextText === current.message.text && markdown === customer.customerMarkdown) { result = { ok: true, value: nextResponse }; return; }
        const revision = randomUUID();
        const now = new Date();
        const reference: SteelMarkdownReference = { ...current.reference, source: 'human', snapshotId: `${input.outputId}:${revision}`,
          operationId: revision, revision, sha256: sha(markdown), savedAt: now };
        delete reference.version;
        const defaultCustomer = /^(?:explicit-default|no-match):/u.test(customer.customerIdentity);
        const preparation = { ...customer, preparationId: randomUUID(), customerMarkdown: markdown,
          ...(defaultCustomer ? { customerIdentity: `explicit-default:${input.tier}` } : {}),
          selectionProvenance: { ...customer.selectionProvenance, selectionMessageId: input.messageId } };
        const updated = await State.updateOne({ ...scopeFilter(input),
          'markdownPublication.current.customer_data.ai': owner.ai,
          'markdownPublication.current.customer_data.effective.revision': input.revision,
          'currentCustomer.preparationId': customer.preparationId,
          ...(active ? { activeRun: active } : { activeRun: { $exists: false } }) },
        { $set: { currentCustomer: preparation, 'markdownPublication.current.customer_data.effective': reference,
          ...(state.currentSystemOrder ? { 'currentSystemOrder.needsRequote': true } : {}) },
          $unset: { customerLookupEvidence: 1 } }, { session });
        if (updated.matchedCount !== 1) throw new Error('Customer transaction invariant failed');
        const changed = await Message.updateOne({ ...messageFilter(input), messageId: input.messageId, text: current.message.text,
          'metadata.steelMarkdownOwners.customer_data.outputId': owner.ai.outputId,
          'metadata.steelMarkdownOwners.customer_data.revision': owner.ai.revision,
          'metadata.steelMarkdownOwners.customer_data.title': input.title, unfinished: { $ne: true } },
        { $set: { text: nextText, ...(content !== undefined ? { content } : {}),
          'metadata.steelMarkdownEffective.customer_data': reference } }, { session });
        if (changed.matchedCount !== 1) throw new Error('Customer message transaction invariant failed');
        const payload = JSON.stringify({ reference, markdown });
        await Artifact.create([{ userId: input.userId, conversationId: input.conversationId, ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}), runId: `markdown:${reference.generationId}`,
          operationId: `customer:${revision}`, kind: 'main', sha256: sha(payload), payload,
          markdownPublication: { reference, rawMarkdown: markdown, baselineMarkdown: markdown } }], { session });
        result = { ok: true, value: { ...nextResponse, revision } };
      });
      return result;
    } finally { await session.endSession(); }
  }

  return { readSteelCustomer, commitSteelCustomer };
}
