import { createHash } from 'node:crypto';
import {
  encodeSteelReviewDigest,
  isSteelReviewSourceAssociationHeader,
  normalizeSteelReviewEffectiveValue,
  normalizeSteelReviewRows,
  sameSteelReviewSource,
  steelReviewReadQuerySchema,
  steelReviewResponseSchema,
  steelReviewPreparedSchema,
  steelReviewPrepareSchema,
} from './review';

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
        tableId: 'ocr_result:message-1:4',
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
        tableId: 'table-1',
      }),
    ).toThrow();
  });

  it('accepts a concrete rendered content part owner', () => {
    expect(steelReviewReadQuerySchema.parse({
      messageId: 'message-1',
      tableId: 'ocr_result:2',
      partIndex: '3',
    }).partIndex).toBe(3);
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

  it('encodes scope, target, and row changes distinctly with stable null defaults', () => {
    const base = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
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
      target: { ...base.target, start: 2 },
    })).not.toBe(withoutTenant);
    expect(encodeSteelReviewDigest({
      ...base,
      rows: [{ ...base.rows[0], values: { Value: { baseline: '2', effective: '8' } } }],
    })).not.toBe(withoutTenant);
  });

  it('preserves the exact 03 digest shape when both new source fields are absent', () => {
    const legacy = {
      userId: 'legacy-fixture-user',
      conversationId: 'legacy-fixture-chat',
      kind: 'ocr_result' as const,
      messageId: 'legacy-fixture-message',
      tableId: 'ocr_result:1',
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
    expect(createHash('sha256').update(encodeSteelReviewDigest(legacy)).digest('hex')).toBe(
      '530790f7a97b4b48f1a6f6a0a86ea71f5ace91cc8d52714d0a00d39f8112d2eb',
    );
    expect(encodeSteelReviewDigest({ ...legacy, sourceMappings: [] })).not.toBe(
      encodeSteelReviewDigest(legacy),
    );
    expect(encodeSteelReviewDigest({ ...legacy, sourceIntents: [] })).not.toBe(
      encodeSteelReviewDigest(legacy),
    );
    expect(() => encodeSteelReviewDigest({ ...legacy, sourceMappings: null as never })).toThrow();
    expect(() => encodeSteelReviewDigest({ ...legacy, sourceMappings: undefined })).toThrow();
  });

  it('rejects present undefined or null source intents while accepting an explicit empty array', () => {
    const base = {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      kind: 'ocr_result' as const,
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows: [{
        rowId: 'row-1',
        values: { Value: { baseline: '1', effective: '1' } },
        source: null,
      }],
    };
    expect(steelReviewPrepareSchema.safeParse({ ...base, sourceIntents: undefined }).success).toBe(false);
    expect(steelReviewPrepareSchema.safeParse({ ...base, sourceIntents: null }).success).toBe(false);
    expect(steelReviewPrepareSchema.safeParse({ ...base, sourceIntents: [] }).success).toBe(true);
    expect(steelReviewPrepareSchema.safeParse(base).success).toBe(true);
    const prepared = { ...base,
      operationId: 'operation-1',
      digest: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      target: { start: 0, end: 1, sha256: 'c'.repeat(64) },
      replacementText: 'new',
      cleanReplacementText: 'new',
      targetText: 'old',
      headers: ['Value'],
      effectiveMarkdown: 'table',
      displayMarkdown: 'table',
      caption: { kind: 'ocr_result' as const, changedRows: 0, changedRowIds: [] },
    };
    expect(steelReviewPreparedSchema.safeParse({ ...prepared, sourceMappings: undefined }).success).toBe(false);
    expect(steelReviewPreparedSchema.safeParse({ ...prepared, sourceMappings: null }).success).toBe(false);
    expect(steelReviewPreparedSchema.safeParse({ ...prepared, sourceMappings: [] }).success).toBe(true);
  });
});
