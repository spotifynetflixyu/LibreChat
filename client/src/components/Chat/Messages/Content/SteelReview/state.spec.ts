import { createStore } from 'jotai';
import {
  steelReviewDialogStateFamily,
  steelReviewPreviewStateFamily,
} from './state';

describe('Steel review scoped state ownership', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('keeps a shared dialog atom while one owner remains mounted', () => {
    const key = `dialog-owner-${Date.now()}`;
    const stateAtom = steelReviewDialogStateFamily(key);
    const store = createStore();
    store.set(stateAtom, (state) => ({ ...state, isOpen: true }));
    const firstUnmount = store.sub(stateAtom, () => undefined);
    const secondUnmount = store.sub(stateAtom, () => undefined);

    firstUnmount();
    jest.runOnlyPendingTimers();

    expect(steelReviewDialogStateFamily(key)).toBe(stateAtom);
    expect(store.get(stateAtom).isOpen).toBe(true);

    secondUnmount();
    jest.runOnlyPendingTimers();
    expect(steelReviewDialogStateFamily(key)).not.toBe(stateAtom);
  });

  it('cleans preview state after its last owner unmounts', () => {
    const key = `preview-owner-${Date.now()}`;
    const stateAtom = steelReviewPreviewStateFamily(key);
    const store = createStore();
    store.set(stateAtom, (state) => ({ ...state, zoom: 2 }));
    const unmount = store.sub(stateAtom, () => undefined);

    unmount();
    jest.runOnlyPendingTimers();

    const freshAtom = steelReviewPreviewStateFamily(key);
    expect(freshAtom).not.toBe(stateAtom);
    expect(store.get(freshAtom).zoom).toBe(1);
  });
});
