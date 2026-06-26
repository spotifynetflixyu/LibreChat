import { atomFamily } from 'recoil';

export const steelNativeStreamEventName = 'steel_event' as const;

export type SteelNativeActivitySource =
  | 'assistant_markdown'
  | 'responses_output'
  | 'tool_result';

export type SteelNativeSavedCounts = Record<string, number>;

export type SteelNativeActivityEvent =
  | {
      type: 'parse_status';
      source: SteelNativeActivitySource;
      message: string;
      parseStatus: 'saved' | 'partial' | 'skipped';
      savedCounts?: SteelNativeSavedCounts;
      conversationId?: string;
      requestId?: string;
      messageId?: string;
      toolName?: string;
      providerToolCallId?: string;
      receivedAt?: number;
    }
  | {
      type: 'memory_saved';
      source: SteelNativeActivitySource;
      message: string;
      savedCounts: SteelNativeSavedCounts;
      conversationId?: string;
      requestId?: string;
      messageId?: string;
      toolName?: string;
      providerToolCallId?: string;
      receivedAt?: number;
    };

export type SteelNativeActivityEnvelope = {
  event: typeof steelNativeStreamEventName;
  data: SteelNativeActivityEvent;
};

export const steelNativeActivityByMessageId = atomFamily<SteelNativeActivityEvent[], string>({
  key: 'steelNativeActivityByMessageId',
  default: [],
});
