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

export const steelReviewDialogStateFamily = atomFamily((_key: string) => {
  return atom<SteelReviewDialogState>({
    isOpen: false,
    pageNumber: 1,
    pageCount: 0,
    fullScreen: false,
  });
});

export const steelReviewPreviewStateFamily = atomFamily((_key: string) => {
  return atom<SteelReviewPreviewState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
    dragging: false,
    renderError: false,
  });
});
