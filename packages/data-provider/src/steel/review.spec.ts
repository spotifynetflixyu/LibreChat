import { createHash } from 'node:crypto';
import type { SteelReviewLedgerRow, SteelReviewOperation } from './review';
import {
  encodeSteelReviewDigest as encodeSteelReviewDigestValue,
  encodeSteelReviewTitleOwner,
  applySteelReviewOperations,
  isSteelReviewSourceAssociationHeader,
  normalizeSteelReviewEffectiveValue,
  normalizeSteelReviewRows,
  normalizeSteelReviewLedgerRows,
  sameSteelReviewSource,
  steelReviewReadQuerySchema,
  steelReviewResponseSchema,
  steelReviewCommitSchema,
  steelReviewPreparedSchema,
  steelReviewPrepareSchema,
  steelReviewOperationCommitSchema,
  steelReviewOperationPrepareSchema,
  steelReviewOperationSchema,
  validateSteelReviewLedger,
} from './review';

const identity = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  kind: 'ocr_result' as const,
  title: 'ocr_result｜完整標題',
  outputId: 'ocr_result:generation-1',
  revision: 'generation-1',
};

const update = {
  type: 'update' as const,
  rowId: 'row-1',
  changes: [{ header: 'Value', value: 'new' }],
};

type DigestFixture = {
  userId: string;
  tenantId?: string | null;
  conversationId: string;
  messageId: string;
  kind: 'ocr_result' | 'system_order';
  title?: string;
  outputId: string;
  revision: string;
  operationId?: string;
  operations?: SteelReviewOperation[];
  rows?: Array<{
    rowId: string;
    values: Record<string, { baseline: string | null; effective: string | null }>;
    insertion?: { kind: 'start' | 'end' | 'after'; rowId?: string; ordinal: number };
  }>;
  [key: string]: unknown;
};

function encodeSteelReviewDigest(input: DigestFixture): string {
  const operations = input.operations ?? (input.rows ?? []).map((row) => {
    const changes = Object.entries(row.values)
      .filter(([, cell]) => cell.baseline !== cell.effective)
      .map(([header, cell]) => ({ header, value: cell.effective }));
    if (row.insertion) {
      return {
        type: 'add' as const,
        rowId: row.rowId,
        position: row.insertion.kind === 'after'
          ? { kind: 'after' as const, rowId: row.insertion.rowId! }
          : { kind: row.insertion.kind },
        changes: changes.length > 0 ? changes : [{ header: 'Value', value: null }],
      };
    }
    return {
      type: 'update' as const,
      rowId: row.rowId,
      changes: changes.length > 0 ? changes : [{ header: 'Value', value: null }],
    };
  });
  return encodeSteelReviewDigestValue({
    userId: input.userId,
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    conversationId: input.conversationId,
    messageId: input.messageId,
    kind: input.kind,
    title: input.title ?? 'ocr_result',
    outputId: input.outputId,
    revision: input.revision,
    operationId: input.operationId ?? 'fixture-operation',
    operations,
  });
}

describe('Steel review contracts', () => {
  it('classifies exact source association headers without locking business fields', () => {
    const associationHeaders = [
      '來源', '頁碼', '原始檔案', '原檔頁碼', 'source', 'source_file', 'Original File',
      'Original Page Number',
    ];
    for (const header of associationHeaders) {
      expect(isSteelReviewSourceAssociationHeader(header)).toBe(true);
    }
    expect(isSteelReviewSourceAssociationHeader('Profile')).toBe(false);
    expect(isSteelReviewSourceAssociationHeader('source code')).toBe(false);
  });

  it('accepts a readonly managed table with independent rows and nullable sources', () => {
    const result = steelReviewResponseSchema.parse({
      table: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        title: 'ocr_result｜完整標題',
        outputId: 'ocr_result:generation-1',
        kind: 'ocr_result',
        revision: 'generation-1',
        latestOutputId: 'ocr_result:generation-1',
        isLatest: true,
        readOnly: false,
        headers: ['來源', '零件編號'],
        rows: [
          {
            rowId: 'row-1',
            source: null,
            values: {
              來源: { baseline: 'F1', effective: 'F1' },
              零件編號: { baseline: 'A', effective: 'A' },
            },
          },
        ],
      },
    });

    expect(result.table?.rows[0]?.rowId).toBe('row-1');
    expect(result.table?.rows[0]?.source).toBeNull();
  });

  it('requires the exact scoped table identity', () => {
    expect(() =>
      steelReviewReadQuerySchema.parse({
        messageId: '',
        title: 'ocr_result',
      }),
    ).toThrow();
  });

  it('requires title-only public review locators and rejects positional/full-row fields', () => {
    expect(steelReviewReadQuerySchema.parse({
      messageId: 'message-1',
      title: 'ocr_result｜完整標題',
    })).toEqual({ messageId: 'message-1', title: 'ocr_result｜完整標題' });
    expect(steelReviewReadQuerySchema.safeParse({ messageId: 'message-1' }).success).toBe(false);
    expect(steelReviewReadQuerySchema.safeParse({
      messageId: 'message-1',
      title: 'ocr_result',
      tableId: 'ocr_result:2',
    }).success).toBe(false);

    const operation = {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      title: 'ocr_result',
      operations: [{
        type: 'update' as const,
        rowId: 'row-1',
        changes: [{ header: 'Profile', value: 'P-2' }],
      }],
    };
    expect(steelReviewOperationPrepareSchema.parse(operation)).toEqual(operation);
    expect(steelReviewOperationPrepareSchema.safeParse({
      ...operation,
      tableId: 'ocr_result:2',
    }).success).toBe(false);
    expect(steelReviewPrepareSchema.safeParse({
      ...operation,
      rows: [],
    }).success).toBe(false);
    expect(steelReviewCommitSchema.parse({
      ...operation,
      operationId: 'operation-1',
      digest: 'a'.repeat(64),
    })).toEqual({
      ...operation,
      operationId: 'operation-1',
      digest: 'a'.repeat(64),
    });
  });

  it('accepts an exact full title as the logical review locator', () => {
    expect(steelReviewReadQuerySchema.parse({
      messageId: 'message-1',
      title: 'system_order｜梁柱詳圖 A-01',
    }).title).toBe('system_order｜梁柱詳圖 A-01');
  });

  it('encodes title owners with a shared namespace and ordered scope', () => {
    expect(encodeSteelReviewTitleOwner({
      userId: 'user-1',
      tenantId: null,
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      title: 'ocr_result｜完整版',
    })).toContain('steel-review-title-owner-v1');
    expect(encodeSteelReviewTitleOwner({
      userId: 'user-1',
      tenantId: null,
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      title: 'ocr_result｜完整版',
    })).not.toBe(encodeSteelReviewTitleOwner({
      userId: 'user-1',
      tenantId: null,
      conversationId: 'conversation-1',
      messageId: 'message-1',
      kind: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      title: 'ocr_result',
    }));
  });

  it('normalizes effective whitespace while preserving null', () => {
    expect(normalizeSteelReviewEffectiveValue('  7\r\n  ')).toBe('7');
    expect(normalizeSteelReviewEffectiveValue(' A\nB ')).toBe('A B');
    expect(normalizeSteelReviewEffectiveValue(null)).toBeNull();
  });

  it('compares nullable source metadata without coercing association fields', () => {
    const source = { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf', mediaType: 'application/pdf' };
    expect(sameSteelReviewSource(null, null)).toBe(true);
    expect(sameSteelReviewSource(null, source)).toBe(false);
    expect(sameSteelReviewSource(source, null)).toBe(false);
    expect(sameSteelReviewSource(source, { ...source })).toBe(true);
    expect(sameSteelReviewSource(source, { ...source, fileId: 'file-2' })).toBe(false);
    expect(sameSteelReviewSource(source, { ...source, pageNumber: 0 })).toBe(false);
    expect(sameSteelReviewSource(source, { ...source, pageNumber: null })).toBe(false);
    expect(sameSteelReviewSource(source, { ...source, filename: 'other.pdf' })).toBe(false);
    expect(sameSteelReviewSource(source, { ...source, mediaType: 'image/png' })).toBe(false);
    expect(sameSteelReviewSource(
      { fileId: 'file-1', pageNumber: 1 },
      { fileId: 'file-1', pageNumber: 1, filename: undefined, mediaType: undefined },
    )).toBe(true);
  });

  it('normalizes rows without changing source, baseline, null, or cell properties', () => {
    const rows = [{
      rowId: 'row-1',
      source: null,
      values: {
        Value: { baseline: ' AI ', effective: '  human\r\nvalue  ' },
        Empty: { baseline: null, effective: null },
      },
    }];
    const normalized = normalizeSteelReviewRows(rows);

    expect(normalized).toEqual([{
      rowId: 'row-1',
      source: null,
      values: {
        Value: { baseline: ' AI ', effective: 'human value' },
        Empty: { baseline: null, effective: null },
      },
    }]);
    expect(normalized).not.toBe(rows);
    expect(normalized[0]?.values).not.toBe(rows[0].values);
  });

  it('materializes legacy ledger defaults only in the trusted effective view', () => {
    const legacy = {
      rowId: 'row-legacy',
      source: null,
      values: { Value: { baseline: 'AI', effective: 'human' } },
    };
    expect(Object.prototype.hasOwnProperty.call(legacy, 'origin')).toBe(false);
    expect(normalizeSteelReviewRows([legacy])).toEqual([legacy]);
    expect(normalizeSteelReviewLedgerRows([legacy])).toEqual([{
      ...legacy,
      origin: 'ai',
      deleted: false,
    }]);
  });

  it('validates typed insertion anchors and keeps them in the digest', () => {
    const base = {
      ...identity,
      operations: [{
        type: 'add' as const,
        rowId: 'row-manual',
        position: { kind: 'after' as const, rowId: 'row-ai' },
        changes: [{ header: 'Value', value: 'new' }],
      }],
    };
    expect(steelReviewOperationPrepareSchema.safeParse(base).success).toBe(true);
    expect(encodeSteelReviewDigest({ ...base, userId: 'user-1' })).not.toBe(encodeSteelReviewDigest({
      ...base,
      userId: 'user-1',
      operations: [{ ...base.operations[0], position: { kind: 'start' as const } }],
    }));
  });

  it('keeps new ledger digests stable across HTTP schema property ordering', () => {
    const base = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      headers: ['Value'],
      messageSha256: 'a'.repeat(64),
      target: { start: 0, end: 1, sha256: 'b'.repeat(64) },
      targetText: 'old',
      replacementText: 'new',
      cleanReplacementText: 'new',
      effectiveMarkdown: 'table',
      displayMarkdown: 'table',
      caption: { kind: 'ocr_result' as const, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const browserRow = {
      rowId: 'row-1',
      values: { Value: { baseline: 'AI', effective: 'new' } },
      source: null,
      deleted: true,
      origin: 'ai' as const,
    };
    const parsedRow = {
      rowId: browserRow.rowId,
      values: browserRow.values,
      source: browserRow.source,
      origin: browserRow.origin,
      deleted: browserRow.deleted,
    };
    expect(encodeSteelReviewDigest({ ...base, rows: [browserRow] }))
      .toBe(encodeSteelReviewDigest({ ...base, rows: [parsedRow] }));
  });

  it('orders trusted ledger rows and reserves ordinals across tombstones', () => {
    const current = [
      {
        rowId: 'row-ai',
        source: null,
        values: { Value: { baseline: 'AI', effective: 'AI' } },
      },
      {
        rowId: 'row-manual-old',
        source: null,
        origin: 'manual' as const,
        deleted: true,
        insertion: { kind: 'end' as const, ordinal: 0 },
        values: { Value: { baseline: null, effective: 'old' } },
      },
    ];
    const result = validateSteelReviewLedger(current, [
      ...current,
      {
        rowId: 'row-manual-new',
        source: null,
        origin: 'manual' as const,
        deleted: false,
        insertion: { kind: 'end' as const, ordinal: 1 },
        values: { Value: { baseline: null, effective: 'new' } },
      },
    ], ['Value']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderedRows.map((row) => row.rowId)).toEqual([
        'row-ai', 'row-manual-old', 'row-manual-new',
      ]);
    }
    expect(validateSteelReviewLedger(current, [
      ...current,
      {
        rowId: 'row-forged',
        source: null,
        origin: 'manual' as const,
        deleted: false,
        insertion: { kind: 'end' as const, ordinal: 0 },
        values: { Value: { baseline: null, effective: 'forged' } },
      },
    ], ['Value'])).toMatchObject({ ok: false, code: 'insertion-order' });
  });

  it('orders persisted and new siblings by protected ordinals, including tombstones', () => {
    const ai = {
      rowId: 'row-ai',
      source: null,
      values: { Value: { baseline: 'AI', effective: 'AI' } },
    };
    const older = {
      rowId: 'row-manual-older',
      source: null,
      origin: 'manual' as const,
      deleted: true,
      insertion: { kind: 'after' as const, rowId: 'row-ai', ordinal: 1 },
      values: { Value: { baseline: null, effective: 'older' } },
    };
    const newer = {
      rowId: 'row-manual-newer',
      source: null,
      origin: 'manual' as const,
      deleted: false,
      insertion: { kind: 'after' as const, rowId: 'row-ai', ordinal: 2 },
      values: { Value: { baseline: null, effective: 'newer' } },
    };
    const result = validateSteelReviewLedger(
      [ai, newer, older],
      [ai, newer, older, {
        rowId: 'row-manual-latest',
        source: null,
        origin: 'manual' as const,
        deleted: false,
        insertion: { kind: 'after' as const, rowId: 'row-ai', ordinal: 3 },
        values: { Value: { baseline: null, effective: 'latest' } },
      }],
      ['Value'],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderedRows.map((row) => row.rowId)).toEqual([
        'row-ai', 'row-manual-older', 'row-manual-newer', 'row-manual-latest',
      ]);
    }
  });

  it('encodes scope, target, and row changes distinctly with stable null defaults', () => {
    const base = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      title: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      revision: 'revision-1',
      rows: [{
        rowId: 'row-1',
        values: { Value: { baseline: '2', effective: '7' } },
        source: null,
      }],
      headers: ['Value'],
      messageSha256: 'a'.repeat(64),
      target: { start: 1, end: 3, sha256: 'b'.repeat(64) },
      targetText: 'old',
      replacementText: 'new',
      cleanReplacementText: 'new',
      effectiveMarkdown: '## ocr_result',
      displayMarkdown: '## ocr_result',
      caption: { kind: 'ocr_result' as const, changedRows: 1, changedRowIds: ['row-1'] },
    };
    const withoutTenant = encodeSteelReviewDigest(base);
    expect(encodeSteelReviewDigest({ ...base, tenantId: null })).toBe(withoutTenant);
    expect(encodeSteelReviewDigest({ ...base, userId: 'user-2' })).not.toBe(withoutTenant);
    expect(encodeSteelReviewDigest({
      ...base,
      title: 'ocr_result｜另一本表',
    })).not.toBe(withoutTenant);
    expect(encodeSteelReviewDigest({
      ...base,
      rows: [{ ...base.rows[0], values: { Value: { baseline: '2', effective: '8' } } }],
    })).not.toBe(withoutTenant);
  });

  it('encodes a migrated stored row through the title-only operation identity', () => {
    const legacy = {
      userId: 'legacy-fixture-user',
      conversationId: 'legacy-fixture-chat',
      kind: 'ocr_result' as const,
      messageId: 'legacy-fixture-message',
      title: 'ocr_result',
      outputId: 'ocr_result:legacy-fixture-generation',
      revision: 'legacy-fixture-generation',
      rows: [{
        rowId: '31c389e1916d78f3aeb367b3074d9943ccc1d85c2e58bdf04ceea976fade3d57',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'LEGACY-P1', effective: 'LEGACY-P1' },
          數量: { baseline: '2', effective: '7' },
          頁碼: { baseline: '1', effective: '1' },
        },
        source: null,
      }],
      headers: ['來源', '零件編號', '數量', '頁碼'],
      messageSha256: '0f3a1e4577ead7ba2a756ce420d5c18e4ffa227977ae803018a30021c6819fdd',
      target: {
        start: 14,
        end: 89,
        sha256: 'e4261ad7e949a37e0adc326b9bb35cc9058c944a96c1b708ea421a45b5d7a299',
      },
      targetText: '| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 2 | 1 |',
      replacementText: '| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 7 | 1 |',
      cleanReplacementText: '| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 7 | 1 |',
      effectiveMarkdown: '## ocr_result\n| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 7 | 1 |',
      displayMarkdown: '## ocr_result\n| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 7 | 1 |',
      aiBaselineMarkdown: '## ocr_result\n| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 2 | 1 |',
      aiRawMarkdown: '## ocr_result\n| 來源 | 零件編號 | 數量 | 頁碼 |\n| --- | --- | --- | --- |\n| A | LEGACY-P1 | 2 | 1 |',
      caption: {
        kind: 'ocr_result' as const,
        changedRows: 1,
        changedRowIds: ['31c389e1916d78f3aeb367b3074d9943ccc1d85c2e58bdf04ceea976fade3d57'],
      },
    };
    const digest = createHash('sha256').update(encodeSteelReviewDigest({
      ...legacy,
      operationId: 'legacy-operation',
      operations: [{
        type: 'update',
        rowId: legacy.rows[0].rowId,
        changes: [{ header: '數量', value: '7' }],
      }],
    })).digest('hex');
    expect(digest).toHaveLength(64);
    expect(encodeSteelReviewDigest({ ...legacy, sourceMappings: [] })).toBe(encodeSteelReviewDigest(legacy));
  });

  it('rejects present undefined or null source intents while accepting an explicit empty array', () => {
    const base = { ...identity, operations: [update] };
    expect(steelReviewPrepareSchema.safeParse(base).success).toBe(true);
    expect(steelReviewPrepareSchema.safeParse({ ...base, sourceIntents: [] }).success).toBe(false);
    expect(steelReviewPrepareSchema.safeParse({ ...base, rows: [] }).success).toBe(false);
    expect(steelReviewPreparedSchema.safeParse({ ...base, operationId: 'operation-1', digest: 'a'.repeat(64) }).success)
      .toBe(false);
  });

  it('keeps changed-row operations closed and presence-sensitive', () => {
    const identity = {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      title: 'ocr_result',
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
    };
    const update = { type: 'update' as const, rowId: 'row-1', changes: [{ header: 'Value', value: 'new' }] };
    const add = {
      type: 'add' as const,
      rowId: 'manual-1',
      position: { kind: 'after' as const, rowId: 'row-1' },
      changes: [{ header: 'Value', value: 'new' }],
    };

    expect(steelReviewOperationSchema.safeParse(update).success).toBe(true);
    expect(steelReviewOperationSchema.safeParse({ type: 'delete', rowId: 'row-1' }).success).toBe(true);
    expect(steelReviewOperationSchema.safeParse({ type: 'restore', rowId: 'row-1' }).success).toBe(true);
    expect(steelReviewOperationSchema.safeParse({ ...update, source: { fileId: null, pageNumber: null } }).success).toBe(true);
    expect(steelReviewOperationSchema.safeParse({ ...update, source: { fileId: 'file-1', pageNumber: null } }).success).toBe(true);
    expect(steelReviewOperationSchema.safeParse(add).success).toBe(true);

    const invalid = [
      { ...update, source: undefined },
      { ...update, source: null },
      { ...update, source: { fileId: null, pageNumber: 1 } },
      { ...update, source: { fileId: 'file-1' } },
      { ...update, source: { fileId: 'file-1', pageNumber: 0 } },
      { ...update, changes: [{ header: 'Value', value: 'a' }, { header: 'Value', value: 'b' }] },
      { ...update, extra: true },
      { ...add, position: { kind: 'start', rowId: undefined } },
      { ...add, position: { kind: 'end', rowId: null } },
      { ...add, position: { kind: 'after' } },
      { ...add, position: { kind: 'after', rowId: '' } },
      { ...add, position: undefined },
      { ...add, source: undefined },
      { ...add, changes: [] },
    ];
    for (const candidate of invalid) {
      expect(steelReviewOperationSchema.safeParse(candidate).success).toBe(false);
    }

    expect(steelReviewOperationPrepareSchema.safeParse({ ...identity, operations: [update] }).success).toBe(true);
    expect(steelReviewOperationPrepareSchema.safeParse({
      ...identity,
      operations: [update],
      rows: [],
    }).success).toBe(false);
    expect(steelReviewOperationCommitSchema.safeParse({
      ...identity,
      operations: [update],
      operationId: 'operation-1',
      digest: 'a'.repeat(64),
    }).success).toBe(true);
  });

  it('merges disjoint fields and returns every conflicting field without mutating trusted inputs', () => {
    const row = (value: string) => ({
      rowId: 'row-1',
      values: {
        Value: { baseline: 'ai', effective: value },
        Other: { baseline: 'ai-other', effective: 'ai-other' },
      },
      source: null,
      origin: 'ai' as const,
      deleted: false,
    });
    const current = [row('foreign')];
    const expected = [row('ai')];
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows(current),
      expectedRows: normalizeSteelReviewLedgerRows(expected),
      headers: ['Value', 'Other'],
      operations: [{
        type: 'update',
        rowId: 'row-1',
        changes: [
          { header: 'Value', value: 'local' },
          { header: 'Other', value: 'local-other' },
        ],
      }],
    });
    expect(result).toMatchObject({
      ok: false,
      conflicts: [{ kind: 'field', rowId: 'row-1', header: 'Value', expected: 'ai', current: 'foreign', requested: 'local' }],
    });
    expect((result as { conflicts: unknown[] }).conflicts).toHaveLength(1);
    expect(current[0]?.values.Value.effective).toBe('foreign');
    expect(expected[0]?.values.Value.effective).toBe('ai');
  });

  it('applies ordered dimension changes against the latest combined inputs', () => {
    const candidate = {
      erpItemCode: 'PL-1',
      category: '鐵板',
      ruleVersion: 'steel-weight-v1',
      exactPhysical: { density: '7.85' },
    } as const;
    const row = {
      rowId: 'row-1',
      values: {
        型號: { baseline: 'PL-1', effective: 'PL-1' },
        類別: { baseline: '鐵板', effective: '鐵板' },
        單位: { baseline: 'kg', effective: 'kg' },
        數量: { baseline: '1', effective: '1' },
        單重: { baseline: '0.785', effective: '0.785' },
        總數: { baseline: '0.785', effective: '0.785' },
        厚度: { baseline: '1', effective: '1' },
        寬度: { baseline: '100', effective: '100' },
        長度: { baseline: '1000', effective: '1000' },
      },
      source: null,
      calculation: { candidate },
      origin: 'ai' as const,
      deleted: false,
    };
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([row]),
      expectedRows: normalizeSteelReviewLedgerRows([row]),
      headers: Object.keys(row.values),
      operations: [{
        type: 'update',
        rowId: row.rowId,
        changes: [
          { header: '厚度', value: '2' },
          { header: '寬度', value: '200' },
        ],
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.currentRows[0]!;
      expect(updated.values['單重']?.effective).toBe('3.14');
      expect(updated.values['總數']?.effective).toBe('3.14');
      expect(updated.calculation?.fields?.['單重']?.kind).toBe('derived');
    }
  });

  it('protects a concurrent manual derived output and accepts equal derived values', () => {
    const candidate = {
      erpItemCode: 'PL-1',
      category: '鐵板',
      ruleVersion: 'steel-weight-v1',
      exactPhysical: { density: '7.85' },
    } as const;
    const row = {
      rowId: 'row-1',
      values: {
        型號: { baseline: 'PL-1', effective: 'PL-1' },
        類別: { baseline: '鐵板', effective: '鐵板' },
        單位: { baseline: 'kg', effective: 'kg' },
        數量: { baseline: '1', effective: '1' },
        單重: { baseline: '0.785', effective: '0.785' },
        總數: { baseline: '0.785', effective: '99' },
        厚度: { baseline: '1', effective: '1' },
        寬度: { baseline: '100', effective: '100' },
        長度: { baseline: '1000', effective: '1000' },
      },
      source: null,
      calculation: { candidate },
      origin: 'ai' as const,
      deleted: false,
    };
    const expected = { ...row, values: Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [header, { ...cell }])) };
    expected.values['總數'] = { baseline: '0.785', effective: '0.785' };
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([row]),
      expectedRows: normalizeSteelReviewLedgerRows([expected]),
      headers: Object.keys(row.values),
      operations: [{ type: 'update', rowId: row.rowId, changes: [{ header: '厚度', value: '2' }] }],
    });

    expect(result).toMatchObject({
      ok: false,
      conflicts: [{ kind: 'field', rowId: 'row-1', header: '總數', expected: '0.785', current: '99', requested: '1.57' }],
    });
  });

  it('accepts server-owned relation state only in persisted rows and applies binding intents', () => {
    const material = {
      rowId: 'material-1',
      values: { Category: { baseline: '材', effective: '材' } },
      source: null,
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    const processing = {
      rowId: 'processing-1',
      values: { Category: { baseline: '加工/切割', effective: '加工/切割' } },
      source: null,
      system: { kind: 'processing' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    expect(steelReviewOperationSchema.safeParse({
      type: 'add',
      rowId: 'processing-2',
      position: { kind: 'end' },
      changes: [{ header: 'Category', value: '加工/鑽孔' }],
      system: { kind: 'processing', parentRowId: material.rowId },
    }).success).toBe(true);
    expect(steelReviewOperationSchema.safeParse({
      type: 'classify',
      rowId: 'processing-1',
      system: { kind: 'processing', parentRowId: material.rowId, cascadeDeletedBy: null },
    }).success).toBe(false);
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([material, processing]),
      expectedRows: normalizeSteelReviewLedgerRows([material, processing]),
      headers: ['Category'],
      operations: [{
        type: 'update',
        rowId: processing.rowId,
        binding: { parentRowId: material.rowId },
      }],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.currentRows.find((row) => row.rowId === processing.rowId)?.system).toEqual({
        kind: 'processing',
        parentRowId: material.rowId,
        cascadeDeletedBy: null,
      });
    }
  });

  it('clears obsolete cascade provenance when a restored child binds to another material', () => {
    const materialA = {
      rowId: 'material-a',
      values: { Category: { baseline: '材料A', effective: '材料A' } },
      source: null,
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: true,
    };
    const materialB = {
      rowId: 'material-b',
      values: { Category: { baseline: '材料B', effective: '材料B' } },
      source: null,
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    const processing = {
      rowId: 'processing-1',
      values: { Category: { baseline: '加工', effective: '加工' } },
      source: null,
      system: { kind: 'processing' as const, parentRowId: materialA.rowId, cascadeDeletedBy: materialA.rowId },
      origin: 'ai' as const,
      deleted: true,
    };
    const currentRows = normalizeSteelReviewLedgerRows([materialA, materialB, processing]);
    const restored = applySteelReviewOperations({
      currentRows,
      expectedRows: normalizeSteelReviewLedgerRows([materialA, materialB, processing]),
      headers: ['Category'],
      operations: [
        { type: 'restore', rowId: processing.rowId },
        { type: 'update', rowId: processing.rowId, binding: { parentRowId: materialB.rowId } },
      ],
    });
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    const rebound = restored.currentRows.find((row) => row.rowId === processing.rowId);
    const expectedRebound = restored.expectedRows.find((row) => row.rowId === processing.rowId);
    expect(rebound).toMatchObject({
      deleted: false,
      system: { kind: 'processing', parentRowId: materialB.rowId, cascadeDeletedBy: null },
    });
    expect(expectedRebound).toMatchObject({
      deleted: false,
      system: { kind: 'processing', parentRowId: materialB.rowId, cascadeDeletedBy: null },
    });

    const deleted = applySteelReviewOperations({
      currentRows: restored.currentRows,
      expectedRows: restored.expectedRows,
      headers: ['Category'],
      operations: [{ type: 'delete', rowId: processing.rowId }],
    });
    expect(deleted).toMatchObject({ ok: true });
    if (!deleted.ok) return;
    const restoredAgain = applySteelReviewOperations({
      currentRows: deleted.currentRows,
      expectedRows: deleted.expectedRows,
      headers: ['Category'],
      operations: [{ type: 'restore', rowId: processing.rowId }],
    });
    expect(restoredAgain).toMatchObject({ ok: true });
    if (restoredAgain.ok) {
      expect(restoredAgain.currentRows.find((row) => row.rowId === processing.rowId)).toMatchObject({
        deleted: false,
        system: { kind: 'processing', parentRowId: materialB.rowId, cascadeDeletedBy: null },
      });
      expect(restoredAgain.expectedRows.find((row) => row.rowId === processing.rowId)).toMatchObject({
        deleted: false,
        system: { kind: 'processing', parentRowId: materialB.rowId, cascadeDeletedBy: null },
      });
    }
  });

  it('stages a new material for a following binding operation', () => {
    const processing = {
      rowId: 'processing-1',
      values: { Category: { baseline: '加工/切割', effective: '加工/切割' } },
      source: null,
      system: { kind: 'processing' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([processing]),
      expectedRows: normalizeSteelReviewLedgerRows([processing]),
      headers: ['Category'],
      operations: [
        {
          type: 'add',
          rowId: 'material-new',
          position: { kind: 'end' },
          changes: [{ header: 'Category', value: '材料' }],
          system: { kind: 'material', parentRowId: null },
        },
        {
          type: 'update',
          rowId: processing.rowId,
          binding: { parentRowId: 'material-new' },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.currentRows.find((row) => row.rowId === processing.rowId)?.system).toMatchObject({
        kind: 'processing',
        parentRowId: 'material-new',
      });
    }
  });

  it('stages a new material for a following unassigned classification', () => {
    const unassigned = {
      rowId: 'unassigned-1',
      values: { Category: { baseline: null, effective: '' } },
      source: null,
      system: { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([unassigned]),
      expectedRows: normalizeSteelReviewLedgerRows([unassigned]),
      headers: ['Category'],
      operations: [
        {
          type: 'add',
          rowId: 'material-new',
          position: { kind: 'end' },
          changes: [{ header: 'Category', value: '材料' }],
          system: { kind: 'material', parentRowId: null },
        },
        {
          type: 'classify',
          rowId: unassigned.rowId,
          system: { kind: 'processing', parentRowId: 'material-new' },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.currentRows.find((row) => row.rowId === unassigned.rowId)?.system).toMatchObject({
        kind: 'processing',
        parentRowId: 'material-new',
      });
    }
  });

  it('allows a classification, business update and delete in one normal operation chain', () => {
    const row = {
      rowId: 'unassigned-1',
      values: {
        Category: { baseline: '', effective: '' },
        Price: { baseline: '10', effective: '10' },
      },
      source: null,
      system: { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    const result = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([row]),
      expectedRows: normalizeSteelReviewLedgerRows([row]),
      headers: ['Category', 'Price'],
      operations: [
        { type: 'classify', rowId: row.rowId, system: { kind: 'material', parentRowId: null } },
        { type: 'update', rowId: row.rowId, changes: [{ header: 'Price', value: '7' }] },
        { type: 'delete', rowId: row.rowId },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.currentRows.find((entry) => entry.rowId === row.rowId)).toMatchObject({
        deleted: true,
        system: { kind: 'material', parentRowId: null },
        values: { Price: { effective: '7' } },
      });
    }
  });

  it('treats a concurrent same-value classification as a no-op and conflicts on a different relation', () => {
    const expected = {
      rowId: 'unassigned-1',
      values: { Category: { baseline: '', effective: '' } },
      source: null,
      system: { kind: 'unassigned' as const, parentRowId: null, cascadeDeletedBy: null },
      origin: 'ai' as const,
      deleted: false,
    };
    const current = {
      ...expected,
      system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
    };
    const same = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([current]),
      expectedRows: normalizeSteelReviewLedgerRows([expected]),
      headers: ['Category'],
      operations: [{ type: 'classify', rowId: expected.rowId, system: { kind: 'material', parentRowId: null } }],
    });
    expect(same).toMatchObject({ ok: true });
    if (same.ok) {
      expect(same.currentRows).toEqual(normalizeSteelReviewLedgerRows([current]));
    }

    const different = applySteelReviewOperations({
      currentRows: normalizeSteelReviewLedgerRows([current]),
      expectedRows: normalizeSteelReviewLedgerRows([expected]),
      headers: ['Category'],
      operations: [{ type: 'classify', rowId: expected.rowId, system: { kind: 'processing', parentRowId: 'material-2' } }],
    });
    expect(different).toMatchObject({
      ok: false,
      conflicts: [{ kind: 'binding', rowId: expected.rowId, expected: null, current: null, requested: 'material-2' }],
    });
  });

  it('cascades material deletion and restores only its own processing tombstones', () => {
    const row = (rowId: string, system: SteelReviewLedgerRow['system'], deleted = false) => ({
      rowId,
      values: { Category: { baseline: rowId, effective: rowId } },
      source: null,
      system,
      origin: 'ai' as const,
      deleted,
    });
    const material = row('material-1', { kind: 'material', parentRowId: null, cascadeDeletedBy: null });
    const child = row('processing-1', { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null });
    const priorTombstone = row('processing-2', { kind: 'processing', parentRowId: 'material-1', cascadeDeletedBy: null }, true);
    const deleted = applySteelReviewOperations({
      currentRows: [material, child, priorTombstone],
      expectedRows: [material, child, priorTombstone],
      headers: ['Category'],
      operations: [{ type: 'delete', rowId: material.rowId }],
    });
    expect(deleted).toMatchObject({ ok: true });
    if (!deleted.ok) return;
    const deletedChild = deleted.currentRows.find((entry) => entry.rowId === child.rowId);
    expect(deletedChild).toMatchObject({ deleted: true, system: { cascadeDeletedBy: material.rowId } });
    const restored = applySteelReviewOperations({
      currentRows: deleted.currentRows,
      expectedRows: deleted.expectedRows,
      headers: ['Category'],
      operations: [{ type: 'restore', rowId: material.rowId }],
    });
    expect(restored).toMatchObject({ ok: true });
    if (restored.ok) {
      expect(restored.currentRows.find((entry) => entry.rowId === child.rowId)).toMatchObject({ deleted: false });
      expect(restored.currentRows.find((entry) => entry.rowId === priorTombstone.rowId)).toMatchObject({ deleted: true });
    }
  });

  it('allocates boundary ordinals across saved tombstones and same-request additions', () => {
    const row = (rowId: string, insertion: { kind: 'start' | 'end'; ordinal: number }, deleted = false) => ({
      rowId,
      values: { Value: { baseline: null, effective: null } },
      source: null,
      origin: 'manual' as const,
      deleted,
      insertion,
    });
    const result = applySteelReviewOperations({
      currentRows: [row('saved-start', { kind: 'start', ordinal: 0 }, true), row('saved-end', { kind: 'end', ordinal: 0 }, true)],
      expectedRows: [row('saved-start', { kind: 'start', ordinal: 0 }, true), row('saved-end', { kind: 'end', ordinal: 0 }, true)],
      headers: ['Value'],
      operations: [
        { type: 'add', rowId: 'new-start', position: { kind: 'start' }, changes: [{ header: 'Value', value: 'start' }] },
        { type: 'add', rowId: 'new-end', position: { kind: 'end' }, changes: [{ header: 'Value', value: 'end' }] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentRows.find((row) => row.rowId === 'new-start')?.insertion).toEqual({ kind: 'start', ordinal: 1 });
      expect(result.currentRows.find((row) => row.rowId === 'new-end')?.insertion).toEqual({ kind: 'end', ordinal: 1 });
    }
  });

  it('does not stamp calculation provenance for a same-value cell intent', () => {
    const row: SteelReviewLedgerRow = {
      rowId: 'row-1',
      values: { 長度: { baseline: '100', effective: '100' } },
      source: null,
      origin: 'ai',
      deleted: false,
      calculation: { fields: { 長度: { kind: 'manual' } } },
    };
    const expected = normalizeSteelReviewLedgerRows([row]);
    const result = applySteelReviewOperations({
      currentRows: expected,
      expectedRows: normalizeSteelReviewLedgerRows([row]),
      headers: ['長度'],
      operations: [{ type: 'update', rowId: row.rowId, changes: [{ header: '長度', value: '100' }] }],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.currentRows).toEqual(expected);
  });

  it('keeps a same-value manual reassertion after an earlier dependency change', () => {
    const row: SteelReviewLedgerRow = {
      rowId: 'row-1',
      values: {
        單位: { baseline: 'kg', effective: 'kg' },
        數量: { baseline: '2', effective: '2' },
        單重: { baseline: '0.942', effective: '0.942' },
        總數: { baseline: '1.884', effective: '1.884' },
      },
      source: null,
      origin: 'ai',
      deleted: false,
    };
    const expected = normalizeSteelReviewLedgerRows([row]);
    const result = applySteelReviewOperations({
      currentRows: expected,
      expectedRows: normalizeSteelReviewLedgerRows([row]),
      headers: Object.keys(row.values),
      operations: [{
        type: 'update',
        rowId: row.rowId,
        changes: [
          { header: '數量', value: '3' },
          { header: '總數', value: '2.826' },
        ],
      }],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.currentRows[0]?.values['總數']?.effective).toBe('2.826');
      expect(result.currentRows[0]?.calculation?.fields?.['總數']).toEqual({ kind: 'manual' });
    }
  });
});
