import { atomFamily } from 'recoil';
import type {
  SteelNativeEventSource,
  SteelNativeActivityEvent as SteelNativeEvent,
} from 'librechat-data-provider';

export { steelNativeStreamEventName } from 'librechat-data-provider';
export type {
  SteelNativeSavedCounts,
  SteelNativeTableCounts,
  SteelNativeQuotationStatus,
  SteelNativeDelegateOcrStage,
  SteelNativeDelegateOcrStatus,
  SteelOcrMissingPageRangesByFileKey,
} from 'librechat-data-provider';

export type SteelNativeActivitySource = SteelNativeEventSource;

/** A canonical Steel event plus the client receipt time used for ordering. */
export type SteelNativeActivityEvent = SteelNativeEvent & { receivedAt?: number };

export type SteelNativeActivityEnvelope = {
  event: 'steel_event';
  data: SteelNativeActivityEvent;
};

export const steelNativeActivityByMessageId = atomFamily<SteelNativeActivityEvent[], string>({
  key: 'steelNativeActivityByMessageId',
  default: [],
});
