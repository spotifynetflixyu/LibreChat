import React from 'react';
import { RecoilRoot } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import { steelNativeActivityByMessageId } from '~/store/steel';
import SteelActivity from '../SteelActivity';

type LocalizeOptions = {
  count?: number;
  counts?: string;
  fileKey?: string;
  ranges?: string;
  source?: string;
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

describe('SteelActivity', () => {
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
