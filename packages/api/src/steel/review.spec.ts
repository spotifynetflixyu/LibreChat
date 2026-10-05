import { createHash } from 'node:crypto';
import type { SteelReviewOperationPrepared } from 'librechat-data-provider';
import { createSteelReviewService } from './review';

const managedMarkdown = [
  '## ocr_result',
  '',
  '| 來源 | 零件編號 |',
  '| --- | --- |',
  '| A | P-1 |',
].join('\n');

const scope = {
  userId: 'user-1',
  conversationId: 'conversation-1',
  kind: 'ocr_result' as const,
  messageId: 'message-1',
  title: 'ocr_result',
};

const aiRow = (rowId = 'row-1', value = 'P-1') => ({
  rowId,
  origin: 'ai' as const,
  deleted: false,
  values: {
    來源: { baseline: 'A', effective: 'A' },
    零件編號: { baseline: value, effective: value },
  },
  source: null,
});

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  ...scope,
  tableId: 'ocr_result:1',
  outputId: 'ocr_result:generation-1',
  latestOutputId: 'ocr_result:generation-1',
  revision: 'generation-1',
  state: 'current' as const,
  headers: ['來源', '零件編號'],
  rows: [aiRow()],
  markdown: managedMarkdown,
  messageText: managedMarkdown,
  ...overrides,
});

const makeOperation = (overrides: Record<string, unknown> = {}) => ({
  conversationId: scope.conversationId,
  messageId: scope.messageId,
  title: scope.title,
  kind: scope.kind,
  outputId: 'ocr_result:generation-1',
  revision: 'generation-1',
  operations: [{
    type: 'update' as const,
    rowId: 'row-1',
    changes: [{ header: '零件編號', value: 'P-9' }],
  }],
  ...overrides,
});

const prepareInput = (overrides: Record<string, unknown> = {}) => ({
  userId: scope.userId,
  ...makeOperation(overrides),
});

const associationMarkdownFor = (
  source: string | null = 'A',
  page: string | null = '1',
  profile = 'P-1',
) => [
  '## ocr_result',
  '',
  '| 來源 | 原始檔案 | 原檔頁碼 | Profile |',
  '| --- | --- | --- | --- |',
  '| ' + (source ?? '') + ' | ' + (source ?? '') + ' | ' + (page ?? '') + ' | ' + profile + ' |',
].join('\n');

const associationRow = (
  source: string | null = 'A',
  page: string | null = '1',
  profile = 'P-1',
) => ({
  rowId: 'row-1',
  origin: 'ai' as const,
  deleted: false,
  values: {
    來源: { baseline: source, effective: source },
    原始檔案: { baseline: source, effective: source },
    原檔頁碼: { baseline: page, effective: page },
    Profile: { baseline: 'P-1', effective: profile },
  },
  source: source
    ? { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf', mediaType: 'application/pdf' }
    : null,
});

const systemOrderTitle = 'system_order｜報價單 A';
const systemOrderMarkdown = [
  `## ${systemOrderTitle}`,
  '',
  '| 品名規格 | 總數 | 單價 |',
  '| --- | --- | --- |',
  '| 雷射板 | 2.060154 | 38.5 |',
].join('\n');

const makeSystemOrderRecord = (overrides: Record<string, unknown> = {}) => ({
  ...scope,
  kind: 'system_order' as const,
  title: systemOrderTitle,
  tableId: `system_order:${systemOrderTitle}`,
  outputId: 'system_order:run-1',
  latestOutputId: 'system_order:run-1',
  revision: 'system-order-revision-1',
  state: 'current' as const,
  headers: ['品名規格', '總數', '單價'],
  rows: [{
    rowId: 'row-1',
    origin: 'ai' as const,
    deleted: false,
    values: {
      品名規格: { baseline: '雷射板', effective: '雷射板' },
      總數: { baseline: '2.060154', effective: '2.060154' },
      單價: { baseline: '38.5', effective: '38.5' },
    },
    source: null,
  }],
  markdown: systemOrderMarkdown,
  messageText: systemOrderMarkdown,
  ...overrides,
});

describe('Steel review read service', () => {
  it('prepares direct system-order price and total edits with a clean internal quote projection', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord()) },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order',
      outputId: 'system_order:run-1',
      revision: 'system-order-revision-1',
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [
          { header: '總數', value: '2.060154' },
          { header: '單價', value: '39.5' },
        ],
      }],
    });

    expect(prepared.kind).toBe('system_order');
    expect(prepared.cleanReplacementText).toContain('| 雷射板 | 2.060154 | 39.5 |');
    expect(prepared.caption).toEqual(expect.objectContaining({
      kind: 'system_order',
      changedRows: 1,
      customerQuoteChangedRows: 1,
      customerQuoteTotal: '82',
    }));
  });

  it('counts customer quote changes by stable ledger row IDs when deletion shifts later rows', async () => {
    const markdown = [
      `## ${systemOrderTitle}`,
      '',
      '| 品名規格 | 總數 | 單價 |',
      '| --- | --- | --- |',
      '| A | 1 | 10 |',
      '| B | 2 | 10 |',
      '| C | 3 | 10 |',
    ].join('\n');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord({
          revision: 'system-order-revision-1',
          markdown,
          messageText: markdown,
          rows: ['a', 'b', 'c'].map((rowId, index) => ({
            rowId,
            origin: 'ai' as const,
            deleted: false,
            values: {
              品名規格: { baseline: String.fromCharCode(65 + index), effective: String.fromCharCode(65 + index) },
              總數: { baseline: String(index + 1), effective: String(index + 1) },
              單價: { baseline: '10', effective: '10' },
            },
            source: null,
          })),
        })),
      },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order',
      outputId: 'system_order:run-1',
      revision: 'system-order-revision-1',
      operations: [{ type: 'delete', rowId: 'a' }],
    });

    expect(prepared.caption.customerQuoteChangedRows).toBe(1);
  });

  it('allows system-order business edits and rejects invalid numeric input', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord()) },
    });
    const base = {
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order' as const,
      outputId: 'system_order:run-1',
      revision: 'system-order-revision-1',
    };

    await expect(service.prepare({
      ...base,
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [{ header: '品名規格', value: '錯誤' }],
      }],
    })).resolves.toEqual(expect.objectContaining({ rows: expect.any(Array) }));
    await expect(service.prepare({
      ...base,
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [{ header: '單價', value: '1e2' }],
      }],
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
  });

  it('merges a stale system-order operation from the immutable initial baseline', async () => {
    const initialRevision = createHash('sha256').update(systemOrderMarkdown).digest('hex');
    const rowId = createHash('sha256')
      .update(`system_order:run-1:0:${JSON.stringify(['雷射板', '2.060154', '38.5'])}`)
      .digest('hex');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord({
          revision: createHash('sha256').update(systemOrderMarkdown.replace('38.5', '39.5')).digest('hex'),
          aiBaselineMarkdown: systemOrderMarkdown,
          markdown: systemOrderMarkdown.replace('38.5', '39.5'),
          effectiveMarkdown: systemOrderMarkdown.replace('38.5', '39.5'),
          messageText: systemOrderMarkdown.replace('38.5', '39.5'),
          rows: [{
            rowId,
            origin: 'ai' as const,
            deleted: false,
            values: {
              品名規格: { baseline: '雷射板', effective: '雷射板' },
              總數: { baseline: '2.060154', effective: '2.060154' },
              單價: { baseline: '38.5', effective: '39.5' },
            },
            source: null,
          }],
        })),
      },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order',
      outputId: 'system_order:run-1',
      revision: initialRevision,
      operations: [{
        type: 'update' as const,
        rowId,
        changes: [{ header: '總數', value: '3.2' }],
      }],
    });

    expect(prepared.rows[0]?.values).toEqual(expect.objectContaining({
      總數: { baseline: '2.060154', effective: '3.2' },
      單價: { baseline: '38.5', effective: '39.5' },
    }));
  });

  it('projects the requested full title from the authenticated message identity', async () => {
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          messageText: [
            '| ordinary | table |',
            '| --- | --- |',
            '| ignored | row |',
            '',
            managedMarkdown,
          ].join('\n'),
        })),
      },
    });

    const result = await service.read(scope);
    expect(result.table).toEqual(expect.objectContaining({
      title: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      isLatest: true,
      readOnly: false,
      rows: [expect.objectContaining({ rowId: expect.any(String) })],
    }));
    expect(result.table).not.toHaveProperty('tableId');
  });

  it('uses the exact title and rejects an unowned same-heading table', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue(makeRecord({
        messageText: [
          '## ocr_result',
          '',
          '| 來源 | 零件編號 |',
          '| --- | --- |',
          '| attacker | fake |',
        ].join('\n'),
      })),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read(scope)).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects duplicate exact-title copies as unavailable', async () => {
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          messageText: managedMarkdown + '\n\n' + managedMarkdown,
        })),
      },
    });

    await expect(service.read(scope)).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('does not carry managed authority across another heading level', async () => {
    const unrelated = [
      '### ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| attacker | P-2 |',
    ].join('\n');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          messageText: managedMarkdown + '\n\n' + unrelated,
        })),
      },
    });

    await expect(service.read({ ...scope, title: 'ocr_result｜missing' })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('keeps an authenticated title readable when the sidecar has no rows', async () => {
    const emptyMarkdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
    ].join('\n');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          rows: [],
          markdown: emptyMarkdown,
          messageText: emptyMarkdown,
        })),
      },
    });

    await expect(service.read(scope)).resolves.toEqual({
      table: expect.objectContaining({ rows: [], readOnly: false }),
    });
  });

  it('rejects positional and full-row fields before reading a title operation', async () => {
    const readSteelReview = jest.fn();
    const service = createSteelReviewService({ reader: { readSteelReview } });
    const current = makeOperation();

    await expect(service.prepare({
      userId: scope.userId,
      ...current,
      tableId: 'ocr_result:1',
    } as never)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY', statusCode: 400 });
    await expect(service.prepare({
      userId: scope.userId,
      ...current,
      rows: [],
    } as never)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY', statusCode: 400 });
    expect(readSteelReview).not.toHaveBeenCalled();
  });

  it('applies ordered title-only row operations to server-owned current rows', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) },
    });

    const prepared = await service.prepare(prepareInput()) as SteelReviewOperationPrepared;
    expect(prepared.title).toBe('ocr_result');
    expect(prepared.rows).toEqual([expect.objectContaining({
      rowId: 'row-1',
      values: expect.objectContaining({
        零件編號: { baseline: 'P-1', effective: 'P-9' },
      }),
    })]);
    expect(prepared.caption).toEqual({
      kind: 'ocr_result',
      changedRows: 1,
      changedRowIds: ['row-1'],
    });
    expect(prepared.operationRequest).toEqual(makeOperation());
  });

  it('rebuilds the physical target from the trusted title while unrelated tables move around it', async () => {
    const markdown = [
      '\x60\x60\x60markdown',
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| fake | fenced |',
      '\x60\x60\x60',
      '',
      '## customer_data',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| keep | customer |',
      '',
      managedMarkdown,
      '',
      '## extra',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| keep | extra |',
    ].join('\n');
    const record = makeRecord({
      tableId: 'ocr_result:2',
      markdown,
      messageText: markdown,
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });

    const prepared = await service.prepare(prepareInput()) as SteelReviewOperationPrepared;
    expect(prepared.effectiveMarkdown).toContain('| A | P-9 |');
    expect(prepared.effectiveMarkdown).toContain('## ocr_result');
    expect(prepared.effectiveMarkdown).not.toContain('customer_data');
    expect(prepared.effectiveMarkdown).not.toContain('## extra');
    expect(prepared.effectiveMarkdown).not.toContain('fenced');
    expect(prepared.target.start).toBeGreaterThan(markdown.indexOf('## customer_data'));
  });

  it('rejects ambiguous canonical title targets before preparing a save', async () => {
    const duplicate = managedMarkdown + '\n\n' + managedMarkdown;
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord({
        markdown: duplicate,
        messageText: duplicate,
      })) },
    });

    await expect(service.prepare(prepareInput())).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('uses persisted effective values instead of the immutable AI baseline', async () => {
    const aiMarkdown = managedMarkdown.replace('P-1', 'P-2');
    const effectiveMarkdown = managedMarkdown.replace('P-1', 'P-7');
    const record = makeRecord({
      markdown: aiMarkdown,
      aiBaselineMarkdown: aiMarkdown,
      effectiveMarkdown,
      messageText: effectiveMarkdown,
      rows: [{
        ...aiRow('row-1', 'P-2'),
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-2', effective: 'P-7' },
        },
      }],
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });

    const prepared = await service.prepare(prepareInput({
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [{ header: '零件編號', value: 'P-8' }],
      }],
    }));
    expect(prepared.rows[0]?.values.零件編號).toEqual({ baseline: 'P-2', effective: 'P-8' });
    expect(prepared.effectiveMarkdown).toContain('| A | P-8 |');
  });

  it('rejects source association cell edits while allowing a business-field operation', async () => {
    const rows = [associationRow()];
    const record = makeRecord({
      headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
      rows,
      markdown: associationMarkdownFor(),
      messageText: associationMarkdownFor(),
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          changes: [{ header: 'Profile', value: 'P-2' }],
        }],
      }),
    });
    expect(prepared.caption.changedRows).toBe(1);

    await expect(service.prepare({
      userId: scope.userId,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          changes: [{ header: '來源', value: 'FORGED' }],
        }],
      }),
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
  });

  it('resolves source metadata and validates a selected PDF page', async () => {
    const rows = [associationRow()];
    const record = makeRecord({
      headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
      rows,
      markdown: associationMarkdownFor(),
      messageText: associationMarkdownFor(),
      sourceMappings: [{
        fileId: 'file-1', sourceCode: 'A', sourceFilename: 'drawing.pdf', mediaType: 'application/pdf',
      }],
    });
    const readMetadata = jest.fn().mockResolvedValue({
      fileId: 'file-2', filename: 'replacement.pdf', mediaType: 'application/pdf',
    });
    const readPageCount = jest.fn().mockResolvedValue({ pageCount: 3 });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
      sourceAuthority: { readMetadata, readPageCount },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      sourceRequest: {} as never,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          changes: [{ header: 'Profile', value: 'P-2' }],
          source: { fileId: 'file-2', pageNumber: 2 },
        }],
      }),
    });

    expect(readMetadata).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-2' }));
    expect(readPageCount).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-2' }), {});
    expect(prepared.sourceMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: 'file-2', sourceCode: 'F1', sourceFilename: 'replacement.pdf' }),
    ]));
    expect(prepared.rows[0]?.source).toEqual(expect.objectContaining({
      fileId: 'file-2', pageNumber: 2, filename: 'replacement.pdf',
    }));
    expect(prepared.rows[0]?.values.來源?.effective).toBe('F1');
    expect(prepared.rows[0]?.values.原檔頁碼?.effective).toBe('2');
  });

  it('rejects a source page outside the server-owned PDF page count', async () => {
    const rows = [associationRow()];
    const record = makeRecord({
      headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
      rows,
      markdown: associationMarkdownFor(),
      messageText: associationMarkdownFor(),
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
      sourceAuthority: {
        readMetadata: jest.fn().mockResolvedValue({
          fileId: 'file-2', filename: 'replacement.pdf', mediaType: 'application/pdf',
        }),
        readPageCount: jest.fn().mockResolvedValue({ pageCount: 2 }),
      },
    });

    await expect(service.prepare({
      userId: scope.userId,
      sourceRequest: {} as never,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          source: { fileId: 'file-2', pageNumber: 3 },
        }],
      }),
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
  });

  it('preserves null source association cells through a business operation', async () => {
    const markdown = associationMarkdownFor(null, null);
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
          rows: [associationRow(null, null)],
          markdown,
          messageText: markdown,
        })),
      },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          changes: [{ header: 'Profile', value: 'P-2' }],
        }],
      }),
    });
    expect(prepared.rows[0]?.source).toBeNull();
    expect(prepared.rows[0]?.values.來源).toEqual({ baseline: null, effective: null });
    expect(prepared.rows[0]?.values.原檔頁碼).toEqual({ baseline: null, effective: null });
  });

  it('keeps source codes lossless beyond the JavaScript safe integer range', async () => {
    const sourceCode = 'F9007199254740993';
    const markdown = associationMarkdownFor(sourceCode, '1');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
          rows: [associationRow(sourceCode, '1')],
          markdown,
          messageText: markdown,
          sourceMappings: [{
            fileId: 'file-1', sourceCode, sourceFilename: 'drawing.pdf', mediaType: 'application/pdf',
          }],
        })),
      },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          changes: [{ header: 'Profile', value: 'P-2' }],
        }],
      }),
    });
    expect(prepared.rows[0]?.values.來源?.effective).toBe(sourceCode);
    expect(prepared.sourceMappings).toEqual(expect.arrayContaining([expect.objectContaining({ sourceCode })]));
  });

  it('rejects an own undefined source intent before reading the review', async () => {
    const readSteelReview = jest.fn().mockResolvedValue(makeRecord());
    const service = createSteelReviewService({ reader: { readSteelReview } });
    const malformed = {
      userId: scope.userId,
      ...makeOperation({
        operations: [{
          type: 'update' as const,
          rowId: 'row-1',
          source: undefined,
          changes: [{ header: '零件編號', value: 'P-2' }],
        }],
      }),
    } as never;

    await expect(service.prepare(malformed)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
    expect(readSteelReview).not.toHaveBeenCalled();
  });

  it('binds a title operation to the selected content part', async () => {
    const messageTextParts = [
      { partIndex: 0, text: 'assistant context\n' },
      { partIndex: 1, text: managedMarkdown },
    ];
    const messageText = messageTextParts.map((part) => part.text).join(' ');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeRecord({
          markdown: messageText,
          messageText,
          messageTextParts,
          messageTextPartIndex: 1,
        })),
      },
    });

    const prepared = await service.prepare(prepareInput());
    expect(prepared.target.partIndex).toBe(1);
    expect(prepared.targetText).toContain('| A | P-1 |');
  });

  it('normalizes effective values and produces a no-op caption for equal intent', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) },
    });

    const prepared = await service.prepare(prepareInput({
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [{ header: '零件編號', value: '  P-1\r\n  ' }],
      }],
    }));
    expect(prepared.rows[0]?.values.零件編號.effective).toBe('P-1');
    expect(prepared.caption).toEqual({ kind: 'ocr_result', changedRows: 0, changedRowIds: [] });
    expect(prepared.cleanReplacementText).toContain('| A | P-1 |');
  });

  it('reconstructs a trusted manual end insertion from an add operation', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) },
    });

    const prepared = await service.prepare(prepareInput({
      operations: [{
        type: 'add' as const,
        rowId: 'row-manual',
        position: { kind: 'end' as const },
        changes: [
          { header: '零件編號', value: 'P-1' },
        ],
      }],
    }));
    expect(prepared.rows.map((row) => row.rowId)).toEqual(['row-1', 'row-manual']);
    expect(prepared.rows[1]).toEqual(expect.objectContaining({ origin: 'manual', deleted: false }));
    expect(prepared.cleanReplacementText).toContain('|  | P-1 |');
  });

  it('reports a same-output stale prepare as a conflict without writing', async () => {
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord({ revision: 'current-revision' })) },
      writer: { commitSteelReview },
    });

    await expect(service.prepare(prepareInput({ revision: 'captured-revision' }))).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
    });
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('rejects an unknown captured revision even when the requested value is current', async () => {
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord({ revision: 'saved-revision' })) },
      writer: { commitSteelReview },
    });

    await expect(service.prepare(prepareInput({
      revision: 'unknown-never-existed',
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [{ header: '零件編號', value: 'P-1' }],
      }],
    }))).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('uses the server-owned initial OCR revision for a disjoint merge after a human save', async () => {
    const initialRowId = createHash('sha256')
      .update('ocr_result:generation-1:0:' + JSON.stringify(['A', 'P-1']))
      .digest('hex');
    const currentMarkdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-1 |',
      '| B | P-2 |',
    ].join('\n');
    const record = makeRecord({
      revision: 'saved-revision',
      headers: ['來源', '零件編號'],
      rows: [
        aiRow(initialRowId),
        {
          rowId: 'row-manual',
          origin: 'manual' as const,
          deleted: false,
          insertion: { kind: 'end' as const, ordinal: 0 },
          values: {
            來源: { baseline: null, effective: 'B' },
            零件編號: { baseline: null, effective: 'P-2' },
          },
          source: null,
        },
      ],
      aiBaselineMarkdown: managedMarkdown,
      effectiveMarkdown: currentMarkdown,
      markdown: currentMarkdown,
      messageText: currentMarkdown,
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      ...makeOperation({
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        operations: [{
          type: 'update' as const,
          rowId: initialRowId,
          changes: [{ header: '零件編號', value: 'P-7' }],
        }],
      }),
    });
    expect(prepared.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowId: initialRowId,
        values: expect.objectContaining({ 零件編號: { baseline: 'P-1', effective: 'P-7' } }),
      }),
      expect.objectContaining({ rowId: 'row-manual' }),
    ]));
  });

  it('rejects a commit digest mismatch before invoking the writer', async () => {
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) },
      writer: { commitSteelReview },
    });
    const prepared = await service.prepare(prepareInput()) as SteelReviewOperationPrepared;

    await expect(service.commit({
      userId: scope.userId,
      ...makeOperation(),
      operationId: prepared.operationId,
      digest: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('commits the trusted current projection and keeps the public response title-only', async () => {
    const commitSteelReview = jest.fn().mockImplementation(async (input) => ({
      operationId: input.operationId,
      digest: input.operationDigest,
      outputId: input.outputId,
      revision: 'saved-revision',
      headers: input.headers,
      rows: input.rows,
      messageSha256: input.messageSha256,
      target: input.target,
      targetText: input.targetText,
      replacementText: input.replacementText,
      cleanReplacementText: input.cleanReplacementText,
      effectiveMarkdown: input.effectiveMarkdown,
      displayMarkdown: input.displayMarkdown,
      caption: input.caption,
      changedRows: input.caption.changedRows,
      changedRowIds: input.caption.changedRowIds,
      savedAt: new Date('2026-10-04T00:00:00.000Z'),
    }));
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) },
      writer: { commitSteelReview },
    });
    const prepared = await service.prepare(prepareInput());
    const saved = await service.commit({
      userId: scope.userId,
      ...makeOperation(),
      operationId: prepared.operationId,
      digest: prepared.digest,
    });

    expect(commitSteelReview).toHaveBeenCalledWith(expect.objectContaining({
      title: 'ocr_result',
      operationDigest: prepared.digest,
      rows: prepared.rows,
    }));
    expect(saved).toEqual(expect.objectContaining({
      title: 'ocr_result',
      revision: 'saved-revision',
      changedRows: 1,
      changedRowIds: ['row-1'],
    }));
    expect(saved).not.toHaveProperty('tableId');
  });

  it('replays an exact current-protocol receipt without rebuilding or writing', async () => {
    const commitSteelReview = jest.fn();
    const readSteelReviewReceipt = jest.fn();
    const reader = { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) };
    const service = createSteelReviewService({
      reader,
      writer: { commitSteelReview, readSteelReviewReceipt },
    });
    const prepared = await service.prepare(prepareInput()) as SteelReviewOperationPrepared;
    const savedAt = new Date('2026-10-04T01:00:00.000Z');
    const snapshot = {
      operationId: prepared.operationId,
      digest: prepared.digest,
      requestDigest: prepared.requestDigest,
      outputId: prepared.outputId,
      revision: 'saved-revision',
      headers: prepared.headers,
      rows: prepared.rows,
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      messageText: managedMarkdown,
      messageSha256: prepared.messageSha256,
      effectiveMarkdown: prepared.effectiveMarkdown,
      displayMarkdown: prepared.displayMarkdown,
      target: prepared.target,
      targetText: prepared.targetText,
      replacementText: prepared.replacementText,
      cleanReplacementText: prepared.cleanReplacementText,
      caption: prepared.caption,
    };
    readSteelReviewReceipt.mockResolvedValue({
      operationId: prepared.operationId,
      digest: prepared.digest,
      requestDigest: prepared.requestDigest,
      outputId: prepared.outputId,
      revision: 'saved-revision',
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt,
      messageSha256: prepared.messageSha256,
      effectiveMarkdown: prepared.effectiveMarkdown,
      displayMarkdown: prepared.displayMarkdown,
      snapshot,
    });

    const replay = await service.commit({
      userId: scope.userId,
      ...makeOperation(),
      operationId: prepared.operationId,
      digest: prepared.digest,
    });
    expect(reader.readSteelReview).toHaveBeenCalledTimes(1);
    expect(readSteelReviewReceipt).toHaveBeenCalledTimes(1);
    expect(commitSteelReview).not.toHaveBeenCalled();
    expect(replay).toEqual(expect.objectContaining({
      title: 'ocr_result',
      revision: 'saved-revision',
      changedRows: 1,
      savedAt: savedAt.toISOString(),
    }));
  });

  it('exposes immutable receipt resolution without a write', async () => {
    const savedAt = new Date('2026-10-03T00:00:00.000Z');
    const readSteelReviewReceipt = jest.fn().mockResolvedValue({
      operationId: 'op-1',
      digest: 'a'.repeat(64),
      outputId: 'ocr_result:generation-1',
      revision: 'saved-revision',
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt,
      messageSha256: 'b'.repeat(64),
      effectiveMarkdown: managedMarkdown,
      displayMarkdown: managedMarkdown,
      snapshot: {
        operationId: 'op-1',
        digest: 'a'.repeat(64),
        outputId: 'ocr_result:generation-1',
        revision: 'saved-revision',
        headers: ['來源', '零件編號'],
        rows: [],
        changedRows: 1,
        changedRowIds: ['row-1'],
        savedAt,
        conversationId: scope.conversationId,
        messageId: scope.messageId,
        messageText: managedMarkdown,
        messageSha256: 'b'.repeat(64),
        effectiveMarkdown: managedMarkdown,
        displayMarkdown: managedMarkdown,
      },
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn() },
      writer: { commitSteelReview: jest.fn(), readSteelReviewReceipt },
    });

    await expect(service.receipt({
      ...scope,
      outputId: 'ocr_result:generation-1',
      operationId: 'op-1',
      digest: 'a'.repeat(64),
    })).resolves.toMatchObject({
      status: 'committed',
      snapshot: { revision: 'saved-revision', savedAt: savedAt.toISOString() },
    });
    expect(readSteelReviewReceipt).toHaveBeenCalledTimes(1);
  });

  it('keeps a changed-row operation bound to its captured revision while previewing current values', async () => {
    const rowId = createHash('sha256')
      .update('ocr_result:generation-1:0:' + JSON.stringify(['A', 'P-1']))
      .digest('hex');
    const currentMarkdown = managedMarkdown.replace('P-1', 'P-9');
    const record = makeRecord({
      revision: 'foreign-revision',
      rows: [{
        ...aiRow(rowId),
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-9' },
        },
      }],
      markdown: currentMarkdown,
      messageText: currentMarkdown,
      aiBaselineMarkdown: managedMarkdown,
    });
    const commitSteelReview = jest.fn().mockImplementation(async (input) => ({
      operationId: input.operationId,
      digest: input.operationDigest,
      outputId: input.outputId,
      revision: 'saved-revision',
      rows: input.rows,
      headers: input.headers,
      messageSha256: input.messageSha256,
      effectiveMarkdown: input.effectiveMarkdown,
      displayMarkdown: input.displayMarkdown,
      target: input.target,
      targetText: input.targetText,
      replacementText: input.replacementText,
      cleanReplacementText: input.cleanReplacementText,
      caption: input.caption,
      changedRows: input.caption.changedRows,
      changedRowIds: input.caption.changedRowIds,
      savedAt: new Date('2026-10-04T00:00:00.000Z'),
    }));
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
      writer: { commitSteelReview },
    });
    const operation = makeOperation({
      revision: 'generation-1',
      operations: [{
        type: 'update' as const,
        rowId,
        changes: [{ header: '零件編號', value: 'P-9' }],
      }],
    });
    const prepared = await service.prepare({ userId: scope.userId, ...operation });
    const preparedOperation = prepared as SteelReviewOperationPrepared;
    expect(preparedOperation.operationRequest.revision).toBe('generation-1');
    expect(preparedOperation.revision).toBe('foreign-revision');
    expect(preparedOperation.rows[0]?.values.零件編號?.effective).toBe('P-9');
    const preparedAgain = await service.prepare({ userId: scope.userId, ...operation });
    const preparedAgainOperation = preparedAgain as SteelReviewOperationPrepared;
    expect(preparedAgainOperation.requestDigest).toBe(preparedOperation.requestDigest);
    expect(preparedAgainOperation.operationId).not.toBe(preparedOperation.operationId);
    expect(preparedAgainOperation.digest).not.toBe(preparedOperation.digest);
    const saved = await service.commit({
      userId: scope.userId,
      ...operation,
      operationId: preparedOperation.operationId,
      digest: preparedOperation.digest,
    });
    expect(commitSteelReview).toHaveBeenCalledWith(expect.objectContaining({
      revision: 'foreign-revision',
      operationDigest: preparedOperation.digest,
      requestDigest: preparedOperation.requestDigest,
    }));
    expect(saved.revision).toBe('saved-revision');
  });

  it('accepts a normal classify, price update and delete chain through staged expected kind', async () => {
    const markdown = [
      `## ${systemOrderTitle}`,
      '',
      '| 類別 | 品名規格 | 總數 | 單價 |',
      '| --- | --- | --- | --- |',
      '|  | 雷射板 | 2 | 10 |',
    ].join('\n');
    const row = {
      rowId: 'row-1',
      origin: 'ai' as const,
      deleted: false,
      values: {
        類別: { baseline: '', effective: '' },
        品名規格: { baseline: '雷射板', effective: '雷射板' },
        總數: { baseline: '2', effective: '2' },
        單價: { baseline: '10', effective: '10' },
      },
      source: null,
      system: { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null },
    };
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord({
        revision: 'compound-revision',
        markdown,
        messageText: markdown,
        headers: ['類別', '品名規格', '總數', '單價'],
        rows: [row],
      })) },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order',
      outputId: 'system_order:run-1',
      revision: 'compound-revision',
      operations: [
        { type: 'classify', rowId: row.rowId, system: { kind: 'material', parentRowId: null } },
        { type: 'update', rowId: row.rowId, changes: [{ header: '單價', value: '7' }] },
        { type: 'delete', rowId: row.rowId },
      ],
    }) as SteelReviewOperationPrepared;

    expect(prepared.operationRequest.operations.map((operation) => operation.type)).toEqual([
      'classify', 'update', 'delete',
    ]);
  });

  it('prepares a same-value stale classification as a no-op and rejects a different relation with recovery', async () => {
    const initialMarkdown = [
      `## ${systemOrderTitle}`,
      '',
      '| 類別 | 品名規格 | 總數 | 單價 |',
      '| --- | --- | --- | --- |',
      '|  | 雷射板 | 2 | 10 |',
    ].join('\n');
    const currentMarkdown = initialMarkdown.replace('|  | 雷射板 |', '| 材料 | 雷射板 |');
    const initialRevision = createHash('sha256').update(initialMarkdown).digest('hex');
    const rowId = createHash('sha256')
      .update(`system_order:run-1:0:${JSON.stringify(['', '雷射板', '2', '10'])}`)
      .digest('hex');
    const currentRecord = makeSystemOrderRecord({
      revision: 'current-revision',
      aiBaselineMarkdown: initialMarkdown,
      markdown: currentMarkdown,
      messageText: currentMarkdown,
      headers: ['類別', '品名規格', '總數', '單價'],
      rows: [{
        rowId,
        origin: 'ai' as const,
        deleted: false,
        values: {
          類別: { baseline: '', effective: '材料' },
          品名規格: { baseline: '雷射板', effective: '雷射板' },
          總數: { baseline: '2', effective: '2' },
          單價: { baseline: '10', effective: '10' },
        },
        source: null,
        system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      }],
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(currentRecord) },
    });
    const base = {
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order' as const,
      outputId: 'system_order:run-1',
      revision: initialRevision,
    };
    const same = await service.prepare({
      ...base,
      operations: [{ type: 'classify', rowId, system: { kind: 'material', parentRowId: null } }],
    });
    expect(same.caption.changedRows).toBe(0);

    await expect(service.prepare({
      ...base,
      operations: [{ type: 'classify', rowId, system: { kind: 'processing', parentRowId: 'material-2' } }],
    })).rejects.toMatchObject({
      code: 'REVIEW_CONFLICT',
      recovery: {
        conflicts: [{ kind: 'binding', rowId, expected: null, current: null, requested: 'material-2' }],
      },
    });
  });
});
