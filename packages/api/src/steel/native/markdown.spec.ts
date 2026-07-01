import {
  captureSteelNativeAssistantMarkdown,
  captureSteelNativeResponseOutput,
  captureSteelNativeToolResult,
  extractSteelNativeMarkdownText,
  extractSteelNativeResponseOutputText,
} from './markdown';

import type {
  CaptureAssistantFinalMarkdownInput,
  CaptureAssistantFinalMarkdownResult,
  CaptureToolResultInput,
  CaptureToolResultResult,
} from '../memory/service';
import type { Response } from '../../agents/responses/types';
import type { SteelToolResult } from '../tools/results';

describe('Steel native Markdown adapter', () => {
  const responseBase: Omit<Response, 'id' | 'output' | 'status'> = {
    object: 'response',
    created_at: 1710000000,
    completed_at: 1710000001,
    incomplete_details: null,
    model: 'gpt-5',
    previous_response_id: null,
    instructions: null,
    error: null,
    tools: [],
    tool_choice: 'auto',
    truncation: 'disabled',
    parallel_tool_calls: true,
    text: {},
    temperature: 1,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    reasoning: null,
    user: null,
    max_tool_calls: null,
    store: true,
    background: false,
    service_tier: 'default',
    max_output_tokens: null,
    metadata: {},
    safety_identifier: null,
    prompt_cache_key: null,
    usage: null,
  };
  const createResponse = ({
    id,
    output,
    status = 'completed',
  }: Pick<Response, 'id' | 'output'> & Pick<Partial<Response>, 'status'>): Response => ({
    ...responseBase,
    id,
    output,
    status,
  });

  it('extracts assistant Markdown from text content blocks', () => {
    expect(
      extractSteelNativeMarkdownText({
        content: [
          { type: 'text', text: '| 項次 | 品名 |\n| --- | --- |\n' },
          { text: { value: '| 1 | 鋼板 |\n' } },
          { type: 'tool_call', name: 'search_customers' },
        ],
      }),
    ).toBe('| 項次 | 品名 |\n| --- | --- |\n| 1 | 鋼板 |\n');
  });

  it('extracts Markdown text from Open Responses output text parts', () => {
    expect(
      extractSteelNativeResponseOutputText(
        createResponse({
          id: 'resp_1',
          output: [
            {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                { type: 'output_text', text: '| 項次 | 品名 |\n', annotations: [], logprobs: [] },
                { type: 'output_text', text: '| 1 | 鋼板 |\n', annotations: [], logprobs: [] },
              ],
            },
          ],
        }),
      ),
    ).toBe('| 項次 | 品名 |\n| 1 | 鋼板 |\n');
  });

  it('captures stored Open Responses output after message persistence metadata is known', async () => {
    const captureAssistantFinalMarkdown = jest.fn(
      async (
        _input: CaptureAssistantFinalMarkdownInput,
      ): Promise<CaptureAssistantFinalMarkdownResult> => ({
        parseStatus: 'saved',
        savedCounts: { working_order_row: 2 },
      }),
    );

    const result = await captureSteelNativeResponseOutput({
      writer: { captureAssistantFinalMarkdown },
      conversationId: 'conversation_1',
      responseId: 'resp_1',
      turnIndex: 6,
      response: createResponse({
        id: 'resp_1',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'output_text', text: '| row | value |\n', annotations: [], logprobs: [] },
            ],
          },
        ],
      }),
    });

    expect(result).toEqual({
      status: 'captured',
      result: {
        parseStatus: 'saved',
        savedCounts: { working_order_row: 2 },
      },
    });
    expect(captureAssistantFinalMarkdown).toHaveBeenCalledWith({
      conversationId: 'conversation_1',
      requestId: 'resp_1',
      messageId: 'resp_1',
      turnIndex: 6,
      checkpointTurnIndex: 5,
      content: '| row | value |\n',
    });
  });

  it('captures persisted assistant Markdown with native message metadata', async () => {
    const captureAssistantFinalMarkdown = jest.fn(
      async (
        _input: CaptureAssistantFinalMarkdownInput,
      ): Promise<CaptureAssistantFinalMarkdownResult> => ({
        parseStatus: 'saved',
        savedCounts: { working_order_row: 1 },
      }),
    );

    const result = await captureSteelNativeAssistantMarkdown({
      writer: { captureAssistantFinalMarkdown },
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      turnIndex: 4,
      text: '| row | value |\n| --- | --- |\n| 1 | steel |\n',
    });

    expect(result).toEqual({
      status: 'captured',
      result: {
        parseStatus: 'saved',
        savedCounts: { working_order_row: 1 },
      },
    });
    expect(captureAssistantFinalMarkdown).toHaveBeenCalledWith({
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_2',
      turnIndex: 4,
      checkpointTurnIndex: 3,
      content: '| row | value |\n| --- | --- |\n| 1 | steel |\n',
    });
  });

  it('forwards current turn files to assistant Markdown capture', async () => {
    const captureAssistantFinalMarkdown = jest.fn(
      async (
        _input: CaptureAssistantFinalMarkdownInput,
      ): Promise<CaptureAssistantFinalMarkdownResult> => ({
        parseStatus: 'saved',
        savedCounts: { ocr_extract: 1 },
      }),
    );
    const currentTurnFiles = [
      {
        fileId: 'file-ocr',
        filename: 'drawing.pdf',
        mediaType: 'application/pdf',
      },
    ];

    await captureSteelNativeAssistantMarkdown({
      writer: { captureAssistantFinalMarkdown },
      conversationId: 'conversation_1',
      requestId: 'request_1',
      messageId: 'message_ocr',
      turnIndex: 4,
      text: '| 來源檔案 | 規格 |\n| --- | --- |\n| drawing.pdf | PL6 |\n',
      currentTurnFiles,
    });

    expect(captureAssistantFinalMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation_1',
        currentTurnFiles,
      }),
    );
  });

  it('skips assistant messages that are unsafe or irrelevant to persist', async () => {
    const captureAssistantFinalMarkdown = jest.fn();

    await expect(
      captureSteelNativeAssistantMarkdown({
        writer: { captureAssistantFinalMarkdown },
        conversationId: 'conversation_1',
        messageId: 'message_2',
        turnIndex: 1,
        text: 'ignored',
        isCreatedByUser: true,
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'user_message' });

    await expect(
      captureSteelNativeAssistantMarkdown({
        writer: { captureAssistantFinalMarkdown },
        conversationId: 'conversation_1',
        messageId: 'message_2',
        turnIndex: 1,
        text: '   ',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'blank_content' });

    await expect(
      captureSteelNativeAssistantMarkdown({
        writer: { captureAssistantFinalMarkdown },
        messageId: 'message_2',
        turnIndex: 1,
        text: 'not saved',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'missing_conversation_id' });

    expect(captureAssistantFinalMarkdown).not.toHaveBeenCalled();
  });

  it('captures successful native Steel tool results into the same writer contract', async () => {
    const captureToolResult = jest.fn(
      async (_input: CaptureToolResultInput): Promise<CaptureToolResultResult> => ({
        savedCounts: { customer_fact: 1 },
      }),
    );
    const toolResult: SteelToolResult = {
      ok: true,
      toolName: 'search_customers',
      data: { customers: [{ id: 21, displayName: 'LD' }] },
      sourceRefs: [],
      durationMs: 5,
      redactionVersion: 1,
    };

    const result = await captureSteelNativeToolResult({
      writer: { captureToolResult },
      conversationId: 'conversation_1',
      requestId: 'request_2',
      providerToolCallId: 'call_1',
      turnIndex: 8,
      result: toolResult,
    });

    expect(result).toEqual({
      status: 'captured',
      result: { savedCounts: { customer_fact: 1 } },
    });
    expect(captureToolResult).toHaveBeenCalledWith({
      conversationId: 'conversation_1',
      requestId: 'request_2',
      providerToolCallId: 'call_1',
      toolName: 'search_customers',
      turnIndex: 8,
      checkpointTurnIndex: 7,
      data: { customers: [{ id: 21, displayName: 'LD' }] },
    });
  });

  it('does not persist failed tool results', async () => {
    const captureToolResult = jest.fn();

    await expect(
      captureSteelNativeToolResult({
        writer: { captureToolResult },
        conversationId: 'conversation_1',
        turnIndex: 8,
        result: {
          ok: false,
          toolName: 'search_customers',
          errorCategory: 'repository_error',
          errorSummary: 'lookup failed',
          durationMs: 5,
          redactionVersion: 1,
        },
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'failed_tool_result' });

    expect(captureToolResult).not.toHaveBeenCalled();
  });
});
