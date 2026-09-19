import { randomUUID } from 'node:crypto';
import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
  createSteelQuotationStateModel,
  createSteelWorkingOrderMemoryModel,
} from '@librechat/data-schemas';
import type { IConversation, IMongoFile, ISteelConversationOcrState, ISteelDelegateOcrRun, ISteelWorkingOrderMemory, SteelConversationOcrSourceMapping } from '@librechat/data-schemas';
import type { Types } from 'mongoose';
import { finalizeOcrResponse, parseAssistantMarkdown, parseOcrResultTable, parseSourceMappingTable } from './result';

type Mongoose = typeof import('mongoose');
type ForkMessage = {
  messageId: string;
  parentMessageId?: string | null;
  isCreatedByUser?: boolean;
  text?: string;
  content?: unknown;
  files?: unknown;
};
type ForkInput = {
  userId: string;
  sourceConversationId: string;
  destinationConversationId: string;
  messages: readonly ForkMessage[];
  targetMessageId: string;
  messageIdMap: ReadonlyMap<string, string>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function messageText(message: ForkMessage): string {
  if (message.text?.trim()) return message.text;
  if (!Array.isArray(message.content)) return '';
  return message.content.map((part: unknown) => {
    const block = record(part);
    if (block?.type !== 'text') return '';
    const text = block.text;
    return typeof text === 'string' ? text : record(text)?.value ?? '';
  }).join('\n');
}

function selectedPath(input: ForkInput): ForkMessage[] {
  const messages = new Map(input.messages.map((message) => [message.messageId, message]));
  const path: ForkMessage[] = [];
  const seen = new Set<string>();
  let message = messages.get(input.targetMessageId);
  while (message) {
    if (seen.has(message.messageId)) throw new Error('Cyclic OCR fork ancestry');
    seen.add(message.messageId);
    path.unshift(message);
    message = message.parentMessageId ? messages.get(message.parentMessageId) : undefined;
  }
  return path;
}

function validateResult(markdown: string): Set<string> {
  const sections = parseAssistantMarkdown(markdown).sections.filter((section) => section.title === 'ocr_result');
  if (sections.length !== 1) throw new Error('Ambiguous OCR fork result');
  const parsed = parseOcrResultTable(sections[0].body);
  if (!parsed.ok || !['來源', '零件編號', '類別'].every((header) => parsed.table.headers.includes(header))) {
    throw new Error('Invalid OCR fork result');
  }
  const source = parsed.table.headers.indexOf('來源');
  const part = parsed.table.headers.indexOf('零件編號');
  if (parsed.table.rows.some((row) => !row[source]?.trim() || !row[part]?.trim())) {
    throw new Error('OCR fork result has missing row identity');
  }
  return new Set(parsed.table.rows.map((row) => row[source].trim()));
}

const messageFields = new Set(['messageId', 'responseMessageId', 'targetMessageId', 'triggeringMessageId', 'supersededByMessageId']);
const generationFields = new Set(['generationId', 'responseGenerationId']);

/** Remap structured provenance only; source text and storage keys are immutable evidence. */
function remapPayload(value: unknown, input: ForkInput, generations: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => remapPayload(entry, input, generations));
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(Object.entries(object).map(([key, entry]) => {
    if (typeof entry === 'string' && (messageFields.has(key) || generationFields.has(key))) {
      const mapped = messageFields.has(key) ? input.messageIdMap.get(entry)
        : generations.get(entry) ?? input.messageIdMap.get(entry);
      if (!mapped) throw new Error('OCR evidence references an uncopied message or generation');
      return [key, mapped];
    }
    if (key === 'conversationId' && entry === input.sourceConversationId) {
      return [key, input.destinationConversationId];
    }
    return [key, remapPayload(entry, input, generations)];
  }));
}

function referencedFiles(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => referencedFiles(entry, ids));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, entry] of Object.entries(object)) {
    if ((key === 'fileId' || key === 'file_id') && typeof entry === 'string') ids.add(entry);
    else if (key === 'ocrFileKey' && typeof entry === 'string' && entry.startsWith('file:')) ids.add(entry.slice(5));
    else if (typeof entry === 'object') referencedFiles(entry, ids);
  }
}

/** Prepares private OCR backing data before the caller publishes the new conversation. */
export function createSteelOcrForkService(mongoose: Mongoose) {
  const State = createSteelConversationOcrStateModel(mongoose);
  const Memory = createSteelWorkingOrderMemoryModel(mongoose);
  const Runs = createSteelDelegateOcrRunModel(mongoose);
  const Quotation = createSteelQuotationStateModel(mongoose);
  const Conversation = mongoose.model<IConversation>('Conversation');
  const File = mongoose.model<IMongoFile>('File');

  return {
    async prepare(input: ForkInput): Promise<{ persist(): Promise<void>; cleanup(): Promise<void> }> {
      if (input.sourceConversationId === input.destinationConversationId ||
        !await Conversation.exists({ conversationId: input.sourceConversationId, user: input.userId })) {
        throw new Error('OCR fork requires exact conversation ownership');
      }
      const destination = { conversationId: input.destinationConversationId };
      const assertUnused = async (): Promise<void> => {
        const occupied = await Promise.all([
          Conversation.exists(destination), State.exists(destination), Memory.exists(destination),
          Runs.exists(destination), Quotation.exists(destination),
        ]);
        if (occupied.some(Boolean)) throw new Error('OCR fork destination already exists');
      };
      await assertUnused();
      const copiedIds = new Set(input.messages.map((message) => message.messageId));
      const mappedIds = input.messages.map((message) => input.messageIdMap.get(message.messageId));
      if (mappedIds.some((id) => !id || copiedIds.has(id)) || new Set(mappedIds).size !== copiedIds.size) {
        throw new Error('OCR fork requires fresh unique message IDs');
      }
      const path = selectedPath(input);
      const [source, runs, memories] = await Promise.all([
        State.findOne({ conversationId: input.sourceConversationId }).lean<ISteelConversationOcrState>(),
        Runs.find({ conversationId: input.sourceConversationId, status: 'completed' }).lean<ISteelDelegateOcrRun[]>(),
        Memory.find({ conversationId: input.sourceConversationId, memoryKind: { $in: ['ocr_extract', 'paddleocr_preflight'] } }).lean<ISteelWorkingOrderMemory[]>(),
      ]);
      const generations = new Map<string, string>();
      const requestMap = new Map(input.messageIdMap);
      const eligibleRuns = runs.filter((run) => run.targetMessageId && copiedIds.has(run.targetMessageId) &&
        copiedIds.has(run.triggeringMessageId) && run.responseGenerationId &&
        (!run.finalizedCandidate?.targetMessageId || run.finalizedCandidate.targetMessageId === run.targetMessageId) &&
        (!run.finalizedCandidate?.generationId || run.finalizedCandidate.generationId === run.responseGenerationId));
      for (const run of eligibleRuns) {
        const responseId = input.messageIdMap.get(run.targetMessageId!)!;
        generations.set(run.responseGenerationId!, responseId);
        requestMap.set(run.responseGenerationId!, responseId);
      }
      if (source?.currentOcrResultGenerationId && source.currentOcrResultMessageId &&
        copiedIds.has(source.currentOcrResultMessageId)) {
        const id = source.currentOcrResultGenerationId;
        generations.set(id, generations.get(id) ?? input.messageIdMap.get(id) ?? randomUUID());
      }
      const mappingClaims = new Map<string, string>();
      let fromCurrentState = false;
      let markdown: string | undefined;
      let resultMessageId: string | undefined;
      for (const message of path) {
        if (message.isCreatedByUser !== false) continue;
        const text = messageText(message);
        const sections = parseAssistantMarkdown(text).sections;
        for (const section of sections.filter((entry) => entry.title === 'source_file_mapping')) {
          const parsed = parseSourceMappingTable(section.body);
          if (!parsed.ok) throw new Error('Invalid OCR fork source mapping');
          for (const row of parsed.table.rows) {
            const code = row[parsed.table.headers.indexOf('來源')].trim();
            const filename = row[parsed.table.headers.indexOf('檔名')].trim();
            if (mappingClaims.has(code) && mappingClaims.get(code) !== filename) throw new Error('Conflicting OCR fork source mapping');
            mappingClaims.set(code, filename);
          }
        }
        const full = sections.filter((section) => section.title === 'ocr_result');
        const updates = sections.filter((section) => section.title === 'ocr_result_updates');
        if (full.length > 0) {
          if (full.length !== 1) throw new Error('Duplicate OCR fork result sections');
          validateResult(full[0].raw);
          markdown = full[0].raw;
          resultMessageId = message.messageId;
        } else if (updates.length > 0) {
          // A split without the base must remain unseeded, never borrow the source's latest order.
          if (!markdown) continue;
          const result = finalizeOcrResponse({
            assistantResponse: text, previousOcrMarkdown: markdown,
            canonicalMapping: [], agentKind: 'other',
            currentUserTurn: messageText(path.find((entry) => entry.messageId === message.parentMessageId) ?? message),
          });
          if (!result.ok) throw new Error(`Cannot reconstruct OCR fork: ${result.reason}`);
          validateResult(result.ocrResultMarkdown);
          markdown = result.ocrResultMarkdown;
          resultMessageId = message.messageId;
        } else if (source?.currentOcrResultMessageId === message.messageId && source.currentOcrResultMarkdown &&
          (!source.currentOcrResultProvenance?.messageId || source.currentOcrResultProvenance.messageId === message.messageId)) {
          validateResult(source.currentOcrResultMarkdown);
          markdown = source.currentOcrResultMarkdown;
          fromCurrentState = true;
          resultMessageId = message.messageId;
        }
      }
      const fileIds = new Set<string>();
      input.messages.forEach((message) => referencedFiles(message.files, fileIds));
      const records: Array<{ _id: Types.ObjectId; conversationId: string; [key: string]: unknown }> = [];
      for (const memory of memories) {
        if (!memory.requestId || !requestMap.has(memory.requestId)) continue;
        const payload = record(memory.payload);
        if (payload?.preflightMode === 'delegate' && !eligibleRuns.some((run) =>
          run.delegateOcrIndex === payload.delegateOcrIndex && run.responseGenerationId === memory.requestId)) continue;
        if (memory.supersededByMessageId && !copiedIds.has(memory.supersededByMessageId)) continue;
        referencedFiles(memory.payload, fileIds);
        referencedFiles(memory.sourceRefs, fileIds);
        const copiedPayload = record(remapPayload(memory.payload, input, generations));
        // Completed evidence becomes regular reusable context; its old delegate run is not copied.
        if (copiedPayload?.preflightMode === 'delegate') {
          copiedPayload.preflightMode = 'regular';
          delete copiedPayload.delegateOcrIndex;
          const preprocessing = record(copiedPayload.ocrPreprocessing);
          if (preprocessing) {
            preprocessing.preflightMode = 'regular';
            delete preprocessing.delegateOcrIndex;
          }
        }
        records.push({
          _id: new mongoose.Types.ObjectId(),
          conversationId: input.destinationConversationId,
          requestId: requestMap.get(memory.requestId),
          turnIndex: memory.turnIndex,
          checkpointTurnIndex: memory.checkpointTurnIndex,
          memoryKind: memory.memoryKind,
          sourceKind: memory.sourceKind,
          state: memory.state,
          summary: memory.summary,
          payload: copiedPayload ?? remapPayload(memory.payload, input, generations),
          sourceRefs: remapPayload(memory.sourceRefs, input, generations),
          supersededAt: memory.supersededAt,
          supersededByMessageId: memory.supersededByMessageId ? input.messageIdMap.get(memory.supersededByMessageId) : undefined,
        });
      }
      if (!markdown && records.length === 0) {
        return { persist: async () => undefined, cleanup: async () => undefined };
      }
      eligibleRuns.forEach((run) => referencedFiles(run.files, fileIds));
      const used = markdown ? validateResult(markdown) : new Set<string>();
      const mappings: SteelConversationOcrSourceMapping[] = (source?.sourceMappings ?? [])
        .filter((mapping) => used.has(mapping.sourceCode.trim()) &&
          (fileIds.has(mapping.fileId) || mappingClaims.get(mapping.sourceCode.trim()) === mapping.sourceFilename || fromCurrentState))
        .map((mapping) => ({ fileId: mapping.fileId, sourceCode: mapping.sourceCode.trim(), sourceFilename: mapping.sourceFilename }));
      mappings.forEach((mapping) => fileIds.add(mapping.fileId));
      const ownedFiles = fileIds.size
        ? await File.find({ user: input.userId, file_id: { $in: [...fileIds] } }).select({ file_id: 1, filename: 1 }).lean()
        : [];
      const owned = new Set(ownedFiles.map((file) => file.file_id));
      if ([...fileIds].some((id) => !owned.has(id))) throw new Error('OCR fork attachment is missing or not owned by the requesting user');
      for (const code of used) {
        if (code === '文字訂單' || mappings.some((mapping) => mapping.sourceCode === code)) continue;
        const candidates = ownedFiles.filter((file) => file.filename === mappingClaims.get(code));
        if (candidates.length !== 1) throw new Error(`Missing OCR fork source mapping: ${code}`);
        mappings.push({ fileId: candidates[0].file_id, sourceCode: code, sourceFilename: candidates[0].filename });
      }
      if (new Set(mappings.map((mapping) => mapping.sourceCode)).size !== mappings.length) {
        throw new Error('Ambiguous OCR fork source mapping');
      }
      const stateId = new mongoose.Types.ObjectId();
      const selectedGeneration = (source?.currentOcrResultMessageId === resultMessageId ? source?.currentOcrResultGenerationId : undefined)
        ?? eligibleRuns.find((run) => run.targetMessageId === resultMessageId)?.responseGenerationId;
      const generationId = (selectedGeneration ? generations.get(selectedGeneration) : undefined) ?? randomUUID();
      const mappedMessageId = resultMessageId ? input.messageIdMap.get(resultMessageId) : undefined;
      let persisted = false;
      let started = false;
      const cleanup = async (): Promise<void> => {
        if (!started) return;
        const results = await Promise.allSettled([
          State.deleteOne({ ...destination, _id: stateId }),
          Memory.deleteMany({ ...destination, _id: { $in: records.map((entry) => entry._id) } }),
        ]);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      };
      return {
        cleanup,
        async persist(): Promise<void> {
          if (persisted) return;
          await assertUnused();
          started = true;
          try {
            await State.create({
              _id: stateId, ...destination, sourceMappings: mappings,
              nextDelegateOcrIndex: 0,
              ...(markdown ? {
                currentOcrResultMarkdown: markdown, currentOcrResultMessageId: mappedMessageId,
                currentOcrResultGenerationId: generationId, currentOcrResultAttemptNumber: 1,
                currentOcrResultProvenance: { generationId, attemptNumber: 1, messageId: mappedMessageId, updatedAt: new Date() },
              } : {}),
            });
            if (records.length) await Memory.insertMany(records, { ordered: true });
            persisted = true;
          } catch (error) {
            await cleanup().catch(() => undefined);
            throw error;
          }
        },
      };
    },
  };
}
