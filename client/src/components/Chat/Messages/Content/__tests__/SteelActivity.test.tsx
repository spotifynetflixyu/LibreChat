import React from 'react';
import { RecoilRoot } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import { steelNativeActivityByMessageId } from '~/store/steel';
import {
  useCancelSteelQuotationMutation,
  useGetSteelQuotationStatusQuery,
} from '~/data-provider/Steel';
import SteelActivity from '../SteelActivity';

type LocalizeOptions = {
  count?: number;
  counts?: string;
  chunkIndex?: number;
  fileKey?: string;
  ranges?: string;
  source?: string;
  error?: string;
  completedChunks?: number;
  totalChunks?: number;
};

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: LocalizeOptions) => {
    if (key === 'com_ui_steel_activity') {
      return 'Steel activity';
    }
    if (key === 'com_ui_steel_activity_events') {
      return `${options?.count ?? 0} events`;
    }
    if (key === 'com_ui_steel_activity_missing_page_ranges') {
      return `Missing page ranges (${options?.fileKey ?? ''}): ${options?.ranges ?? ''}`;
    }
    if (key === 'com_ui_steel_activity_parse_saved') {
      return 'Steel form parsed';
    }
    if (key === 'com_ui_steel_activity_state_saved') {
      return 'Saved Working Order Memory';
    }
    if (key === 'com_ui_steel_activity_ocr_markdown_saved') {
      return 'Save final OCR markdown';
    }
    if (key === 'com_ui_steel_activity_paddleocr_saved') {
      return 'Saved PaddleOCR preflight';
    }
    if (key === 'com_ui_steel_activity_paddleocr_partial') {
      return 'PaddleOCR preflight partial';
    }
    if (key === 'com_ui_steel_activity_paddleocr_skipped') {
      return 'PaddleOCR preflight skipped';
    }
    if (key === 'com_ui_steel_activity_records_saved') {
      return `${options?.count ?? 0} records`;
    }
    if (key === 'com_ui_steel_activity_records_saved_detail') {
      return `Saved records (${options?.counts ?? ''})`;
    }
    if (key === 'com_ui_steel_activity_this_turn_counts') {
      return `This turn: ${options?.counts ?? ''}`;
    }
    if (key === 'com_ui_steel_activity_total_counts') {
      return `Total: ${options?.counts ?? ''}`;
    }
    if (key === 'com_ui_steel_activity_quotation') {
      return 'Quotation progress';
    }
    if (key === 'com_ui_steel_quote_cancel') {
      return 'Cancel quotation';
    }
    if (key === 'com_ui_steel_quote_canceling') {
      return 'Canceling quotation…';
    }
    if (key === 'com_ui_steel_quote_cancel_failed') {
      return `Quotation cancellation failed: ${options?.error ?? ''}`;
    }
    if (key === 'com_ui_steel_quote_status_running') {
      return `Quotation in progress (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_chunk_running') {
      return `Quotation child chunk ${options?.chunkIndex ?? 0} in progress (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_queued') {
      return 'Quotation queued';
    }
    if (key === 'com_ui_steel_quote_status_started') {
      return `Quotation started (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_chunk_started') {
      return `Quotation chunk ${options?.chunkIndex ?? 0} started (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_chunk_saved') {
      return `Quotation chunk ${options?.chunkIndex ?? 0} saved (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_main_consolidating') {
      return `Quotation main agent consolidating (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_main_responding') {
      return `Quotation main agent responding (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_aggregating') {
      return `Aggregating quotation (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_finalizing') {
      return `Finalizing quotation (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_quote_status_completed') {
      return `Quotation completed (${options?.completedChunks ?? 0}/${options?.totalChunks ?? 0} chunks)`;
    }
    if (key === 'com_ui_steel_activity_source_count') {
      return `${options?.source ?? ''}: ${options?.count ?? 0}`;
    }
    if (key === 'com_ui_steel_activity_source_ocr') {
      return 'OCR';
    }
    if (key === 'com_ui_steel_activity_source_ocr_markdown') {
      return 'OCR markdown';
    }
    if (key === 'com_ui_steel_activity_source_ocr_raw') {
      return 'OCR raw results';
    }
    if (key === 'com_ui_steel_activity_source_ocr_tables') {
      return 'OCR tables';
    }
    if (key === 'com_ui_steel_activity_source_workbook') {
      return 'Workbook';
    }
    if (key === 'com_ui_steel_activity_source_workbook_rows') {
      return 'Workbook rows';
    }
    if (key === 'com_ui_steel_activity_source_workbook_tables') {
      return 'Workbook tables';
    }
    if (key === 'com_ui_steel_activity_source_paddleocr') {
      return 'PaddleOCR';
    }
    if (key === 'com_ui_steel_activity_record_calculation_facts') {
      return 'Calculation facts';
    }
    if (key === 'com_ui_steel_activity_record_customer_facts') {
      return 'Customer facts';
    }
    if (key === 'com_ui_steel_activity_record_ocr_extracts') {
      return 'OCR extracts';
    }
    if (key === 'com_ui_steel_activity_record_price_evidence') {
      return 'Price evidence';
    }
    if (key === 'com_ui_steel_activity_record_working_order_rows') {
      return 'Working order rows';
    }
    return key;
  },
}));

jest.mock('~/data-provider/Steel', () => ({
  __esModule: true,
  useCancelSteelQuotationMutation: jest.fn(),
  useGetSteelQuotationStatusQuery: jest.fn(),
}));

const mockUseCancelSteelQuotationMutation = jest.mocked(useCancelSteelQuotationMutation);
const mockUseGetSteelQuotationStatusQuery = jest.mocked(useGetSteelQuotationStatusQuery);

const quotationStatusEvent = {
  type: 'quotation_status' as const,
  source: 'quotation_preflight' as const,
  conversationId: 'conversation-1',
  messageId: 'assistant-quotation',
  index: 4,
  runId: 'quotation-run-4',
  stage: 'chunk',
  status: 'running' as const,
  completedChunks: 1,
  totalChunks: 3,
};

beforeEach(() => {
  mockUseGetSteelQuotationStatusQuery.mockReturnValue({ data: undefined } as ReturnType<
    typeof useGetSteelQuotationStatusQuery
  >);
  mockUseCancelSteelQuotationMutation.mockReturnValue({
    isLoading: false,
    error: null,
    mutate: jest.fn(),
  } as unknown as ReturnType<typeof useCancelSteelQuotationMutation>);
});

describe('SteelActivity', () => {
  it('renders quotation progress and sends the specific quotation index to cancel', () => {
    const mutate = jest.fn();
    mockUseCancelSteelQuotationMutation.mockReturnValue({
      isLoading: false,
      error: null,
      mutate,
    } as unknown as ReturnType<typeof useCancelSteelQuotationMutation>);

    const { container } = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quotation'), [quotationStatusEvent]);
        }}
      >
        <SteelActivity messageId="assistant-quotation" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getAllByText('Quotation in progress (1/3 chunks)')).toHaveLength(2);
    const cancel = screen.getByRole('button', { name: 'Cancel quotation' });
    expect(cancel).toHaveClass('ms-auto', 'shrink-0');
    expect(container.querySelector('.my-3 .animate-spin')).toBeInTheDocument();
    fireEvent.click(cancel);
    expect(mutate).toHaveBeenCalledWith(4);
  });

  it('disables duplicate cancellation clicks while cancellation is pending', () => {
    mockUseCancelSteelQuotationMutation.mockReturnValue({
      isLoading: true,
      error: null,
      mutate: jest.fn(),
    } as unknown as ReturnType<typeof useCancelSteelQuotationMutation>);

    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quotation-pending'), [
            { ...quotationStatusEvent, messageId: 'assistant-quotation-pending' },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-quotation-pending" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByRole('button', { name: 'Canceling quotation…' })).toBeDisabled();
  });

  it('keeps the cancel action available and reports a failed cancellation', () => {
    mockUseCancelSteelQuotationMutation.mockReturnValue({
      isLoading: false,
      error: new Error('request failed'),
      mutate: jest.fn(),
    } as unknown as ReturnType<typeof useCancelSteelQuotationMutation>);

    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quotation-error'), [
            { ...quotationStatusEvent, messageId: 'assistant-quotation-error' },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-quotation-error" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByRole('button', { name: 'Cancel quotation' })).toBeEnabled();
    expect(screen.getByText('Quotation cancellation failed: request failed')).toBeInTheDocument();
  });

  it('hides cancellation after the backend reports completion', () => {
    mockUseGetSteelQuotationStatusQuery.mockReturnValue({
      data: {
        conversationId: 'conversation-1',
        index: 4,
        runId: 'quotation-run-4',
        status: 'completed',
        completedChunks: 3,
        totalChunks: 3,
        canCancel: false,
      },
    } as ReturnType<typeof useGetSteelQuotationStatusQuery>);

    const { container } = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quotation-completed'), [
            { ...quotationStatusEvent, messageId: 'assistant-quotation-completed' },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-quotation-completed" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Quotation completed (3/3 chunks)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel quotation' })).not.toBeInTheDocument();
    expect(container.querySelector('.my-3 .animate-spin')).not.toBeInTheDocument();
    expect(container.querySelector('.my-3 .text-status-success')).toBeInTheDocument();
  });

  it('keeps historical completion when the conversation query belongs to a newer run', () => {
    mockUseGetSteelQuotationStatusQuery.mockReturnValue({
      data: {
        conversationId: 'conversation-1',
        index: 4,
        runId: 'quotation-run-2',
        status: 'running',
        completedChunks: 1,
        totalChunks: 2,
        canCancel: true,
      },
    } as ReturnType<typeof useGetSteelQuotationStatusQuery>);

    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quotation-old'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-old',
              runId: 'quotation-run-1',
              status: 'completed' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-quotation-old" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getAllByText('Quotation completed (2/2 chunks)')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Cancel quotation' })).not.toBeInTheDocument();
  });

  it('shows a fresh queued quotation only in the progress summary', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quotation-queued'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-queued',
              runId: 'quotation-run-queued',
              status: 'queued' as const,
              completedChunks: 0,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-quotation-queued" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getAllByText('Quotation queued')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '1 events' })).not.toBeInTheDocument();
  });

  it('uses chunk stage labels with global chunk and completion counts', () => {
    render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-quotation-stages"
          isCreatedByUser={false}
          persistedActivityEvents={[
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-stages',
              runId: 'quotation-run-stages',
              stage: 'chunk',
              status: 'running' as const,
              chunkIndex: 1,
              completedChunks: 0,
              totalChunks: 2,
            },
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-stages',
              runId: 'quotation-run-stages',
              stage: 'chunk_started',
              status: 'running' as const,
              chunkIndex: 1,
              completedChunks: 1,
              totalChunks: 2,
            },
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-stages',
              runId: 'quotation-run-stages',
              stage: 'chunk_saved',
              status: 'running' as const,
              chunkIndex: 2,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]}
        />
      </RecoilRoot>,
    );

    expect(
      screen.getByText('Quotation child chunk 1 in progress (0/2 chunks)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Quotation chunk 1 started (1/2 chunks)')).toBeInTheDocument();
    expect(screen.getAllByText('Quotation chunk 2 saved (2/2 chunks)')).toHaveLength(2);
  });

  it('labels quotation main phases with global completion counts', () => {
    render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-quotation-main"
          isCreatedByUser={false}
          persistedActivityEvents={[
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-main',
              runId: 'quotation-run-main',
              stage: 'aggregating',
              status: 'aggregating' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
            {
              ...quotationStatusEvent,
              messageId: 'assistant-quotation-main',
              runId: 'quotation-run-main',
              stage: 'main_streaming',
              status: 'aggregating' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]}
        />
      </RecoilRoot>,
    );

    expect(screen.getByText('Quotation main agent consolidating (2/2 chunks)')).toBeInTheDocument();
    expect(screen.getAllByText('Quotation main agent responding (2/2 chunks)')).toHaveLength(2);
  });

  it('keeps a terminal polled status over a stale main streaming event', () => {
    mockUseGetSteelQuotationStatusQuery.mockReturnValue({
      data: {
        conversationId: 'conversation-1',
        index: 4,
        runId: 'quotation-run-main-terminal',
        status: 'completed',
        completedChunks: 2,
        totalChunks: 2,
        canCancel: false,
      },
    } as ReturnType<typeof useGetSteelQuotationStatusQuery>);

    const { container } = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-main-terminal'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-main-terminal',
              runId: 'quotation-run-main-terminal',
              stage: 'main_streaming',
              status: 'aggregating' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-main-terminal" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Quotation completed (2/2 chunks)')).toBeInTheDocument();
    expect(container.querySelector('.my-3 .animate-spin')).not.toBeInTheDocument();
  });

  it('keeps a same-run terminal event over stale active query data', () => {
    mockUseGetSteelQuotationStatusQuery.mockReturnValue({
      data: {
        conversationId: 'conversation-1',
        index: 4,
        runId: 'quotation-run-event-terminal',
        status: 'aggregating',
        completedChunks: 2,
        totalChunks: 2,
        canCancel: true,
      },
    } as ReturnType<typeof useGetSteelQuotationStatusQuery>);

    const { container } = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-event-terminal'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-event-terminal',
              runId: 'quotation-run-event-terminal',
              stage: 'completed',
              status: 'completed' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-event-terminal" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getAllByText('Quotation completed (2/2 chunks)')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Cancel quotation' })).not.toBeInTheDocument();
    expect(container.querySelector('.my-3 .animate-spin')).not.toBeInTheDocument();
  });

  it('shows the loading dot only for live preflight before main streaming', () => {
    const live = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-live-preflight'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-live-preflight',
              runId: 'quotation-run-live',
              stage: 'chunk_started',
              status: 'running' as const,
              chunkIndex: 2,
              completedChunks: 1,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-live-preflight" isCreatedByUser={false} />
      </RecoilRoot>,
    );
    expect(live.container.querySelector('.result-thinking')).toBeInTheDocument();
    live.unmount();

    const restored = render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-restored-preflight"
          isCreatedByUser={false}
          persistedActivityEvents={[
            {
              ...quotationStatusEvent,
              messageId: 'assistant-restored-preflight',
              runId: 'quotation-run-live',
              stage: 'chunk_started',
              status: 'running' as const,
              chunkIndex: 2,
              completedChunks: 1,
              totalChunks: 2,
            },
          ]}
        />
      </RecoilRoot>,
    );
    expect(restored.container.querySelector('.result-thinking')).toBeInTheDocument();
    restored.unmount();

    const mainStreaming = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-main-streaming'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-main-streaming',
              runId: 'quotation-run-live',
              stage: 'main_streaming',
              status: 'aggregating' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-main-streaming" isCreatedByUser={false} />
      </RecoilRoot>,
    );
    expect(mainStreaming.container.querySelector('.result-thinking')).not.toBeInTheDocument();
    mainStreaming.unmount();

    const finalizing = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-finalizing'), [
            {
              ...quotationStatusEvent,
              messageId: 'assistant-finalizing',
              runId: 'quotation-run-live',
              stage: 'finalizing',
              status: 'finalizing' as const,
              completedChunks: 2,
              totalChunks: 2,
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-finalizing" isCreatedByUser={false} />
      </RecoilRoot>,
    );
    expect(finalizing.container.querySelector('.result-thinking')).not.toBeInTheDocument();
    finalizing.unmount();

    const interrupted = render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-interrupted"
          isCreatedByUser={false}
          persistedActivityEvents={[
            {
              ...quotationStatusEvent,
              messageId: 'assistant-interrupted',
              runId: 'quotation-run-interrupted',
              stage: 'interrupted',
              status: 'interrupted' as const,
              completedChunks: 1,
              totalChunks: 2,
            },
          ]}
        />
      </RecoilRoot>,
    );
    expect(interrupted.container.querySelector('.result-thinking')).not.toBeInTheDocument();
  });

  it('replays persisted two-chunk quotation checkpoints after a reload-equivalent remount', () => {
    const restoredEvents = [
      {
        ...quotationStatusEvent,
        messageId: 'assistant-restored-quotation',
        runId: 'quotation-run-restored',
        status: 'running' as const,
        completedChunks: 1,
        totalChunks: 2,
        message: 'Restored from saved quotation checkpoints',
      },
      {
        ...quotationStatusEvent,
        messageId: 'assistant-restored-quotation',
        runId: 'quotation-run-restored',
        status: 'running' as const,
        completedChunks: 2,
        totalChunks: 2,
        message: 'Restored from saved quotation checkpoints',
      },
      {
        ...quotationStatusEvent,
        messageId: 'assistant-restored-quotation',
        runId: 'quotation-run-restored',
        status: 'completed' as const,
        completedChunks: 2,
        totalChunks: 2,
        message: 'Restored from saved quotation checkpoints',
      },
    ];

    const { unmount } = render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-restored-quotation"
          isCreatedByUser={false}
          persistedActivityEvents={restoredEvents}
        />
      </RecoilRoot>,
    );

    expect(screen.getByText('Quotation in progress (1/2 chunks)')).toBeInTheDocument();
    expect(screen.getByText('Quotation in progress (2/2 chunks)')).toBeInTheDocument();
    expect(screen.getAllByText('Quotation completed (2/2 chunks)')).toHaveLength(2);
    expect(screen.getAllByText('Restored from saved quotation checkpoints')).toHaveLength(4);

    unmount();

    render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-restored-quotation-reloaded"
          isCreatedByUser={false}
          persistedActivityEvents={restoredEvents}
        />
      </RecoilRoot>,
    );

    expect(screen.getAllByText('Quotation completed (2/2 chunks)')).toHaveLength(2);
    expect(screen.getAllByText('Restored from saved quotation checkpoints')).toHaveLength(4);
  });

  it('renders loaded saved OCR chunk events live and from persisted refresh state', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-live-resume'), [
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-live-resume',
              message: 'Loaded saved PaddleOCR (chunk 17/18) (file:scan.pdf)',
              parseStatus: 'partial',
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-live-resume" isCreatedByUser={false} />
        <SteelActivity
          messageId="assistant-persisted-resume"
          isCreatedByUser={false}
          persistedActivityEvents={[
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              message: 'Loaded saved OCR markdown (chunk 8/18) (file:scan.pdf)',
              parseStatus: 'partial',
            },
          ]}
        />
      </RecoilRoot>,
    );

    expect(
      screen.getByText('Loaded saved PaddleOCR (chunk 17/18) (file:scan.pdf)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Loaded saved OCR markdown (chunk 8/18) (file:scan.pdf)'),
    ).toBeInTheDocument();
  });

  it('renders persisted PaddleOCR preflight activity without live Recoil events', () => {
    render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-persisted-preflight"
          isCreatedByUser={false}
          persistedActivityEvents={[
            {
              type: 'memory_saved',
              source: 'paddleocr_preflight',
              message: 'Saved PaddleOCR preflight',
              savedCounts: { paddleocr_preflight: 1 },
            },
          ]}
        />
      </RecoilRoot>,
    );

    expect(screen.getByText('Saved PaddleOCR preflight')).toBeInTheDocument();
  });

  it('deduplicates identical persisted and live activity events', () => {
    const persistedEvent = {
      type: 'memory_saved' as const,
      source: 'paddleocr_preflight' as const,
      message: 'Saved PaddleOCR preflight' as const,
      savedCounts: { paddleocr_preflight: 1 },
    };

    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-persisted-live'), [persistedEvent]);
        }}
      >
        <SteelActivity
          messageId="assistant-persisted-live"
          isCreatedByUser={false}
          persistedActivityEvents={[persistedEvent]}
        />
      </RecoilRoot>,
    );

    expect(screen.getByText('Saved PaddleOCR preflight')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2 events' })).not.toBeInTheDocument();
  });

  it('ignores malformed persisted activity events', () => {
    render(
      <RecoilRoot>
        <SteelActivity
          messageId="assistant-malformed-persisted"
          isCreatedByUser={false}
          persistedActivityEvents={[
            null,
            ['not-an-event'],
            { type: 'memory_saved', source: 'paddleocr_preflight', message: 'missing counts' },
          ]}
        />
      </RecoilRoot>,
    );

    expect(screen.queryByLabelText('Steel activity')).not.toBeInTheDocument();
  });

  it('renders quote audit activity using its raw message', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-quote-audit'), [
            {
              type: 'quote_audit',
              source: 'quote_runtime',
              message: 'Stage 2 started',
              stage: 'stage_2',
              status: 'started',
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-quote-audit" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Stage 2 started')).toBeInTheDocument();
  });

  it('renders native Steel save status without successful parse rows', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-1'), [
            {
              type: 'parse_status',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-1',
              message: 'Saved Markdown parse',
              parseStatus: 'saved',
              savedCounts: { working_order_row: 2 },
              savedTableCounts: { system_order_table: 1 },
              totalSavedCounts: { working_order_row: 2 },
              totalTableCounts: { system_order_table: 1 },
            },
            {
              type: 'memory_saved',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-1',
              message: 'Saved Working Order Memory',
              savedCounts: { working_order_row: 2 },
              savedTableCounts: { system_order_table: 1 },
              totalSavedCounts: { working_order_row: 2 },
              totalTableCounts: { system_order_table: 1 },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-1" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByLabelText('Steel activity')).toBeInTheDocument();
    expect(screen.queryByText('Steel form parsed')).not.toBeInTheDocument();
    expect(screen.getByText('Saved records (Working order rows: 2)')).toBeInTheDocument();
    expect(screen.getByText('Total: Workbook tables: 1, Workbook rows: 2')).toBeInTheDocument();
    expect(screen.queryByText('This turn: Workbook tables: 1, Workbook rows: 2')).not.toBeInTheDocument();
  });

  it('renders OCR table counts separately from aggregate OCR raw totals', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-ocr'), [
            {
              type: 'memory_saved',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr',
              message: 'Saved Working Order Memory',
              savedCounts: { ocr_extract: 1 },
              savedTableCounts: { ocr_table: 1 },
              totalSavedCounts: { paddleocr_preflight: 2, ocr_extract: 2 },
              totalTableCounts: { ocr_table: 2 },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-ocr" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Saved records (OCR extracts: 1)')).toBeInTheDocument();
    expect(screen.queryByText('This turn: OCR tables: 1')).not.toBeInTheDocument();
    expect(screen.getByText('Total: OCR raw results: 2, OCR tables: 2')).toBeInTheDocument();
  });

  it('renders official OCR markdown save activity with an OCR-specific label', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-official-ocr'), [
            {
              type: 'memory_saved',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-official-ocr',
              message: 'Saved Working Order Memory',
              savedCounts: { ocr_markdown: 1 },
              totalSavedCounts: { ocr_markdown: 1 },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-official-ocr" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Save final OCR markdown')).toBeInTheDocument();
    expect(screen.queryByText('Saved Working Order Memory')).not.toBeInTheDocument();
  });

  it('names each saved tool record type in the activity label', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-tool-records'), [
            {
              type: 'memory_saved',
              source: 'tool_result',
              conversationId: 'conversation-1',
              messageId: 'assistant-tool-records',
              message: 'Saved Working Order Memory',
              savedCounts: {
                price_evidence: 2,
                customer_fact: 1,
              },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-tool-records" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(
      screen.getByText('Saved records (Price evidence: 2, Customer facts: 1)'),
    ).toBeInTheDocument();
  });

  it('renders combined OCR table and workbook table counts', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-mixed'), [
            {
              type: 'memory_saved',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-mixed',
              message: 'Saved Working Order Memory',
              savedCounts: {
                ocr_extract: 1,
                calculation_fact: 1,
                working_order_row: 1,
              },
              savedTableCounts: {
                ocr_table: 1,
                system_order_table: 1,
              },
              totalSavedCounts: {
                ocr_extract: 1,
                calculation_fact: 1,
                working_order_row: 1,
              },
              totalTableCounts: {
                ocr_table: 1,
                system_order_table: 1,
              },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-mixed" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(
      screen.getByText(
        'Saved records (OCR extracts: 1, Calculation facts: 1, Working order rows: 1)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Total: OCR tables: 1, Workbook tables: 1, Workbook rows: 1'),
    ).toBeInTheDocument();
  });

  it('renders saved PaddleOCR preflight activity with OCR raw result counts', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-preflight'), [
            {
              type: 'memory_saved',
              source: 'paddleocr_preflight',
              conversationId: 'conversation-1',
              messageId: 'assistant-preflight',
              message: 'Saved PaddleOCR preflight',
              savedCounts: { paddleocr_preflight: 1 },
              totalSavedCounts: { paddleocr_preflight: 2 },
              totalTableCounts: {},
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-preflight" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Saved PaddleOCR preflight')).toBeInTheDocument();
    expect(screen.getByText('This turn: OCR raw results: 1')).toBeInTheDocument();
    expect(screen.getByText('Total: OCR raw results: 2')).toBeInTheDocument();
  });

  it('renders PaddleOCR preflight partial activity with OCR source counts', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-preflight-partial'), [
            {
              type: 'parse_status',
              source: 'paddleocr_preflight',
              conversationId: 'conversation-1',
              messageId: 'assistant-preflight-partial',
              message: 'PaddleOCR preflight partial',
              parseStatus: 'partial',
              savedCounts: { paddleocr_preflight: 1 },
              totalSavedCounts: { paddleocr_preflight: 1 },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-preflight-partial" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('PaddleOCR preflight partial')).toBeInTheDocument();
    expect(screen.getByText('This turn: OCR raw results: 1')).toBeInTheDocument();
    expect(screen.getByText('Total: OCR raw results: 1')).toBeInTheDocument();
  });

  it('renders OCR preprocessing progress messages verbatim', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-ocr-progress'), [
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr-progress',
              message: 'Uploaded pdf to S3 (163 pages / 4 chunks) (file:BH.pdf)',
              parseStatus: 'partial',
            },
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr-progress',
              message: 'Ran OCR markdown process (chunk 1/4) (file:BH.pdf)',
              parseStatus: 'partial',
            },
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr-progress',
              message: 'Processing pdf with OCR markdowns (file:BH.pdf)',
              parseStatus: 'partial',
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-ocr-progress" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(
      screen.getByText('Uploaded pdf to S3 (163 pages / 4 chunks) (file:BH.pdf)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ran OCR markdown process (chunk 1/4) (file:BH.pdf)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Processing pdf with OCR markdowns (file:BH.pdf)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3 events' })).not.toBeInTheDocument();
  });

  it('collapses long OCR preprocessing activity to the latest three events', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(
            steelNativeActivityByMessageId('assistant-ocr-long-progress'),
            [
              'Uploaded pdf to S3 (106 pages / 3 chunks) (file:BH.pdf)',
              'Running paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)',
              'Ran paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)',
              'Saved PaddleOCR preflight (chunk 1/3) (file:BH.pdf)',
              'Running paddleocr_vl in PaddleOCR (chunk 2/3) (file:BH.pdf)',
            ].map((message) => ({
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr-long-progress',
              message,
              parseStatus: 'partial',
            })),
          );
        }}
      >
        <SteelActivity messageId="assistant-ocr-long-progress" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    const toggle = screen.getByRole('button', { name: '5 events' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByText('Uploaded pdf to S3 (106 pages / 3 chunks) (file:BH.pdf)'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Running paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Ran paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Saved PaddleOCR preflight (chunk 1/3) (file:BH.pdf)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Running paddleocr_vl in PaddleOCR (chunk 2/3) (file:BH.pdf)'),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('Uploaded pdf to S3 (106 pages / 3 chunks) (file:BH.pdf)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Running paddleocr_vl in PaddleOCR (chunk 1/3) (file:BH.pdf)'),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByText('Uploaded pdf to S3 (106 pages / 3 chunks) (file:BH.pdf)'),
    ).not.toBeInTheDocument();
  });

  it('renders OCR preprocessing error details in activity', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-ocr-error'), [
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr-error',
              message: 'ocr preprocessing failed (file:BH.pdf)',
              parseStatus: 'partial',
              errorMessage: 'OCR preprocessing failed for BH.pdf: organizer timeout',
              failedKeys: ['file:BH.pdf'],
              missingPageRangesByFileKey: {
                'file:BH.pdf': [{ pageStart: 4, pageEnd: 5 }],
              },
            },
            {
              type: 'parse_status',
              source: 'ocr_preprocessing',
              conversationId: 'conversation-1',
              messageId: 'assistant-ocr-error',
              message: 'ocr preprocessing failed (file:other.pdf)',
              parseStatus: 'partial',
              errorMessage: 'OCR preprocessing failed for other.pdf: provider timeout',
              failedKeys: ['file:other.pdf'],
              missingPageRangesByFileKey: {
                'file:BH.pdf': [{ pageStart: 1, pageEnd: 2 }],
                'file:other.pdf': [
                  { pageStart: 3, pageEnd: 3 },
                  { pageStart: 7, pageEnd: 7 },
                ],
              },
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-ocr-error" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(
      screen.getByText('OCR preprocessing failed for BH.pdf: organizer timeout'),
    ).toBeInTheDocument();
    expect(screen.getByText('Missing page ranges (file:BH.pdf): 1-2, 4-5')).toBeInTheDocument();
    expect(screen.getByText('Missing page ranges (file:other.pdf): 3, 7')).toBeInTheDocument();
  });

  it('does not render Steel activity on user messages', () => {
    const { container } = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('user-1'), [
            {
              type: 'memory_saved',
              source: 'tool_result',
              message: 'Saved Working Order Memory',
              savedCounts: { ocr_extract: 1 },
            },
          ]);
        }}
      >
        <SteelActivity messageId="user-1" isCreatedByUser />
      </RecoilRoot>,
    );

    expect(container.firstChild).toBeNull();
  });
});
