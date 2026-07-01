import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { steelNativeActivityByMessageId } from '~/store/steel';
import SteelActivity from '../SteelActivity';

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: { count?: number; source?: string }) => {
    if (key === 'com_ui_steel_activity') {
      return 'Steel activity';
    }
    if (key === 'com_ui_steel_activity_parse_saved') {
      return 'Steel form parsed';
    }
    if (key === 'com_ui_steel_activity_state_saved') {
      return 'Steel quote state saved';
    }
    if (key === 'com_ui_steel_activity_records_saved') {
      return `${options?.count ?? 0} records`;
    }
    if (key === 'com_ui_steel_activity_source_count') {
      return `${options?.source ?? ''}: ${options?.count ?? 0}`;
    }
    if (key === 'com_ui_steel_activity_source_ocr') {
      return 'OCR';
    }
    if (key === 'com_ui_steel_activity_source_workbook') {
      return 'Workbook';
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
            },
            {
              type: 'memory_saved',
              source: 'assistant_markdown',
              conversationId: 'conversation-1',
              messageId: 'assistant-1',
              message: 'Working Order Memory saved',
              savedCounts: { working_order_row: 2 },
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
    expect(screen.getAllByText('Workbook: 2')).toHaveLength(2);
  });

  it('renders OCR source counts for OCR-only saved state', () => {
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
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-ocr" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('Steel quote state saved')).toBeInTheDocument();
    expect(screen.getByText('OCR: 1')).toBeInTheDocument();
  });

  it('renders combined OCR and workbook source counts', () => {
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
            },
          ]);
        }}
      >
        <SteelActivity messageId="assistant-mixed" isCreatedByUser={false} />
      </RecoilRoot>,
    );

    expect(screen.getByText('OCR: 1, Workbook: 2')).toBeInTheDocument();
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
