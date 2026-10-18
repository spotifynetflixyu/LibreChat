import type {
  SteelReviewPrepared,
  SteelReviewSavedSnapshot,
  SteelReviewTable,
  TMessage,
} from 'librechat-data-provider';
import type { MutableRefObject } from 'react';
import type {
  SteelReviewCapturedAuthority,
  SteelReviewIdentity,
  SteelReviewSelection,
} from './state';
import { sameSteelReviewIdentity } from './state';

/** A value that belongs to one review dialog capture (one opening of the dialog). */
export type CaptureScoped<T> = {
  captureId: string;
  value: T;
};

/** The table owner a confirmed save or prepared operation was made against. */
export type SteelReviewOwner = Pick<
  SteelReviewTable,
  'conversationId' | 'messageId' | 'kind' | 'title' | 'outputId' | 'revision'
>;

export function getCaptureScopedValue<T>(
  ref: MutableRefObject<CaptureScoped<T> | undefined>,
  captureId: string | undefined,
): T | undefined {
  return captureId && ref.current?.captureId === captureId ? ref.current.value : undefined;
}

export function sameSteelReviewScope(
  left: SteelReviewIdentity | null | undefined,
  right: SteelReviewIdentity | null | undefined,
): boolean {
  return Boolean(left && right && sameSteelReviewIdentity(left, right));
}

/** The live selection is still this dialog's capture. */
export function isLiveCapture(
  selection: SteelReviewSelection | null | undefined,
  captureId: string,
  identity: SteelReviewIdentity,
): boolean {
  return Boolean(
    selection && selection.captureId === captureId && sameSteelReviewIdentity(selection, identity),
  );
}

export function isCapturedAuthorityForPrepared(
  authority: SteelReviewCapturedAuthority | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(
    authority &&
      authority.outputId === prepared.outputId &&
      authority.table.outputId === prepared.outputId &&
      sameSteelReviewScope(authority.table, prepared),
  );
}

function isSameCapturedAuthorityOwner(
  left: SteelReviewCapturedAuthority | undefined,
  right: SteelReviewCapturedAuthority | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.outputId === right.outputId &&
      left.table.outputId === right.table.outputId &&
      sameSteelReviewScope(left.table, right.table),
  );
}

/** The selection still belongs to this dialog and to the same captured table owner. */
export function isCurrentCapturedSession(
  selection: SteelReviewSelection | null | undefined,
  identity: SteelReviewIdentity,
  authority: SteelReviewCapturedAuthority | undefined,
  expectedAuthority: SteelReviewCapturedAuthority | undefined,
): boolean {
  return Boolean(
    selection &&
      sameSteelReviewIdentity(selection, identity) &&
      isSameCapturedAuthorityOwner(authority, expectedAuthority),
  );
}

/** The selection still belongs to this dialog and its captured authority made the prepared operation. */
export function isCapturedSessionActive(
  selection: SteelReviewSelection | null | undefined,
  identity: SteelReviewIdentity,
  authority: SteelReviewCapturedAuthority | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(
    selection &&
      sameSteelReviewIdentity(selection, identity) &&
      sameSteelReviewScope(selection, prepared) &&
      isCapturedAuthorityForPrepared(authority, prepared),
  );
}

/** The live table is still the latest revision of the owner a save was made against. */
export function isCurrentOwner(
  table: SteelReviewTable | null | undefined,
  owner: SteelReviewOwner,
): boolean {
  return Boolean(
    table &&
      table.conversationId === owner.conversationId &&
      table.messageId === owner.messageId &&
      table.kind === owner.kind &&
      table.title === owner.title &&
      table.outputId === owner.outputId &&
      table.revision === owner.revision &&
      table.isLatest,
  );
}

/** The live table is the latest output the prepared operation was made for. */
export function isAuthorizedCurrentTable(
  table: SteelReviewTable | null | undefined,
  prepared: SteelReviewPrepared,
): boolean {
  return Boolean(
    table &&
      table.conversationId === prepared.conversationId &&
      table.messageId === prepared.messageId &&
      table.kind === prepared.kind &&
      table.title === prepared.title &&
      table.outputId === prepared.outputId &&
      table.latestOutputId === prepared.outputId &&
      table.isLatest,
  );
}

/**
 * Whether the cached conversation still shows the message text the snapshot
 * was saved against, by exact text or by the prepared message hash.
 */
export async function canApplySteelReviewMessageSnapshot(
  messages: readonly TMessage[] | undefined,
  prepared: SteelReviewPrepared,
  snapshot: SteelReviewSavedSnapshot,
): Promise<boolean> {
  if (!messages) {
    return true;
  }
  const message = messages.find((candidate) => candidate.messageId === snapshot.messageId);
  if (!message) {
    return false;
  }
  if (message.text === snapshot.messageText) {
    return true;
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return false;
  }
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(message.text));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return hash === prepared.messageSha256;
  } catch {
    return false;
  }
}
