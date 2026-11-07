import { atom } from 'jotai';
import { SSE } from 'sse.js';
import { Constants, DynamicQueryKeys, QueryKeys } from 'librechat-data-provider';
import type {
  SteelOcrKind,
  SteelFlowStatus,
  SteelOcrStatus,
  SteelQuotationStatus,
  SteelNativeActivityEvent,
} from 'librechat-data-provider';
import type { QueryClient } from '@tanstack/react-query';
import type { useStore } from 'jotai';

type SteelFlowKind = SteelOcrKind | 'quotation';
export type SteelOcrFlowStatus = SteelOcrStatus & {
  generationCreatedAt?: number;
  delegateOcrIndex?: number;
  verifiedByStatus?: boolean;
};
type FlowStatus = SteelOcrFlowStatus | SteelQuotationFlowStatus;
type SteelStream = {
  readyState: number;
  addEventListener(event: 'readystatechange', listener: () => void): void;
};

export type SteelQuotationFlowStatus = SteelQuotationStatus & {
  note?: string;
  chunkIndex?: number;
  repairAttempt?: number;
  maxRepairAttempts?: number;
};

export const steelStreamOwners = atom(new Map<string, ReadonlySet<SteelStream>>());

export function isSupersededSteelFlow(data?: FlowStatus): boolean {
  return Boolean(data?.latestRunId && data.latestRunId !== data.runId);
}

function isTerminalSteelFlow(data?: FlowStatus): boolean {
  return data?.status === 'completed' || data?.status === 'cancelled';
}

export function trackSteelStream(
  queryClient: QueryClient,
  store: ReturnType<typeof useStore>,
  stream: SteelStream,
  getConversationId: () => string | null | undefined,
) {
  let current: string | undefined;

  const sync = () => {
    const id = stream.readyState === SSE.OPEN ? getConversationId() : undefined;
    const next =
      id && id !== Constants.NEW_CONVO && id !== Constants.PENDING_CONVO ? id : undefined;
    if (current === next) {
      return;
    }

    const owners = new Map(store.get(steelStreamOwners));
    if (current) {
      const remaining = new Set(owners.get(current));
      remaining.delete(stream);
      if (remaining.size > 0) {
        owners.set(current, remaining);
      } else {
        owners.delete(current);
        // Reconcile once after detach, including terminal events lost with the stream.
        void queryClient.invalidateQueries({
          queryKey: [QueryKeys.steelFlowStatus, current],
          refetchType: 'none',
          predicate: (query) => {
            const data = query.state.data as FlowStatus | undefined;
            return !isTerminalSteelFlow(data) && !isSupersededSteelFlow(data);
          },
        });
      }
    }
    if (next) {
      const attached = new Set(owners.get(next));
      attached.add(stream);
      owners.set(next, attached);
      if (attached.size === 1) {
        void queryClient.cancelQueries({ queryKey: [QueryKeys.steelFlowStatus, next] });
      }
    }

    current = next;
    store.set(steelStreamOwners, owners);
  };

  stream.addEventListener('readystatechange', sync);
  sync();
  return sync;
}

export function quotationFlowKey(status: {
  runId?: string;
  index: number | null;
}): string | undefined {
  return status.runId ?? (status.index == null ? undefined : `legacy:${status.index}`);
}

function compareSteelFlowOrder(left: FlowStatus, right: FlowStatus): number | undefined {
  if ('index' in left && 'index' in right) {
    return left.index != null && right.index != null ? left.index - right.index : undefined;
  }
  if ('kind' in left && 'kind' in right) {
    if (left.delegateOcrIndex != null && right.delegateOcrIndex != null) {
      return left.delegateOcrIndex - right.delegateOcrIndex;
    }
    if (left.generationCreatedAt != null && right.generationCreatedAt != null) {
      return left.generationCreatedAt - right.generationCreatedAt;
    }
  }
  return undefined;
}

export function markOlderSteelFlows(
  client: QueryClient,
  conversationId: string,
  kind: SteelFlowKind,
  runKey: string,
  snapshot: FlowStatus,
) {
  if (isSupersededSteelFlow(snapshot)) {
    return;
  }
  const latestRunId = snapshot.runId ?? runKey;
  for (const [key, previous] of client.getQueriesData<FlowStatus>({
    queryKey: [QueryKeys.steelFlowStatus, conversationId, kind],
  })) {
    if (!previous || key[3] === runKey) {
      continue;
    }

    const order = compareSteelFlowOrder(snapshot, previous);
    if ('index' in snapshot && 'index' in previous) {
      const legacyKey = `legacy:${snapshot.index}`;
      if (snapshot.runId && order === 0 && (key[3] === legacyKey || runKey === legacyKey)) {
        if (
          !isSupersededSteelFlow(previous) &&
          (!isTerminalSteelFlow(previous) || previous.status === snapshot.status)
        ) {
          void client.cancelQueries({ queryKey: key, exact: true });
          client.setQueryData(key, snapshot);
        }
        continue;
      }
    }

    // A historical event seed has no live ordering information. An HTTP
    // snapshot of unknown order remains authoritative until detached reconciliation.
    const orderedOcrFrame =
      order === undefined &&
      'kind' in snapshot &&
      'kind' in previous &&
      !previous.verifiedByStatus &&
      (snapshot.generationCreatedAt !== undefined || snapshot.delegateOcrIndex !== undefined);
    if (
      (orderedOcrFrame || (order != null && order > 0)) &&
      previous.runId !== latestRunId &&
      previous.latestRunId !== latestRunId
    ) {
      void client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData(key, { ...previous, latestRunId });
    }
  }
}

export function writeSteelFlowStatus(
  client: QueryClient,
  conversationId: string,
  kind: SteelFlowKind,
  runKey: string,
  snapshot: FlowStatus,
) {
  const queryKey = DynamicQueryKeys.steelFlowStatus(conversationId, kind, runKey);
  const current = client.getQueryData<FlowStatus>(queryKey);
  if (isSupersededSteelFlow(current)) {
    return;
  }
  // An index-only frame can still arrive on an older server after the GET
  // identifies the same run by its canonical id.
  if ('index' in snapshot && !snapshot.runId && current?.runId) {
    snapshot = { ...snapshot, runId: current.runId, latestRunId: current.latestRunId };
  }
  if (
    'kind' in snapshot && current && 'kind' in current &&
    current.generationCreatedAt != null && snapshot.generationCreatedAt != null &&
    snapshot.generationCreatedAt < current.generationCreatedAt
  ) {
    return;
  }
  const newer = client
    .getQueriesData<FlowStatus>({ queryKey: [QueryKeys.steelFlowStatus, conversationId, kind] })
    .find(([, candidate]) =>
      candidate?.runId &&
      candidate.runId !== snapshot.runId &&
      !isSupersededSteelFlow(candidate) &&
      (compareSteelFlowOrder(candidate, snapshot) ?? 0) > 0,
    )?.[1];
  if (newer?.runId) {
    snapshot = { ...snapshot, latestRunId: newer.runId };
  }

  // React Query cancels and restores synchronously, before the newer snapshot is written.
  void client.cancelQueries({ queryKey, exact: true });
  // Completed and cancelled runs cannot be restarted. Replay can contain earlier frames.
  if (!isTerminalSteelFlow(current) || current?.status === snapshot.status) {
    client.setQueryData(queryKey, snapshot);
  } else if (newer?.runId && current) {
    client.setQueryData(queryKey, { ...current, latestRunId: newer.runId });
  }

  markOlderSteelFlows(client, conversationId, kind, runKey, snapshot);
}

export function resolveEventOcrFlowStatus(
  event: Extract<SteelNativeActivityEvent, { type: 'parse_status' | 'delegate_ocr_status' }>,
): SteelFlowStatus {
  if (event.flowStatus) {
    return event.flowStatus;
  }
  if (event.type === 'delegate_ocr_status') {
    if (event.status === 'succeeded') {
      return 'completed';
    }
    if (event.status === 'failed') {
      return 'failed';
    }
    return 'running';
  }
  if (event.parseStatus === 'saved') {
    return 'completed';
  }
  if (event.errorMessage) {
    return 'failed';
  }
  return 'running';
}

export function writeSteelFlowEvent(
  client: QueryClient,
  event: SteelNativeActivityEvent,
  generationCreatedAt?: number,
) {
  const { conversationId } = event;
  if (!conversationId || conversationId === Constants.NEW_CONVO || conversationId === Constants.PENDING_CONVO) {
    return;
  }

  if (event.type === 'quotation_status') {
    const key = quotationFlowKey(event);
    if (!key) {
      return;
    }
    writeSteelFlowStatus(client, conversationId, 'quotation', key, {
      conversationId,
      index: event.index,
      runId: event.runId,
      latestRunId: event.runId,
      status: event.status,
      stage: event.stage,
      note: event.message,
      chunkIndex: event.chunkIndex,
      repairAttempt: event.repairAttempt,
      maxRepairAttempts: event.maxRepairAttempts,
      completedChunks: event.completedChunks,
      totalChunks: event.totalChunks,
      canCancel: event.status === 'running',
      ocrSource: event.ocrSource,
    });
    return;
  }

  if (event.type !== 'parse_status' && event.type !== 'delegate_ocr_status') {
    return;
  }
  const { runId } = event;
  if (!runId || (
    event.type === 'parse_status' &&
    event.source !== 'ocr_preprocessing' &&
    event.source !== 'paddleocr_preflight'
  )) {
    return;
  }
  const kind = event.kind ?? (event.type === 'delegate_ocr_status' ? 'delegate' : 'preflight');
  const current = client.getQueryData<SteelOcrFlowStatus>(
    DynamicQueryKeys.steelFlowStatus(conversationId, kind, runId),
  );
  writeSteelFlowStatus(client, conversationId, kind, runId, {
    runId,
    kind,
    generationCreatedAt: generationCreatedAt ?? current?.generationCreatedAt,
    delegateOcrIndex: event.type === 'delegate_ocr_status'
      ? event.delegateOcrIndex
      : current?.delegateOcrIndex,
    latestRunId: runId,
    status: resolveEventOcrFlowStatus(event),
    stage: event.stage ?? current?.stage ?? kind,
    completedChunks: event.completedChunks ?? current?.completedChunks ?? 0,
    totalChunks: event.totalChunks ?? current?.totalChunks ?? 0,
    errorMessage: event.errorMessage ?? null,
  });
}
