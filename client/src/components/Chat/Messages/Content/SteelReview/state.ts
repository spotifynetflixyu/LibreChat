import { atom } from 'jotai';
import type { SteelReviewKind } from 'librechat-data-provider';

export type SteelReviewSelection = {
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  tableId: string;
};

export const steelReviewSelectionAtom = atom<SteelReviewSelection | null>(null);
