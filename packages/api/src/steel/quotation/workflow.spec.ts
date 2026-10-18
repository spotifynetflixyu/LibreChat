import { AIMessage } from '@librechat/agents/langchain/messages';
import type { SteelQuotationWorkflowInput, SteelQuotationWorkflowStore } from './workflow';
import type { QuotationRunnerInput } from './runner';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import { createSteelQuotationWorkflow } from './workflow';

const mockRunQuotation = jest.fn();
const mockFinalize = jest.fn();

jest.mock('./runner', () => ({
  ...jest.requireActual('./runner'),
  runQuotationPreflightWithRetries: (input: QuotationRunnerInput) => mockRunQuotation(input),
}));
jest.mock('../markdown/completion', () => ({
  ...jest.requireActual('../markdown/completion'),
  createSteelMarkdownCompletionServices: () => ({ finalize: mockFinalize }),
}));

const completeSystemOrder = '## system_order\n\n| 品名 | 數量 |\n| --- | --- |\n| 測試 | 1 |';
const scope = { userId: 'owner', conversationId: 'conversation-1' };
const client = { query: jest.fn() };

function createStore(): { [Method in keyof SteelQuotationWorkflowStore]: jest.Mock } {
  return {
    saveMessage: jest.fn().mockResolvedValue({ messageId: 'response-1' }),
    getMessage: jest.fn(),
    admitSteelMarkdown: jest.fn(),
    publishSteelMarkdown: jest.fn(),
    saveSteelQuotationMessage: jest.fn(),
    appendSteelQuotationSummary: jest.fn(),
  };
}

function aiMessage(
  content: string,
  finishReason = 'stop',
  toolCalls: AIMessage['tool_calls'] = [],
) {
  return new AIMessage({
    content,
    response_metadata: { finish_reason: finishReason },
    tool_calls: toolCalls,
  });
}

function makeInput(resume = false, last = aiMessage('## quote_signal')) {
  const input: SteelQuotationWorkflowInput = {
    req: {
      user: { id: 'owner' },
      steelNativeContext: {
        requestId: 'response-1',
        quotation: { scope, resume, messageId: 'confirm-user' },
        delegateOcrContext: { modelOptions: { model: 'test-model' } },
        steelHistory: { activityEvents: [], preflightToolCalls: [] },
      },
    },
    signal: new AbortController().signal,
    agent: { id: 'agent-1' },
    run: { getRunMessages: () => [last] },
    onText: jest.fn(),
    buildPublicationMessage: ({ targetMessageId, markdown }) => ({
      messageId: targetMessageId,
      conversationId: scope.conversationId,
      parentMessageId: 'original-input',
      user: 'owner',
      text: markdown,
      content: [{ type: 'text', text: markdown }],
    }),
  };
  return input;
}

/** Mirrors the completion service: an accepted run persists the AI order before quotation starts. */
async function acceptCompletedSignal(input: {
  completed: boolean;
  markdown: string;
  applyMarkdown(markdown: string): void;
  persistMarkdown(): Promise<unknown>;
}) {
  if (!input.completed || !input.markdown.includes('quote_signal')) {
    return { markdown: input.markdown };
  }
  input.applyMarkdown(input.markdown);
  await input.persistMarkdown();
  return { markdown: input.markdown, acceptedRun: { runId: 'run-1' } };
}

let store: ReturnType<typeof createStore>;
let execute: ReturnType<typeof createSteelQuotationWorkflow>;
let emitChunk: jest.SpyInstance;

beforeEach(() => {
  mockFinalize.mockReset().mockImplementation(acceptCompletedSignal);
  mockRunQuotation.mockReset().mockResolvedValue({ status: 'completed' });
  emitChunk = jest.spyOn(GenerationJobManager, 'emitChunk').mockResolvedValue(undefined);
  store = createStore();
  execute = createSteelQuotationWorkflow({ db: store, client });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createSteelQuotationWorkflow', () => {
  it('persists the accepted AI order before starting one quotation run', async () => {
    await execute(makeInput());

    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: 'response-1',
        generationId: 'response-1',
        markdown: '## quote_signal',
        completed: true,
        stage: 'workflow',
      }),
    );
    expect(store.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner' }),
      expect.objectContaining({
        messageId: 'response-1',
        conversationId: 'conversation-1',
        parentMessageId: 'confirm-user',
        unfinished: true,
        text: '## quote_signal',
        finish_reason: 'stop',
      }),
      { context: 'Quotation workflow signal durable publication' },
    );
    expect(mockRunQuotation).toHaveBeenCalledTimes(1);
    expect(mockRunQuotation).toHaveBeenCalledWith(
      expect.objectContaining({ client, scope, modelOptions: { model: 'test-model' } }),
    );
    expect(store.saveMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunQuotation.mock.invocationCallOrder[0],
    );
  });

  it('hands a locally completed signal to quotation and rejects a malformed one', async () => {
    const input = makeInput(false, aiMessage('## quote_signal\n\nstart', 'quotation_handoff'));
    await execute(input);
    expect(mockFinalize).toHaveBeenLastCalledWith(expect.objectContaining({ completed: true }));
    expect(mockRunQuotation).toHaveBeenCalledTimes(1);
    expect(input.signal.aborted).toBe(false);

    mockRunQuotation.mockClear();
    await execute(makeInput(false, aiMessage('## quote_signal\n\nstart now', 'quotation_handoff')));
    expect(mockFinalize).toHaveBeenLastCalledWith(expect.objectContaining({ completed: false }));
    expect(mockRunQuotation).not.toHaveBeenCalled();
  });

  it('does not admit a pending tool exchange, an aborted turn, or an interrupted run', async () => {
    await execute(
      makeInput(false, aiMessage('signal', 'tool_calls', [{ id: 'pending', name: 'x', args: {} }])),
    );
    const controller = new AbortController();
    controller.abort();
    await execute({ ...makeInput(), signal: controller.signal });
    const interrupted = makeInput();
    await execute({ ...interrupted, run: { ...interrupted.run, interrupt: {} } });

    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockRunQuotation).not.toHaveBeenCalled();
  });

  it('does not start a quotation when the completion service declines the run', async () => {
    mockFinalize.mockResolvedValue({ markdown: 'plain answer' });
    await execute(makeInput(false, aiMessage('plain answer')));
    expect(mockRunQuotation).not.toHaveBeenCalled();
  });

  it('resumes the existing quotation run once and streams its terminal notice', async () => {
    mockRunQuotation.mockResolvedValue({ status: 'cancelled' });
    const input = makeInput(true);
    await execute(input);

    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockRunQuotation).toHaveBeenCalledTimes(1);
    expect(input.onText).toHaveBeenCalledWith(expect.stringContaining('報價已取消'));
  });

  it('publishes the committed table before the summary prose and announces both updates', async () => {
    const publication = {
      version: 1,
      runId: 'run-1',
      outputId: 'system_order:run-1',
      sourceMessageId: 'response-1',
      receiptSha256: 'a'.repeat(64),
      tableContentIndex: 0,
      admissionSequence: 1,
      summaryContentIndex: 1,
      footerContentIndex: 2,
    };
    const saved = {
      messageId: 'response-1',
      conversationId: 'conversation-1',
      user: 'owner',
      text: completeSystemOrder,
      content: [
        { type: 'text', text: completeSystemOrder },
        { type: 'text', text: '' },
        { type: 'text', text: '' },
      ],
      metadata: { steelQuotation: publication },
    };
    store.saveSteelQuotationMessage.mockResolvedValue({ ok: true, message: saved });
    const input = {
      ...makeInput(true),
      streamId: 'quotation-stream',
      onCommittedMessage: jest.fn(),
    };
    mockRunQuotation.mockImplementation(
      async ({ publishFinal, onTextDelta, onSummaryCommitted }: QuotationRunnerInput) => {
        await publishFinal({
          runId: 'run-1',
          targetMessageId: 'response-1',
          run: { runId: 'run-1', targetMessageId: 'response-1' },
          markdown: completeSystemOrder,
        } as Parameters<QuotationRunnerInput['publishFinal']>[0]);
        expect(emitChunk).toHaveBeenCalledWith(
          'quotation-stream',
          { event: 'steel_message_update', data: { message: saved, publication, update: 'order' } },
          undefined,
        );
        await onTextDelta?.('Main summary');
        await onSummaryCommitted?.({ ...saved, text: `${completeSystemOrder}\n\nMain summary` });
        return { status: 'completed' };
      },
    );

    await execute(input);

    expect(input.onText).toHaveBeenCalledWith('Main summary');
    expect(input.onText).toHaveBeenCalledTimes(1);
    expect(input.onCommittedMessage).toHaveBeenCalledWith(saved);
    const updates = emitChunk.mock.calls
      .map(([, event]) => event)
      .filter(({ event }) => event === 'steel_message_update');
    expect(updates.map(({ data }) => data.update)).toEqual(['order', 'summary']);
    expect(store.saveSteelQuotationMessage.mock.invocationCallOrder[0]).toBeLessThan(
      (input.onText as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('keeps the raw response owner separate from the publication target', async () => {
    store.saveSteelQuotationMessage.mockResolvedValue({ ok: true, message: { messageId: 'b' } });
    const input: SteelQuotationWorkflowInput = {
      ...makeInput(true),
      buildPublicationMessage: ({ markdown }) => ({
        messageId: 'source-a',
        sourceMessageId: 'source-a',
        conversationId: 'conversation-1',
        parentMessageId: 'original-input',
        user: 'owner',
        text: `source prefix\n\n${markdown}`,
        content: [{ type: 'text', text: 'source prefix' }],
        metadata: { keep: true },
      }),
    };
    mockRunQuotation.mockImplementationOnce(async ({ publishFinal }: QuotationRunnerInput) => {
      await publishFinal({
        runId: 'run-1',
        targetMessageId: 'target-b',
        run: { runId: 'run-1', targetMessageId: 'target-b' },
        markdown: completeSystemOrder,
      } as Parameters<QuotationRunnerInput['publishFinal']>[0]);
      return { status: 'completed' };
    });

    await execute(input);

    expect(store.saveSteelQuotationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          messageId: 'target-b',
          sourceMessageId: 'source-a',
          text: `source prefix\n\n${completeSystemOrder}`,
          metadata: { keep: true },
        }),
      }),
    );
  });
});
