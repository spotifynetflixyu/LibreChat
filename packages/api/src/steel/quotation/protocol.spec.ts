import {
  buildQuotationChunks,
  extractCustomerDataTable,
  finalizeQuotationMainResponse,
  parseQuotationSignal,
  validateQuotationChildResult,
} from './protocol';

import type {
  QuotationChunk,
  QuotationChildResultInput,
  QuotationLookupEvidence,
  QuotationPythonEvidence,
} from './protocol';
import type { SteelToolJsonObject, SteelToolJsonValue } from '../tools/results';

const columns = ['來源', '零件編號', '類別', '數量', '厚度', '寬度', '長度'];
const systemColumns = [
  '型號',
  '品名規格',
  '材質編號',
  '單位',
  '數量',
  '單重',
  '總數',
  '單價',
  '計價基準',
  '公式編號',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '類別',
  '備註',
];

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function ocr(rows: readonly (readonly string[])[]): string {
  return `## ocr_result\n\n${table(columns, rows)}`;
}

function ocrWithHeaders(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return `## ocr_result\n\n${table(headers, rows)}`;
}

function evidence(
  callId: string,
  candidates: readonly SteelToolJsonObject[],
): QuotationLookupEvidence {
  const queryResult: SteelToolJsonObject = {
    queryId: 'q1',
    status: 'ok',
    candidates: candidates.map((entry) => entry as SteelToolJsonValue),
  };
  const data: SteelToolJsonObject = {
    queryResults: [queryResult],
  };
  return {
    lookupCallId: callId,
    persisted: true,
    result: {
      ok: true,
      toolName: 'search_price_candidates',
      data,
      durationMs: 1,
      redactionVersion: 1,
    },
  };
}

function evidenceWithQueries(
  callId: string,
  queryResults: readonly SteelToolJsonObject[],
): QuotationLookupEvidence {
  return {
    lookupCallId: callId,
    persisted: true,
    result: {
      ok: true,
      toolName: 'search_price_candidates',
      data: { queryResults: queryResults.map((entry) => entry as SteelToolJsonValue) },
      durationMs: 1,
      redactionVersion: 1,
    },
  };
}

function candidate(overrides: SteelToolJsonObject = {}): SteelToolJsonObject {
  return {
    erpItemCode: 'ERP-1',
    productName: '鐵板 6T',
    category: '鐵板',
    material: '黑鐵',
    unit: 'Kg',
    formulaCode: 'PL',
    thicknessMinMm: 6,
    thicknessMaxMm: 6,
    tierPrices: { A: 11, B: 12, C: 13, D: 14, E: 15, F: 16 },
    ...overrides,
  } as SteelToolJsonObject;
}

function chunkForOneRow(): QuotationChunk {
  return buildQuotationChunks(ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]))[0]!;
}

function child(
  chunk: QuotationChunk,
  row: readonly string[],
  callId: string,
  candidateIdentity: SteelToolJsonObject | null,
  lookupEvidence: readonly QuotationLookupEvidence[],
  pythonEvidence: readonly QuotationPythonEvidence[] = calculationEvidence(row),
  queryId?: string,
): QuotationChildResultInput {
  const lineage = JSON.stringify({
    version: 1,
    quote_lineage: {
      '1': {
        sourceRowId: chunk.sourceRows[0]!.sourceRowId,
        kind: 'material',
        lookupCallId: callId,
        ...(queryId ? { queryId } : {}),
        candidate: candidateIdentity,
      },
    },
  });
  return {
    chunk,
    response: `## system_order_chunk\n\n${table(systemColumns, [row])}\n\n\`\`\`json\n${lineage}\n\`\`\``,
    lookupEvidence,
    pythonEvidence,
  };
}

function calculationEvidence(row: readonly string[]): readonly QuotationPythonEvidence[] {
  const calculations: SteelToolJsonObject = {};
  if (row[5]) calculations.單重 = row[5]!;
  if (row[6]) calculations.總數 = row[6]!;
  if (Object.keys(calculations).length === 0) return [];
  return [{
    type: 'tool-result',
    toolCallId: 'python-1',
    payload: JSON.stringify({
      type: 'tool-result',
      toolCallId: 'python-1',
      toolName: 'code_interpreter',
      result: JSON.stringify({ quote_calculations: { '1': calculations } }),
    }),
  }];
}

describe('quotation protocol', () => {
  it('parses only one exact quote signal table', () => {
    expect(parseQuotationSignal('## quote_signal\n\n| index | token |\n| --- | --- |\n| 7 | run-7 |')).toEqual({
      index: 7,
      token: 'run-7',
    });
    expect(parseQuotationSignal('text ## quote_signal\n\n| index | token |\n| --- | --- |\n| 7 | run-7 |')).toBeUndefined();
    expect(parseQuotationSignal('## quote_signal\n\n| index | token |\n| --- | --- |\n| 7 | run-7 |\n| 8 | forged |')).toBeUndefined();
    expect(parseQuotationSignal('```markdown\n## quote_signal\n| index | token |\n| --- | --- |\n| 7 | run-7 |\n```')).toBeUndefined();
  });

  it('extracts the single rectangular customer_data table', () => {
    expect(extractCustomerDataTable('## customer_data｜selected\n\n| 客戶 | 等級 |\n| --- | --- |\n| A公司 | B |')).toEqual({
      headers: ['客戶', '等級'],
      rows: [['A公司', 'B']],
    });
    expect(extractCustomerDataTable('## customer_data\n\n| 客戶 | 等級 |\n| --- | --- |\n| A公司 | B |\n| A公司 |')).toBeUndefined();
  });

  it('groups by category, splits at thirty, and keeps stable source IDs outside visible rows', () => {
    const rows = Array.from({ length: 61 }, (_, index) => [
      'F1',
      `P${index + 1}`,
      index % 2 === 0 ? '鐵板' : 'H型鋼',
      '1',
      '6',
      '100',
      '200',
    ]);
    const chunks = buildQuotationChunks(ocr(rows));
    expect(chunks.map((chunk) => chunk.sourceRows.length)).toEqual([30, 1, 30]);
    expect(chunks.map((chunk) => chunk.category)).toEqual(['鐵板', '鐵板', 'H型鋼']);
    expect(chunks[0]!.sourceRows[0]!.sourceRowId).toBe('source-row-1');
    expect(chunks[1]!.sourceRows[0]!.sourceRowId).toBe('source-row-61');
    expect(chunks.flatMap((chunk) => chunk.sourceRows).map((source) => source.sourceRowIndex)).toEqual([
      ...Array.from({ length: 61 }, (_, index) => index).filter((index) => index % 2 === 0),
      ...Array.from({ length: 61 }, (_, index) => index).filter((index) => index % 2 === 1),
    ]);
    expect(chunks.every((chunk) => !chunk.markdown.includes('source-row-'))).toBe(true);
  });

  it('rejects a child row without persisted lookup evidence', () => {
    const chunk = chunkForOneRow();
    const row = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', ''];
    expect(() => validateQuotationChildResult(child(chunk, row, 'call-1', candidate(), []))).toThrow(
      'lookup evidence',
    );
  });

  it('keeps source dimensions bound when OCR uses millimetre header aliases', () => {
    const chunk = buildQuotationChunks(ocrWithHeaders(
      ['來源', '零件編號', '類別', '數量', '厚度(mm)', '寬度(mm)', '長度(mm)'],
      [['F1', 'P1', '鐵板', '2', '6', '100', '200']],
    ))[0]!;
    const row = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', ''];
    expect(validateQuotationChildResult(child(chunk, row, 'call-mm', candidate(), [evidence('call-mm', [candidate()])]))).toBeDefined();
    expect(() => validateQuotationChildResult(child(
      chunk,
      [...row.slice(0, 11), '101', ...row.slice(12)],
      'call-mm',
      candidate(),
      [evidence('call-mm', [candidate()])],
    ))).toThrow('quantity or dimensions');
  });

  it('rejects out-of-range selected candidates and treats only out-of-range results as no match', () => {
    const chunk = chunkForOneRow();
    const pricedRow = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', ''];
    const zeroBasedRange = candidate({ thicknessMinMm: 0, thicknessMaxMm: 6 });
    expect(validateQuotationChildResult(child(chunk, pricedRow, 'call-zero-range', zeroBasedRange, [evidence('call-zero-range', [zeroBasedRange])]))).toBeDefined();
    const outOfRange = candidate({ thicknessMinMm: 8, thicknessMaxMm: 8 });
    expect(() => validateQuotationChildResult(child(
      chunk,
      pricedRow,
      'call-range',
      candidate(),
      [evidence('call-range', [outOfRange])],
    ))).toThrow('no matching applicable lookup candidate');

    const noCandidateRow = ['', 'P1', '', '', '2', '', '', '', '2', '', '6', '100', '200', '', '鐵板', '厚度不在候選適用範圍，需確認'];
    const result = validateQuotationChildResult(child(
      chunk,
      noCandidateRow,
      'call-range-empty',
      null,
      [evidence('call-range-empty', [outOfRange])],
    ));
    expect(result.lineage[0]!.candidate).toBeNull();
  });

  it.each([true, false])('requires review for unknown thickness even without a note (header present: %s)', (hasHeader) => {
    const headers = ['來源', '零件編號', '類別', '數量', ...(hasHeader ? ['厚度(mm)'] : []), '寬度(mm)', '長度(mm)'];
    const fullOcrResult = ocrWithHeaders(headers, [['F1', 'P1', '鐵板', '2', ...(hasHeader ? [''] : []), '100', '200']]);
    const chunk = buildQuotationChunks(fullOcrResult)[0]!;
    const row = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '', '100', '200', '', '鐵板', ''];
    const childResult = child(chunk, row, 'call-unknown-thickness', candidate(), [evidence('call-unknown-thickness', [candidate()])]);
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult,
      mainResponse: `## system_order\n\n${table(systemColumns, [row])}`,
      childResults: [childResult],
    })).toThrow('manual_review coverage');
  });

  it('accepts zero candidates only with blank price and a concrete review note', () => {
    const chunk = chunkForOneRow();
    const row = ['', 'P1', '', '', '2', '', '', '', '2', '', '6', '100', '200', '', '鐵板', '無可用候選，需確認'];
    const result = validateQuotationChildResult(child(chunk, row, 'call-empty', null, [evidence('call-empty', [])]));
    expect(result.lineage[0]!.candidate).toBeNull();
  });

  it('scopes no-candidate decisions to the lineage query', () => {
    const chunk = chunkForOneRow();
    const row = ['', 'P1', '', '', '2', '', '', '', '2', '', '6', '100', '200', '', '鐵板', '無可用候選，需確認'];
    const mixedEvidence = [evidenceWithQueries('call-mixed', [
      { queryId: 'q1', status: 'ok', candidates: [candidate()] },
      { queryId: 'q2', status: 'ok', candidates: [] },
    ])];
    expect(validateQuotationChildResult(child(chunk, row, 'call-mixed', null, mixedEvidence, [], 'q2')).lineage[0]!.candidate).toBeNull();
    expect(() => validateQuotationChildResult(child(chunk, row, 'call-mixed', null, mixedEvidence))).toThrow('requires queryId');
  });

  it('requires actual Python result evidence for calculated cells and rejects tampering', () => {
    const chunk = chunkForOneRow();
    const row = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', ''];
    const lookup = [evidence('call-python', [candidate()])];
    expect(() => validateQuotationChildResult(child(
      chunk,
      row,
      'call-python',
      candidate(),
      lookup,
      [{ type: 'tool-call', toolCallId: 'python-1', payload: '{}' }],
    ))).toThrow('tool-result evidence');
    const tampered: QuotationPythonEvidence = {
      type: 'tool-result',
      toolCallId: 'python-1',
      payload: JSON.stringify({ quote_calculations: { '1': { 總數: '999' } } }),
    };
    expect(() => validateQuotationChildResult(child(
      chunk,
      row,
      'call-python',
      candidate(),
      lookup,
      [tampered],
    ))).toThrow('does not match row 1 總數');
  });

  it('rejects tampered or incomplete main rows and finalizes deterministic quote output', () => {
    const chunk = chunkForOneRow();
    const row = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', ''];
    const childResult = child(chunk, row, 'call-1', candidate(), [evidence('call-1', [candidate()])]);
    const validMain = [
      '## system_order',
      '',
      table(systemColumns, [row]),
      '',
      '## customer_quote',
      '',
      '| 假資料 |',
      '| --- |',
      '| 1 |',
      '',
      '查價輸出完成：共 99 筆 system_order，無待複核事項。',
      '',
      '```json',
      '{"quote_lineage":{"1":{"sourceRowId":"forged"}}}',
      '```',
    ].join('\n');
    const finalized = finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: validMain,
      childResults: [childResult],
    });
    expect(finalized.response.match(/## customer_quote/g)).toHaveLength(1);
    expect(finalized.response.match(/查價輸出完成：/g)).toHaveLength(1);
    expect(finalized.response).not.toContain('quote_lineage');
    expect(finalized.response).toContain('| 鐵板 6T P1 | 2 | 24 |');
    expect(finalized.summary).toBe('查價輸出完成：共 1 筆 system_order，無待複核事項。');

    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: validMain.replace('| 2 |  | 2 | 12 |', '| 3 |  | 2 | 12 |'),
      childResults: [childResult],
    })).toThrow('differs from accepted child rows');
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: validMain.replace(table(systemColumns, [row]), table(systemColumns, [])),
      childResults: [childResult],
    })).toThrow('system_order');
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: validMain.replace(table(systemColumns, [row]), table(systemColumns, [row, row])),
      childResults: [childResult],
    })).toThrow('differs from accepted child rows');
  });

  it('requires manual review coverage for a valid zero-candidate child row', () => {
    const chunk = chunkForOneRow();
    const row = ['', 'P1', '', '', '2', '', '', '', '2', '', '6', '100', '200', '', '鐵板', '無可用候選，需確認'];
    const childResult = child(chunk, row, 'call-empty', null, [evidence('call-empty', [])]);
    const system = table(systemColumns, [row]);
    const review = table(
      ['來源表格', '來源件號 / 項次', '問題欄位', '目前判斷', '需確認內容', '影響範圍'],
      [['F1', 'P1', '單價', '無可用候選', '確認材料價格', 'P1']],
    );
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: `## system_order\n\n${system}`,
      childResults: [childResult],
    })).toThrow('manual_review coverage');
    const unrelatedReview = review.replace('| F1 | P1 |', '| F1 | P2 |');
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: `## system_order\n\n${system}\n\n## manual_review\n\n${unrelatedReview}`,
      childResults: [childResult],
    })).toThrow('manual_review coverage');
    const finalized = finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: `## system_order\n\n${system}\n\n## manual_review\n\n${review}\n\n## notes\n\n保留的核對說明`,
      childResults: [childResult],
    });
    expect(finalized.summary).toBe('查價輸出完成：共 1 筆 system_order、1 項待複核事項。');
    expect(finalized.response.indexOf('## notes')).toBeLessThan(finalized.response.indexOf('## manual_review'));
  });
});
