import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { SteelReviewKind, SteelReviewTable } from 'librechat-data-provider';
import type { PrimitiveAtom } from 'jotai';
import type { SteelReviewDraftState } from './session';

export type SteelReviewSelection = {
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  title: string;
  capturedAuthority?: SteelReviewCapturedAuthority;
};

export type SteelReviewCapturedAuthority = {
  outputId: string;
  revision: string;
  table: SteelReviewTable;
};

export const steelReviewSelectionAtom = atom<SteelReviewSelection | null>(null);

export interface SteelReviewDialogState {
  isOpen: boolean;
  selectedFileId?: string;
  pageNumber: number;
  pageCount: number;
  fullScreen: boolean;
  initializedSourceId?: string;
  sourceCorrectionRowId?: string;
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
    selection.title,
  ].join(':');
}

export function steelReviewSourcePreviewKey(selection: SteelReviewSelection, fileId: string): string {
  return `${steelReviewIdentityKey(selection)}:${fileId}`;
}

export function sameSteelReviewIdentity(
  left: SteelReviewSelection | null | undefined,
  right: Pick<SteelReviewSelection, 'conversationId' | 'messageId' | 'kind' | 'title'>,
): left is SteelReviewSelection {
  return Boolean(left &&
    left.conversationId === right.conversationId &&
    left.messageId === right.messageId &&
    left.kind === right.kind &&
    left.title === right.title);
}

type OwnedStateFamily<T> = ((key: string) => PrimitiveAtom<T>) & {
  remove: (key: string) => void;
};

function createOwnedStateFamily<T>(createState: () => T): OwnedStateFamily<T> {
  const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const mountedOwners = new Map<string, number>();
  const family: OwnedStateFamily<T> = atomFamily<string, PrimitiveAtom<T>>((key) => {
    const state = atom(createState());
    state.onMount = () => {
      const pendingCleanup = cleanupTimers.get(key);
      if (pendingCleanup) {
        clearTimeout(pendingCleanup);
        cleanupTimers.delete(key);
      }
      mountedOwners.set(key, (mountedOwners.get(key) ?? 0) + 1);
      return () => {
        const ownerCount = (mountedOwners.get(key) ?? 1) - 1;
        if (ownerCount > 0) {
          mountedOwners.set(key, ownerCount);
          return;
        }
        mountedOwners.delete(key);
        const cleanup = setTimeout(() => {
          cleanupTimers.delete(key);
          if (!mountedOwners.has(key) && family(key) === state) {
            family.remove(key);
          }
        }, 0);
        cleanupTimers.set(key, cleanup);
      };
    };
    return state;
  });
  return family;
}

export const steelReviewDialogStateFamily = createOwnedStateFamily<SteelReviewDialogState>(() => ({
  isOpen: false,
  pageNumber: 1,
  pageCount: 0,
  fullScreen: false,
}));

export const steelReviewPreviewStateFamily = createOwnedStateFamily<SteelReviewPreviewState>(() => ({
  zoom: 1,
  pan: { x: 0, y: 0 },
  dragging: false,
  renderError: false,
}));

export const steelReviewDraftStateFamily = createOwnedStateFamily<SteelReviewDraftState>(() => ({
  ownerKey: '',
  cells: {},
  touched: {},
  cellVersions: {},
  sourceDrafts: {},
  sourceVersions: {},
  rowStates: {},
  past: [],
  future: [],
  changeSequence: 0,
}));
