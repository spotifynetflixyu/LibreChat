import { createHash } from 'node:crypto';
import type { SteelCatalogCandidate, SteelReviewOperationPrepared, SteelReviewRow } from 'librechat-data-provider';
import type { SteelReviewCommitInput } from '@librechat/data-schemas';
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

const catalogHeaders = [
  '型號', '品名規格', '材質編號', '單價', '厚度', '單位', '類別', '計價基準', '公式編號',
  '寬度', '長度', '肚', '單重', '數量', '總數', '備註',
];

const catalogMarkdown = (rows: readonly SteelReviewRow[]) => [
  `## ${systemOrderTitle}`,
  '',
  `| ${catalogHeaders.join(' | ')} |`,
  `| ${catalogHeaders.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${catalogHeaders.map((header) => row.values[header]?.effective ?? '').join(' | ')} |`),
].join('\n');

const makeCatalogRow = (
  rowId: string,
  kind: 'material' | 'processing',
  values: Record<string, string>,
): SteelReviewRow => {
  const category = kind === 'material' ? '鐵板' : '加工/焊接';
  return {
    rowId,
    origin: 'ai',
    deleted: false,
    values: Object.fromEntries(Object.entries(values).map(([header, value]) => [header, {
      baseline: value,
      effective: value,
    }])),
    source: null,
    system: kind === 'material'
      ? { kind, parentRowId: null, cascadeDeletedBy: null }
      : { kind, parentRowId: 'material-1', cascadeDeletedBy: null },
    calculation: {
      candidate: {
        erpItemCode: `OLD-${kind}`,
        category,
        ruleVersion: 'old-rule',
        exactPhysical: { density: '7.85', widthMm: '100', lengthMm: '1000', unitWeightValue: '2.5' },
      },
      measurement: { mode: 'perPiece', amount: '2', unit: '次', ruleVersion: 'v1' },
      fields: Object.fromEntries([
        ['寬度', { kind: 'manual' as const }],
        ['長度', { kind: 'manual' as const }],
        ['肚', { kind: 'manual' as const }],
        ['單重', { kind: 'manual' as const }],
        ['數量', { kind: 'manual' as const }],
        ['總數', { kind: 'manual' as const }],
        ['備註', { kind: 'manual' as const }],
      ]),
    },
  };
};

const makeCatalogCandidate = (kind: 'material' | 'processing'): SteelCatalogCandidate => {
  const category = kind === 'material' ? '鐵板' : '加工/焊接';
  const erpItemCode = `NEW-${kind}`;
  return {
    id: `${kind}-catalog-new`,
    revision: 'c'.repeat(64),
    erpItemCode,
    productName: `New ${kind}`,
    specKey: `${erpItemCode} new specification`,
    category,
    subcategory: kind === 'processing' ? '通用' : null,
    formulaCode: 'new-formula',
    material: 'NEW-MATERIAL',
    unit: '片',
    costBasis: 'piece',
    valueState: 'confirmed',
    unitWeightValue: '99.9',
    unitWeightBasis: 'kg_per_piece_or_stock_length',
    density: '7.85',
    thicknessMinMm: '13',
    thicknessMaxMm: '13',
    widthMm: '999',
    heightMm: '777',
    lengthMm: '8888',
    outerDiameterMm: '666',
    webMm: '555',
    flangeMm: '444',
    lipMm: '333',
    sheetWidthMm: '222',
    sheetLengthMm: '111',
    unitPrice: '42',
    calculation: {
      erpItemCode,
      category,
      ruleVersion: 'new-rule',
      exactPhysical: { density: '7.85', widthMm: '999', lengthMm: '8888', unitWeightValue: '99.9' },
    },
    label: `${erpItemCode} New ${kind}`,
  };
};

describe('Steel review read service', () => {
  it('initializes fresh processing bindings from an exact material remark', async () => {
    const title = 'system_order｜自動綁定';
    const headers = ['來源', '類別', '備註', '總數'];
    const rows = [
      ['F1', 'H型鋼', 'A', '2'],
      ['PROCESS', '加工/切工', 'A', '2'],
    ];
    const markdown = [
      `## ${title}`,
      '',
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');
    const processingRowId = createHash('sha256')
      .update(`system_order:run-1:1:${JSON.stringify(rows[1])}`)
      .digest('hex');
    const materialRowId = createHash('sha256')
      .update(`system_order:run-1:0:${JSON.stringify(rows[0])}`)
      .digest('hex');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord({
          title,
          tableId: `system_order:${title}`,
          headers,
          rows: undefined,
          markdown,
          messageText: markdown,
          sourceMappings: [{
            fileId: 'file-1',
            sourceCode: 'F1',
            sourceFilename: 'drawing.pdf',
          }],
        })),
      },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title,
      kind: 'system_order',
      outputId: 'system_order:run-1',
      revision: 'system-order-revision-1',
      operations: [{
        type: 'update',
        rowId: processingRowId,
        changes: [{ header: '總數', value: '3' }],
      }],
    });

    expect(prepared.rows.find((row) => row.rowId === processingRowId)?.system).toEqual({
      kind: 'processing',
      parentRowId: materialRowId,
      cascadeDeletedBy: null,
    });
    expect(prepared.rows.find((row) => row.rowId === processingRowId)?.source).toEqual({
      fileId: 'file-1',
      pageNumber: null,
      filename: 'drawing.pdf',
    });
  });

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

  it('rejects measurement metadata outside system-order processing rows', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeRecord()) },
    });

    await expect(service.prepare({
      ...prepareInput(),
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        measurement: { mode: 'batch', amount: '2', unit: '刀' },
      }],
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
  });

  it('counts a measurement-only save even when the rendered markdown is unchanged', async () => {
    const title = 'system_order｜測量測試';
    const headers = ['品名規格', '類別', '單位', '數量', '總數', '單價'];
    const markdown = [
      `## ${title}`,
      '',
      '| 品名規格 | 類別 | 單位 | 數量 | 總數 | 單價 |',
      '| --- | --- | --- | --- | --- | --- |',
      '| H | H型鋼 | 支 | 2 | 2 | 10 |',
      '| cut | 加工/切工 | 刀 |  | 1 | 5 |',
    ].join('\n');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord({
          title,
          markdown,
          messageText: markdown,
          headers,
          rows: [
            {
              rowId: 'material-1', origin: 'ai', deleted: false,
              values: Object.fromEntries(headers.map((header, index) => [header, {
                baseline: ['H', 'H型鋼', '支', '2', '2', '10'][index] ?? '',
                effective: ['H', 'H型鋼', '支', '2', '2', '10'][index] ?? '',
              }])),
              source: null,
              system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
            },
            {
              rowId: 'processing-1', origin: 'ai', deleted: false,
              values: Object.fromEntries(headers.map((header, index) => [header, {
                baseline: ['cut', '加工/切工', '刀', '', '1', '5'][index] ?? '',
                effective: ['cut', '加工/切工', '刀', '', '1', '5'][index] ?? '',
              }])),
              source: null,
              system: { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null },
            },
          ],
        })),
      },
    });

    const prepared = await service.prepare({
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title,
      kind: 'system_order',
      outputId: 'system_order:run-1',
      revision: 'system-order-revision-1',
      operations: [{
        type: 'update', rowId: 'processing-1',
        measurement: { mode: 'batch', amount: '3', unit: '刀' },
      }],
    });

    expect(prepared.caption).toEqual(expect.objectContaining({ changedRows: 1, changedRowIds: ['processing-1'] }));
    expect(prepared.rows.find((row) => row.rowId === 'processing-1')?.calculation?.measurement).toEqual({
      mode: 'batch', amount: '3', unit: '刀', ruleVersion: 'v1',
    });
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

  it('projects valid catalog customer evidence on review tables and omits invalid evidence', async () => {
    const input = {
      userId: scope.userId,
      conversationId: scope.conversationId,
      kind: 'system_order' as const,
      messageId: scope.messageId,
      title: systemOrderTitle,
    };
    const customerSnapshot = {
      snapshotId: 'customer-snapshot-1',
      customerIdentity: 'explicit-default:B',
      customerMarkdown: '## customer_data\n\n| 客戶 | 計價基準 |\n| --- | --- |\n| 預設 | B |',
    };
    const reader = { readSteelReview: jest.fn() };
    const service = createSteelReviewService({ reader });

    reader.readSteelReview.mockResolvedValueOnce(makeSystemOrderRecord({ customerSnapshot }));
    const result = await service.read(input);
    expect(result.table.catalogCustomer).toEqual({
      snapshotId: customerSnapshot.snapshotId,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      tier: 'B',
    });

    reader.readSteelReview.mockResolvedValueOnce(makeSystemOrderRecord({
      customerSnapshot: {
        ...customerSnapshot,
        customerIdentity: 'invalid-tier',
        customerMarkdown: '## customer_data\n\n| 客戶 | 計價基準 |\n| --- | --- |\n| 預設 | G |',
      },
    }));
    const invalid = await service.read(input);
    expect(invalid.table).not.toHaveProperty('catalogCustomer');
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

  it('resolves processing candidates separately and passes the trusted map to staged application', async () => {
    const headers = ['型號', '品名規格', '類別', '單位', '計價基準', '數量', '單價', '總數'];
    const markdown = [
      `## ${systemOrderTitle}`,
      '',
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      '| MAT-1 | Plate | 鐵板 | kg | 2 | 3 | 10 | 30 |',
      '| OLD-P | Old weld | 加工/焊接 | kg | 2 | 1 | 5 | 5 |',
    ].join('\n');
    const materialRow = {
      rowId: 'material-1', origin: 'ai' as const, deleted: false, source: null,
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      values: Object.fromEntries(headers.map((header, index) => {
        const values = ['MAT-1', 'Plate', '鐵板', 'kg', '2', '3', '10', '30'];
        return [header, { baseline: values[index]!, effective: values[index]! }];
      })),
    };
    const processingRow = {
      rowId: 'processing-1', origin: 'ai' as const, deleted: false, source: null,
      system: { kind: 'processing' as const, parentRowId: materialRow.rowId, cascadeDeletedBy: null },
      values: Object.fromEntries(headers.map((header, index) => {
        const values = ['OLD-P', 'Old weld', '加工/焊接', 'kg', '2', '1', '5', '5'];
        return [header, { baseline: values[index]!, effective: values[index]! }];
      })),
    };
    const candidate: SteelCatalogCandidate = {
      id: 'processing-catalog-1', revision: 'b'.repeat(64), erpItemCode: 'PR-1',
      productName: 'Weld', specKey: 'PR-1 weld', category: '加工/焊接', subcategory: '通用',
      formulaCode: null, material: null, unit: 'kg', costBasis: 'kg', valueState: 'confirmed',
      unitWeightValue: null, unitWeightBasis: null, density: null, thicknessMinMm: null,
      thicknessMaxMm: null, widthMm: null, heightMm: null, lengthMm: null, outerDiameterMm: null,
      webMm: null, flangeMm: null, lipMm: null, sheetWidthMm: null, sheetLengthMm: null,
      unitPrice: '7', calculation: {
        erpItemCode: 'PR-1', category: '加工/焊接', ruleVersion: 'steel-catalog-v1', exactPhysical: {},
      }, label: 'PR-1 Weld PR-1 weld',
    };
    const resolve = jest.fn().mockResolvedValue({
      candidate,
      customer: { snapshotId: 'snapshot', revision: 'customer', tier: 'B' },
      evidence: {
        rowId: processingRow.rowId, candidateId: candidate.id, candidateRevision: candidate.revision,
        customerSnapshotId: 'snapshot', customerRevision: 'customer', customerTier: 'B', unitPrice: '7',
      },
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(makeSystemOrderRecord({
        revision: 'processing-revision', headers, rows: [materialRow, processingRow], markdown, messageText: markdown,
      })) },
      catalogService: { search: jest.fn(), resolve },
    });

    const prepared = await service.prepare({
      userId: scope.userId, conversationId: scope.conversationId, messageId: scope.messageId,
      title: systemOrderTitle, kind: 'system_order', outputId: 'system_order:run-1', revision: 'processing-revision',
      operations: [{
        type: 'replace_processing', rowId: processingRow.rowId,
        selection: { id: candidate.id, revision: candidate.revision, evidence: {
          snapshotId: 'snapshot', revision: 'customer', tier: 'B',
        } },
      }],
    }) as SteelReviewOperationPrepared;

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ kind: 'processing', rowId: processingRow.rowId }));
    expect(prepared.rows.find((row) => row.rowId === processingRow.rowId)?.values['型號']?.effective).toBe('PR-1');
    expect(prepared.rows.find((row) => row.rowId === processingRow.rowId)?.values['單價']?.effective).toBe('7');
  });

  it.each([
    ['material', 'replace_material', 'D', '4'],
    ['processing', 'replace_processing', 'E', '5'],
  ] as const)('persists the nine catalog fields and protects stored %s values through commit recheck', async (
    kind,
    operationType,
    tier,
    expectedTier,
  ) => {
    const materialValues = {
      型號: 'OLD-M', 品名規格: 'Stored material', 材質編號: 'OLD-MATERIAL', 單價: '17', 厚度: '12',
      單位: 'kg', 類別: '鐵板', 計價基準: '9', 公式編號: 'old-formula', 寬度: '100', 長度: '1000',
      肚: '25', 單重: '2.5', 數量: '4', 總數: '10', 備註: 'keep part',
    };
    const processingValues = {
      型號: 'OLD-P', 品名規格: 'Stored processing', 材質編號: 'OLD-MATERIAL', 單價: '19', 厚度: '12',
      單位: 'kg', 類別: '加工/焊接', 計價基準: '9', 公式編號: 'old-formula', 寬度: '100', 長度: '1000',
      肚: '25', 單重: '2.5', 數量: '4', 總數: '10', 備註: 'keep part',
    };
    const materialRow = makeCatalogRow('material-1', 'material', materialValues);
    const selectedRow = kind === 'material'
      ? materialRow
      : makeCatalogRow('processing-1', 'processing', processingValues);
    const originalRows = kind === 'material' ? [selectedRow] : [materialRow, selectedRow];
    const currentRows = originalRows.map((row) => row.rowId === selectedRow.rowId
      ? {
          ...row,
          values: {
            ...row.values,
            寬度: { ...row.values.寬度!, effective: '777' },
            總數: { ...row.values.總數!, effective: '12345' },
          },
          calculation: {
            ...row.calculation!,
            fields: {
              ...row.calculation!.fields,
              寬度: { kind: 'manual' as const, dependencies: { source: 'transaction-current' } },
              總數: { kind: 'manual' as const, dependencies: { source: 'transaction-current' } },
            },
          },
        }
      : row);
    const record = makeSystemOrderRecord({
      revision: 'catalog-revision',
      headers: catalogHeaders,
      rows: originalRows,
      markdown: catalogMarkdown(originalRows),
      messageText: catalogMarkdown(originalRows),
    });
    const currentRecord = makeSystemOrderRecord({
      revision: 'catalog-revision',
      headers: catalogHeaders,
      rows: currentRows,
      markdown: catalogMarkdown(currentRows),
      messageText: catalogMarkdown(currentRows),
    });
    const candidate = makeCatalogCandidate(kind);
    const resolve = jest.fn().mockResolvedValue({
      candidate,
      customer: { snapshotId: 'snapshot', revision: 'customer-revision', tier },
      evidence: {
        rowId: selectedRow.rowId,
        candidateId: candidate.id,
        candidateRevision: candidate.revision,
        customerSnapshotId: 'snapshot',
        customerRevision: 'customer-revision',
        customerTier: tier,
        unitPrice: candidate.unitPrice,
      },
    });
    const commitSteelReview = jest.fn().mockImplementation(async (input: SteelReviewCommitInput) => {
      if (!input.prepareOperation) throw new Error('Missing transaction recheck');
      const transactionInput = await input.prepareOperation(currentRecord);
      return {
        ...transactionInput,
        changedRows: transactionInput.caption.changedRows,
        changedRowIds: transactionInput.caption.changedRowIds,
        savedAt: new Date('2026-10-08T00:00:00.000Z'),
      };
    });
    const reader = {
      readSteelReview: jest.fn().mockResolvedValueOnce(record).mockResolvedValueOnce(record),
    };
    const service = createSteelReviewService({
      reader,
      writer: { commitSteelReview },
      catalogService: { search: jest.fn(), resolve },
    });
    const operation = {
      userId: scope.userId,
      conversationId: scope.conversationId,
      messageId: scope.messageId,
      title: systemOrderTitle,
      kind: 'system_order' as const,
      outputId: 'system_order:run-1',
      revision: 'catalog-revision',
      operations: [{
        type: operationType,
        rowId: selectedRow.rowId,
        selection: {
          id: candidate.id,
          revision: candidate.revision,
          evidence: { snapshotId: 'snapshot', revision: 'customer-revision', tier },
        },
      }],
    };
    const prepared = await service.prepare(operation) as SteelReviewOperationPrepared;
    const preparedRow = prepared.rows.find((row) => row.rowId === selectedRow.rowId)!;
    expect(preparedRow.values).toEqual(expect.objectContaining({
      型號: expect.objectContaining({ effective: candidate.erpItemCode }),
      品名規格: expect.objectContaining({ effective: candidate.productName }),
      材質編號: expect.objectContaining({ effective: candidate.material }),
      單價: expect.objectContaining({ effective: candidate.unitPrice }),
      厚度: expect.objectContaining({ effective: '13' }),
      單位: expect.objectContaining({ effective: candidate.unit }),
      類別: expect.objectContaining({ effective: candidate.category }),
      計價基準: expect.objectContaining({ effective: expectedTier }),
      公式編號: expect.objectContaining({ effective: candidate.formulaCode }),
    }));
    expect(preparedRow.values).toEqual(expect.objectContaining({
      寬度: expect.objectContaining({ effective: '100' }),
      長度: expect.objectContaining({ effective: '1000' }),
      肚: expect.objectContaining({ effective: '25' }),
      單重: expect.objectContaining({ effective: '2.5' }),
      數量: expect.objectContaining({ effective: '4' }),
      總數: expect.objectContaining({ effective: '10' }),
      備註: expect.objectContaining({ effective: 'keep part' }),
    }));
    expect(preparedRow.calculation?.fields?.寬度).toEqual({ kind: 'manual' });
    expect(preparedRow.calculation?.fields?.總數).toEqual({ kind: 'manual' });
    expect(preparedRow.calculation?.measurement).toEqual(selectedRow.calculation?.measurement);
    expect(preparedRow.calculation?.candidate).toEqual(candidate.calculation);

    const saved = await service.commit({
      ...operation,
      operationId: prepared.operationId,
      digest: prepared.digest,
    });
    const persistedRow = saved.rows.find((row) => row.rowId === selectedRow.rowId)!;
    expect(persistedRow.values).toEqual(expect.objectContaining({
      型號: expect.objectContaining({ effective: candidate.erpItemCode }),
      計價基準: expect.objectContaining({ effective: expectedTier }),
      寬度: expect.objectContaining({ effective: '777' }),
      長度: expect.objectContaining({ effective: '1000' }),
      肚: expect.objectContaining({ effective: '25' }),
      單重: expect.objectContaining({ effective: '2.5' }),
      數量: expect.objectContaining({ effective: '4' }),
      總數: expect.objectContaining({ effective: '12345' }),
    }));
    expect(persistedRow.calculation?.fields?.寬度).toEqual({
      kind: 'manual', dependencies: { source: 'transaction-current' },
    });
    expect(persistedRow.calculation?.fields?.總數).toEqual({
      kind: 'manual', dependencies: { source: 'transaction-current' },
    });
    expect(persistedRow.calculation?.measurement).toEqual(selectedRow.calculation?.measurement);
    expect(commitSteelReview).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      kind,
      revision: 'catalog-revision',
      rowId: selectedRow.rowId,
    }));
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
      customerSnapshot: {
        snapshotId: 'customer-snapshot-recovery',
        customerIdentity: 'explicit-default:B',
        customerMarkdown: '## customer_data\n\n| 客戶 | 計價基準 |\n| --- | --- |\n| 預設 | B |',
      },
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
        table: {
          catalogCustomer: expect.objectContaining({
            snapshotId: 'customer-snapshot-recovery',
            tier: 'B',
          }),
        },
        conflicts: [{ kind: 'binding', rowId, expected: null, current: null, requested: 'material-2' }],
      },
    });
  });
});
