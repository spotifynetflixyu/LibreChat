import { useSyncExternalStore } from 'react';

type TickerStore = {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => number;
};

const stores = new Map<number, TickerStore>();
const listeners = new Map<number, Set<() => void>>();
const snapshots = new Map<number, number>();
let timerId: ReturnType<typeof setTimeout> | null = null;

const rescheduleGlobalClock = () => {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }

  const now = Date.now();
  const nextDelayMs = Array.from(listeners.entries()).reduce<number | null>(
    (shortest, [cadenceMs, subscribers]) => {
      if (subscribers.size === 0) {
        return shortest;
      }
      const elapsedMs = now - (snapshots.get(cadenceMs) ?? now);
      const remainingMs = elapsedMs < 0 ? 0 : Math.max(0, cadenceMs - elapsedMs);
      return shortest === null || remainingMs < shortest ? remainingMs : shortest;
    },
    null,
  );

  if (nextDelayMs === null) {
    return;
  }

  timerId = setTimeout(() => {
    timerId = null;
    const tickNow = Date.now();
    listeners.forEach((subscribers, cadenceMs) => {
      const previous = snapshots.get(cadenceMs) ?? tickNow;
      if (subscribers.size === 0 || (tickNow - previous >= 0 && tickNow - previous < cadenceMs)) {
        return;
      }
      snapshots.set(cadenceMs, tickNow);
      subscribers.forEach((listener) => listener());
    });
    rescheduleGlobalClock();
  }, nextDelayMs);
};

const getTickerStore = (intervalMs: number): TickerStore => {
  const existing = stores.get(intervalMs);
  if (existing) {
    return existing;
  }

  const subscribers = new Set<() => void>();
  listeners.set(intervalMs, subscribers);
  snapshots.set(intervalMs, Date.now());

  const store: TickerStore = {
    subscribe: (onStoreChange) => {
      if (subscribers.size === 0) {
        snapshots.set(intervalMs, Date.now());
      }
      subscribers.add(onStoreChange);
      rescheduleGlobalClock();
      return () => {
        subscribers.delete(onStoreChange);
        rescheduleGlobalClock();
      };
    },
    getSnapshot: () => snapshots.get(intervalMs) ?? 0,
  };

  stores.set(intervalMs, store);
  return store;
};

/**
 * Subscribes to one global, ref-counted clock. It runs at the fastest cadence currently
 * requested, while slower subscribers are notified only when their own cadence elapses.
 */
export default function useTimeTick(intervalMs = 60_000): number {
  const store = getTickerStore(intervalMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
