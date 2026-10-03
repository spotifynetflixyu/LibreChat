import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { SteelReviewKind } from 'librechat-data-provider';

export type SteelReviewSelection = {
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  tableId: string;
  partIndex?: number;
};

export const steelReviewSelectionAtom = atom<SteelReviewSelection | null>(null);

export interface SteelReviewDialogState {
  isOpen: boolean;
  selectedFileId?: string;
  pageNumber: number;
  pageCount: number;
  fullScreen: boolean;
  initializedSourceId?: string;
}

export interface SteelReviewPan {
  x: number;
  y: number;
}

export interface SteelReviewPreviewState {
  imageUrl?: string;
  zoom: number;
  pan: SteelReviewPan;
  dragging: boolean;
  renderError: boolean;
}

export function steelReviewIdentityKey(selection: SteelReviewSelection): string {
  return [
    selection.conversationId,
    selection.messageId,
    selection.kind,
    selection.tableId,
    selection.partIndex ?? '',
  ].join(':');
}

export function steelReviewSourcePreviewKey(selection: SteelReviewSelection, fileId: string): string {
  return `${steelReviewIdentityKey(selection)}:${fileId}`;
}

const dialogCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dialogMountedOwners = new Map<string, number>();

export const steelReviewDialogStateFamily = atomFamily((key: string) => {
  const state = atom<SteelReviewDialogState>({
    isOpen: false,
    pageNumber: 1,
    pageCount: 0,
    fullScreen: false,
  });
  state.onMount = () => {
    const pendingCleanup = dialogCleanupTimers.get(key);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      dialogCleanupTimers.delete(key);
    }
    dialogMountedOwners.set(key, (dialogMountedOwners.get(key) ?? 0) + 1);
    return () => {
      const ownerCount = (dialogMountedOwners.get(key) ?? 1) - 1;
      if (ownerCount > 0) {
        dialogMountedOwners.set(key, ownerCount);
        return;
      }
      dialogMountedOwners.delete(key);
      const cleanup = setTimeout(() => {
        dialogCleanupTimers.delete(key);
        if (!dialogMountedOwners.has(key) && steelReviewDialogStateFamily(key) === state) {
          steelReviewDialogStateFamily.remove(key);
        }
      }, 0);
      dialogCleanupTimers.set(key, cleanup);
    };
  };
  return state;
});

const previewCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const previewMountedOwners = new Map<string, number>();

export const steelReviewPreviewStateFamily = atomFamily((key: string) => {
  const state = atom<SteelReviewPreviewState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
    dragging: false,
    renderError: false,
  });
  state.onMount = () => {
    const pendingCleanup = previewCleanupTimers.get(key);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup);
      previewCleanupTimers.delete(key);
    }
    previewMountedOwners.set(key, (previewMountedOwners.get(key) ?? 0) + 1);
    return () => {
      const ownerCount = (previewMountedOwners.get(key) ?? 1) - 1;
      if (ownerCount > 0) {
        previewMountedOwners.set(key, ownerCount);
        return;
      }
      previewMountedOwners.delete(key);
      const cleanup = setTimeout(() => {
        previewCleanupTimers.delete(key);
        if (!previewMountedOwners.has(key) && steelReviewPreviewStateFamily(key) === state) {
          steelReviewPreviewStateFamily.remove(key);
        }
      }, 0);
      previewCleanupTimers.set(key, cleanup);
    };
  };
  return state;
});
