import {
  isSteelReviewSourceAssociationHeader,
  steelReviewReadQuerySchema,
  steelReviewResponseSchema,
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
});
