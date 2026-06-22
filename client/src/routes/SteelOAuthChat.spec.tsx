import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
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

  it('shows Markdown parse status and saved memory counts in Activity', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '| 項次 | 型號 | 品名規格 |\n| --- | --- | --- |\n| 1 | CCG075 | 75x45 |',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({
        type: 'parse_status',
        message: 'Markdown parse saved',
        parseStatus: 'saved',
        savedCounts: {
          working_order_row: 71,
          customer_fact: 1,
        },
      });
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '存成表格');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('CCG075');

    const activityPanel = screen.getByLabelText('Activity panel');
    expect(within(activityPanel).getByText('Memory parse')).toBeInTheDocument();
    expect(within(activityPanel).getByText('Saved')).toBeInTheDocument();
    expect(within(activityPanel).getByText('Markdown parse saved')).toBeInTheDocument();
    expect(
      within(activityPanel).getByText('working_order_row: 71, customer_fact: 1'),
    ).toBeInTheDocument();
  });

  it('renders streamed assistant text deltas before the stream finishes', async () => {
    const user = userEvent.setup();
    let finishStream: (() => void) | undefined;
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      onEvent({ type: 'text', delta: '即時' });
      onEvent({ type: 'text', delta: '串流' });
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '即時串流',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), 'stream please');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('即時串流');
    await act(async () => {
      finishStream?.();
    });

    expect(await screen.findByText('即時串流')).toBeInTheDocument();
    expect(screen.getAllByText('即時串流')).toHaveLength(1);
  });

  it('accepts queued steer text while a Steel response is running', async () => {
    const user = userEvent.setup();
    let finishStream: (() => void) | undefined;
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      onEvent({ type: 'text', delta: '第一輪處理中' });
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '第一輪處理中',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '先報 CCG075');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('第一輪處理中');

    await user.type(screen.getByPlaceholderText('Message Steel'), '數量改成 3 支');
    await user.click(screen.getByLabelText('Send'));

    const activityPanel = screen.getByLabelText('Activity panel');
    expect(within(activityPanel).getByText('Queued steer accepted')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message Steel')).toHaveValue('');

    await act(async () => {
      finishStream?.();
    });
  });

  it('runs queued steer as a follow-up request after the current response finishes', async () => {
    const user = userEvent.setup();
    let finishFirstStream: (() => void) | undefined;
    mockStreamSteelChat
      .mockImplementationOnce(async (_payload, onEvent) => {
        onEvent({ type: 'text', delta: '第一輪完成' });
        await new Promise<void>((resolve) => {
          finishFirstStream = resolve;
        });
        const response = {
          conversationId: 'steel-chat-1',
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '第一輪完成',
          unsupportedSettings: [],
          warnings: [],
        };
        onEvent({ type: 'done', response });
        return response;
      })
      .mockImplementationOnce(async (_payload, onEvent) => {
        onEvent({ type: 'steer_applied', message: 'Queued steer applied' });
        const response = {
          conversationId: 'steel-chat-1',
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '已改成 3 支',
          unsupportedSettings: [],
          warnings: [],
        };
        onEvent({ type: 'done', response });
        return response;
      });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '先報 CCG075');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('第一輪完成');
    await user.type(screen.getByPlaceholderText('Message Steel'), '數量改成 3 支');
    await user.click(screen.getByLabelText('Send'));

    await act(async () => {
      finishFirstStream?.();
    });

    expect(await screen.findByText('已改成 3 支')).toBeInTheDocument();
    expect(mockStreamSteelChat).toHaveBeenCalledTimes(2);
    expect(mockStreamSteelChat.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        conversationId: 'steel-chat-1',
        messageSource: 'queued_steer',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: '數量改成 3 支',
          }),
        ],
      }),
    );
    expect(within(screen.getByLabelText('Activity panel')).getByText('Queued steer applied')).toBeInTheDocument();
  });

  it('copies assistant Markdown and rendered tables without Activity text', async () => {
    const user = userEvent.setup();
    const writeTextSpy = jest.spyOn(navigator.clipboard, 'writeText');
    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), 'C100 6M 一支多少');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('643.2');

    await user.click(screen.getByLabelText('Copy assistant message'));
    expect(writeTextSpy).toHaveBeenLastCalledWith(
      '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
    );
    expect(writeTextSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('search_price_candidates completed'),
    );

    await user.click(screen.getByLabelText('Copy table Markdown'));
    expect(writeTextSpy).toHaveBeenLastCalledWith(
      '| 品名 | 小計 |\n| --- | --- |\n| C100 | 643.2 |',
    );
  });

  it('edits a prior user message by overwriting visible text and rerunning from that message', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat
      .mockImplementationOnce(async (_payload, onEvent) => {
        const response = {
          conversationId: 'steel-chat-1',
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '原本回覆',
          unsupportedSettings: [],
          warnings: [],
        };
        onEvent({ type: 'done', response });
        return response;
      })
      .mockImplementationOnce(async (_payload, onEvent) => {
        const response = {
          conversationId: 'steel-chat-1',
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '編輯後回覆',
          unsupportedSettings: [],
          warnings: [],
        };
        onEvent({ type: 'done', response });
        return response;
      });
    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '先報 1 支');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('原本回覆');
    await user.click(screen.getByLabelText('Edit user message'));
    await user.clear(screen.getByPlaceholderText('Message Steel'));
    await user.type(screen.getByPlaceholderText('Message Steel'), '改成 3 支');
    await user.click(screen.getByLabelText('Send'));

    expect(await screen.findByText('編輯後回覆')).toBeInTheDocument();
    expect(screen.queryByText('先報 1 支')).not.toBeInTheDocument();
    expect(screen.queryByText('原本回覆')).not.toBeInTheDocument();
    expect(mockStreamSteelChat.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        conversationId: 'steel-chat-1',
        editMessageId: expect.stringMatching(/^user-/),
        messages: [
          expect.objectContaining({
            role: 'user',
            content: '改成 3 支',
            messageId: expect.stringMatching(/^user-/),
          }),
        ],
      }),
    );
  });
});
