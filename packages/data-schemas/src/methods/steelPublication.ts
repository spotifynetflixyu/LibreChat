import { createHash } from 'node:crypto';
import { parseSteelReviewMarkdownTables, normalizeSteelReviewLedgerRows } from 'librechat-data-provider';
import type { ClientSession } from 'mongoose';
import type { IMessage, IConversation, ISteelQuotationState, ISteelQuotationArtifact, ISteelReviewOutput, ISteelConversationOcrState, SteelQuotationScope, SteelMarkdownAdmissionInput, SteelMarkdownAdmission, SteelMarkdownExpected, SteelMarkdownPublicationInput, SteelMarkdownPublicationResult, SteelMarkdownReference, SteelMarkdownKind, SteelMarkdownVersion } from '~/types';
import type { SteelReviewAuthorizedFile } from './steelSourceAuthorization';
import { createSteelDelegateOcrRunModel, createSteelQuotationStateModel, createSteelQuotationArtifactModel, createSteelConversationOcrStateModel, createSteelReviewOutputModel } from '~/models/steel';
import { createSteelReviewSourceAuthorization } from './steelSourceAuthorization';
import { createSteelQuotationPublicationProof } from './published';
import { steelReviewTitleStorageId } from '~/utils/identity';
import { activeExpirationFilter } from '~/utils/retention';
import { createConversationModel } from '~/models/convo';
import { createMessageModel } from '~/models/message';

type Mongoose = typeof import('mongoose');
type SaveMessage = (input: SteelMarkdownPublicationInput, message: SteelMarkdownPublicationInput['message'], session: ClientSession) => Promise<IMessage | null | undefined>;
const kinds: SteelMarkdownKind[] = ['ocr_result', 'system_order', 'customer_data'];
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const equal = (left: object | undefined, right: object | undefined): boolean => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
const scopeFilter = (scope: SteelQuotationScope) => ({ userId: scope.userId, conversationId: scope.conversationId,
  ...(scope.tenantId === undefined ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] } : { tenantId: scope.tenantId }) });
const messageFilter = (scope: SteelQuotationScope, messageId?: string) => ({ user: scope.userId, conversationId: scope.conversationId,
  ...(messageId ? { messageId } : {}), ...(scope.tenantId === undefined ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] } : { tenantId: scope.tenantId }) });
function expected(state: ISteelQuotationState | null, ocr: ISteelConversationOcrState | null): SteelMarkdownExpected {
  return {
    ...(ocr?.currentOcrResultGenerationId ? { ocrGeneration: ocr.currentOcrResultGenerationId } : {}),
    ...(ocr?.currentOcrResultMarkdown ? { ocrHash: sha(ocr.currentOcrResultMarkdown) } : {}),
    ...(state?.currentOrder?.sha256 ? { orderHash: state.currentOrder.sha256 } : {}),
    ...(state?.currentSystemOrder?.sha256 ? { systemOrderHash: state.currentSystemOrder.sha256 } : {}),
    ...(state?.currentCustomer?.preparationId ? { customerPreparationId: state.currentCustomer.preparationId } : {}),
    ...(state?.markdownPublication?.current ? { owners: state.markdownPublication.current } : {}),
  };
}
function validTargets(input: SteelMarkdownPublicationInput): boolean {
  if (!input.scope.userId || !input.scope.conversationId || input.message.user !== input.scope.userId ||
    input.message.conversationId !== input.scope.conversationId || input.message.messageId !== input.admission.responseId ||
    input.message.tenantId !== input.scope.tenantId || input.message.isCreatedByUser !== false || !input.message.text || input.targets.length === 0 ||
    new Set(input.targets.map((target) => target.kind)).size !== input.targets.length) return false;
  const tables = parseSteelReviewMarkdownTables(input.message.text);
  return input.targets.every((target) => {
    const rendered = tables.filter((table) => table.title === target.title);
    const baseline = parseSteelReviewMarkdownTables(target.baselineMarkdown).filter((table) => table.title === target.title);
    const parsedKind = target.title.split(/[\s｜:：([{]/u)[0];
    if (!kinds.includes(target.kind) || parsedKind !== target.kind || rendered.length !== 1 || baseline.length !== 1 ||
      !equal({ headers: rendered[0].headers, rows: rendered[0].rows }, { headers: baseline[0].headers, rows: baseline[0].rows })) return false;
    if (target.kind === 'customer_data') return Boolean(input.customer && input.customer.customerMarkdown === target.baselineMarkdown);
    const table = baseline[0];
    if (!target.headers || !target.rows || !equal({ headers: target.headers }, { headers: table.headers }) ||
      table.rows.length !== target.rows.length || table.rows.some((row) => row.length !== table.headers.length)) return false;
    return target.rows.every((row, index) => row.rowId === sha(`${target.outputId}:${index}:${JSON.stringify(table.rows[index])}`) &&
      !row.deleted && row.origin !== 'manual' && table.headers.every((header, column) => row.values[header]?.baseline === table.rows[index][column] &&
        row.values[header]?.effective === table.rows[index][column]));
  });
}

/** Scoped full publication. All writes and mirror checks share one Mongo transaction. */
export interface SteelPublicationMethods {
  admitSteelMarkdown(input: SteelMarkdownAdmissionInput): Promise<SteelMarkdownAdmission | null>;
  publishSteelMarkdown(input: SteelMarkdownPublicationInput): Promise<SteelMarkdownPublicationResult>;
  readSteelMarkdownVersions(scope: SteelQuotationScope): Promise<SteelMarkdownVersion[] | null>;
}

export function createSteelPublicationMethods(mongoose: Mongoose, saveMessage: SaveMessage): SteelPublicationMethods {
  const State = createSteelQuotationStateModel(mongoose);
  const DelegateRun = createSteelDelegateOcrRunModel(mongoose);
  const Ocr = createSteelConversationOcrStateModel(mongoose);
  const Artifact = createSteelQuotationArtifactModel(mongoose);
  const Output = createSteelReviewOutputModel(mongoose);
  const Conversation = createConversationModel(mongoose);
  const Message = createMessageModel(mongoose);
  const authorizeFiles = createSteelReviewSourceAuthorization(mongoose);

  async function admitSteelMarkdown(input: SteelMarkdownAdmissionInput): Promise<SteelMarkdownAdmission | null> {
    if (!input.scope.userId || !input.scope.conversationId || !input.responseId || !input.generationId) return null;
    const session = await mongoose.startSession();
    let admitted: SteelMarkdownAdmission | null = null;
    try {
      await session.withTransaction(async () => {
        const conversation = await Conversation.findOne({ ...messageFilter(input.scope), ...activeExpirationFilter() }).session(session).lean<IConversation>();
        if (!conversation) return;
        const state = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        const previous = state?.markdownPublication?.admission;
        if (previous?.responseId === input.responseId && previous.generationId === input.generationId) { admitted = previous; return; }
        const ocr = await Ocr.findOne({ conversationId: input.scope.conversationId }).session(session).lean<ISteelConversationOcrState>();
        const sequence = (state?.markdownPublication?.nextSequence ?? 0) + 1;
        admitted = { sequence, responseId: input.responseId, generationId: input.generationId,
          lineageId: state?.markdownPublication?.current?.ocr_result?.ai.lineageId ?? input.generationId, expected: expected(state, ocr) };
        await State.findOneAndUpdate(scopeFilter(input.scope), { $set: { 'markdownPublication.nextSequence': sequence, 'markdownPublication.admission': admitted },
          $setOnInsert: { userId: input.scope.userId, conversationId: input.scope.conversationId, ...(input.scope.tenantId ? { tenantId: input.scope.tenantId } : {}) } },
          { upsert: true, session, new: true });
      });
      return admitted;
    } finally { await session.endSession(); }
  }

  async function publishSteelMarkdown(input: SteelMarkdownPublicationInput): Promise<SteelMarkdownPublicationResult> {
    if (!validTargets(input)) return { ok: false, code: 'invalid_target' };
    const session = await mongoose.startSession();
    let result: SteelMarkdownPublicationResult = { ok: false, code: 'superseded' };
    const superseded = new Error('Steel publication superseded');
    try {
      await session.withTransaction(async () => {
        result = { ok: false, code: 'superseded' };
        const conversation = await Conversation.findOne({ ...messageFilter(input.scope), ...activeExpirationFilter() }).session(session).lean<IConversation>();
        const state = await State.findOne(scopeFilter(input.scope)).session(session).lean<ISteelQuotationState>();
        if (!conversation || !state || !equal(state.markdownPublication?.admission, input.admission) ||
          state.markdownPublication?.nextSequence !== input.admission.sequence) return;
        const oldMessage = await Message.findOne(messageFilter(input.scope, input.message.messageId)).session(session).lean<IMessage>();
        const prior = await Artifact.find({ ...scopeFilter(input.scope), runId: `markdown:${input.admission.generationId}`, operationId: { $in: input.targets.map((target) => `ai:${target.kind}`) } }).session(session).lean<ISteelQuotationArtifact[]>();
        if (prior.length === input.targets.length && oldMessage && input.targets.every((target) => {
          const snapshot = prior.find((artifact) => artifact.operationId === `ai:${target.kind}`)?.markdownPublication;
          if (!snapshot || snapshot.reference.outputId !== state.markdownPublication?.current?.[target.kind]?.ai.outputId) return false;
          const exactRaw = snapshot.rawMarkdown === input.rawMarkdown && snapshot.baselineMarkdown === target.baselineMarkdown;
          const originalTable = parseSteelReviewMarkdownTables(snapshot.baselineMarkdown).filter((table) => table.title === target.title);
          const replayTable = parseSteelReviewMarkdownTables(target.baselineMarkdown).filter((table) => table.title === target.title);
          const exactSavedProjection = input.rawMarkdown === oldMessage.text && input.message.text === oldMessage.text &&
            originalTable.length === 1 && replayTable.length === 1 &&
            equal({ headers: originalTable[0].headers, rows: originalTable[0].rows }, { headers: replayTable[0].headers, rows: replayTable[0].rows });
          return exactRaw || exactSavedProjection;
        })) {
          result = { ok: true, message: oldMessage, references: prior.flatMap((artifact) => artifact.markdownPublication ? [artifact.markdownPublication.reference] : []) };
          return;
        }
        if (prior.length > 0) return;
        const publicationProof = createSteelQuotationPublicationProof(Artifact, session);
        const activeRun = state.activeRun;
        if (activeRun && activeRun.status !== 'cancelled' &&
          (activeRun.status !== 'completed' || !await publicationProof.isPublished(input.scope, activeRun))) return;
        const ocr = await Ocr.findOne({ conversationId: input.scope.conversationId }).session(session).lean<ISteelConversationOcrState>();
        if (!equal(expected(state, ocr), input.admission.expected)) return;
        if (input.ocr?.claimToken) {
          if (input.ocr.delegateOcrIndex === undefined || !input.ocr.executionLeaseToken || !input.ocr.candidateToken ||
            ocr?.activeDelegateClaim?.claimToken !== input.ocr.claimToken ||
            ocr.activeDelegateClaim.executionLeaseToken !== input.ocr.executionLeaseToken ||
            ocr.activeDelegateClaim.delegateOcrIndex !== input.ocr.delegateOcrIndex) return;
          const delegate = await DelegateRun.exists({ conversationId: input.scope.conversationId, claimToken: input.ocr.claimToken,
            delegateOcrIndex: input.ocr.delegateOcrIndex, executionLeaseToken: input.ocr.executionLeaseToken,
            executionLeaseExpiresAt: { $gt: new Date() }, 'finalizedCandidate.token': input.ocr.candidateToken,
            'finalizedCandidate.generationId': input.admission.generationId, 'finalizedCandidate.targetMessageId': input.message.messageId,
            'finalizedCandidate.markdown': input.message.text, 'finalizationJournal.candidateValidatedToken': input.ocr.candidateToken }).session(session);
          if (!delegate) return;
        }
        const sourceIds = [...new Set(input.targets.flatMap((target) => (target.sourceMappings ?? []).map((mapping) => mapping.fileId)))];
        const authorized = sourceIds.length ? await authorizeFiles({ ...input.scope, messageId: input.message.messageId, kind: 'ocr_result' }, sourceIds, session, { conversation, message: input.message }) : new Map<string, SteelReviewAuthorizedFile>();
        for (const target of input.targets) {
          for (const mapping of target.sourceMappings ?? []) {
            const file = authorized.get(mapping.fileId);
            const canonical = ocr?.sourceMappings.find((entry) => entry.fileId === mapping.fileId);
            if (!file || !canonical || canonical.sourceCode !== mapping.sourceCode || canonical.sourceFilename !== mapping.sourceFilename || file.filename !== mapping.sourceFilename) return;
          }
          if (target.rows?.some((row) => row.source && !(target.sourceMappings ?? []).some((mapping) => mapping.fileId === row.source?.fileId))) return;
        }
        const now = new Date();
        const references: SteelMarkdownReference[] = input.targets.map((target) => ({
          kind: target.kind, source: 'ai', snapshotId: `markdown:${input.admission.generationId}:ai:${target.kind}`,
          generationId: input.admission.generationId, outputId: target.outputId, messageId: input.message.messageId, title: target.title,
          revision: target.revision, sha256: sha(target.baselineMarkdown), lineageId: input.admission.lineageId, version: 1, savedAt: now,
        }));
        const metadata = { ...oldMessage?.metadata, ...input.message.metadata };
        const priorSteelReview = oldMessage?.metadata?.steelReview;
        const steelReview: Record<string, unknown> = priorSteelReview && typeof priorSteelReview === 'object' && !Array.isArray(priorSteelReview) ? { ...priorSteelReview } : {};
        for (const target of input.targets) delete steelReview[target.kind];
        if (Object.keys(steelReview).length > 0) metadata.steelReview = steelReview;
        else delete metadata.steelReview;
        const existingOwners = oldMessage?.metadata?.steelMarkdownOwners;
        const ownerMetadata: Partial<Record<SteelMarkdownKind, SteelMarkdownReference>> = {};
        if (existingOwners && typeof existingOwners === 'object' && !Array.isArray(existingOwners)) {
          for (const kind of kinds) {
            const current = state.markdownPublication?.current?.[kind]?.ai;
            if (current?.messageId === input.message.messageId) ownerMetadata[kind] = current;
          }
        }
        for (const reference of references) ownerMetadata[reference.kind] = reference;
        metadata.steelMarkdownOwners = ownerMetadata;
        const saved = await saveMessage(input, { ...input.message, metadata }, session);
        if (!saved) throw new Error('Steel message publication failed');
        const current = { ...state.markdownPublication?.current };
        for (const target of input.targets) {
          const reference = references.find((candidate) => candidate.kind === target.kind)!;
          current[target.kind] = { ai: reference, effective: reference };
          const payload = JSON.stringify({ rawMarkdown: input.rawMarkdown, baselineMarkdown: target.baselineMarkdown });
          await Artifact.create([{ userId: input.scope.userId, conversationId: input.scope.conversationId, ...(input.scope.tenantId ? { tenantId: input.scope.tenantId } : {}),
            runId: `markdown:${input.admission.generationId}`, operationId: `ai:${target.kind}`, kind: 'main', sha256: sha(payload), payload,
            markdownPublication: { reference, rawMarkdown: input.rawMarkdown, baselineMarkdown: target.baselineMarkdown,
              ...(target.sourceMappings ? { sourceMappings: target.sourceMappings } : {}) } }], { session });
          if (target.kind !== 'customer_data') {
            await Output.updateMany({ ...scopeFilter(input.scope), kind: target.kind, state: 'current' }, { $set: { state: 'historical', latestOutputId: target.outputId } }, { session, timestamps: false });
            await Output.create([{ userId: input.scope.userId, conversationId: input.scope.conversationId,
              ...(input.scope.tenantId ? { tenantId: input.scope.tenantId } : {}), kind: target.kind, messageId: input.message.messageId, title: target.title,
              tableId: steelReviewTitleStorageId({ userId: input.scope.userId, tenantId: input.scope.tenantId, conversationId: input.scope.conversationId,
                messageId: input.message.messageId, kind: target.kind, outputId: target.outputId, title: target.title }),
              outputId: target.outputId, revision: target.revision, state: 'current', latestOutputId: target.outputId,
              headers: target.headers, rows: normalizeSteelReviewLedgerRows(target.rows ?? []), sourceMappings: target.sourceMappings,
              aiUpdatedAt: now, aiRawMarkdown: input.rawMarkdown, aiBaselineMarkdown: target.baselineMarkdown,
              effectiveMarkdown: target.baselineMarkdown, displayMarkdown: target.baselineMarkdown, receipts: [] }], { session });
          }
        }
        const ocrTarget = input.targets.find((target) => target.kind === 'ocr_result');
        const systemTarget = input.targets.find((target) => target.kind === 'system_order');
        if (systemTarget && (!input.systemOrder || input.systemOrder.markdown !== systemTarget.baselineMarkdown || input.systemOrder.sha256 !== sha(systemTarget.baselineMarkdown))) throw new Error('Steel system-order publication proof is invalid');
        if (ocrTarget) {
          await Ocr.updateOne({ conversationId: input.scope.conversationId }, { $set: {
            currentOcrResultMarkdown: ocrTarget.baselineMarkdown, currentOcrResultMessageId: input.message.messageId,
            currentOcrResultGenerationId: input.admission.generationId, currentOcrResultAttemptNumber: input.ocr?.attemptNumber ?? 1,
            ...(input.ocr?.delegateOcrIndex !== undefined ? { currentOcrResultIndex: input.ocr.delegateOcrIndex } : {}),
            currentOcrResultProvenance: { generationId: input.admission.generationId, messageId: input.message.messageId,
              attemptNumber: input.ocr?.attemptNumber ?? 1, ...(input.ocr?.claimToken ? { claimToken: input.ocr.claimToken } : {}), updatedAt: now },
          } }, { upsert: true, session });
        }
        if (ocrTarget && input.ocr?.claimToken && input.ocr.candidateToken) {
          const token = input.ocr.candidateToken;
          const finished = await DelegateRun.updateOne({ conversationId: input.scope.conversationId, claimToken: input.ocr.claimToken,
            executionLeaseToken: input.ocr.executionLeaseToken, 'finalizedCandidate.token': token }, { $set: {
              status: 'completed', currentStage: 'completed', 'finalizationJournal.messagePersisted': true,
              'finalizationJournal.messagePersistedToken': token, 'finalizationJournal.resultPersisted': true,
              'finalizationJournal.resultPersistedToken': token, 'finalizationJournal.claimCleared': true,
              'finalizationJournal.claimClearedToken': token } }, { session });
          if (finished.matchedCount !== 1) throw superseded;
          const cleared = await Ocr.updateOne({ conversationId: input.scope.conversationId,
            'activeDelegateClaim.claimToken': input.ocr.claimToken, 'activeDelegateClaim.executionLeaseToken': input.ocr.executionLeaseToken,
            'activeDelegateClaim.delegateOcrIndex': input.ocr.delegateOcrIndex }, { $unset: { activeDelegateClaim: 1 } }, { session });
          if (cleared.matchedCount !== 1) throw superseded;
        }
        const updates = { 'markdownPublication.current': current,
          ...(ocrTarget ? { currentOrder: { markdown: ocrTarget.baselineMarkdown, sha256: sha(ocrTarget.baselineMarkdown), revision: input.admission.generationId, messageId: input.message.messageId } } : {}),
          ...(input.customer ? { currentCustomer: input.customer } : {}),
          ...(systemTarget && input.systemOrder ? { currentSystemOrder: { ...input.systemOrder, reviewOutputId: systemTarget.outputId, messageId: input.message.messageId, updatedAt: now } } : {}),
          ...(ocrTarget && state.currentSystemOrder && !systemTarget ? { 'currentSystemOrder.needsRequote': true } : {}),
        };
        const changed = await State.updateOne({ ...scopeFilter(input.scope), 'markdownPublication.admission.sequence': input.admission.sequence,
          'markdownPublication.admission.generationId': input.admission.generationId,
          ...(state.activeRun ? { 'activeRun.runId': state.activeRun.runId, 'activeRun.status': state.activeRun.status,
            'activeRun.checkpointRefs': state.activeRun.checkpointRefs } : { activeRun: { $exists: false } }),
        }, { $set: updates }, { session });
        if (changed.matchedCount !== 1) throw superseded;
        result = { ok: true, message: saved, references };
      });
      return result;
    } catch (error) { if (error === superseded) return { ok: false, code: 'superseded' }; throw error; }
    finally { await session.endSession(); }
  }

  async function readSteelMarkdownVersions(scope: SteelQuotationScope): Promise<SteelMarkdownVersion[] | null> {
    const conversation = await Conversation.exists({ ...messageFilter(scope), ...activeExpirationFilter() });
    if (!conversation) return null;
    const [state, artifacts, outputs, ocr, messages] = await Promise.all([
      State.findOne(scopeFilter(scope)).lean<ISteelQuotationState>(),
      Artifact.find({ ...scopeFilter(scope), 'markdownPublication.reference': { $exists: true } }).select({ 'markdownPublication.reference': 1 }).lean<ISteelQuotationArtifact[]>(),
      Output.find(scopeFilter(scope)).select({ kind: 1, messageId: 1, outputId: 1, title: 1, revision: 1, 'receipts.changedRows': 1, state: 1 }).lean<ISteelReviewOutput[]>(),
      Ocr.findOne({ conversationId: scope.conversationId }).select({ currentOcrResultMessageId: 1, currentOcrResultGenerationId: 1 }).lean<ISteelConversationOcrState>(),
      Message.find(messageFilter(scope)).select({ messageId: 1, 'metadata.steelMarkdownOwners': 1, 'metadata.steelReview': 1 }).lean<IMessage[]>(),
    ]);
    const messagesById = new Map(messages.map((message) => [message.messageId, message]));
    const outputsByOwner = new Map(outputs.map((output) => [JSON.stringify([output.kind, output.messageId, output.outputId, output.title]), output]));
    const versions = new Map<string, SteelMarkdownVersion>();
    for (const artifact of artifacts) {
      const ref = artifact.markdownPublication?.reference;
      if (!ref) continue;
      const bound = messagesById.get(ref.messageId)?.metadata?.steelMarkdownOwners;
      if (!bound || typeof bound !== 'object' || Array.isArray(bound) || !(ref.kind in bound)) continue;
      const owner: unknown = Reflect.get(bound, ref.kind);
      if (!owner || typeof owner !== 'object' || Array.isArray(owner) || !('outputId' in owner) || owner.outputId !== ref.outputId) continue;
      const output = outputsByOwner.get(JSON.stringify([ref.kind, ref.messageId, ref.outputId, ref.title]));
      versions.set(JSON.stringify([ref.messageId, ref.title]), { kind: ref.kind, messageId: ref.messageId, title: ref.title, outputId: ref.outputId,
        revision: output?.revision ?? ref.revision, latest: state?.markdownPublication?.current?.[ref.kind]?.ai.outputId === ref.outputId && state.markdownPublication.current[ref.kind]?.ai.messageId === ref.messageId,
        saves: output?.receipts.filter((receipt) => receipt.changedRows > 0).length ?? 0 });
    }
    for (const output of outputs) {
      if (!output.title || versions.has(JSON.stringify([output.messageId, output.title]))) continue;
      const latest = output.kind === 'ocr_result' ? ocr?.currentOcrResultMessageId === output.messageId && `ocr_result:${ocr.currentOcrResultGenerationId}` === output.outputId
        : state?.currentSystemOrder?.messageId === output.messageId && (state.currentSystemOrder.reviewOutputId ?? `system_order:${state.currentSystemOrder.runId}`) === output.outputId;
      versions.set(JSON.stringify([output.messageId, output.title]), { kind: output.kind, messageId: output.messageId, title: output.title, outputId: output.outputId, revision: output.revision,
        latest, saves: output.receipts.filter((receipt) => receipt.changedRows > 0).length });
    }
    return [...versions.values()];
  }
  return { admitSteelMarkdown, publishSteelMarkdown, readSteelMarkdownVersions };
}
