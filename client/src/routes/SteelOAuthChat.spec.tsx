import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SteelOAuthChat from './SteelOAuthChat';

const mockSendSteelChat = jest.fn();
const mockStreamSteelChat = jest.fn();
const mockGetSteelConversationMessages = jest.fn();

jest.mock('librechat-data-provider', () => ({
  dataService: {
    getSteelConversationMessages: (...args: unknown[]) => mockGetSteelConversationMessages(...args),
    sendSteelChat: (...args: unknown[]) => mockSendSteelChat(...args),
    streamSteelChat: (...args: unknown[]) => mockStreamSteelChat(...args),
  },
}));

describe('SteelOAuthChat', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/steel/oauth-chat');
    mockGetSteelConversationMessages.mockReset();
    mockGetSteelConversationMessages.mockResolvedValue({
      conversationId: 'steel-chat-empty',
      messages: [],
    });
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

  it('reloads persisted Steel chat turns from the URL conversationId and reuses message ids for edits', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/steel/oauth-chat?conversationId=steel-chat-reload');
    mockGetSteelConversationMessages.mockResolvedValueOnce({
      conversationId: 'steel-chat-reload',
      messages: [
        {
          messageId: 'user-1',
          role: 'user',
          content: '上一輪 PL15*500',
          attachments: [
            {
              fileId: 'file-1',
              filename: 'PL.pdf',
              mediaType: 'application/pdf',
            },
          ],
          createdAt: '2026-06-24T00:00:00.000Z',
          updatedAt: '2026-06-24T00:00:00.000Z',
        },
        {
          messageId: 'assistant-1',
          role: 'assistant',
          content: '已保存報價',
          createdAt: '2026-06-24T00:00:01.000Z',
          updatedAt: '2026-06-24T00:00:01.000Z',
        },
      ],
    });
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        conversationId: 'steel-chat-reload',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已重新報價',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    expect(await screen.findByText('上一輪 PL15*500')).toBeInTheDocument();
    expect(screen.getByText('PL.pdf')).toBeInTheDocument();
    expect(screen.getByText('已保存報價')).toBeInTheDocument();
    expect(mockGetSteelConversationMessages).toHaveBeenCalledWith('steel-chat-reload');
    expect(mockStreamSteelChat).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Edit user message'));
    await user.clear(screen.getByPlaceholderText('Message Steel'));
    await user.type(screen.getByPlaceholderText('Message Steel'), '改成 PL15*500 兩片');
    await user.click(screen.getByLabelText('Send'));

    expect(await screen.findByText('已重新報價')).toBeInTheDocument();
    expect(mockStreamSteelChat.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        conversationId: 'steel-chat-reload',
        editMessageId: 'user-1',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: '改成 PL15*500 兩片',
            messageId: 'user-1',
          }),
        ],
      }),
    );
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

  it('renders wide Markdown tables with readable columns and three-line cell text', async () => {
    const user = userEvent.setup();
    const longReviewText =
      '孔標註可辨識為 2-Ø30 與 4-Ø24；請確認是否需另計鑽孔 / 沖孔 / 雷射孔，這段文字應限制最多三行避免表格被撐高。';
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: [
          '| 來源頁 | 圖面名稱 | 件號 / 編號 | 斷面規格 | 判讀尺寸 mm | 材料 | 數量 | 長度 mm | 面積 | 重量 kg | 孔數 / 件 | 總孔數 | 孔徑 / 孔型 | 切工 / 折工 / 開槽 / 其他加工 | 信心 | 人工複核原因 |',
          '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
          `| 3 | PL15*500 | 03 | PL15*500 | 厚 15 × 寬 500 × 長 300 | A36 | 10 | 300.0 | 0.32 | 17.7 | 6 | 60 | 2-Ø30、4-Ø24 | 板材切割；孔加工 | 高 | ${longReviewText} |`,
        ].join('\n'),
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '顯示 PL.pdf OCR 表格');
    await user.click(screen.getByLabelText('Send'));

    const table = await screen.findByRole('table');
    expect(table).toHaveClass('w-max');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('columnheader', { name: '人工複核原因' }).closest('th')).toHaveClass(
      'min-w-[9rem]',
    );
    expect(screen.getByRole('cell', { name: longReviewText }).closest('td')).toHaveClass(
      'min-w-[9rem]',
    );
    expect(screen.getByText(longReviewText)).toHaveStyle({
      WebkitLineClamp: '3',
      overflow: 'hidden',
    });
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

  it('coalesces streamed reasoning deltas into one Activity item', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        conversationId: 'steel-chat-1',
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已確認 OCR 內容。',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'reasoning', summary: 'I' });
      onEvent({ type: 'reasoning', summary: ' need' });
      onEvent({ type: 'reasoning', summary: ' final OCR confirmation.' });
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '請確認 PL.pdf OCR');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('已確認 OCR 內容。');
    const activityPanel = screen.getByLabelText('Activity panel');
    expect(within(activityPanel).getAllByText('Reasoning summary')).toHaveLength(1);
    expect(within(activityPanel).getAllByText('Summary')).toHaveLength(1);
    expect(within(activityPanel).getAllByText('reasoning summary')).toHaveLength(1);
    expect(within(activityPanel).getByText('I need final OCR confirmation.')).toBeInTheDocument();
    expect(within(activityPanel).queryByText('I')).not.toBeInTheDocument();
    expect(within(activityPanel).queryByText(' need')).not.toBeInTheDocument();
    expect(within(activityPanel).queryByText(' final OCR confirmation.')).not.toBeInTheDocument();
  });

  it('does not render object-placeholder provider errors in Activity or chat', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      onEvent({
        type: 'progress',
        stage: 'provider_request',
        message: 'Waiting for provider',
      });
      onEvent({
        type: 'error',
        errorCategory: 'unknown',
        errorSummary: '[object Object]',
      });
      throw new Error('[object Object]');
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '請處理 PL.pdf');
    await user.click(screen.getByLabelText('Send'));

    expect(await screen.findAllByText('Steel chat request failed.')).toHaveLength(2);
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    const activityPanel = screen.getByLabelText('Activity panel');
    expect(within(activityPanel).queryByText('[object Object]')).not.toBeInTheDocument();
    expect(within(activityPanel).getAllByText('Error')).toHaveLength(1);
    expect(within(activityPanel).getAllByText('Failed')).toHaveLength(1);
  });

  it('renders nested provider error detail instead of a generic OAuth wrapper', async () => {
    const user = userEvent.setup();
    const providerError = new Error('OpenAI OAuth provider request failed.', {
      cause: {
        response: {
          data: {
            error: {
              message: 'Provider rejected follow-up after PL.pdf OCR table context.',
            },
          },
        },
      },
    });
    mockStreamSteelChat.mockImplementationOnce(async () => {
      throw providerError;
    });

    render(<SteelOAuthChat />);

    await user.type(screen.getByPlaceholderText('Message Steel'), '請處理 PL.pdf');
    await user.click(screen.getByLabelText('Send'));

    expect(
      await screen.findAllByText('Provider rejected follow-up after PL.pdf OCR table context.'),
    ).toHaveLength(2);
    expect(screen.queryByText('OpenAI OAuth provider request failed.')).not.toBeInTheDocument();
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
    expect(
      within(screen.getByLabelText('Activity panel')).getByText('Queued steer applied'),
    ).toBeInTheDocument();
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
