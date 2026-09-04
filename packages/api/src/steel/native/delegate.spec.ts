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
  isDelegateOcrQuoteOnlyTurn,
  normalizeDelegateOcrChunk,
  parseDelegateOcrPageRangesFromTurn,
  delegateOcrArgsSchema,
  runDelegateOcrWorkflow,
  resolveDelegateOcrPolicy,
  resolveDelegateOcrFileKeys,
  type DelegateOcrFileRecord,
} from './delegate';

const modelOptions = {
  authFilePath: '/tmp/codex-auth.json',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'high',
  temperature: 0.2,
};

const poisonedModelOptions = {
  ...modelOptions,
  enableCodeInterpreter: true,
  tools: [
    { type: 'function', function: { name: 'search_customers' } },
    { name: 'steel_search_customers' },
    { type: 'function', function: { name: 'search_price_candidates' } },
    { name: 'steel_search_price_candidates' },
    { name: 'delegate_ocr' },
    { type: 'function', function: { name: 'web_search' } },
  ],
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
  it('resolves delegate_ocr backend availability from preflight, quote, and attachments', () => {
    expect(
      resolveDelegateOcrPolicy({
        currentUserTurn: '請重新確認原始圖面',
        attachmentFileKeys: ['file:a', 'file:a'],
      }),
    ).toEqual({ resolved: true, allowed: true, allowedFileKeys: ['file:a'] });
    expect(
      resolveDelegateOcrPolicy({
        currentUserTurn: '請重新確認原始圖面',
        ocrTurnActive: true,
        attachmentFileKeys: ['file:a'],
      }),
    ).toEqual({ resolved: true, allowed: false, allowedFileKeys: ['file:a'] });
    expect(
      resolveDelegateOcrPolicy({
        currentUserTurn: '請重新確認圖面後報價',
        attachmentFileKeys: ['file:a'],
      }),
    ).toEqual({ resolved: true, allowed: false, allowedFileKeys: ['file:a'] });
    expect(
      resolveDelegateOcrPolicy({
        currentUserTurn: '請重新確認原始圖面',
      }),
    ).toEqual({ resolved: true, allowed: false, allowedFileKeys: [] });
  });

  it('classifies confirmed OCR details followed by a quote request as quote-only', () => {
    expect(isDelegateOcrQuoteOnlyTurn('確認以上 OCR 明細，依 B 價報價')).toBe(true);
  });

  it.each([
    '請重新 OCR 這份 PDF 後報價',
    '請核對原始 PDF 後報價',
    '確認以上 OCR 明細，但請重新核對原始 PDF 後報價',
    '確認以上 OCR 明細，但請再核對原始 PDF 後報價',
  ])('removes delegate OCR for any quote-intent turn: %s', (prompt) => {
    expect(isDelegateOcrQuoteOnlyTurn(prompt)).toBe(true);
  });

  it.each(['重新核對附件', '請重新 OCR 這份 PDF'])(
    'keeps delegate OCR bound for current-turn inspection without quote intent: %s',
    (prompt) => {
      expect(isDelegateOcrQuoteOnlyTurn(prompt)).toBe(false);
    },
  );

  it.each([
    '先不要報價，請重新核對附件',
    '先不要再報價，請重新核對附件',
    '報價先不要，請重新核對附件',
    '報價不用了，重新核對附件',
    '不用算費用，先檢查 PDF',
    "I don't need a quote; inspect the PDF",
  ])(
    'does not treat a negated quote phrase as quote intent: %s',
    (prompt) => {
      expect(isDelegateOcrQuoteOnlyTurn(prompt)).toBe(false);
    },
  );

  it.each([
    '這批多少錢？',
    '請幫我算費用',
    '請幫我報個價',
    '请帮我报个价',
    '请帮我报一个价',
    'how much is this batch?',
    '先不要報價，但請告訴我總價',
    '報價先不要，請重新核對附件，但最後請告訴我總價',
    '報價先不要，但最後請告訴我總價，也重新核對附件',
    '不要看圖直接幫我報價',
    '我不想核對附件只要知道總價',
    "I don't need OCR just quote it",
  ])(
    'recognizes quote synonyms and remaining positive quote intent: %s',
    (prompt) => {
      expect(isDelegateOcrQuoteOnlyTurn(prompt)).toBe(true);
    },
  );

  it('parses and canonicalizes explicit page expressions from the current turn', () => {
    expect(parseDelegateOcrPageRangesFromTurn('重新核對第 35 頁至第 37 頁、pages 40-41')).toEqual([
      { pageStart: 35, pageEnd: 37 },
      { pageStart: 40, pageEnd: 41 },
    ]);
  });

  it('does not mistake a full-document page count for a selected page', () => {
    expect(parseDelegateOcrPageRangesFromTurn('完整 OCR 106 頁 PDF')).toBeUndefined();
  });

  it('rejects non-positive or inverted page ranges at the public tool seam', () => {
    expect(() =>
      delegateOcrArgsSchema.parse({
        files: [
          { fileKey: 'file:pdf-1', pageRanges: [{ pageStart: 0, pageEnd: 1 }] },
        ],
      }),
    ).toThrow();
    expect(() =>
      delegateOcrArgsSchema.parse({
        files: [
          { fileKey: 'file:pdf-1', pageRanges: [{ pageStart: 3, pageEnd: 2 }] },
        ],
      }),
    ).toThrow('pageEnd must be greater than or equal to pageStart');
  });

  it('groups page ranges under each file at the public tool seam', () => {
    expect(
      delegateOcrArgsSchema.parse({
        files: [
          {
            fileKey: 'file:pdf-1',
            pageRanges: [
              { pageStart: 1, pageEnd: 25 },
              { pageStart: 26, pageEnd: 50 },
            ],
          },
          { fileKey: 'file:image-1' },
        ],
      }),
    ).toEqual({
      files: [
        {
          fileKey: 'file:pdf-1',
          pageRanges: [
            { pageStart: 1, pageEnd: 25 },
            { pageStart: 26, pageEnd: 50 },
          ],
        },
        { fileKey: 'file:image-1' },
      ],
    });
    expect(delegateOcrArgsSchema.safeParse({ fileKeys: ['file:pdf-1'] }).success).toBe(false);
  });

  it('sends only the exact current turn and omits older provider history', async () => {
    const invokeModel = jest.fn(async () => '已完成。');

    await delegateOcr({
      files: [{ fileKey: 'file:image-1' }],
      history: [new HumanMessage('舊問題'), new AIMessage('舊回答')],
      currentUserTurn: '重新核對第 35 頁孔數',
      modelOptions,
      ocrRulesText: 'OCR rules',
      userId: 'user-1',
      findOwnedFiles: async () => [files[0]],
      signFile: async () => 'https://fresh.example/drawing.png',
      invokeModel,
    });

    const messages = invokeModel.mock.calls[0]?.[0]?.messages ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[1]?.content).toBe('重新核對第 35 頁孔數');
    expect(JSON.stringify(messages)).not.toContain('舊問題');
    expect(JSON.stringify(messages)).not.toContain('舊回答');
  });

  it('passes the selected file page ranges to exact artifact batching', async () => {
    const prepareBatches = jest.fn(async ({ fileInputs }) => {
      expect(fileInputs).toEqual([
        { fileKey: 'file:pdf-1', pageRanges: [{ pageStart: 35, pageEnd: 35 }] },
      ]);
      return [
        {
          files: [
            {
              ...files[1],
              fileId: 'pdf-1#35-35',
              storageKey: 'ocr/pages-000035-000035.pdf',
              filepath: 'https://fresh.example/pages-000035-000035.pdf',
              pageStart: 35,
              pageEnd: 35,
            },
          ],
          signFile: async (file: DelegateOcrFileRecord) => file.filepath ?? '',
        },
      ];
    });
    const invokeModel = jest.fn(async () => '孔數為 4。');

    await delegateOcr({
      files: [
        { fileKey: 'file:pdf-1', pageRanges: [{ pageStart: 35, pageEnd: 35 }] },
      ],
      currentUserTurn: '重新核對第 35 頁孔數',
      history: [new HumanMessage('舊問題')],
      modelOptions,
      ocrRulesText: 'OCR rules',
      userId: 'user-1',
      findOwnedFiles: async () => [files[1]],
      signFile: async () => 'unexpected original sign',
      prepareBatches,
      invokeModel,
    });

    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages)).toContain(
      'pages-000035-000035.pdf',
    );
    expect(JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages)).toContain(
      '原始頁碼 35-35',
    );
    expect(JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages)).not.toContain(
      'pages-000001-000050.pdf',
    );
  });

  it('refreshes every file and retries once when a signed URL expires before streaming', async () => {
    const signFile = jest
      .fn()
      .mockResolvedValueOnce('https://old.example/image.png')
      .mockResolvedValueOnce('https://old.example/quote.pdf')
      .mockResolvedValueOnce('https://fresh.example/image.png')
      .mockResolvedValueOnce('https://fresh.example/quote.pdf');
    const invokeModel = jest
      .fn()
      .mockRejectedValueOnce(new Error('RequestExpired'))
      .mockResolvedValueOnce('Recovered OCR');

    await expect(
      delegateOcr({
        files: [{ fileKey: 'file:image-1' }, { fileKey: 'file:pdf-1' }],
        currentUserTurn: '重新確認圖面',
        modelOptions: poisonedModelOptions,
        ocrRulesText: 'OCR rules',
        userId: 'user-1',
        findOwnedFiles: async () => files,
        signFile,
        invokeModel,
      }),
    ).resolves.toBe('Recovered OCR');

    expect(invokeModel).toHaveBeenCalledTimes(2);
    expect(signFile).toHaveBeenCalledTimes(4);
    expect(invokeModel.mock.calls.map(([invocation]) => invocation.modelOptions)).toEqual([
      {
        ...poisonedModelOptions,
        tools: [{ type: 'function', function: { name: 'web_search' } }],
      },
      {
        ...poisonedModelOptions,
        tools: [{ type: 'function', function: { name: 'web_search' } }],
      },
    ]);
    expect(poisonedModelOptions.tools).toHaveLength(6);
    expect(JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages)).toContain(
      'https://old.example/image.png',
    );
    expect(JSON.stringify(invokeModel.mock.calls[1]?.[0]?.messages)).toContain(
      'https://fresh.example/image.png',
    );
    expect(JSON.stringify(invokeModel.mock.calls[1]?.[0]?.messages)).toContain(
      'https://fresh.example/quote.pdf',
    );
  });

  it('does not retry an expired signed URL after streaming a delta', async () => {
    const signFile = jest.fn(async (file: DelegateOcrFileRecord) => file.filepath ?? '');
    const onDelta = jest.fn();
    const invokeModel = jest.fn(async ({ onDelta: emitDelta }) => {
      await emitDelta?.('partial');
      throw new Error('RequestExpired');
    });

    await expect(
      delegateOcr({
        files: [{ fileKey: 'file:image-1' }],
        currentUserTurn: '重新確認圖面',
        modelOptions,
        ocrRulesText: 'OCR rules',
        userId: 'user-1',
        findOwnedFiles: async () => [files[0]],
        signFile,
        invokeModel,
        onDelta,
      }),
    ).rejects.toThrow('delegate_ocr failed: RequestExpired');

    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(signFile).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('partial');
  });

  it('runs 106 pages as three ordered sequential batches and fails fast with the original range', async () => {
    const order: string[] = [];
    const prepareBatches = async () =>
      [
        { pageStart: 1, pageEnd: 50 },
        { pageStart: 51, pageEnd: 100 },
        { pageStart: 101, pageEnd: 106 },
      ].map((range) => ({
        files: [
          {
            ...files[1],
            fileId: `pdf-1#${range.pageStart}-${range.pageEnd}`,
            filepath: `https://fresh.example/${range.pageStart}-${range.pageEnd}.pdf`,
          },
        ],
        signFile: async (file: DelegateOcrFileRecord) => file.filepath ?? '',
        range,
      }));
    const invokeModel = jest.fn(async ({ messages }) => {
      const text = JSON.stringify(messages);
      const range = text.match(/(1-50|51-100|101-106)/)?.[1] ?? '';
      order.push(range);
      if (range === '51-100') {
        throw new Error('Vision failed');
      }
      return range;
    });

    await expect(
      delegateOcr({
        files: [{ fileKey: 'file:pdf-1' }],
        currentUserTurn: '重新核對整份 106 頁 PDF',
        history: [],
        modelOptions,
        ocrRulesText: 'OCR rules',
        userId: 'user-1',
        findOwnedFiles: async () => [files[1]],
        signFile: async () => 'unexpected original sign',
        prepareBatches,
        invokeModel,
      }),
    ).rejects.toThrow('51-100');
    expect(order).toEqual(['1-50', '51-100']);
    expect(invokeModel).toHaveBeenCalledTimes(2);
  });

  it('emits a separator between streamed batch responses', async () => {
    const prepareBatches = async () =>
      [1, 2].map((page) => ({
        files: [
          {
            ...files[1],
            fileId: `pdf-1#${page}-${page}`,
            filepath: `https://fresh.example/${page}.pdf`,
            pageStart: page,
            pageEnd: page,
          },
        ],
        range: { pageStart: page, pageEnd: page },
        signFile: async (file: DelegateOcrFileRecord) => file.filepath ?? '',
      }));
    const deltas: string[] = [];
    const invokeModel = jest.fn(async ({ onDelta }) => {
      await onDelta?.('batch');
      return 'batch';
    });

    await delegateOcr({
      files: [{ fileKey: 'file:pdf-1' }],
      currentUserTurn: '重新核對圖面',
      history: [],
      modelOptions,
      ocrRulesText: 'OCR rules',
      userId: 'user-1',
      findOwnedFiles: async () => [files[1]],
      signFile: async () => 'unused',
      prepareBatches,
      invokeModel,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['batch', '\n\n', 'batch']);
  });
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

  it('parses common model-generated file key variants without attachment metadata', () => {
    const fileId = '676b6f2c-0361-412a-92f0-92711c94ffef';

    for (const key of [
      `file:${fileId}.pdf`,
      `files:${fileId}.pdf`,
      `file_id:${fileId}.pdf`,
      `<file:${fileId}.pdf>`,
      `${fileId}.pdf`,
    ]) {
      expect(resolveDelegateOcrFileKeys([key], undefined)).toEqual([`file:${fileId}`]);
    }
    expect(resolveDelegateOcrFileKeys(['file:drawing-1.pdf'], undefined)).toEqual([
      'file:drawing-1',
    ]);
  });

  it('resolves multiple file keys in order and rejects duplicate aliases', () => {
    expect(
      resolveDelegateOcrFileKeys(
        ['files:drawing-1.pdf', 'file:drawing-2.png'],
        [
          { fileId: 'drawing-1', filename: 'A.pdf' },
          { fileId: 'drawing-2', filename: 'B.png' },
        ],
      ),
    ).toEqual(['file:drawing-1', 'file:drawing-2']);
    expect(() =>
      resolveDelegateOcrFileKeys(
        ['files:drawing-1.pdf', 'filename:A.pdf'],
        [{ fileId: 'drawing-1', filename: 'A.pdf' }],
      ),
    ).toThrow('duplicate attachment file keys');
  });

  it('resolves generic PDF aliases only when one PDF attachment is available', () => {
    const availableFiles = [
      { fileId: 'pdf-1', filename: 'PL.pdf' },
      { fileId: 'image-1', filename: 'drawing.png' },
    ];

    for (const key of ['pdf', 'file:pdf', 'files:pdf', 'file_id:pdf', '<file:pdf>']) {
      expect(resolveDelegateOcrFileKeys([key], availableFiles)).toEqual(['file:pdf-1']);
    }
    expect(() =>
      resolveDelegateOcrFileKeys(
        ['file:pdf'],
        [
          { fileId: 'pdf-1', filename: 'PL.pdf' },
          { fileId: 'pdf-2', filename: 'BH.PDF' },
        ],
      ),
    ).toThrow('delegate_ocr attachment file key is ambiguous: file:pdf');
    expect(
      resolveDelegateOcrFileKeys(
        ['file:pdf'],
        [{ fileId: 'mime-only-pdf', mediaType: 'application/pdf' }],
      ),
    ).toEqual(['file:mime-only-pdf']);
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
      policy: { resolved: true, allowed: true, allowedFileKeys: ['file:pdf-1'] },
      modelOptions,
      userId: 'user-1',
      getOwnedFileRecords,
      signStoredFile,
      loadOcrRules: async () => 'OCR_RULE\nVISION_RULE\nOCR_MAIN_RULE',
      invokeModel,
    });

    await expect(execute({ files: [{ fileKey: 'file:pdf-1' }] })).resolves.toBe(
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

  it('resolves a displayed file-id extension through backend attachment metadata', async () => {
    const fileId = '676b6f2c-0361-412a-92f0-92711c94ffef';
    const storedFile = {
      file_id: fileId,
      filename: 'PL.pdf',
      mimetype: 'application/pdf',
      source: 's3',
      storageKey: `uploads/user-1/${fileId}__PL.pdf`,
    };
    const getOwnedFileRecords = jest.fn(async () => [storedFile]);
    const signStoredFile = jest.fn(async () => 'https://fresh.example/PL.pdf');
    const invokeModel = jest.fn(async () => '已依原始圖面完成 Vision 判讀。');
    const execute = createDelegateOcrRequestExecute({
      history: [new HumanMessage('看一下圖面切工')],
      policy: { resolved: true, allowed: true, allowedFileKeys: [`file:${fileId}`] },
      modelOptions,
      userId: 'user-1',
      availableFiles: [{ fileId, filename: 'PL.pdf' }],
      getOwnedFileRecords,
      signStoredFile,
      loadOcrRules: async () => 'OCR rules',
      invokeModel,
    });

    await expect(execute({ files: [{ fileKey: `${fileId}.pdf` }] })).resolves.toBe(
      '已依原始圖面完成 Vision 判讀。',
    );
    expect(getOwnedFileRecords).toHaveBeenCalledWith({
      user: 'user-1',
      $or: [{ file_id: { $in: [fileId] } }],
    });
    expect(signStoredFile).toHaveBeenCalledWith(storedFile);
    expect(invokeModel).toHaveBeenCalledTimes(1);

    await expect(execute({ files: [{ fileKey: `files:${fileId}.pdf` }] })).resolves.toBe(
      '已依原始圖面完成 Vision 判讀。',
    );
    expect(getOwnedFileRecords).toHaveBeenLastCalledWith({
      user: 'user-1',
      $or: [{ file_id: { $in: [fileId] } }],
    });

    await expect(execute({ files: [{ fileKey: `file:${fileId}.pdf` }] })).resolves.toBe(
      '已依原始圖面完成 Vision 判讀。',
    );
    expect(getOwnedFileRecords).toHaveBeenLastCalledWith({
      user: 'user-1',
      $or: [{ file_id: { $in: [fileId] } }],
    });

    await expect(execute({ files: [{ fileKey: 'file:pdf' }] })).resolves.toBe(
      '已依原始圖面完成 Vision 判讀。',
    );
    expect(getOwnedFileRecords).toHaveBeenLastCalledWith({
      user: 'user-1',
      $or: [{ file_id: { $in: [fileId] } }],
    });
  });

  it('rejects unknown and ambiguous backend attachment aliases', async () => {
    const createExecute = (availableFiles: { fileId: string; filename?: string }[]) =>
      createDelegateOcrRequestExecute({
        history: [new HumanMessage('看圖面')],
        modelOptions,
        userId: 'user-1',
        availableFiles,
        getOwnedFileRecords: async () => [],
        signStoredFile: async () => 'unused',
        loadOcrRules: async () => 'OCR rules',
        invokeModel: async () => 'unused',
      });

    await expect(
      createExecute([{ fileId: 'file-1', filename: 'PL.pdf' }])({
        files: [{ fileKey: 'unknown.pdf' }],
      }),
    ).rejects.toThrow('delegate_ocr could not resolve attachment file keys: unknown.pdf');
    await expect(
      createExecute([
        { fileId: 'file-1', filename: 'PL.pdf' },
        { fileId: 'file-2', filename: 'PL.pdf' },
      ])({ files: [{ fileKey: 'PL.pdf' }] }),
    ).rejects.toThrow('delegate_ocr attachment file key is ambiguous: PL.pdf');
  });

  it('rejects an attachment outside the resolved policy before loading dependencies', async () => {
    const getOwnedFileRecords = jest.fn(async () => []);
    const signStoredFile = jest.fn(async () => 'unused');
    const loadOcrRules = jest.fn(async () => 'OCR rules');
    const invokeModel = jest.fn(async () => 'unused');
    const execute = createDelegateOcrRequestExecute({
      history: [new HumanMessage('重新確認原始圖面')],
      currentUserTurn: '重新確認原始圖面',
      policy: { resolved: true, allowed: true, allowedFileKeys: ['file:allowed'] },
      modelOptions,
      userId: 'user-1',
      availableFiles: [
        { fileId: 'allowed', filename: 'allowed.pdf' },
        { fileId: 'other', filename: 'other.pdf' },
      ],
      getOwnedFileRecords,
      signStoredFile,
      loadOcrRules,
      invokeModel,
    });

    await expect(execute({ files: [{ fileKey: 'file:other' }] })).rejects.toThrow(
      'delegate_ocr attachment file keys are not allowed: file:other',
    );
    expect(getOwnedFileRecords).not.toHaveBeenCalled();
    expect(loadOcrRules).not.toHaveBeenCalled();
    expect(signStoredFile).not.toHaveBeenCalled();
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it('sends freshly signed original sources once with the latest user turn only', async () => {
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
      files: [{ fileKey: 'file:image-1' }, { fileKey: 'file:pdf-1' }],
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
    expect(invocation?.modelOptions).toEqual({ ...modelOptions, tools: [] });
    expect(invocation?.messages[1]).toBeInstanceOf(HumanMessage);
    expect(invocation?.messages[1]?.content).toBe('請重新確認開槽連續邊長');
    expect(JSON.stringify(invocation?.messages)).not.toContain('existing provider system context');
    expect(JSON.stringify(invocation?.messages)).not.toContain('我會重新確認原始圖面。');
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
        files: [{ fileKey: 'file:missing' }],
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
        { files: [{ fileKey: 'file:image-1' }] },
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
      files: [{ fileKey: 'file:image-1' }],
      providerToolCallId: 'call_delegate_1',
    });

    await expect(
      tool.invoke(
        { files: [{ fileKey: 'file:image-1' }] },
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
            args: { files: [{ fileKey: 'file:image-1' }] },
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
          args: { files: [{ fileKey: 'file:image-1' }] },
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
          args: { files: [{ fileKey: 'file:image-1' }] },
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

  it('runs delegate preprocessing once and retries only the canonical agent on mapping mismatch', async () => {
    const preprocess = jest.fn(async ({ currentUserTurn, signedFiles }) => {
      expect(currentUserTurn).toBe('請重新核對圖面');
      expect(signedFiles[0]?.url).toBe('https://fresh.example/drawing.png');
      return { organizerMarkdown: '## organizer\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | A |' };
    });
    const beginAttempt = jest.fn(async ({ attemptNumber }) => ({
      attemptToken: `attempt-${attemptNumber}`,
    }));
    const wrongMapping =
      '## source_file_mapping\n\n| 來源 | 檔名 |\n| --- | --- |\n| F2 | wrong.png |\n\n## ocr_result\n\n| 來源 | 零件編號 |\n| --- | --- |\n| F1 | A |';
    const invokeModel = jest
      .fn()
      .mockResolvedValueOnce(wrongMapping)
      .mockResolvedValueOnce(wrongMapping)
      .mockResolvedValueOnce(wrongMapping);

    await expect(
      runDelegateOcrWorkflow({
        files: [
          { fileKey: 'file:image-1', pageRanges: [{ pageStart: 35, pageEnd: 36 }] },
        ],
        currentUserTurn: '請重新核對圖面',
        modelOptions: poisonedModelOptions,
        ocrRulesText: 'OCR rules',
        userId: 'user-1',
        findOwnedFiles: async () => [files[0]],
        signFile: async () => 'https://fresh.example/drawing.png',
        invokeModel,
        workflow: {
          runPreprocessing: preprocess,
          canonicalMapping: [{ sourceCode: 'F1', sourceFilename: 'drawing.png' }],
          runStore: { beginAttempt },
        },
      }),
    ).rejects.toThrow('目前 AI model 暫時不可用，建議先切換別的 model。');
    expect(preprocess).toHaveBeenCalledTimes(1);
    expect(invokeModel).toHaveBeenCalledTimes(3);
    const packet = JSON.stringify(invokeModel.mock.calls[0]?.[0]?.messages);
    const canonicalPacket = JSON.stringify(
      invokeModel.mock.calls[0]?.[0]?.messages?.[1]?.content,
    );
    expect(packet).toContain('drawing.png');
    expect(packet).toContain('organizer');
    expect(canonicalPacket).toContain('\\"pageRanges\\":[{\\"pageStart\\":35,\\"pageEnd\\":36}]');
    expect(packet).not.toContain('請重新核對圖面');
    expect(packet).not.toContain('https://fresh.example');
    expect(beginAttempt).toHaveBeenCalledTimes(3);
    expect(invokeModel.mock.calls.map(([invocation]) => invocation.modelOptions)).toEqual([
      {
        ...poisonedModelOptions,
        tools: [{ type: 'function', function: { name: 'web_search' } }],
      },
      {
        ...poisonedModelOptions,
        tools: [{ type: 'function', function: { name: 'web_search' } }],
      },
      {
        ...poisonedModelOptions,
        tools: [{ type: 'function', function: { name: 'web_search' } }],
      },
    ]);
    expect(poisonedModelOptions.tools).toHaveLength(6);
  });

  it('suppresses stale delegate stream events through the injected dispatch gate', async () => {
    const events: unknown[] = [];
    const tool = createDelegateOcrTool({
      execute: async ({ onDelta }) => {
        await onDelta?.('stale');
        return 'stale';
      },
    });
    await tool.invoke(
      { files: [{ fileKey: 'file:image-1' }] },
      {
        configurable: {
          delegateOcrStreaming: true,
          delegateOcrClaimToken: 'claim-1',
          delegateOcrGenerationId: 'generation-1',
          delegateOcrAttemptToken: 'attempt-1',
          canDispatchEvent: async () => false,
          hostCustomEventDispatcher: async (_name, payload) => events.push(payload),
        },
      },
    );
    expect(events).toEqual([]);
  });
});
