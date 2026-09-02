import { randomUUID } from 'crypto';

import {
  createSteelConversationOcrStateModel,
  createSteelDelegateOcrRunModel,
} from '@librechat/data-schemas';

import type {
  ISteelConversationOcrState,
  ISteelDelegateOcrRun,
  SteelConversationOcrResultProvenance,
  SteelDelegateOcrFailureKind,
  SteelDelegateOcrFinalizationJournal,
  SteelDelegateOcrFinalizedCandidate,
  SteelDelegateOcrStage,
  SteelDelegateOcrStatus,
  SteelDelegateOcrSupersedeProvenance,
  SteelDelegateOcrToolFile,
  SteelDelegateOcrToolParameters,
} from '@librechat/data-schemas';

type Mongoose = typeof import('mongoose');
type ConversationStateModel = ReturnType<typeof createSteelConversationOcrStateModel>;

export interface ClaimNewDelegateOcrIndexInput {
  conversationId: string;
  triggeringMessageId: string;
  claimToken?: string;
  responseGenerationId?: string;
  now?: Date;
}

export interface DelegateOcrClaim {
  conversationId: string;
  delegateOcrIndex: number;
  claimToken: string;
  triggeringMessageId: string;
  responseGenerationId?: string;
  claimedAt: Date;
}

export interface MaterializeDelegateOcrRunInput {
  conversationId: string;
  delegateOcrIndex: number;
  claimToken: string;
  triggeringMessageId: string;
  triggeringMessageText?: string;
  activeResumeKey?: string;
  toolParameters: SteelDelegateOcrToolParameters;
  files: SteelDelegateOcrToolFile[];
  responseGenerationId?: string;
}

export interface AcquireDelegateExecutionLeaseInput {
  claimToken: string;
  leaseToken?: string;
  now?: Date;
  leaseDurationMs?: number;
}

export interface DelegateExecutionLease {
  claimToken: string;
  executionLeaseToken: string;
  executionLeaseExpiresAt: Date;
}

export interface TransitionDelegateOcrRunInput {
  claimToken: string;
  executionLeaseToken?: string;
  status?: SteelDelegateOcrStatus;
  currentStage?: SteelDelegateOcrStage;
  failureKind?: SteelDelegateOcrFailureKind;
  responseGenerationId?: string;
  targetMessageId?: string;
}

export interface BeginDelegateAttemptInput {
  claimToken: string;
  executionLeaseToken?: string;
  attemptToken?: string;
}

export interface SetFinalizedCandidateInput {
  claimToken: string;
  executionLeaseToken?: string;
  candidate: SteelDelegateOcrFinalizedCandidate;
}

export interface UpdateFinalizationJournalInput {
  claimToken: string;
  executionLeaseToken?: string;
  candidateToken: string;
  journal: Partial<SteelDelegateOcrFinalizationJournal>;
}

export interface ClearCompletedClaimInput {
  conversationId: string;
  claimToken: string;
}

export interface SupersedeDelegateClaimInput {
  conversationId: string;
  claimToken: string;
  delegateOcrIndex: number;
  supersededByClaimToken: string;
  supersededByRunId?: string;
  reason: string;
  at?: Date;
}

export interface DelegateSourceMapping {
  fileId: string;
  sourceCode: string;
  sourceFilename: string;
}

export interface AllocateDelegateSourceMappingInput {
  conversationId: string;
  fileId: string;
  sourceFilename: string;
}

export interface UpsertCurrentOcrResultInput {
  conversationId: string;
  claimToken?: string;
  executionLeaseToken?: string;
  generationId: string;
  attemptNumber: number;
  markdown: string;
  messageId?: string;
  delegateOcrIndex?: number;
  expectedGenerationId?: string;
}

export interface CurrentOcrResult {
  markdown?: string;
  messageId?: string;
  delegateOcrIndex?: number;
  generationId?: string;
  attemptNumber?: number;
  provenance?: SteelConversationOcrResultProvenance;
}

export interface SteelDelegateOcrStateService {
  claimNewDelegateOcrIndex(input: ClaimNewDelegateOcrIndexInput): Promise<DelegateOcrClaim | undefined>;
  materializeDelegateOcrRun(input: MaterializeDelegateOcrRunInput): Promise<ISteelDelegateOcrRun>;
  findResumableDelegateOcrRun(input: { conversationId: string; triggeringMessageId: string }): Promise<ISteelDelegateOcrRun | null>;
  acquireDelegateExecutionLease(input: AcquireDelegateExecutionLeaseInput): Promise<DelegateExecutionLease | undefined>;
  transitionDelegateOcrRun(input: TransitionDelegateOcrRunInput): Promise<ISteelDelegateOcrRun | null>;
  beginDelegateAgentAttempt(input: BeginDelegateAttemptInput): Promise<ISteelDelegateOcrRun | null>;
  beginDelegateSaveAttempt(input: BeginDelegateAttemptInput): Promise<ISteelDelegateOcrRun | null>;
  setDelegateFinalizedCandidate(input: SetFinalizedCandidateInput): Promise<ISteelDelegateOcrRun | null>;
  updateDelegateFinalizationJournal(input: UpdateFinalizationJournalInput): Promise<ISteelDelegateOcrRun | null>;
  clearCompletedDelegateClaim(input: ClearCompletedClaimInput): Promise<ISteelConversationOcrState | null>;
  recordSupersededDelegateClaim(input: SupersedeDelegateClaimInput): Promise<ISteelConversationOcrState | null>;
  supersedeDelegateOcrRun(input: { claimToken: string; provenance: SteelDelegateOcrSupersedeProvenance }): Promise<ISteelDelegateOcrRun | null>;
  allocateDelegateSourceMapping(input: AllocateDelegateSourceMappingInput): Promise<DelegateSourceMapping>;
  upsertCurrentOcrResult(input: UpsertCurrentOcrResultInput): Promise<ISteelConversationOcrState | null>;
  readConversationOcrState(conversationId: string): Promise<ISteelConversationOcrState | null>;
  readCurrentOcrResult(conversationId: string): Promise<CurrentOcrResult | undefined>;
  readActiveDelegateClaim(conversationId: string): Promise<ISteelConversationOcrState['activeDelegateClaim'] | undefined>;
  readSourceMappings(conversationId: string): Promise<DelegateSourceMapping[]>;
  findDelegateOcrRunByClaimToken(claimToken: string): Promise<ISteelDelegateOcrRun | null>;
  findActiveDelegateOcrRun(conversationId: string): Promise<ISteelDelegateOcrRun | null>;
}

function isDuplicateKeyError(error: object): boolean {
  return 'code' in error && error.code === 11000;
}

function assertDelegateOcrIndex(delegateOcrIndex: number): void {
  if (!Number.isSafeInteger(delegateOcrIndex) || delegateOcrIndex < 1) {
    throw new Error('delegateOcrIndex must be a positive safe integer');
  }
}

function getRunFilter(input: {
  claimToken: string;
  executionLeaseToken?: string;
}) {
  return {
    claimToken: input.claimToken,
    ...(input.executionLeaseToken
      ? { executionLeaseToken: input.executionLeaseToken }
      : {}),
  };
}

async function ensureConversationState(
  State: ConversationStateModel,
  conversationId: string,
): Promise<void> {
  await State.updateOne(
    { conversationId },
    {
      $setOnInsert: {
        conversationId,
        nextDelegateOcrIndex: 0,
        sourceMappings: [],
      },
    },
    { upsert: true },
  );
}

export function createSteelDelegateOcrStateService(mongoose: Mongoose): SteelDelegateOcrStateService {
  const Run = createSteelDelegateOcrRunModel(mongoose);
  const State = createSteelConversationOcrStateModel(mongoose);

  async function claimNewDelegateOcrIndex(
    input: ClaimNewDelegateOcrIndexInput,
  ): Promise<DelegateOcrClaim | undefined> {
    await ensureConversationState(State, input.conversationId);
    const claimToken = input.claimToken ?? randomUUID();
    const now = input.now ?? new Date();
    const existingState = await State.findOne({ conversationId: input.conversationId })
      .select({ activeDelegateClaim: 1 })
      .lean<ISteelConversationOcrState>();
    const existingClaim = existingState?.activeDelegateClaim;
    if (existingClaim) {
      const existingRun = await Run.findOne({ claimToken: existingClaim.claimToken })
        .select({ status: 1 })
        .lean<ISteelDelegateOcrRun>();
      const missingRunExpired =
        !existingRun &&
        existingClaim.claimedAt instanceof Date &&
        existingClaim.claimedAt.getTime() <= now.getTime() - 60_000;
      if (missingRunExpired || ['completed', 'superseded'].includes(existingRun?.status ?? '')) {
        await State.updateOne(
          {
            conversationId: input.conversationId,
            'activeDelegateClaim.claimToken': existingClaim.claimToken,
          },
          { $unset: { activeDelegateClaim: 1 } },
        );
      }
    }
    const activeClaimAbsent = { activeDelegateClaim: { $exists: false } };
    const state = await State.findOneAndUpdate(
      { conversationId: input.conversationId, ...activeClaimAbsent },
      [
        {
          $set: {
            nextDelegateOcrIndex: {
              $add: [{ $ifNull: ['$nextDelegateOcrIndex', 0] }, 1],
            },
            activeDelegateClaim: {
              claimToken: { $literal: claimToken },
              triggeringMessageId: { $literal: input.triggeringMessageId },
              delegateOcrIndex: {
                $add: [{ $ifNull: ['$nextDelegateOcrIndex', 0] }, 1],
              },
              ...(input.responseGenerationId
                ? { responseGenerationId: { $literal: input.responseGenerationId } }
                : {}),
              phase: { $literal: 'claimed' },
              claimedAt: { $literal: now },
              updatedAt: { $literal: now },
            },
          },
        },
      ],
      { new: true },
    ).lean<ISteelConversationOcrState>();

    const activeClaim = state?.activeDelegateClaim;
    if (!activeClaim || activeClaim.claimToken !== claimToken) {
      return undefined;
    }
    return {
      conversationId: input.conversationId,
      delegateOcrIndex: activeClaim.delegateOcrIndex,
      claimToken,
      triggeringMessageId: activeClaim.triggeringMessageId,
      ...(activeClaim.responseGenerationId
        ? { responseGenerationId: activeClaim.responseGenerationId }
        : {}),
      claimedAt: activeClaim.claimedAt,
    };
  }

  async function materializeDelegateOcrRun(
    input: MaterializeDelegateOcrRunInput,
  ): Promise<ISteelDelegateOcrRun> {
    assertDelegateOcrIndex(input.delegateOcrIndex);
    const update = {
      $setOnInsert: {
        conversationId: input.conversationId,
        delegateOcrIndex: input.delegateOcrIndex,
        claimToken: input.claimToken,
        activeResumeKey: input.activeResumeKey,
        triggeringMessageId: input.triggeringMessageId,
        triggeringMessageText: input.triggeringMessageText,
        toolParameters: input.toolParameters,
        files: input.files,
        status: 'running' as const,
        currentStage: 'claiming' as const,
        agentAttemptNumber: 0,
        saveAttemptNumber: 0,
        responseGenerationId: input.responseGenerationId,
        finalizationJournal: {
          candidateValidated: false,
          resultPersisted: false,
          messagePersisted: false,
          claimCleared: false,
        },
      },
    };
    try {
      const run = await Run.findOneAndUpdate(
        { conversationId: input.conversationId, delegateOcrIndex: input.delegateOcrIndex },
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean<ISteelDelegateOcrRun>();
      if (!run) {
        throw new Error('delegate OCR run materialization returned no document');
      }
      return run;
    } catch (error) {
      if (typeof error !== 'object' || error === null || !isDuplicateKeyError(error)) {
        throw error;
      }
      const run = await Run.findOne({
        conversationId: input.conversationId,
        delegateOcrIndex: input.delegateOcrIndex,
      }).lean<ISteelDelegateOcrRun>();
      if (!run) {
        throw error;
      }
      return run;
    }
  }

  function findResumableDelegateOcrRun(input: {
    conversationId: string;
    triggeringMessageId: string;
  }): Promise<ISteelDelegateOcrRun | null> {
    return Run.findOne({
      conversationId: input.conversationId,
      triggeringMessageId: input.triggeringMessageId,
      status: { $in: ['running', 'agent_running', 'finalizing', 'agent_failed', 'save_failed'] },
    })
      .sort({ delegateOcrIndex: -1 })
      .lean<ISteelDelegateOcrRun>();
  }

  async function acquireDelegateExecutionLease(
    input: AcquireDelegateExecutionLeaseInput,
  ): Promise<DelegateExecutionLease | undefined> {
    const now = input.now ?? new Date();
    const executionLeaseToken = input.leaseToken ?? randomUUID();
    const leaseDurationMs = input.leaseDurationMs ?? 60_000;
    const executionLeaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const run = await Run.findOneAndUpdate(
      {
        claimToken: input.claimToken,
        status: { $nin: ['completed', 'superseded'] },
        $or: [
          { executionLeaseToken },
          { executionLeaseExpiresAt: { $exists: false } },
          { executionLeaseExpiresAt: { $lte: now } },
        ],
      },
      { $set: { executionLeaseToken, executionLeaseExpiresAt } },
      { new: true },
    ).lean<ISteelDelegateOcrRun>();
    if (!run) {
      return undefined;
    }
    const state = await State.findOneAndUpdate(
      {
        conversationId: run.conversationId,
        'activeDelegateClaim.claimToken': input.claimToken,
        'activeDelegateClaim.delegateOcrIndex': run.delegateOcrIndex,
      },
      { $set: { 'activeDelegateClaim.executionLeaseToken': executionLeaseToken } },
      { new: true },
    ).lean<ISteelConversationOcrState>();
    if (!state) {
      return undefined;
    }
    return { claimToken: input.claimToken, executionLeaseToken, executionLeaseExpiresAt };
  }

  function transitionDelegateOcrRun(
    input: TransitionDelegateOcrRunInput,
  ): Promise<ISteelDelegateOcrRun | null> {
    const $set = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.currentStage ? { currentStage: input.currentStage } : {}),
      ...(input.failureKind ? { failureKind: input.failureKind } : {}),
      ...(input.responseGenerationId ? { responseGenerationId: input.responseGenerationId } : {}),
      ...(input.targetMessageId ? { targetMessageId: input.targetMessageId } : {}),
    };
    return Run.findOneAndUpdate(getRunFilter(input), { $set }, { new: true }).lean<ISteelDelegateOcrRun>();
  }

  async function beginDelegateAgentAttempt(
    input: BeginDelegateAttemptInput,
  ): Promise<ISteelDelegateOcrRun | null> {
    const agentAttemptToken = input.attemptToken ?? randomUUID();
    return Run.findOneAndUpdate(
      getRunFilter(input),
      {
        $inc: { agentAttemptNumber: 1 },
        $set: { agentAttemptToken, status: 'agent_running', currentStage: 'agent' },
      },
      { new: true },
    ).lean<ISteelDelegateOcrRun>();
  }

  async function beginDelegateSaveAttempt(
    input: BeginDelegateAttemptInput,
  ): Promise<ISteelDelegateOcrRun | null> {
    const saveAttemptToken = input.attemptToken ?? randomUUID();
    return Run.findOneAndUpdate(
      getRunFilter(input),
      {
        $inc: { saveAttemptNumber: 1 },
        $set: { saveAttemptToken, status: 'finalizing', currentStage: 'saving' },
      },
      { new: true },
    ).lean<ISteelDelegateOcrRun>();
  }

  function setDelegateFinalizedCandidate(
    input: SetFinalizedCandidateInput,
  ): Promise<ISteelDelegateOcrRun | null> {
    return Run.findOneAndUpdate(
      getRunFilter(input),
      { $set: { finalizedCandidate: input.candidate, currentStage: 'finalizing', status: 'finalizing' } },
      { new: true },
    ).lean<ISteelDelegateOcrRun>();
  }

  function updateDelegateFinalizationJournal(
    input: UpdateFinalizationJournalInput,
  ): Promise<ISteelDelegateOcrRun | null> {
    const journalUpdates = Object.entries(input.journal).reduce(
      (updates, [key, value]) => {
        updates[`finalizationJournal.${key}`] = value;
        return updates;
      },
      {} as { [key: string]: boolean | string | undefined },
    );
    return Run.findOneAndUpdate(
      {
        ...getRunFilter(input),
        'finalizedCandidate.token': input.candidateToken,
      },
      { $set: journalUpdates },
      { new: true },
    ).lean<ISteelDelegateOcrRun>();
  }

  function clearCompletedDelegateClaim(
    input: ClearCompletedClaimInput,
  ): Promise<ISteelConversationOcrState | null> {
    return State.findOneAndUpdate(
      {
        conversationId: input.conversationId,
        'activeDelegateClaim.claimToken': input.claimToken,
      },
      {
        $unset: { activeDelegateClaim: 1 },
      },
      { new: true },
    ).lean<ISteelConversationOcrState>();
  }

  async function recordSupersededDelegateClaim(
    input: SupersedeDelegateClaimInput,
  ): Promise<ISteelConversationOcrState | null> {
    await ensureConversationState(State, input.conversationId);
    const at = input.at ?? new Date();
    return State.findOneAndUpdate(
      {
        conversationId: input.conversationId,
        'activeDelegateClaim.claimToken': input.claimToken,
      },
      {
        $set: {
          supersededClaimRecovery: {
            claimToken: input.claimToken,
            delegateOcrIndex: input.delegateOcrIndex,
            supersededByClaimToken: input.supersededByClaimToken,
            reason: input.reason,
            at,
          },
        },
      },
      { new: true },
    ).lean<ISteelConversationOcrState>();
  }

  async function supersedeDelegateOcrRun(input: {
    claimToken: string;
    provenance: SteelDelegateOcrSupersedeProvenance;
  }): Promise<ISteelDelegateOcrRun | null> {
    return Run.findOneAndUpdate(
      { claimToken: input.claimToken, status: { $nin: ['completed', 'superseded'] } },
      { $set: { status: 'superseded', currentStage: 'completed', supersedeProvenance: input.provenance } },
      { new: true },
    ).lean<ISteelDelegateOcrRun>();
  }

  async function allocateDelegateSourceMapping(
    input: AllocateDelegateSourceMappingInput,
  ): Promise<DelegateSourceMapping> {
    await ensureConversationState(State, input.conversationId);
    const existing = await State.findOne({
      conversationId: input.conversationId,
      'sourceMappings.fileId': input.fileId,
    })
      .select({ sourceMappings: 1 })
      .lean<ISteelConversationOcrState>();
    const existingMapping = existing?.sourceMappings.find((mapping) => mapping.fileId === input.fileId);
    if (existingMapping) {
      return {
        fileId: existingMapping.fileId,
        sourceCode: existingMapping.sourceCode,
        sourceFilename: existingMapping.sourceFilename,
      };
    }

    for (;;) {
      const state = await State.findOne({ conversationId: input.conversationId })
        .select({ sourceMappings: 1 })
        .lean<ISteelConversationOcrState>();
      const racedMapping = state?.sourceMappings.find((mapping) => mapping.fileId === input.fileId);
      if (racedMapping) {
        return {
          fileId: racedMapping.fileId,
          sourceCode: racedMapping.sourceCode,
          sourceFilename: racedMapping.sourceFilename,
        };
      }
      const highest = (state?.sourceMappings ?? []).reduce((max, mapping) => {
        const match = /^F(\d+)$/u.exec(mapping.sourceCode);
        const value = match ? Number(match[1]) : 0;
        return Number.isSafeInteger(value) ? Math.max(max, value) : max;
      }, 0);
      const sourceCode = `F${highest + 1}`;
      const updated = await State.findOneAndUpdate(
        {
          conversationId: input.conversationId,
          'sourceMappings.fileId': { $ne: input.fileId },
          'sourceMappings.sourceCode': { $ne: sourceCode },
        },
        {
          $push: {
            sourceMappings: {
              fileId: input.fileId,
              sourceCode,
              sourceFilename: input.sourceFilename,
              createdAt: new Date(),
            },
          },
        },
        { new: true },
      ).lean<ISteelConversationOcrState>();
      const mapping = updated?.sourceMappings.find((entry) => entry.fileId === input.fileId);
      if (mapping) {
        return {
          fileId: mapping.fileId,
          sourceCode: mapping.sourceCode,
          sourceFilename: mapping.sourceFilename,
        };
      }
    }
  }

  async function upsertCurrentOcrResult(
    input: UpsertCurrentOcrResultInput,
  ): Promise<ISteelConversationOcrState | null> {
    await ensureConversationState(State, input.conversationId);
    const delegateOcrIndex = input.delegateOcrIndex;
    const isDelegateResult = delegateOcrIndex !== undefined;
    if (isDelegateResult && (!input.claimToken || !input.executionLeaseToken)) {
      return null;
    }
    if (isDelegateResult) {
      assertDelegateOcrIndex(delegateOcrIndex);
    }
    const provenance: SteelConversationOcrResultProvenance = {
      generationId: input.generationId,
      attemptNumber: input.attemptNumber,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.claimToken ? { claimToken: input.claimToken } : {}),
      updatedAt: new Date(),
    };
    const generationGuard = {} as {
      currentOcrResultGenerationId?: string;
      $or?: Array<{
        currentOcrResultGenerationId: { $exists: false } | string;
        currentOcrResultAttemptNumber?: { $lte: number };
      }>;
    };
    if (!isDelegateResult) {
      if (input.expectedGenerationId) {
        generationGuard.currentOcrResultGenerationId = input.expectedGenerationId;
      } else {
        generationGuard.$or = [
          { currentOcrResultGenerationId: { $exists: false } },
          {
            currentOcrResultGenerationId: input.generationId,
            currentOcrResultAttemptNumber: { $lte: input.attemptNumber },
          },
        ];
      }
    }
    const claimGuard = isDelegateResult
      ? {
          'activeDelegateClaim.claimToken': input.claimToken,
          'activeDelegateClaim.delegateOcrIndex': delegateOcrIndex,
          'activeDelegateClaim.executionLeaseToken': input.executionLeaseToken,
        }
      : {};
    const result = await State.findOneAndUpdate(
      {
        conversationId: input.conversationId,
        ...generationGuard,
        ...claimGuard,
      },
      {
        $set: {
          currentOcrResultMarkdown: input.markdown,
          currentOcrResultMessageId: input.messageId,
          currentOcrResultIndex: input.delegateOcrIndex,
          currentOcrResultGenerationId: input.generationId,
          currentOcrResultAttemptNumber: input.attemptNumber,
          currentOcrResultProvenance: provenance,
        },
      },
      { new: true },
    ).lean<ISteelConversationOcrState>();
    return result;
  }

  function readConversationOcrState(
    conversationId: string,
  ): Promise<ISteelConversationOcrState | null> {
    return State.findOne({ conversationId }).lean<ISteelConversationOcrState>();
  }

  async function readCurrentOcrResult(conversationId: string): Promise<CurrentOcrResult | undefined> {
    const state = await State.findOne({ conversationId })
      .select({
        currentOcrResultMarkdown: 1,
        currentOcrResultMessageId: 1,
        currentOcrResultIndex: 1,
        currentOcrResultGenerationId: 1,
        currentOcrResultAttemptNumber: 1,
        currentOcrResultProvenance: 1,
      })
      .lean<ISteelConversationOcrState>();
    if (!state || state.currentOcrResultMarkdown === undefined) {
      return undefined;
    }
    return {
      markdown: state.currentOcrResultMarkdown,
      ...(state.currentOcrResultMessageId
        ? { messageId: state.currentOcrResultMessageId }
        : {}),
      ...(state.currentOcrResultIndex !== undefined
        ? { delegateOcrIndex: state.currentOcrResultIndex }
        : {}),
      ...(state.currentOcrResultGenerationId
        ? { generationId: state.currentOcrResultGenerationId }
        : {}),
      ...(state.currentOcrResultAttemptNumber !== undefined
        ? { attemptNumber: state.currentOcrResultAttemptNumber }
        : {}),
      ...(state.currentOcrResultProvenance
        ? { provenance: state.currentOcrResultProvenance }
        : {}),
    };
  }

  function readActiveDelegateClaim(
    conversationId: string,
  ): Promise<ISteelConversationOcrState['activeDelegateClaim'] | undefined> {
    return State.findOne({ conversationId })
      .select({ activeDelegateClaim: 1 })
      .lean<ISteelConversationOcrState>()
      .then((state) => state?.activeDelegateClaim);
  }

  async function readSourceMappings(
    conversationId: string,
  ): Promise<DelegateSourceMapping[]> {
    const state = await State.findOne({ conversationId })
      .select({ sourceMappings: 1 })
      .lean<ISteelConversationOcrState>();
    return (state?.sourceMappings ?? []).map((mapping) => ({
      fileId: mapping.fileId,
      sourceCode: mapping.sourceCode,
      sourceFilename: mapping.sourceFilename,
    }));
  }

  function findDelegateOcrRunByClaimToken(
    claimToken: string,
  ): Promise<ISteelDelegateOcrRun | null> {
    return Run.findOne({ claimToken }).lean<ISteelDelegateOcrRun>();
  }

  function findActiveDelegateOcrRun(
    conversationId: string,
  ): Promise<ISteelDelegateOcrRun | null> {
    return Run.findOne({
      conversationId,
      status: { $nin: ['completed', 'superseded'] },
    })
      .sort({ delegateOcrIndex: -1 })
      .lean<ISteelDelegateOcrRun>();
  }

  return {
    claimNewDelegateOcrIndex,
    materializeDelegateOcrRun,
    findResumableDelegateOcrRun,
    acquireDelegateExecutionLease,
    transitionDelegateOcrRun,
    beginDelegateAgentAttempt,
    beginDelegateSaveAttempt,
    setDelegateFinalizedCandidate,
    updateDelegateFinalizationJournal,
    clearCompletedDelegateClaim,
    recordSupersededDelegateClaim,
    supersedeDelegateOcrRun,
    allocateDelegateSourceMapping,
    upsertCurrentOcrResult,
    readConversationOcrState,
    readCurrentOcrResult,
    readActiveDelegateClaim,
    readSourceMappings,
    findDelegateOcrRunByClaimToken,
    findActiveDelegateOcrRun,
  };
}

export const createSteelOcrStateService: typeof createSteelDelegateOcrStateService =
  createSteelDelegateOcrStateService;
