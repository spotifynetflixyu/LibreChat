import { createHash, randomUUID } from 'node:crypto';
import { isJSONArray, isJSONObject, isJSONValue } from '@ai-sdk/provider';
import type {
  OAuthCompactionScope as StoredOAuthCompactionScope,
  OAuthCompactionState as StoredOAuthCompactionState,
  OAuthCompactionStore,
  OAuthCompactionUsage as StoredOAuthCompactionUsage,
} from '@librechat/data-schemas';
import type {
  OAuthCompactionConfig as DataProviderOAuthCompactionConfig,
  TContextUsageEvent,
} from 'librechat-data-provider';
import type { JSONObject, JSONArray, JSONValue } from '@ai-sdk/provider';
import type { OpenAIOAuthFetch } from '~/steel/native/credentials';
import type { TextTokenCounter } from './budget';
import { estimateTokens } from './budget';

export type OAuthCompactionConfig = DataProviderOAuthCompactionConfig;

export interface OAuthCompactionScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly executionId: string;
}

export type OAuthCompactionUsage = StoredOAuthCompactionUsage;
export type OAuthCompactionState = StoredOAuthCompactionState;
export type { OAuthCompactionStore };
type OAuthCompactionSaveState = Pick<
  OAuthCompactionState,
  'coveredHashes' | 'opaque' | 'usage' | 'expiresAt'
>;

export type OAuthCompactionStatusPhase = 'started' | 'completed' | 'failed' | 'cancelled';

export type OAuthCompactionErrorCode =
  | 'invalid_config'
  | 'invalid_request'
  | 'lease_busy'
  | 'provider_unavailable'
  | 'malformed_stream'
  | 'response_too_large'
  | 'context_too_large'
  | 'persist_failed'
  | 'aborted'
  | 'unsupported_request';

export interface OAuthCompactionStatus {
  readonly id: string;
  readonly phase: OAuthCompactionStatusPhase;
  readonly agentId: string;
  readonly executionId: string;
  readonly runId?: string;
  readonly code?: OAuthCompactionErrorCode;
}

export interface OAuthCompactionOptions {
  readonly store: OAuthCompactionStore;
  readonly config: OAuthCompactionConfig;
  readonly scope: OAuthCompactionScope;
  readonly compactOnly?: boolean;
  readonly onContextUsage?: (
    usage: TContextUsageEvent,
    metadata?: Record<string, unknown>,
  ) => void | Promise<void>;
  readonly onStatus?: (
    status: OAuthCompactionStatus,
    metadata?: Record<string, unknown>,
  ) => void | Promise<void>;
}

export interface OAuthCompactionRequest {
  readonly body: JSONObject;
  readonly input: JSONArray;
  readonly model: string;
  readonly accountHash: string;
  readonly instructionsHash: string;
  readonly shapingHash: string;
}

export interface OAuthCompactionRuntime {
  fetch(input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit): Promise<Response>;
  compactOnly(input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit): Promise<void>;
}

export class OAuthCompactionError extends Error {
  readonly code: OAuthCompactionErrorCode;

  constructor(code: OAuthCompactionErrorCode) {
    super('OpenAI OAuth compaction failed');
    this.name = 'OAuthCompactionError';
    this.code = code;
  }
}

export const DEFAULT_OAUTH_COMPACTION_TIMEOUT_MS = 120_000;

export function validateOAuthCompactionConfig(config: OAuthCompactionConfig): void {
  if (
    typeof config.enabled !== 'boolean' ||
    !Number.isFinite(config.triggerRatio) ||
    config.triggerRatio <= 0 ||
    config.triggerRatio > 1 ||
    !Number.isSafeInteger(config.maxContextTokens) ||
    config.maxContextTokens <= 0 ||
    !Number.isSafeInteger(config.outputReserveTokens) ||
    config.outputReserveTokens < 0 ||
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs <= 0 ||
    !Number.isSafeInteger(config.maxResponseBytes) ||
    config.maxResponseBytes <= 0 ||
    !Number.isSafeInteger(config.retentionDays) ||
    config.retentionDays <= 0
  ) {
    throw new OAuthCompactionError('invalid_config');
  }
}

function canonicalize(value: JSONValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (isJSONObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashJSON(value: JSONValue): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function parseBody(body: BodyInit | null | undefined): JSONObject | null {
  if (typeof body !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return isJSONObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function headerValue(input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit): string | null {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const account = headers.get('chatgpt-account-id');
  return account && account.trim() !== '' ? account : null;
}

function requestURL(input: Parameters<OpenAIOAuthFetch>[0]): URL | null {
  try {
    return new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return null;
  }
}

function requestMethod(input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestBody(input: Parameters<OpenAIOAuthFetch>[0], init?: RequestInit): BodyInit | null {
  return init?.body ?? (input instanceof Request ? input.clone().body : null);
}

function stringProperty(value: JSONObject, key: string): string | undefined {
  const property = value[key];
  return typeof property === 'string' ? property : undefined;
}

function isRetryableContextError(value: JSONValue | null): boolean {
  if (!isJSONObject(value)) {
    return false;
  }
  if (Object.keys(value).some((key) => key !== 'type' && key !== 'code')) {
    return false;
  }
  return (
    stringProperty(value, 'type') === 'invalid_request_error' &&
    stringProperty(value, 'code') === 'context_length_exceeded'
  );
}

function arrayProperty(value: JSONObject, key: string): JSONArray | undefined {
  const property = value[key];
  return isJSONArray(property) ? property : undefined;
}

function roleOf(item: JSONValue): string | undefined {
  return isJSONObject(item) ? stringProperty(item, 'role') : undefined;
}

function normalizedInstructions(body: JSONObject, input: JSONArray): JSONValue {
  const developer = input.filter((item) => roleOf(item) === 'developer');
  const instructions = isJSONValue(body.instructions) ? body.instructions : null;
  return { instructions, developer };
}

function normalizedShaping(body: JSONObject): JSONObject {
  const shaping: JSONObject = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'input' && key !== 'stream' && value !== undefined) {
      shaping[key] = value;
    }
  }
  return shaping;
}

export function parseOAuthCompactionRequest(
  input: Parameters<OpenAIOAuthFetch>[0],
  init?: RequestInit,
): OAuthCompactionRequest | null {
  const url = requestURL(input);
  if (
    url === null ||
    !url.pathname.endsWith('/responses') ||
    requestMethod(input, init) !== 'POST'
  ) {
    return null;
  }
  const body = parseBody(requestBody(input, init));
  if (body === null) {
    return null;
  }
  const model = stringProperty(body, 'model');
  const bodyInput = arrayProperty(body, 'input');
  const account = headerValue(input, init);
  if (model === undefined || bodyInput === undefined || account === null) {
    return null;
  }
  const accountHash = createHash('sha256').update(account).digest('hex');
  const instructionsHash = hashJSON({
    instructions: normalizedInstructions(body, bodyInput),
    shaping: normalizedShaping(body),
  });
  const shapingHash = hashJSON({
    accountHash,
    instructionsHash,
    model,
    body: normalizedShaping(body),
  });
  return { body, input: bodyInput, model, accountHash, instructionsHash, shapingHash };
}

function nowMs(): Date {
  return new Date();
}

function expiration(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

function ownerId(scope: OAuthCompactionScope): string {
  return `${scope.executionId}:${randomUUID()}`;
}

function statusId(): string {
  return randomUUID();
}

function statusEvent(
  scope: OAuthCompactionScope,
  phase: OAuthCompactionStatusPhase,
  id: string,
  code?: OAuthCompactionErrorCode,
): OAuthCompactionStatus {
  return {
    id,
    phase,
    agentId: scope.agentId,
    executionId: scope.executionId,
    ...(code === undefined ? {} : { code }),
  };
}

async function emitStatus(
  callback: OAuthCompactionOptions['onStatus'],
  status: OAuthCompactionStatus,
): Promise<void> {
  await callback?.(status);
}

export function estimateContextTokens(
  input: JSONArray,
  outputReserveTokens: number,
  countText: TextTokenCounter,
): number {
  return input.reduce<number>(
    (tokens, item) => tokens + estimateTokens(item, countText).knownTokens,
    outputReserveTokens,
  );
}

function hasClosedFunctionCalls(input: JSONArray): boolean {
  const calls = new Set<string>();
  const outputs = new Set<string>();
  for (const item of input) {
    if (!isJSONObject(item)) {
      continue;
    }
    const type = stringProperty(item, 'type');
    const id = stringProperty(item, 'call_id');
    if (type === 'function_call' && id !== undefined) {
      calls.add(id);
    }
    if (type === 'function_call_output' && id !== undefined) {
      outputs.add(id);
    }
  }
  for (const id of calls) {
    if (!outputs.has(id)) {
      return false;
    }
  }
  for (const id of outputs) {
    if (!calls.has(id)) {
      return false;
    }
  }
  return true;
}

function inputHashes(input: JSONArray): string[] {
  return input.map((item) => hashJSON(item));
}

function validateOpaque(opaque: string): JSONObject | null {
  try {
    const parsed: unknown = JSON.parse(opaque);
    if (!isJSONObject(parsed)) {
      return null;
    }
    const type = stringProperty(parsed, 'type');
    const ciphertext = stringProperty(parsed, 'encrypted_content');
    return type === 'compaction' &&
      ciphertext !== undefined &&
      ciphertext.length > 0 &&
      JSON.stringify(parsed) === opaque
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function validStoredState(state: OAuthCompactionState | null): state is OAuthCompactionState {
  if (
    state === null ||
    state.coveredHashes.length === 0 ||
    state.coveredHashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash)) ||
    !(state.expiresAt instanceof Date) ||
    !Number.isFinite(state.expiresAt.getTime()) ||
    state.expiresAt.getTime() <= Date.now() ||
    validateOpaque(state.opaque) === null
  ) {
    return false;
  }
  return (
    state.usage === undefined ||
    (Number.isSafeInteger(state.usage.inputTokens) &&
      state.usage.inputTokens >= 0 &&
      state.usage.inputHashes.length > 0 &&
      state.usage.inputHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash)) &&
      /^[a-f0-9]{64}$/u.test(state.usage.shapingHash))
  );
}

function matchingPrefix(input: JSONArray, coveredHashes: readonly string[]): number {
  const hashes = inputHashes(input);
  if (coveredHashes.length > hashes.length) {
    return 0;
  }
  for (let index = 0; index < coveredHashes.length; index += 1) {
    if (hashes[index] !== coveredHashes[index]) {
      return 0;
    }
  }
  return coveredHashes.length;
}

interface RestoredInput {
  readonly input: JSONArray;
  readonly coverage: readonly (readonly number[])[];
}

function restoreInputWithCoverage(
  input: JSONArray,
  state: OAuthCompactionState,
): RestoredInput | null {
  const opaqueItem = validateOpaque(state.opaque);
  if (opaqueItem === null) {
    return null;
  }
  const prefixLength = matchingPrefix(input, state.coveredHashes);
  if (prefixLength === 0) {
    return null;
  }
  const retained: JSONValue[] = [];
  const retainedCoverage: number[][] = [];
  for (let index = 0; index < prefixLength; index += 1) {
    const item = input[index];
    if (item !== undefined && (roleOf(item) === 'user' || roleOf(item) === 'developer')) {
      retained.push(item);
      retainedCoverage.push([index]);
    }
  }
  const tail = input.slice(prefixLength);
  const tailCoverage = tail.map((_, index) => [prefixLength + index]);
  return {
    input: [...retained, opaqueItem, ...tail],
    coverage: [
      ...retainedCoverage,
      Array.from({ length: prefixLength }, (_, index) => index),
      ...tailCoverage,
    ],
  };
}

function restoreInput(input: JSONArray, state: OAuthCompactionState): JSONArray | null {
  return restoreInputWithCoverage(input, state)?.input ?? null;
}

function eligiblePrefix(input: JSONArray, costs: readonly number[], maxTokens: number): JSONArray {
  const calls = new Set<string>();
  const outputs = new Set<string>();
  let tokens = 0;
  let closedLength = 0;
  let firstClosedLength = 0;
  for (let index = 0; index < input.length; index++) {
    tokens += costs[index];
    const item = input[index];
    if (isJSONObject(item)) {
      const id = stringProperty(item, 'call_id');
      if (id !== undefined && item.type === 'function_call') {
        if (!outputs.delete(id)) calls.add(id);
      }
      if (id !== undefined && item.type === 'function_call_output') {
        if (!calls.delete(id)) outputs.add(id);
      }
    }
    if (calls.size !== 0 || outputs.size !== 0) continue;
    firstClosedLength ||= index + 1;
    if (tokens > maxTokens) break;
    closedLength = index + 1;
  }
  // Estimates cannot prove admission. Let the provider check the shortest
  // complete group when none appears to fit, including opaque/media context.
  return input.slice(0, closedLength || firstClosedLength);
}

function coveredPrefixLength(
  coverage: readonly (readonly number[])[],
  itemCount: number,
): number | null {
  const indices = Array.from(
    new Set(coverage.slice(0, itemCount).flatMap((itemCoverage) => itemCoverage)),
  ).sort((left, right) => left - right);
  if (indices.length === 0) {
    return null;
  }
  const highest = indices[indices.length - 1];
  if (highest === undefined || indices.length !== highest + 1) {
    return null;
  }
  for (let index = 0; index <= highest; index += 1) {
    if (indices[index] !== index) {
      return null;
    }
  }
  return highest + 1;
}

function withInput(body: JSONObject, input: JSONArray): JSONObject {
  return { ...body, input };
}

function requestWithBody(
  input: Parameters<OpenAIOAuthFetch>[0],
  init: RequestInit | undefined,
  body: JSONObject,
  signal: AbortSignal,
): { input: Parameters<OpenAIOAuthFetch>[0]; init: RequestInit } {
  const nextInit: RequestInit = {
    ...init,
    body: JSON.stringify(body),
    signal,
  };
  return { input, init: nextInit };
}

export function createOAuthCompactionRuntime(
  fetch: OpenAIOAuthFetch,
  options: OAuthCompactionOptions,
  stream: {
    compact: (
      response: Response,
      signal: AbortSignal,
      maxBytes: number,
      captureResponse?: boolean,
    ) => Promise<{
      readonly opaque: string;
      readonly inputTokens: number;
      readonly response?: Response;
    }>;
    readError: (
      response: Response,
      signal: AbortSignal,
      maxBytes: number,
    ) => Promise<JSONValue | null>;
    inspect: (
      response: Response,
      options: {
        readonly signal: AbortSignal;
        readonly maxBytes: number;
        readonly onCompleted: (inputTokens: number) => Promise<void>;
        readonly onFinished: (outcome: 'completed' | 'cancelled' | 'failed') => Promise<void>;
      },
    ) => Response;
  },
  getTokenCounter: () => Promise<TextTokenCounter>,
): OAuthCompactionRuntime {
  validateOAuthCompactionConfig(options.config);
  const passthrough = async (
    requestInput: Parameters<OpenAIOAuthFetch>[0],
    requestInit: RequestInit | undefined,
  ): Promise<Response> => fetch(requestInput, requestInit);

  const run = async (
    requestInput: Parameters<OpenAIOAuthFetch>[0],
    requestInit: RequestInit | undefined,
    parsed: OAuthCompactionRequest,
    compactOnly = options.compactOnly === true,
  ): Promise<Response | null> => {
    const { config, scope, store } = options;
    if (!config.enabled) {
      if (compactOnly) {
        throw new OAuthCompactionError('unsupported_request');
      }
      return passthrough(requestInput, requestInit);
    }
    const threshold = config.maxContextTokens * config.triggerRatio;
    const eventId = statusId();
    const leaseOwner = ownerId(scope);
    const storeScope: StoredOAuthCompactionScope = {
      ...scope,
      accountHash: parsed.accountHash,
      model: parsed.model,
      instructionsHash: parsed.instructionsHash,
    };
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    const callerSignal = requestInit?.signal;
    if (callerSignal?.aborted) {
      throw new OAuthCompactionError('aborted');
    }
    callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    if (callerSignal?.aborted) {
      callerSignal.removeEventListener('abort', forwardAbort);
      throw new OAuthCompactionError('aborted');
    }
    const deadline = setTimeout(() => controller.abort(), config.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(deadline);
      callerSignal?.removeEventListener('abort', forwardAbort);
    };
    const now = nowMs();
    let acquired: Awaited<ReturnType<OAuthCompactionStore['acquireOAuthCompaction']>>;
    try {
      acquired = await store.acquireOAuthCompaction({
        scope: storeScope,
        ownerId: leaseOwner,
        now,
        leaseExpiresAt: new Date(now.getTime() + config.timeoutMs),
        expiresAt: expiration(now, config.retentionDays),
      });
    } catch {
      cleanup();
      throw new OAuthCompactionError('provider_unavailable');
    }
    if (!acquired.ok) {
      cleanup();
      throw new OAuthCompactionError('lease_busy');
    }
    if (controller.signal.aborted) {
      try {
        await store.releaseOAuthCompaction({ scope: storeScope, ownerId: leaseOwner });
      } catch {
        // Lease cleanup must not replace the stable abort error.
      }
      cleanup();
      throw new OAuthCompactionError('aborted');
    }
    let revision = acquired.revision;
    let leaseHeld = true;
    const release = async (): Promise<void> => {
      if (!leaseHeld) {
        return;
      }
      leaseHeld = false;
      try {
        await store.releaseOAuthCompaction({ scope: storeScope, ownerId: leaseOwner });
      } catch {
        // Lease cleanup must not replace the stable provider/runtime error.
      }
    };
    let streaming = false;
    let statusStarted = false;
    let compactionCompleted = false;
    try {
      if (controller.signal.aborted || callerSignal?.aborted) {
        throw new OAuthCompactionError('aborted');
      }
      let body = parsed.body;
      let currentInput = parsed.input;
      let currentCoverage: readonly (readonly number[])[] = parsed.input.map((_, index) => [index]);
      if (acquired.state !== null && !validStoredState(acquired.state)) {
        throw new OAuthCompactionError('persist_failed');
      }
      const stored = acquired.state;
      let activeState: OAuthCompactionState | null = stored;
      const restoredWithCoverage =
        stored === null ? null : restoreInputWithCoverage(currentInput, stored);
      const restored = restoredWithCoverage?.input ?? null;
      const storedUsage = stored?.usage;
      const usageBaselineMatches =
        storedUsage !== undefined &&
        storedUsage.shapingHash === parsed.shapingHash &&
        restored !== null &&
        matchingPrefix(restored, storedUsage.inputHashes) === storedUsage.inputHashes.length;
      const countText = await getTokenCounter();
      const requestEnvelopeTokens = estimateTokens(normalizedShaping(body), countText).knownTokens;
      const estimateInput = (input: JSONArray, reserve = 0) =>
        estimateContextTokens(input, reserve, countText);
      const inputEstimate =
        usageBaselineMatches && restored !== null
          ? (storedUsage?.inputTokens ?? 0) +
            estimateInput(restored.slice(storedUsage?.inputHashes.length ?? 0)) +
            config.outputReserveTokens
          : estimateInput(restored ?? parsed.input, config.outputReserveTokens) +
            requestEnvelopeTokens;
      if (restored !== null) {
        currentInput = restored;
        currentCoverage = restoredWithCoverage?.coverage ?? currentCoverage;
      }
      const needsCompaction = compactOnly || inputEstimate >= threshold;
      let contextRecoveryUsed = false;
      const compactAndPersist = async () => {
        if (!hasClosedFunctionCalls(currentInput)) {
          throw new OAuthCompactionError('unsupported_request');
        }
        const maxTokens = Math.max(
          0,
          config.maxContextTokens - config.outputReserveTokens - requestEnvelopeTokens,
        );
        const costs = currentInput.map((item) => estimateTokens(item, countText).knownTokens);
        let prefix = eligiblePrefix(currentInput, costs, maxTokens);
        if (prefix.length === 0) {
          throw new OAuthCompactionError('unsupported_request');
        }
        if (!statusStarted) {
          await emitStatus(options.onStatus, statusEvent(scope, 'started', eventId));
          statusStarted = true;
        }
        const compact = async (compactPrefix: JSONArray) => {
          const compactBody = withInput(body, [...compactPrefix, { type: 'compaction_trigger' }]);
          const compactRequest = requestWithBody(
            requestInput,
            requestInit,
            compactBody,
            controller.signal,
          );
          if (controller.signal.aborted) {
            throw new OAuthCompactionError('aborted');
          }
          const compactResponse = await fetch(compactRequest.input, compactRequest.init);
          if (!compactResponse.ok) {
            const retryableStatus =
              compactResponse.status === 400 || compactResponse.status === 413;
            const errorBody = retryableStatus
              ? await stream.readError(compactResponse, controller.signal, config.maxResponseBytes)
              : null;
            if (controller.signal.aborted) {
              throw new OAuthCompactionError('aborted');
            }
            const retryableBody = isRetryableContextError(errorBody);
            await compactResponse.body?.cancel().catch(() => undefined);
            throw new OAuthCompactionError(
              retryableStatus && retryableBody ? 'context_too_large' : 'provider_unavailable',
            );
          }
          return stream.compact(
            compactResponse,
            controller.signal,
            config.maxResponseBytes,
            compactOnly,
          );
        };
        let compacted;
        try {
          compacted = await compact(prefix);
        } catch (error) {
          if (!(error instanceof OAuthCompactionError) || error.code !== 'context_too_large') {
            throw error;
          }
          if (contextRecoveryUsed) {
            throw error;
          }
          contextRecoveryUsed = true;
          const retryPrefix = eligiblePrefix(currentInput, costs, Math.floor(maxTokens / 2));
          if (retryPrefix.length === 0 || retryPrefix.length >= prefix.length) {
            throw error;
          }
          compacted = await compact(retryPrefix);
          prefix = retryPrefix;
        }
        const rawPrefixLength = coveredPrefixLength(currentCoverage, prefix.length);
        if (rawPrefixLength === null || rawPrefixLength > parsed.input.length) {
          throw new OAuthCompactionError('unsupported_request');
        }
        const coveredInput = parsed.input.slice(0, rawPrefixLength);
        const stateToSave: OAuthCompactionSaveState = {
          coveredHashes: inputHashes(coveredInput),
          opaque: compacted.opaque,
          expiresAt: expiration(nowMs(), config.retentionDays),
        };
        const saved = await store.saveOAuthCompaction({
          scope: storeScope,
          ownerId: leaseOwner,
          expectedRevision: revision,
          state: stateToSave,
          now: nowMs(),
        });
        if (!saved) {
          throw new OAuthCompactionError('persist_failed');
        }
        revision += 1;
        const savedAt = nowMs();
        const state: OAuthCompactionState = {
          revision,
          coveredHashes: [...stateToSave.coveredHashes],
          usage: undefined,
          opaque: stateToSave.opaque,
          updatedAt: savedAt,
          expiresAt: stateToSave.expiresAt,
        };
        activeState = state;
        currentInput = restoreInput(parsed.input, state) ?? currentInput;
        body = withInput(body, currentInput);
        await emitStatus(options.onStatus, statusEvent(scope, 'completed', eventId));
        compactionCompleted = true;
        return compacted;
      };
      if (needsCompaction) {
        const compacted = await compactAndPersist();
        if (compactOnly) {
          await release();
          cleanup();
          if (compacted.response === undefined) {
            throw new OAuthCompactionError('malformed_stream');
          }
          return compacted.response;
        }
      } else if (restored !== null) {
        body = withInput(body, currentInput);
      }
      if (controller.signal.aborted) {
        throw new OAuthCompactionError('aborted');
      }
      const emitContextUsage = async (): Promise<void> => {
        if (scope.executionId !== 'main' || !options.onContextUsage) {
          return;
        }
        const baseline = activeState?.usage;
        const baselineMatches =
          baseline !== undefined &&
          baseline.shapingHash === parsed.shapingHash &&
          matchingPrefix(currentInput, baseline.inputHashes) === baseline.inputHashes.length;
        const tail = baselineMatches
          ? currentInput.slice(baseline.inputHashes.length)
          : currentInput;
        const inputTokens = baselineMatches
          ? baseline.inputTokens + estimateInput(tail)
          : estimateInput(currentInput) + requestEnvelopeTokens;
        const contextBudget = config.maxContextTokens - config.outputReserveTokens;
        await options.onContextUsage({
          agentId: scope.agentId,
          model: parsed.model,
          provider: 'librechat_openai_oauth',
          contextBudget,
          remainingContextTokens: Math.max(0, contextBudget - inputTokens),
          oauthCompaction: { inputTokens, isEstimate: !baselineMatches || tail.length > 0 },
          breakdown: {
            maxContextTokens: config.maxContextTokens,
            instructionTokens: 0,
            systemMessageTokens: 0,
            dynamicInstructionTokens: 0,
            toolSchemaTokens: 0,
            summaryTokens: 0,
            toolCount: 0,
            messageCount: currentInput.length,
            messageTokens: inputTokens,
            availableForMessages: contextBudget,
          },
        });
      };
      await emitContextUsage();
      const normalRequest = requestWithBody(requestInput, requestInit, body, controller.signal);
      let normalResponse = await fetch(normalRequest.input, normalRequest.init);
      if (!normalResponse.ok || normalResponse.body === null) {
        const retryableStatus = normalResponse.status === 400 || normalResponse.status === 413;
        const errorBody = retryableStatus
          ? await stream.readError(normalResponse, controller.signal, config.maxResponseBytes)
          : null;
        await normalResponse.body?.cancel().catch(() => undefined);
        if (controller.signal.aborted) {
          throw new OAuthCompactionError('aborted');
        }
        if (retryableStatus && isRetryableContextError(errorBody)) {
          if (contextRecoveryUsed || compactionCompleted) {
            throw new OAuthCompactionError('context_too_large');
          }
          await compactAndPersist();
          contextRecoveryUsed = true;
          if (controller.signal.aborted) {
            throw new OAuthCompactionError('aborted');
          }
          await emitContextUsage();
          const retryRequest = requestWithBody(requestInput, requestInit, body, controller.signal);
          normalResponse = await fetch(retryRequest.input, retryRequest.init);
          if (!normalResponse.ok || normalResponse.body === null) {
            const contextStatus = normalResponse.status === 400 || normalResponse.status === 413;
            const retryError = contextStatus
              ? await stream.readError(normalResponse, controller.signal, config.maxResponseBytes)
              : null;
            await normalResponse.body?.cancel().catch(() => undefined);
            throw new OAuthCompactionError(
              contextStatus && isRetryableContextError(retryError)
                ? 'context_too_large'
                : 'provider_unavailable',
            );
          }
        } else {
          throw new OAuthCompactionError('provider_unavailable');
        }
      }
      streaming = true;
      return stream.inspect(normalResponse, {
        signal: controller.signal,
        maxBytes: config.maxResponseBytes,
        onCompleted: async (inputTokens) => {
          if (activeState === null) {
            return;
          }
          const currentState = activeState;
          if (!validStoredState(currentState)) {
            return;
          }
          const usage: OAuthCompactionUsage = {
            inputTokens,
            inputHashes: inputHashes(currentInput),
            shapingHash: parsed.shapingHash,
          };
          const saved = await store.saveOAuthCompaction({
            scope: storeScope,
            ownerId: leaseOwner,
            expectedRevision: revision,
            state: {
              coveredHashes: [...currentState.coveredHashes],
              opaque: currentState.opaque,
              usage: {
                inputTokens: usage.inputTokens,
                inputHashes: [...usage.inputHashes],
                shapingHash: usage.shapingHash,
              },
              expiresAt: currentState.expiresAt,
            },
            now: nowMs(),
          });
          if (saved) {
            revision += 1;
          }
        },
        onFinished: async (outcome) => {
          await release();
          cleanup();
          if (!statusStarted || compactionCompleted) {
            return;
          }
          if (outcome === 'completed') {
            await emitStatus(options.onStatus, statusEvent(scope, 'completed', eventId));
          } else if (outcome === 'cancelled') {
            await emitStatus(options.onStatus, statusEvent(scope, 'cancelled', eventId, 'aborted'));
          } else {
            await emitStatus(
              options.onStatus,
              statusEvent(scope, 'failed', eventId, 'provider_unavailable'),
            );
          }
        },
      });
    } catch (error) {
      await release();
      let code: OAuthCompactionErrorCode;
      if (error instanceof OAuthCompactionError) {
        code = error.code;
      } else if (controller.signal.aborted) {
        code = 'aborted';
      } else {
        code = 'provider_unavailable';
      }
      if ((statusStarted && !compactionCompleted) || code === 'context_too_large') {
        await emitStatus(
          options.onStatus,
          statusEvent(
            scope,
            code === 'aborted' ? 'cancelled' : 'failed',
            compactionCompleted ? statusId() : eventId,
            code,
          ),
        );
      }
      throw error instanceof OAuthCompactionError ? error : new OAuthCompactionError(code);
    } finally {
      if (!streaming) {
        cleanup();
      }
      if (!streaming && leaseHeld) {
        await release();
      }
    }
  };

  return {
    fetch: async (requestInput, requestInit) => {
      if (requestInit?.signal?.aborted) {
        throw new OAuthCompactionError('aborted');
      }
      const parsed = parseOAuthCompactionRequest(requestInput, requestInit);
      return parsed === null
        ? passthrough(requestInput, requestInit)
        : run(requestInput, requestInit, parsed).then((response) => {
            if (response === null) {
              throw new OAuthCompactionError('unsupported_request');
            }
            return response;
          });
    },
    compactOnly: async (requestInput, requestInit) => {
      if (requestInit?.signal?.aborted) {
        throw new OAuthCompactionError('aborted');
      }
      const parsed = parseOAuthCompactionRequest(requestInput, requestInit);
      if (parsed === null) {
        throw new OAuthCompactionError('invalid_request');
      }
      await run(requestInput, requestInit, parsed, true);
    },
  };
}
