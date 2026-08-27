import { atomFamily } from 'recoil';

export const steelNativeStreamEventName = 'steel_event' as const;

export type SteelNativeActivitySource =
  | 'assistant_markdown'
  | 'ocr_preprocessing'
  | 'paddleocr_preflight'
  | 'quote_runtime'
  | 'responses_output'
  | 'tool_result';

export type SteelNativeSavedCounts = Record<string, number>;
export type SteelNativeTableCounts = Record<string, number>;
export interface SteelOcrMissingPageRange {
  pageStart: number;
  pageEnd: number;
}

export type SteelOcrMissingPageRangesByFileKey = Record<
  string,
  readonly SteelOcrMissingPageRange[]
>;

export type SteelNativeActivityEvent =
  | {
      type: 'quote_audit';
      source: 'quote_runtime';
      message: 'Stage 2 started';
      stage: 'stage_2';
      status: 'started';
      savedCounts?: SteelNativeSavedCounts;
      savedTableCounts?: SteelNativeTableCounts;
      totalSavedCounts?: SteelNativeSavedCounts;
      totalTableCounts?: SteelNativeTableCounts;
      conversationId?: string;
      requestId?: string;
      messageId?: string;
      toolName?: string;
      providerToolCallId?: string;
      receivedAt?: number;
    }
  | {
      type: 'quote_audit';
      source: 'quote_runtime';
      message: 'Code Interpreter executed';
      stage: 'stage_1' | 'stage_2';
      status: 'executed';
      toolName: 'code_interpreter';
      savedCounts?: SteelNativeSavedCounts;
      savedTableCounts?: SteelNativeTableCounts;
      totalSavedCounts?: SteelNativeSavedCounts;
      totalTableCounts?: SteelNativeTableCounts;
      conversationId?: string;
      requestId?: string;
      messageId?: string;
      providerToolCallId?: string;
      receivedAt?: number;
    }
  | {
      type: 'parse_status';
      source: SteelNativeActivitySource;
      message: string;
      parseStatus: 'saved' | 'partial' | 'skipped';
      errorMessage?: string;
      failedKeys?: readonly string[];
      missingPageRangesByFileKey?: SteelOcrMissingPageRangesByFileKey;
      savedCounts?: SteelNativeSavedCounts;
      savedTableCounts?: SteelNativeTableCounts;
      totalSavedCounts?: SteelNativeSavedCounts;
      totalTableCounts?: SteelNativeTableCounts;
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
      savedTableCounts?: SteelNativeTableCounts;
      totalSavedCounts?: SteelNativeSavedCounts;
      totalTableCounts?: SteelNativeTableCounts;
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
