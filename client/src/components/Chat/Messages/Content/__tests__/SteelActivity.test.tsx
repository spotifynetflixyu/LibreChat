import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { steelNativeActivityByMessageId } from '~/store/steel';
import SteelActivity from '../SteelActivity';

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: { count?: number; counts?: string; source?: string }) => {
    if (key === 'com_ui_steel_activity') {
      return 'Steel activity';
    }
    if (key === 'com_ui_steel_activity_parse_saved') {
      return 'Steel form parsed';
    }
    if (key === 'com_ui_steel_activity_state_saved') {
      return 'Steel quote state saved';
    }
    if (key === 'com_ui_steel_activity_paddleocr_saved') {
      return 'PaddleOCR preflight saved';
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
    if (key === 'com_ui_steel_activity_this_turn_counts') {
      return `This turn: ${options?.counts ?? ''}`;
    }
    if (key === 'com_ui_steel_activity_total_counts') {
      return `Total: ${options?.counts ?? ''}`;
    }
    if (key === 'com_ui_steel_activity_source_count') {
      return `${options?.source ?? ''}: ${options?.count ?? 0}`;
    }
    if (key === 'com_ui_steel_activity_source_ocr') {
      return 'OCR';
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
    return key;
  },
}));

describe('SteelActivity', () => {
  it('renders native Steel parse and save status for assistant messages', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-1'), [
            {
              type: 'parse_status',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-1',
              message: 'Markdown parse saved',
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
              message: 'Working Order Memory saved',
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
    expect(screen.getByText('Steel form parsed')).toBeInTheDocument();
    expect(screen.getByText('Steel quote state saved')).toBeInTheDocument();
    expect(screen.getByText('Total: Workbook tables: 1, Workbook rows: 2')).toBeInTheDocument();
    expect(screen.getAllByText('This turn: Workbook tables: 1, Workbook rows: 2')).toHaveLength(2);
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
              message: 'Working Order Memory saved',
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

    expect(screen.getByText('Steel quote state saved')).toBeInTheDocument();
    expect(screen.getByText('This turn: OCR tables: 1')).toBeInTheDocument();
    expect(screen.getByText('Total: OCR raw results: 2, OCR tables: 2')).toBeInTheDocument();
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
              message: 'Working Order Memory saved',
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
      screen.getByText('This turn: OCR tables: 1, Workbook tables: 1, Workbook rows: 1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Total: OCR tables: 1, Workbook tables: 1, Workbook rows: 1'),
    ).toBeInTheDocument();
  });

  it('renders PaddleOCR preflight saved activity with OCR raw result counts', () => {
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('assistant-preflight'), [
            {
              type: 'memory_saved',
              source: 'paddleocr_preflight',
              conversationId: 'conversation-1',
              messageId: 'assistant-preflight',
              message: 'PaddleOCR preflight saved',
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

    expect(screen.getByText('PaddleOCR preflight saved')).toBeInTheDocument();
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

  it('does not render Steel activity on user messages', () => {
    const { container } = render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(steelNativeActivityByMessageId('user-1'), [
            {
              type: 'memory_saved',
              source: 'tool_result',
              message: 'Working Order Memory saved',
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
