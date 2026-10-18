import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import type { SteelReviewPrepared, SteelReviewTable } from 'librechat-data-provider';
import type { Dispatch, SetStateAction } from 'react';
import type {
  SteelReviewCapturedAuthority,
  SteelReviewIdentity,
  SteelReviewSelection,
} from '../state';
import type { CaptureScoped } from '../authority';
import { isCapturedSessionActive, isCurrentCapturedSession } from '../authority';
import { sameSteelReviewIdentity, steelReviewSelectionAtom } from '../state';

export interface CapturedAuthorityOptions {
  identity: SteelReviewIdentity;
  isOpen: boolean;
  captureId: string | undefined;
  selection: SteelReviewSelection | null;
  setSelection: Dispatch<SetStateAction<SteelReviewSelection | null>>;
  table: SteelReviewTable | null | undefined;
}

/** Guards for the table owner a dialog capture was opened against. */
export interface CapturedAuthority {
  getCapturedAuthority: (expectedCaptureId?: string) => SteelReviewCapturedAuthority | undefined;
  hasActiveCapturedSession: (prepared: SteelReviewPrepared, expectedCaptureId?: string) => boolean;
  hasCurrentCapturedSession: (
    expectedAuthority: SteelReviewCapturedAuthority | undefined,
    expectedCaptureId?: string,
  ) => boolean;
  isCurrentCapture: (expectedCaptureId: string, expectedOutputId?: string) => boolean;
  clearSelectionForCapture: (
    expectedCaptureId: string | undefined,
    expectedOutputId?: string,
  ) => void;
  persistCapturedAuthority: (
    authority: SteelReviewCapturedAuthority,
    expectedCaptureId?: string,
  ) => void;
  clearCapturedAuthority: (expectedCaptureId?: string) => void;
}

/**
 * Captures the review table owner when the dialog opens and keeps it on the
 * selection, so later saves and receipts are checked against that owner.
 */
export function useCapturedAuthority({
  identity,
  isOpen,
  captureId,
  selection,
  setSelection,
  table,
}: CapturedAuthorityOptions): CapturedAuthority {
  const store = useStore();
  const capturedAuthorityRef = useRef<CaptureScoped<SteelReviewCapturedAuthority>>();
  const getCapturedAuthority = useCallback(
    (expectedCaptureId = captureId) => {
      if (!expectedCaptureId) {
        return undefined;
      }
      if (capturedAuthorityRef.current?.captureId === expectedCaptureId) {
        return capturedAuthorityRef.current.value;
      }
      return selection?.captureId === expectedCaptureId ? selection.capturedAuthority : undefined;
    },
    [captureId, selection],
  );
  useEffect(() => {
    if (!isOpen) {
      capturedAuthorityRef.current = undefined;
      return;
    }
    if (selection?.capturedAuthority) {
      capturedAuthorityRef.current = {
        captureId: selection.captureId,
        value: selection.capturedAuthority,
      };
      return;
    }
    if (
      !captureId ||
      !table ||
      !table.outputId ||
      !table.revision ||
      capturedAuthorityRef.current?.captureId === captureId
    ) {
      return;
    }
    const authority = {
      outputId: table.outputId,
      revision: table.revision,
      table,
    };
    capturedAuthorityRef.current = { captureId, value: authority };
    setSelection((current) => {
      if (!sameSteelReviewIdentity(current, identity) || current.captureId !== captureId) {
        return current;
      }
      return { ...current, capturedAuthority: authority };
    });
  }, [
    captureId,
    identity,
    isOpen,
    selection?.captureId,
    selection?.capturedAuthority,
    setSelection,
    table,
  ]);
  const hasActiveCapturedSession = useCallback(
    (prepared: SteelReviewPrepared, expectedCaptureId = captureId) => {
      const currentSelection = store.get(steelReviewSelectionAtom);
      if (!expectedCaptureId || currentSelection?.captureId !== expectedCaptureId) {
        return false;
      }
      return isCapturedSessionActive(
        currentSelection,
        identity,
        currentSelection.capturedAuthority ?? getCapturedAuthority(expectedCaptureId),
        prepared,
      );
    },
    [captureId, getCapturedAuthority, identity, store],
  );
  const isCurrentCapture = useCallback(
    (expectedCaptureId: string, expectedOutputId?: string) => {
      const currentSelection = store.get(steelReviewSelectionAtom);
      if (
        !currentSelection ||
        currentSelection.captureId !== expectedCaptureId ||
        !sameSteelReviewIdentity(currentSelection, identity)
      ) {
        return false;
      }
      if (!expectedOutputId) {
        return true;
      }
      const authority =
        currentSelection.capturedAuthority ?? getCapturedAuthority(expectedCaptureId);
      return !authority || authority.outputId === expectedOutputId;
    },
    [getCapturedAuthority, identity, store],
  );
  const hasCurrentCapturedSession = useCallback(
    (
      expectedAuthority: SteelReviewCapturedAuthority | undefined,
      expectedCaptureId = captureId,
    ) => {
      const currentSelection = store.get(steelReviewSelectionAtom);
      if (!expectedCaptureId || currentSelection?.captureId !== expectedCaptureId) {
        return false;
      }
      return isCurrentCapturedSession(
        currentSelection,
        identity,
        currentSelection.capturedAuthority ?? getCapturedAuthority(expectedCaptureId),
        expectedAuthority,
      );
    },
    [captureId, getCapturedAuthority, identity, store],
  );
  const clearSelectionForCapture = useCallback(
    (expectedCaptureId: string | undefined, expectedOutputId?: string) => {
      if (!expectedCaptureId) {
        return;
      }
      setSelection((current) => {
        if (
          !current ||
          current.captureId !== expectedCaptureId ||
          !sameSteelReviewIdentity(current, identity)
        ) {
          return current;
        }
        if (
          expectedOutputId &&
          current.capturedAuthority &&
          current.capturedAuthority.outputId !== expectedOutputId
        ) {
          return current;
        }
        return null;
      });
    },
    [identity, setSelection],
  );
  const persistCapturedAuthority = useCallback(
    (
      authority: {
        outputId: string;
        revision: string;
        table: SteelReviewTable;
      },
      expectedCaptureId = captureId,
    ) => {
      if (!expectedCaptureId) {
        return;
      }
      capturedAuthorityRef.current = { captureId: expectedCaptureId, value: authority };
      setSelection((current) => {
        if (
          !sameSteelReviewIdentity(current, identity) ||
          current.captureId !== expectedCaptureId
        ) {
          return current;
        }
        return { ...current, capturedAuthority: authority };
      });
    },
    [captureId, identity, setSelection],
  );
  const clearCapturedAuthority = useCallback(
    (expectedCaptureId = captureId) => {
      if (!expectedCaptureId || capturedAuthorityRef.current?.captureId !== expectedCaptureId) {
        return;
      }
      capturedAuthorityRef.current = undefined;
      setSelection((current) => {
        if (
          !sameSteelReviewIdentity(current, identity) ||
          current.captureId !== expectedCaptureId ||
          !current.capturedAuthority
        ) {
          return current;
        }
        const { capturedAuthority: _capturedAuthority, ...identityOnly } = current;
        return identityOnly;
      });
    },
    [captureId, identity, setSelection],
  );
  return {
    getCapturedAuthority,
    hasActiveCapturedSession,
    hasCurrentCapturedSession,
    isCurrentCapture,
    clearSelectionForCapture,
    persistCapturedAuthority,
    clearCapturedAuthority,
  };
}
