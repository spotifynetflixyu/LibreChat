import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SteelOAuthChat from './SteelOAuthChat';

const mockSendSteelChat = jest.fn();
const mockStreamSteelChat = jest.fn();

jest.mock('librechat-data-provider', () => ({
  dataService: {
    sendSteelChat: (...args: unknown[]) => mockSendSteelChat(...args),
    streamSteelChat: (...args: unknown[]) => mockStreamSteelChat(...args),
  },
}));

describe('SteelOAuthChat', () => {
  beforeEach(() => {
    mockSendSteelChat.mockReset();
    mockStreamSteelChat.mockReset();
    mockStreamSteelChat.mockImplementation(async (_payload, onEvent) => {
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({
        type: 'progress',
        stage: 'provider_request',
        message: '等待模型回覆',
      });
      onEvent({
        type: 'lookup',
        status: 'completed',
        toolName: 'search_price_candidates',
        message: 'search_price_candidates completed',
        ok: true,
      });
      onEvent({ type: 'done', response });
      return response;
    });
  });

  it('sends chat payloads without workbook ids and renders assistant Markdown tables', async () => {
    const user = userEvent.setup();
    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), 'C100 6M 一支多少');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('643.2');
    expect(screen.getByRole('columnheader', { name: '品名' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '小計' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'C100' })).toBeInTheDocument();
    expect(mockStreamSteelChat.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: 'C100 6M 一支多少',
          }),
        ],
      }),
    );
    expect(mockStreamSteelChat.mock.calls[0]?.[0]).not.toHaveProperty('workbookId');
    expect(mockStreamSteelChat.mock.calls[0]?.[0]).not.toHaveProperty('workbookVersion');
    expect(screen.queryByRole('tab', { name: 'Workbook' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'File Analysis' })).not.toBeInTheDocument();
  });

  it('shows activity and neutral provider timings without workbook metrics', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: 'timed-ok',
        timings: {
          totalDurationMs: 160,
          generationDurationMs: 120,
          toolDurationMs: 35,
          roundCount: 2,
          rounds: [
            {
              round: 1,
              generationDurationMs: 70,
              toolDurationMs: 25,
              promptMessageCount: 6,
              generatedToolCallCount: 2,
            },
            {
              round: 2,
              generationDurationMs: 50,
              toolDurationMs: 10,
              promptMessageCount: 9,
              generatedToolCallCount: 1,
            },
          ],
        },
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({
        type: 'progress',
        stage: 'provider_request',
        message: 'activity progress',
      });
      onEvent({
        type: 'tool',
        status: 'started',
        toolName: 'search_price_candidates',
        message: 'search_price_candidates started',
      });
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), 'timed run');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('timed-ok');

    const activityPanel = screen.getByLabelText('Activity panel');
    expect(within(activityPanel).getByText('activity progress')).toBeInTheDocument();
    expect(within(activityPanel).getByText('search_price_candidates started')).toBeInTheDocument();

    const timingsPanel = within(activityPanel).getByLabelText('Provider timings');
    expect(within(timingsPanel).getByText('Total')).toBeInTheDocument();
    expect(within(timingsPanel).getByText('160 ms')).toBeInTheDocument();
    expect(within(timingsPanel).getAllByText('Generation')).toHaveLength(3);
    expect(within(timingsPanel).getAllByText('Tools')).toHaveLength(3);
    expect(within(timingsPanel).getByText('Round 2')).toBeInTheDocument();
    expect(within(timingsPanel).queryByText('Workbook completion')).not.toBeInTheDocument();
    expect(within(timingsPanel).queryByText(/workbook ops/)).not.toBeInTheDocument();
  });
});
