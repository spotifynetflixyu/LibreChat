import type { SteelReviewOcrContext, SteelReviewRow } from 'librechat-data-provider';
import type { SteelReviewReadRecord } from '@librechat/data-schemas';
import { createSteelReviewService } from './review';

const scope = {
  userId: 'review-owner',
  conversationId: 'review-conversation',
  messageId: 'system-message',
  title: 'system_order',
  kind: 'system_order' as const,
};
const headers = ['品名規格', '總數', '單價', '類別', '備註'];
const markdown = [
  '## system_order',
  '',
  '| 品名規格 | 總數 | 單價 | 類別 | 備註 |',
  '| --- | --- | --- | --- | --- |',
  '| Steel plate | 10 | 20 | 鐵板 | D3 |',
].join('\n');
const source = { fileId: 'drawing-file', pageNumber: 1, filename: 'PL.pdf', mediaType: 'application/pdf' };
const ocrContext: SteelReviewOcrContext = {
  title: 'ocr_result',
  outputId: 'ocr-output',
  revision: 'ocr-human-v3',
  headers: ['零件編號', '來源', '頁碼'],
  rows: [{
    rowId: 'ocr-d3',
    values: {
      零件編號: { baseline: 'D3', effective: 'D3' },
      來源: { baseline: 'F1', effective: 'F1' },
      頁碼: { baseline: '1', effective: '1' },
    },
    source,
  }],
};
const row: SteelReviewRow = {
  rowId: 'system-d3',
  values: Object.fromEntries(headers.map((header, index) => {
    const value = ['Steel plate', '10', '20', '鐵板', 'D3'][index] ?? '';
    return [header, { baseline: value, effective: value }];
  })),
  source,
  system: { kind: 'material', parentRowId: null, cascadeDeletedBy: null },
  ocrLink: { outputId: ocrContext.outputId, revision: ocrContext.revision, rowId: 'ocr-d3' },
};

function makeRecord(): SteelReviewReadRecord {
  return {
    ...scope,
    tableId: 'system-storage-id',
    outputId: 'system_order:quotation-run',
    latestOutputId: 'system_order:quotation-run',
    revision: 'quotation-run',
    state: 'current',
    headers,
    rows: [row],
    markdown,
    messageText: markdown,
    ocrContext,
    sourceMappings: [{ fileId: source.fileId, sourceCode: 'F1', sourceFilename: source.filename, mediaType: source.mediaType }],
  };
}

describe('Steel system review OCR transport', () => {
  it('returns the stored OCR revision and row binding without reselecting an OCR owner', async () => {
    const readSteelReview = jest.fn(async () => makeRecord());
    const service = createSteelReviewService({ reader: { readSteelReview } });

    const response = await service.read(scope);

    expect(response.table.ocrContext).toEqual(ocrContext);
    expect(response.table.rows[0].ocrLink).toEqual(row.ocrLink);
    expect(readSteelReview).toHaveBeenCalledTimes(1);
  });

  it('rejects client-supplied OCR binding metadata before reading the trusted record', async () => {
    const readSteelReview = jest.fn(async () => makeRecord());
    const service = createSteelReviewService({ reader: { readSteelReview } });

    await expect(service.prepare({
      ...scope,
      outputId: 'system_order:quotation-run',
      revision: 'quotation-run',
      operations: [{
        type: 'update',
        rowId: row.rowId,
        changes: [{ header: '備註', value: 'S3' }],
        ocrLink: { outputId: 'foreign-output', revision: 'foreign-revision', rowId: 'foreign-row' },
      }],
    } as never)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY', statusCode: 400 });
    expect(readSteelReview).not.toHaveBeenCalled();
  });

  it('preserves the stored row link when an unrelated value changes', async () => {
    const service = createSteelReviewService({ reader: { readSteelReview: async () => makeRecord() } });

    const prepared = await service.prepare({
      ...scope,
      outputId: 'system_order:quotation-run',
      revision: 'quotation-run',
      operations: [{ type: 'update', rowId: row.rowId, changes: [{ header: '單價', value: '21' }] }],
    });

    expect(prepared.rows[0].ocrLink).toEqual(row.ocrLink);
    expect(prepared.rows[0].source).toEqual(source);
    expect(prepared.rows[0].values['單價'].effective).toBe('21');
  });

  it('clears a stale OCR link when the part number changes to an unmatched value', async () => {
    const service = createSteelReviewService({ reader: { readSteelReview: async () => makeRecord() } });

    const prepared = await service.prepare({
      ...scope,
      outputId: 'system_order:quotation-run',
      revision: 'quotation-run',
      operations: [{ type: 'update', rowId: row.rowId, changes: [{ header: '備註', value: 'unmatched-part' }] }],
    });

    expect(prepared.rows[0].ocrLink).toBeNull();
    expect(prepared.rows[0].values['備註'].effective).toBe('unmatched-part');
  });

  it('derives a trusted OCR link when an unlinked row is manually assigned its source page', async () => {
    const record = makeRecord();
    record.rows = [{ ...row, source: null, ocrLink: null }];
    const service = createSteelReviewService({
      reader: { readSteelReview: async () => record },
      sourceAuthority: {
        readMetadata: async () => ({ ...source, pageCount: 3 }),
        readPageCount: async () => ({ pageCount: 3 }),
      },
    });

    const prepared = await service.prepare({
      ...scope,
      outputId: 'system_order:quotation-run',
      revision: 'quotation-run',
      operations: [{ type: 'update', rowId: row.rowId, source: { fileId: source.fileId, pageNumber: 1 } }],
    });

    expect(prepared.rows[0].source).toEqual(source);
    expect(prepared.rows[0].ocrLink).toEqual(row.ocrLink);
  });

  it('clears the OCR link when a manually selected page has no matching part', async () => {
    const service = createSteelReviewService({
      reader: { readSteelReview: async () => makeRecord() },
      sourceAuthority: {
        readMetadata: async () => ({ ...source, pageCount: 3 }),
        readPageCount: async () => ({ pageCount: 3 }),
      },
    });

    const prepared = await service.prepare({
      ...scope,
      outputId: 'system_order:quotation-run',
      revision: 'quotation-run',
      operations: [{ type: 'update', rowId: row.rowId, source: { fileId: source.fileId, pageNumber: 2 } }],
    });

    expect(prepared.rows[0].source?.pageNumber).toBe(2);
    expect(prepared.rows[0].ocrLink).toBeNull();
  });
});
