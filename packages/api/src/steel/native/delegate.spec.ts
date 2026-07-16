import { CallbackManager } from '@langchain/core/callbacks/manager';
import { ToolNode } from '@librechat/agents';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@librechat/agents/langchain/messages';

import {
  buildDelegateOcrFileFilter,
  createDelegateOcrRequestExecute,
  createDelegateOcrTool,
  delegateOcr,
  delegateOcrStreamEventName,
  delegateOcrStreamedArtifact,
  delegateOcrToolName,
  normalizeDelegateOcrChunk,
  type DelegateOcrFileRecord,
} from './delegate';

const modelOptions = {
  authFilePath: '/tmp/codex-auth.json',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'high',
  temperature: 0.2,
};

const files: DelegateOcrFileRecord[] = [
  {
    fileId: 'image-1',
    filename: 'drawing.png',
    filepath: 'https://old.example/image.png?expired=true',
    mediaType: 'image/png',
    storageKey: 'images/user/image-1__drawing.png',
  },
  {
    fileId: 'pdf-1',
    filename: 'quote.pdf',
    filepath: 'https://old.example/quote.pdf?expired=true',
    mediaType: 'application/octet-stream',
    storageKey: 'uploads/user/pdf-1__quote.pdf',
  },
];

describe('delegate_ocr', () => {
  it('normalizes streamed chunks without inserting delimiters', () => {
    expect(normalizeDelegateOcrChunk('a')).toBe('a');
    expect(
      normalizeDelegateOcrChunk([
        'a',
        { type: 'text', text: 'b' },
        { type: 'image_url', image_url: { url: 'ignored' } },
        '',
        42,
        { text: '' },
        { text: 'c' },
      ]),
    ).toBe('abc');
    expect(normalizeDelegateOcrChunk({ text: 'ignored' })).toBe('');
    expect(normalizeDelegateOcrChunk([])).toBe('');
  });

  it('builds an owner-only lookup for every supported file key form', () => {
    expect(
      buildDelegateOcrFileFilter(
        [
          'file:image-1',
          'storage:uploads/user/quote.pdf',
          'path:https://old.example/quote.pdf',
          'filename:quote.pdf',
          'raw-file-id',
        ],
        'user-1',
      ),
    ).toEqual({
      user: 'user-1',
      $or: [
        { file_id: { $in: ['image-1', 'raw-file-id'] } },
        { storageKey: { $in: ['uploads/user/quote.pdf'] } },
        { filepath: { $in: ['https://old.example/quote.pdf'] } },
        { filename: { $in: ['quote.pdf'] } },
      ],
    });
  });

  it('keeps the stored record for fresh signing instead of signing its old URL', async () => {
    const history = [new HumanMessage('重新解析原始 PDF')];
    const storedFile = {
      file_id: 'pdf-1',
      filename: 'quote.pdf',
      filepath: 'https://old.example/quote.pdf?expired=true',
      mimetype: 'application/pdf',
      source: 's3',
      storageKey: 'uploads/user/pdf-1__quote.pdf',
    };
    const getOwnedFileRecords = jest.fn(async () => [storedFile]);
    const signStoredFile = jest.fn(async () => 'https://fresh.example/quote.pdf?expires=43200');
    const invokeModel = jest.fn(async () => '原始 PDF 已重新確認。');
    const execute = createDelegateOcrRequestExecute({
      history,
      modelOptions,
      userId: 'user-1',
      getOwnedFileRecords,
      signStoredFile,
      loadOcrRules: async () => 'OCR_RULE\nVISION_RULE\nOCR_MAIN_RULE',
      invokeModel,
    });

    await expect(execute({ fileKeys: ['file:pdf-1'] })).resolves.toBe(
      '原始 PDF 已重新確認。',
    );
    expect(getOwnedFileRecords).toHaveBeenCalledWith({
      user: 'user-1',
      $or: [{ file_id: { $in: ['pdf-1'] } }],
    });
    expect(signStoredFile).toHaveBeenCalledWith(storedFile);
    expect(JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages)).toContain(
      'https://fresh.example/quote.pdf?expires=43200',
    );
    expect(JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages)).not.toContain(
      'https://old.example',
    );
  });

  it('keeps the provider history intact and sends freshly signed original sources once', async () => {
    const history = [
      new SystemMessage('existing provider system context'),
      new HumanMessage('請重新確認開槽連續邊長'),
      new AIMessage('我會重新確認原始圖面。'),
    ];
    const findOwnedFiles = jest.fn(async () => files);
    const signFile = jest.fn(async (file: DelegateOcrFileRecord) => {
      return `https://fresh.example/${file.storageKey}?expires=43200`;
    });
    const invokeModel = jest.fn(async () => '開槽連續邊長為 1,400mm。');

    const result = await delegateOcr({
      fileKeys: ['file:image-1', 'file:pdf-1'],
      history,
      modelOptions,
      ocrRulesText: 'OCR_RULE\nVISION_RULE\nOCR_MAIN_RULE',
      userId: 'user-1',
      findOwnedFiles,
      signFile,
      invokeModel,
    });

    expect(result).toBe('開槽連續邊長為 1,400mm。');
    expect(findOwnedFiles).toHaveBeenCalledWith({
      fileKeys: ['file:image-1', 'file:pdf-1'],
      userId: 'user-1',
    });
    expect(signFile).toHaveBeenCalledTimes(2);

    const invocation = invokeModel.mock.calls[0]?.[0];
    expect(invocation?.modelOptions).toEqual(modelOptions);
    expect(invocation?.messages.slice(1, 4)).toEqual(history);
    expect(invocation?.messages[0]).toBeInstanceOf(SystemMessage);
    expect(invocation?.messages[0]?.content).toBe('OCR_RULE\nVISION_RULE\nOCR_MAIN_RULE');

    const sourceMessage = invocation?.messages.at(-1);
    expect(sourceMessage).toBeInstanceOf(HumanMessage);
    expect(JSON.stringify(sourceMessage?.content)).toContain(
      'https://fresh.example/images/user/image-1__drawing.png?expires=43200',
    );
    expect(JSON.stringify(sourceMessage?.content)).toContain(
      'https://fresh.example/uploads/user/pdf-1__quote.pdf?expires=43200',
    );
    expect(JSON.stringify(sourceMessage?.content)).toContain('application/pdf');
    expect(JSON.stringify(sourceMessage?.content)).not.toContain('https://old.example');
  });

  it('rejects a missing or unowned file key before invoking the model', async () => {
    await expect(
      delegateOcr({
        fileKeys: ['file:missing'],
        history: [new HumanMessage('重新解析')],
        modelOptions,
        ocrRulesText: 'OCR rules',
        userId: 'user-1',
        findOwnedFiles: async () => [],
        signFile: async () => 'unused',
        invokeModel: async () => 'unused',
      }),
    ).rejects.toThrow('file:missing');
  });

  it('returns the native OCR answer as tool content and lets execution errors propagate', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce('plain text answer')
      .mockRejectedValueOnce(new Error('S3 signer failed'));
    const tool = createDelegateOcrTool({ execute });

    await expect(
      tool.invoke(
        { fileKeys: ['file:image-1'] },
        { toolCall: { id: 'call_delegate_1' } },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        content: 'plain text answer',
        name: delegateOcrToolName,
        status: 'success',
        tool_call_id: 'call_delegate_1',
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(1, {
      fileKeys: ['file:image-1'],
      providerToolCallId: 'call_delegate_1',
    });

    await expect(
      tool.invoke(
        { fileKeys: ['file:image-1'] },
        { toolCall: { id: 'call_delegate_2' } },
      ),
    ).rejects.toThrow('S3 signer failed');
    expect(tool.name).toBe(delegateOcrToolName);
  });

  it('streams only under the scoped flag and returns the marker only after a delta', async () => {
    const events: Array<{ name: string; payload: unknown }> = [];
    const execute = jest.fn(async ({ onDelta }: { onDelta?: (delta: string) => Promise<void> }) => {
      await onDelta?.('first');
      await onDelta?.('');
      await onDelta?.('second');
      return 'firstsecond';
    });
    const tool = createDelegateOcrTool({ execute });
    const node = new ToolNode({ tools: [tool] });
    const message = (id: string) =>
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: delegateOcrToolName,
            args: { fileKeys: ['file:image-1'] },
            id,
          },
        ],
      });
    const config = {
      configurable: { delegateOcrStreaming: true },
      callbacks: new CallbackManager('parent-run', {
        handlers: [
          {
            handleCustomEvent(name: string, payload: unknown): void {
              events.push({ name, payload });
            },
          },
        ],
      }),
      toolCall: { id: 'call_streamed' },
    };

    const [result] = await node.invoke([message('call_streamed')], config);

    expect(result).toBeInstanceOf(ToolMessage);
    expect(result.content).toBe('firstsecond');
    expect(result.artifact).toEqual(delegateOcrStreamedArtifact);
    expect(events).toEqual([
      {
        name: delegateOcrStreamEventName,
        payload: {
          phase: 'delta',
          providerToolCallId: 'call_streamed',
          delta: 'first',
        },
      },
      {
        name: delegateOcrStreamEventName,
        payload: {
          phase: 'delta',
          providerToolCallId: 'call_streamed',
          delta: 'second',
        },
      },
      {
        name: delegateOcrStreamEventName,
        payload: {
          phase: 'complete',
          providerToolCallId: 'call_streamed',
        },
      },
    ]);

    events.length = 0;
    const [unscoped] = await node.invoke(
      [message('call_unscoped')],
      { callbacks: config.callbacks },
    );
    expect(unscoped.content).toBe('firstsecond');
    expect(unscoped.artifact).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('emits an error phase and rethrows after partial streaming', async () => {
    const events: unknown[] = [];
    const execute = jest.fn(async ({ onDelta }: { onDelta?: (delta: string) => Promise<void> }) => {
      await onDelta?.('partial');
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const tool = createDelegateOcrTool({ execute });
    const node = new ToolNode({ tools: [tool], handleToolErrors: false });
    const message = new AIMessage({
      content: '',
      tool_calls: [
        {
          name: delegateOcrToolName,
          args: { fileKeys: ['file:image-1'] },
          id: 'call_abort',
        },
      ],
    });

    await expect(
      node.invoke([message], {
        configurable: { delegateOcrStreaming: true },
        callbacks: new CallbackManager('parent-run-abort', {
          handlers: [
            {
              handleCustomEvent(_name: string, payload: unknown): void {
                events.push(payload);
              },
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(events).toEqual([
      {
        phase: 'delta',
        providerToolCallId: 'call_abort',
        delta: 'partial',
      },
      {
        phase: 'error',
        providerToolCallId: 'call_abort',
        error: 'AbortError: The operation was aborted',
      },
    ]);
  });

  it('returns a real ToolNode ToolMessage with full content and streamed artifact', async () => {
    const tool = createDelegateOcrTool({
      execute: async ({ onDelta }) => {
        await onDelta?.('streamed ');
        await onDelta?.('answer');
        return 'streamed answer';
      },
    });
    const node = new ToolNode({ tools: [tool] });
    const message = new AIMessage({
      content: '',
      tool_calls: [
        {
          name: delegateOcrToolName,
          args: { fileKeys: ['file:image-1'] },
          id: 'call_tool_node',
        },
      ],
    });
    const output = await node.invoke([message], {
      configurable: { delegateOcrStreaming: true },
    });

    expect(output).toHaveLength(1);
    expect(output[0]).toBeInstanceOf(ToolMessage);
    expect(output[0]).toEqual(
      expect.objectContaining({
        content: 'streamed answer',
        artifact: delegateOcrStreamedArtifact,
        tool_call_id: 'call_tool_node',
      }),
    );
  });
});
