import {
  buildQuotationSystemOrder,
  buildQuotationChunks,
  buildQuotationFailureMarkdown,
  extractCustomerDataTable,
  finalizeQuotationMainResponse,
  parseQuotationSignal,
  restoreQuotationChunks,
  splitQuotationChunk,
  mergeQuotationChildResults,
  validateQuotationChildResult,
} from './protocol';

import type { QuotationChildResultInput, QuotationChunk, QuotationLookupEvidence } from './protocol';
import type { SteelToolResult } from '../tools/results';
import { parseMarkdownTables } from '../markdown/table';

const ocrHeaders = ['來源', '零件編號', '類別', '數量', '厚度', '寬度', '長度'];
const systemHeaders = [
  '型號', '品名規格', '材質編號', '單位', '數量', '單重', '總數', '單價',
  '計價基準', '公式編號', '厚度', '寬度', '長度', '肚', '類別', '備註',
];
const reviewHeaders = ['來源表格', '來源件號 / 項次', '問題欄位', '目前判斷', '需確認內容', '影響範圍'];

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function ocr(rows: readonly (readonly string[])[]): string {
  return `## ocr_result\n\n${table(ocrHeaders, rows)}`;
}

function ocrWithHeaders(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return `## ocr_result\n\n${table(headers, rows)}`;
}

function chunkForRows(rows: readonly (readonly string[])[] = [['F1', 'P1', '鐵板', '2', '6', '100', '200']]): QuotationChunk {
  return buildQuotationChunks(ocr(rows))[0]!;
}

function lookupEvidence(result: SteelToolResult, lookupCallId = 'lookup-1'): QuotationLookupEvidence {
  return { lookupCallId, persisted: true, result };
}

function successfulLookup(lookupCallId = 'lookup-1'): QuotationLookupEvidence {
  return lookupEvidence({
    ok: true,
    toolName: 'search_price_candidates',
    data: { queryResults: [{ queryId: 'q1', status: 'ok', candidates: [] }] },
    durationMs: 1,
    redactionVersion: 1,
  }, lookupCallId);
}

function failedLookup(lookupCallId = 'lookup-1'): QuotationLookupEvidence {
  return lookupEvidence({
    ok: false,
    toolName: 'search_price_candidates',
    errorCategory: 'repository_error',
    errorSummary: 'temporary lookup failure',
    durationMs: 1,
    redactionVersion: 1,
  }, lookupCallId);
}

function childInput(
  chunk: QuotationChunk,
  row: readonly string[],
  evidence: readonly QuotationLookupEvidence[] = [successfulLookup()],
): QuotationChildResultInput {
  return {
    chunk,
    response: `## system_order_chunk\n\n${table(systemHeaders, [row])}`,
    lookupEvidence: evidence,
  };
}

function removeTrailingPipes(markdown: string): string {
  return markdown.split('\n').map((line) => {
    const trimmed = line.trimEnd();
    return trimmed.startsWith('|') && trimmed.endsWith('|')
      ? trimmed.slice(0, -1)
      : line;
  }).join('\n');
}

const pricedRow = ['ERP-1', '鐵板 6T P1', '黑鐵', 'Kg', '2', '', '2', '12', '2', 'PL', '6', '100', '200', '', '鐵板', ''];
const blankRow = ['', '鐵板 P1', '', '', '2', '', '', '', '2', '', '6', '100', '200', '', '鐵板', '查無候選，需確認'];

function rowsForChunk(chunk: QuotationChunk): readonly (readonly string[])[] {
  return chunk.sourceRows.map((source) => {
    const row = [...pricedRow];
    row[1] = `${source.cells[2]} ${source.cells[1]}`;
    row[4] = source.cells[3] ?? '';
    row[10] = source.cells[4] ?? '';
    row[11] = source.cells[5] ?? '';
    row[12] = source.cells[6] ?? '';
    row[14] = source.cells[2] ?? '';
    return row;
  });
}

describe('quotation protocol', () => {
  it('splits recovery source rows exactly once and merges complete material, processing and review tables', () => {
    const parent = chunkForRows(Array.from({ length: 23 }, (_, index) =>
      ['F1', `P${index + 1}`, '鐵板', '2', '6', '100', '200']));
    const slices = splitQuotationChunk(parent);
    expect(slices.map((slice) => slice.sourceRows.length)).toEqual([10, 10, 3]);
    expect(slices.flatMap((slice) => slice.sourceRows)).toEqual(parent.sourceRows);
    const children = slices.map((chunk) => ({
      ...childInput(chunk, rowsForChunk(chunk)[0]!),
      response: `## system_order_chunk\n\n${table(systemHeaders, rowsForChunk(chunk))}\n\n## manual_reviews_chunk\n\n${table(reviewHeaders, [
        ['ocr_result', chunk.sourceRows[0]!.cells[1]!, '單價', '', '需確認', '報價'],
      ])}`,
    }));
    const merged = mergeQuotationChildResults(parent, children);
    expect(merged.match(/## system_order_chunk/g)).toHaveLength(1);
    expect(merged.match(/## manual_reviews_chunk/g)).toHaveLength(1);
    expect(validateQuotationChildResult({ ...childInput(parent, rowsForChunk(parent)[0]!), response: merged }).rows).toHaveLength(23);
    expect(merged.indexOf('P1 |')).toBeLessThan(merged.indexOf('P11 |'));
    expect(merged.indexOf('P11 |')).toBeLessThan(merged.indexOf('P21 |'));
    expect(() => mergeQuotationChildResults(parent, children.slice(1))).toThrow('source');
    expect(() => mergeQuotationChildResults(parent, [children[0]!, ...children])).toThrow('source');
    expect(() => mergeQuotationChildResults(parent, [...children].reverse())).toThrow('source');
    expect(() => mergeQuotationChildResults(parent, [
      ...children.slice(0, -1), { ...children[2]!, response: `${children[2]!.response}\n| unfinished` },
    ])).toThrow('incomplete Markdown row');
  });

  it('parses only the fixed standalone quotation start signal', () => {
    expect(parseQuotationSignal('## quote_signal\n\nstart')).toEqual({ action: 'start' });
    for (const text of [
      'text ## quote_signal\n\nstart',
      '## quote_signal\n\nstart now',
      '## quote_signal\n\nstart\n\n## quote_signal\n\nstart',
      '## quote_signal\n\n| index | token |\n| --- | --- |\n| 7 | run-7 |',
      '```markdown\n## quote_signal\n\nstart\n```',
    ]) expect(parseQuotationSignal(text)).toBeUndefined();
  });

  it('extracts the single rectangular customer_data table', () => {
    expect(extractCustomerDataTable('## customer_data｜selected\n\n| 客戶 | 等級 |\n| --- | --- |\n| A公司 | B |')).toEqual({ headers: ['客戶', '等級'], rows: [['A公司', 'B']] });
    expect(extractCustomerDataTable('## customer_data\n\n| 客戶 | 等級 |\n| --- | --- |\n| A公司 | B |\n| A公司 |')).toBeUndefined();
  });

  it('groups categories into chunks while keeping source identity in backend state', () => {
    const rows = Array.from({ length: 62 }, (_, index) => ['F1', `P${index + 1}`, index % 2 === 0 ? '鐵板' : 'H型鋼', '1', '6', '100', '200']);
    const chunks = buildQuotationChunks(ocr(rows), 30);
    expect(chunks.map((chunk) => chunk.sourceRows.length)).toEqual([30, 1, 30, 1]);
    expect(chunks.map((chunk) => chunk.category)).toEqual(['鐵板', '鐵板', 'H型鋼', 'H型鋼']);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([1, 2, 3, 4]);
    expect(chunks.every((chunk) => chunk.chunkCount === 4)).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.sourceRows.map((row) => row.cells[1]))).toEqual([
      ...Array.from({ length: 31 }, (_, index) => `P${index * 2 + 1}`),
      ...Array.from({ length: 31 }, (_, index) => `P${index * 2 + 2}`),
    ]);
    expect(chunks[0]!.sourceRows[0]!.sourceRowId).toBe('source-row-1');
    expect(chunks[1]!.sourceRows[0]!.sourceRowId).toBe('source-row-61');
    expect(chunks.every((chunk) => !chunk.markdown.includes('source-row-'))).toBe(true);
  });

  it('uses 24 source rows per default chunk and supports exact saved-root restoration', () => {
    const rows = Array.from({ length: 49 }, (_, index) => ['F1', `P${index + 1}`, '鐵板', '1', '6', '100', '200']);
    const chunks = buildQuotationChunks(ocr(rows));
    expect(chunks.map((chunk) => chunk.sourceRows.length)).toEqual([24, 24, 1]);
    expect(chunks.map((chunk) => chunk.chunkCount)).toEqual([3, 3, 3]);

    const categoryRows = Array.from({ length: 62 }, (_, index) => ['F1', `P${index + 1}`, index % 2 === 0 ? '鐵板' : 'H型鋼', '1', '6', '100', '200']);
    const snapshot = ocr(categoryRows);
    const restored = restoreQuotationChunks(snapshot, [
      { index: 1, sourceRowCount: 30 },
      { index: 2, sourceRowCount: 1 },
      { index: 3, sourceRowCount: 30 },
      { index: 4, sourceRowCount: 1 },
    ]);
    expect(restored.map((chunk) => chunk.sourceRows.length)).toEqual([30, 1, 30, 1]);
    expect(restored.flatMap((chunk) => chunk.sourceRows.map((row) => row.sourceRowId)))
      .toEqual(buildQuotationChunks(snapshot, 30).flatMap((chunk) => chunk.sourceRows.map((row) => row.sourceRowId)));
    expect(restored.map((chunk) => chunk.category)).toEqual(['鐵板', '鐵板', 'H型鋼', 'H型鋼']);
    expect(() => restoreQuotationChunks(snapshot, [
      { index: 1, sourceRowCount: 30 },
      { index: 2, sourceRowCount: 2 },
      { index: 3, sourceRowCount: 29 },
      { index: 4, sourceRowCount: 1 },
    ])).toThrow('category boundary');
    expect(() => restoreQuotationChunks(snapshot, [
      { index: 1, sourceRowCount: 30 },
      { index: 3, sourceRowCount: 1 },
    ])).toThrow('contiguous');
  });

  it('splits a recovered root at each requested slice size', () => {
    const parent = chunkForRows(Array.from({ length: 23 }, (_, index) =>
      ['F1', `P${index + 1}`, '鐵板', '2', '6', '100', '200']));
    expect(splitQuotationChunk(parent, 12).map((chunk) => chunk.sourceRows.length)).toEqual([12, 11]);
    expect(splitQuotationChunk(parent, 6).map((chunk) => chunk.sourceRows.length)).toEqual([6, 6, 6, 5]);
    expect(splitQuotationChunk(parent, 3).map((chunk) => chunk.sourceRows.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 2]);
    expect(() => splitQuotationChunk(parent, 0)).toThrow('rowsPerSlice');
  });

  it('accepts a Markdown-only child with a structured failed lookup as a reviewable no-data row', () => {
    const result = validateQuotationChildResult(childInput(chunkForRows(), blankRow, [failedLookup()]));
    expect(result.rows).toEqual([blankRow]);
    expect(result.markdown).toBe(`## system_order_chunk\n\n${table(systemHeaders, [blankRow])}`);
  });

  it('accepts a priced child without candidate or Python evidence because those are AI-owned decisions', () => {
    expect(validateQuotationChildResult(childInput(chunkForRows(), pricedRow))).toEqual(expect.objectContaining({ rows: [pricedRow] }));
  });

  it('builds and accepts the deterministic OCR fallback with canonical alias precedence', () => {
    const headers = ['來源', '零件編號', '類別', '品名規格', '品名／規格', '品名', '規格', '數量', '厚度(mm)', '厚度', '寬度(mm)', '長度(mm)', '頁碼', '加工需求'];
    const source = ocrWithHeaders(headers, [['F-01', 'P-01', '鐵板', 'canonical', 'historical', 'name', 'spec', '2', '6', '99', '100', '200', '7', '折彎']]);
    const chunk = buildQuotationChunks(source)[0]!;
    const backendFailure = { retryDepth: 3 as const, reason: 'all candidate lookups failed' };
    const fallback = buildQuotationFailureMarkdown(chunk, backendFailure.reason);
    const rows = parseMarkdownTables(fallback)[0]!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toBe('canonical');
    expect(rows[0]![4]).toBe('2');
    expect(rows[0]![10]).toBe('99');
    expect(rows[0]![11]).toBe('100');
    expect(rows[0]![12]).toBe('200');
    expect(rows[0]![0]).toBe('');
    expect(rows[0]![2]).toBe('');
    expect(rows[0]![7]).toBe('');
    expect(rows[0]![15]).toContain('來源=F-01');
    expect(rows[0]![15]).toContain('頁碼=7');
    expect(rows[0]![15]).toContain('零件編號=P-01');
    expect(rows[0]![15]).toContain('加工需求=折彎');
    expect(rows[0]![15]).toContain('重試3次');
    expect(rows[0]![15]).toContain(backendFailure.reason);
    expect(validateQuotationChildResult({
      chunk,
      response: fallback,
      lookupEvidence: [],
      backendFailure,
    }).rows).toEqual(rows);
    expect(() => validateQuotationChildResult({
      chunk,
      response: fallback.replace('canonical', 'forged'),
      lookupEvidence: [],
      backendFailure,
    })).toThrow('deterministic OCR fallback');
    expect(() => validateQuotationChildResult({
      chunk,
      response: fallback,
      lookupEvidence: [],
      backendFailure: { retryDepth: 2 as 3, reason: backendFailure.reason },
    })).toThrow('retryDepth 3');

    const aliasHeaders = ['來源', '零件編號', '類別', '品名規格', '品名／規格', '數量', '厚度', '寬度', '長度', '孔數'];
    const aliasChunk = buildQuotationChunks(ocrWithHeaders(aliasHeaders, [['F-02', 'P-02', '鐵板', '', 'fallback name', '1', '3', '40', '50', '2']]))[0]!;
    const aliasRows = parseMarkdownTables(buildQuotationFailureMarkdown(aliasChunk, 'reason'))[0]!.rows;
    expect(aliasRows[0]![1]).toBe('fallback name');
    expect(aliasRows[0]![15]).toContain('孔數=2');
  });

  it('rejects an ordinary no-evidence child even when it resembles the fallback contract', () => {
    const chunk = chunkForRows();
    const fallback = buildQuotationFailureMarkdown(chunk, 'lookup exhausted');
    expect(() => validateQuotationChildResult({ chunk, response: fallback, lookupEvidence: [] })).toThrow('search_price_candidates attempt');
  });

  it('retains optional child reviews together with the order table', () => {
    const child = childInput(chunkForRows(), blankRow);
    const reviews = `## manual_reviews_chunk\n\n${table(reviewHeaders, [['ocr_result', 'P1', '單價', '', '查無資料', '報價']])}`;
    expect(validateQuotationChildResult({ ...child, response: `${child.response}\n\n${reviews}` }).markdown)
      .toBe(`${child.response}\n\n${reviews}`);
    expect(validateQuotationChildResult(child).markdown).not.toContain('manual_reviews_chunk');
    expect(validateQuotationChildResult({
      ...child,
      response: `${child.response}\n\n${reviews.replace('## manual_reviews_chunk', '## manual_reviews_chunk\n\n以下項目待確認。')}\n\n請確認以上事項。`,
    }).markdown).toContain(reviews);
  });

  it('rejects a new strict child review sidecar while keeping the legacy default readable', () => {
    const chunk = chunkForRows();
    const review = `## manual_reviews_chunk\n\n${table(reviewHeaders, [['ocr_result', 'P1', '單價', '', '查無資料', '報價']])}`;
    const input = { ...childInput(chunk, blankRow), response: `${childInput(chunk, blankRow).response}\n\n${review}` };
    expect(validateQuotationChildResult(input).reviewTable).toBeDefined();
    expect(() => validateQuotationChildResult({ ...input, allowManualReviews: false }))
      .toThrow('system_order 備註');
  });

  it('rejects a strict child that omits a material group before it can be checkpointed', () => {
    const chunk = chunkForRows([
      ['F1', 'P1', '鐵板', '2', '6', '100', '200'],
      ['F1', 'P2', '鐵板', '1', '8', '100', '200'],
    ]);
    expect(() => validateQuotationChildResult({
      ...childInput(chunk, pricedRow),
      allowManualReviews: false,
    })).toThrow('material rows');
  });

  it('builds one authoritative source ordered system_order from complete child tables', () => {
    const order = ocr([
      ['F1', 'P1', '鐵板', '2', '6', '100', '200'],
      ['F1', 'P2', 'H型鋼', '1', '8', '100', '200'],
      ['F1', 'P3', '鐵板', '3', '10', '100', '200'],
    ]);
    const chunks = buildQuotationChunks(order);
    const rowsFor = (chunk: QuotationChunk, category: string) => chunk.sourceRows.flatMap((source) => {
      const material = [...pricedRow];
      material[1] = `${category} ${source.cells[1]}`;
      material[14] = category;
      const processing = [...material];
      processing[1] = `${category} 加工 ${source.cells[1]}`;
      processing[14] = '加工/孔';
      return [material, processing];
    });
    const children = chunks.map((chunk) => ({
      ...childInput(chunk, rowsFor(chunk, chunk.category)[0]!),
      response: `## system_order_chunk\n\n${table(systemHeaders, rowsFor(chunk, chunk.category))}`,
    })).reverse();
    const built = buildQuotationSystemOrder({ fullOcrResult: order, childResults: children });
    const rows = parseMarkdownTables(built)[0]!.rows;
    expect(rows.map((row) => row[1])).toEqual([
      '鐵板 P1', '鐵板 加工 P1', 'H型鋼 P2', 'H型鋼 加工 P2', '鐵板 P3', '鐵板 加工 P3',
    ]);
  });

  it('rejects duplicate, missing, leading processing, and non-material-count child coverage', () => {
    const order = ocr([
      ['F1', 'P1', '鐵板', '2', '6', '100', '200'],
      ['F1', 'P2', '鐵板', '1', '8', '100', '200'],
    ]);
    const chunks = buildQuotationChunks(order);
    const child = (chunk: QuotationChunk, rows: readonly (readonly string[])[]) => ({
      ...childInput(chunk, rows[0]!),
      response: `## system_order_chunk\n\n${table(systemHeaders, rows)}`,
    });
    const rows = chunks[0]!.sourceRows.map((source) => {
      const row = [...pricedRow];
      row[1] = `鐵板 ${source.cells[1]}`;
      return row;
    });
    expect(() => buildQuotationSystemOrder({ fullOcrResult: order, childResults: [child(chunks[0]!, rows.slice(0, 1))] }))
      .toThrow('material rows');
    expect(() => buildQuotationSystemOrder({ fullOcrResult: order, childResults: [child(chunks[0]!, [
      [...rows[0]!, 'extra'],
    ])] })).toThrow();
    const processing = [...rows[0]!];
    processing[14] = '加工/孔';
    expect(() => buildQuotationSystemOrder({ fullOcrResult: order, childResults: [child(chunks[0]!, [processing, rows[0]!])] }))
      .toThrow('cannot start');
  });

  it('rejects malformed, empty or duplicate child review sections', () => {
    const child = childInput(chunkForRows(), blankRow);
    const valid = `## manual_reviews_chunk\n\n${table(reviewHeaders, [['ocr_result', 'P1', '單價', '', '查無資料', '報價']])}`;
    for (const review of [
      `## manual_reviews_chunk\n\n${table(reviewHeaders, [])}`,
      `## manual_reviews_chunk\n\n${table(['wrong'], [['value']])}`,
      `${valid}\n\n${valid}`,
    ]) {
      expect(() => validateQuotationChildResult({ ...child, response: `${child.response}\n\n${review}` })).toThrow();
    }
  });

  it('requires an actual persisted search attempt for every child', () => {
    expect(() => validateQuotationChildResult(childInput(chunkForRows(), blankRow, []))).toThrow('search_price_candidates attempt');
    expect(() => validateQuotationChildResult(childInput(chunkForRows(), blankRow, [lookupEvidence({
      ok: true,
      toolName: 'search_customers',
      data: {},
      durationMs: 1,
      redactionVersion: 1,
    })]))).toThrow('search_price_candidates attempt');
  });

  it('strips a legacy JSON child sidecar during checkpoint recovery', () => {
    const chunk = chunkForRows();
    const response = [
      `## system_order_chunk\n\n${table(systemHeaders, [pricedRow])}`,
      '```json',
      JSON.stringify({ version: 1, quote_lineage: { '1': { sourceRowId: 'source-row-1' } } }),
      '```',
    ].join('\n\n');
    const result = validateQuotationChildResult({ chunk, response, lookupEvidence: [successfulLookup()] });
    expect(result.markdown).not.toContain('quote_lineage');
    expect(result.markdown).toContain('ERP-1');
  });

  it.each([
    '```text\nnotes\n```',
    '   ~~~~text\r\nnotes\r\n   ~~~~~',
    '```text\nunfinished',
    '~~~text\nunfinished',
  ])('rejects non-control fenced content in child results: %s', (fence) => {
    const child = childInput(chunkForRows(), pricedRow);
    expect(() => validateQuotationChildResult({
      ...child, response: `${child.response}\n\n${fence}`,
    })).toThrow('Child result must contain one 16-column system_order_chunk');
  });

  it('rejects malformed child tables while retaining escaped Markdown cell parsing', () => {
    const chunk = chunkForRows();
    const escaped = [...pricedRow];
    escaped[1] = '規格 \\| 特殊';
    expect(validateQuotationChildResult({
      chunk,
      response: `## system_order_chunk\n\n${table(systemHeaders, [escaped])}`,
      lookupEvidence: [successfulLookup()],
    }).rows[0]?.[1]).toBe('規格 | 特殊');
    expect(() => validateQuotationChildResult({
      chunk,
      response: `## system_order_chunk\n\n${table(systemHeaders.slice(0, -1), [pricedRow.slice(0, -1)])}`,
      lookupEvidence: [successfulLookup()],
    })).toThrow('invalid system_order_chunk');
    expect(validateQuotationChildResult({
      chunk,
      response: `以下為本次報價。\n\n## system_order_chunk\n\n價格說明。\n\n${table(systemHeaders, [pricedRow])}\n\n補充文字`,
      lookupEvidence: [successfulLookup()],
    }).rows).toEqual([pricedRow]);
    expect(() => validateQuotationChildResult({
      chunk,
      response: `## system_order_chunk\n\n${table(systemHeaders, [pricedRow])}\n| unfinished`,
      lookupEvidence: [successfulLookup()],
    })).toThrow('incomplete Markdown row');
  });

  it('normalizes complete child tables with missing trailing pipes and renders an idempotent canonical result', () => {
    const chunk = chunkForRows();
    const row = [...pricedRow];
    row[15] = '已確認';
    const response = `## system_order_chunk\n\n${removeTrailingPipes(table(systemHeaders, [row]))}`;
    const validated = validateQuotationChildResult({ ...childInput(chunk, row), response });
    expect(validated.rows).toEqual([row]);
    expect(validated.markdown).toBe(`## system_order_chunk\n\n${table(systemHeaders, [row])}`);
    expect(validateQuotationChildResult({ ...childInput(chunk, row), response: validated.markdown })).toEqual(validated);
  });

  it('preserves escaped internal and terminal pipes while normalizing an escaped trailing delimiter', () => {
    const chunk = chunkForRows();
    const escaped = [...pricedRow];
    escaped[1] = '規格 \\| 特殊';
    escaped[15] = '末端 \\|';
    const response = `## system_order_chunk\n\n${removeTrailingPipes(table(systemHeaders, [escaped]))}`;
    const result = validateQuotationChildResult({ ...childInput(chunk, escaped), response });
    const expected = [...escaped];
    expected[1] = '規格 | 特殊';
    expected[15] = '末端 |';
    expect(result.rows).toEqual([expected]);
    expect(result.markdown).toContain('| 規格 \\| 特殊 |');
    expect(result.markdown).toContain('| 末端 \\| |');
  });

  it('normalizes a six-column manual review table with missing trailing pipes', () => {
    const chunk = chunkForRows();
    const reviewRow = ['ocr_result', 'P1', '單價', '', '查無資料', '報價'];
    const review = `## manual_reviews_chunk\n\n${removeTrailingPipes(table(reviewHeaders, [reviewRow]))}`;
    const response = `${removeTrailingPipes(childInput(chunk, blankRow).response!)}\n\n${review}`;
    const result = validateQuotationChildResult({ ...childInput(chunk, blankRow), response });
    expect(result.markdown).toBe(`## system_order_chunk\n\n${table(systemHeaders, [blankRow])}\n\n## manual_reviews_chunk\n\n${table(reviewHeaders, [reviewRow])}`);
  });

  it('rejects wrong-width rows, headers, prose rows, and ambiguous empty final cells instead of padding them', () => {
    const chunk = chunkForRows();
    const missingLastCell = removeTrailingPipes(table(systemHeaders, [pricedRow.slice(0, -1)]));
    const extraCell = removeTrailingPipes(table(systemHeaders, [[...pricedRow, 'extra']]));
    const wrongHeader = removeTrailingPipes(table(systemHeaders.slice(0, -1), [pricedRow.slice(0, -1)]));
    const proseRow = `${removeTrailingPipes(table(systemHeaders, [pricedRow]))}\n| prose row`;
    const ambiguousEmptyFinalCell = removeTrailingPipes(table(systemHeaders, [pricedRow]));
    for (const response of [missingLastCell, extraCell, wrongHeader, proseRow, ambiguousEmptyFinalCell]) {
      expect(() => validateQuotationChildResult({ ...childInput(chunk, pricedRow), response: `## system_order_chunk\n\n${response}` })).toThrow();
    }
  });

  it('uses the main table rows after AI correction or reordering and strips legacy controls', () => {
    const chunk = chunkForRows([
      ['F1', 'P1', '鐵板', '2', '6', '100', '200'],
      ['F1', 'P2', '鐵板', '1', '8', '100', '200'],
    ]);
    const child = {
      ...childInput(chunk, rowsForChunk(chunk)[0]!),
      response: `## system_order_chunk\n\n${table(systemHeaders, rowsForChunk(chunk))}`,
    };
    const corrected = [...pricedRow];
    corrected[1] = '鐵板 8T P2';
    corrected[4] = '1';
    corrected[6] = '1';
    corrected[10] = '8';
    const mainResponse = [
      '前置說明',
      '## system_order',
      '',
      table(systemHeaders, [corrected, pricedRow]),
      '',
      '## notes',
      '',
      'AI 已完成修正',
      '',
      '```json',
      '{"quote_lineage":{"1":{"sourceRowId":"forged"}}}',
      '```',
      '',
      '查價輸出完成：共 99 筆 system_order，無待複核事項。',
    ].join('\n');
    const finalized = finalizeQuotationMainResponse({ fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]), mainResponse, childResults: [child] });
    expect(finalized.rows).toEqual([corrected, pricedRow]);
    expect(finalized.response).toContain('| 鐵板 8T P2 |');
    expect(finalized.response).not.toContain('quote_lineage');
    expect(finalized.response.match(/## customer_quote/g)).toHaveLength(1);
    expect(finalized.summary).toBe('查價輸出完成：共 2 筆 system_order，無待複核事項。');
    expect(finalized.response).toContain(`## quote_summary\n\n${finalized.summary}`);
    expect(finalized.response).not.toContain('## manual_reviews');
    const repeated = finalizeQuotationMainResponse({ fullOcrResult: '', mainResponse: finalized.response, childResults: [child] });
    expect(repeated.response).toBe(finalized.response);
  });

  it('normalizes numeric cells before saving the final order and composing the customer quote', () => {
    const source = [...pricedRow];
    source[4] = '2支';
    source[7] = '1,234.50元';
    source[8] = 'B';
    const expected = [...pricedRow];
    expected[4] = '2';
    expected[7] = '1234.50';
    expected[8] = '2';
    const result = finalizeQuotationMainResponse({
      fullOcrResult: '',
      mainResponse: `## system_order\n\n${table(systemHeaders, [source])}`,
      childResults: [childInput(chunkForRows(), pricedRow)],
    });
    expect(result.rows).toEqual([expected]);
    expect(result.response).not.toContain('1,234.50元');
    expect(result.response.match(/## customer_quote/g)).toHaveLength(1);
  });

  it.each(['manual_reviews', 'manual_review', 'manual_reviews｜訂單.pdf'])('normalizes %s without requiring backend source coverage', (title) => {
    const review = table(reviewHeaders, [['ocr_result', 'P-not-in-source', '單價', '需確認', '由 AI 規則判斷', '備註']]);
    const finalized = finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: `## system_order｜訂單.pdf\n\n${table(systemHeaders, [blankRow])}\n\n## ${title}\n\n${review}\n\n## notes\n\n補充`,
      childResults: [childInput(chunkForRows(), blankRow, [failedLookup()])],
    });
    expect(finalized.summary).toBe('查價輸出完成：共 1 筆 system_order、1 項待複核事項。');
    expect(finalized.response).toContain('## manual_reviews\n');
    expect(finalized.response).toContain('## system_order\n');
    expect(finalized.response).toContain('## customer_quote\n');
    expect(finalized.response).not.toContain('｜訂單.pdf');
    expect(finalized.response.indexOf('## manual_reviews')).toBeGreaterThan(finalized.response.indexOf('## notes'));
    expect(finalized.response).not.toContain('## manual_review\n');
    expect(finalized.response.endsWith(`## quote_summary\n\n${finalized.summary}`)).toBe(true);
  });

  it('rejects duplicate main review aliases and invalid review columns', () => {
    const review = table(reviewHeaders, [['ocr_result', 'P1', '單價', '', '查無資料', '報價']]);
    for (const sections of [
      `## manual_reviews\n\n${review}\n\n## manual_review\n\n${review}`,
      `## manual_reviews\n\n${table(['wrong'], [['value']])}`,
    ]) {
      expect(() => finalizeQuotationMainResponse({
        fullOcrResult: '',
        mainResponse: `## system_order\n\n${table(systemHeaders, [blankRow])}\n\n${sections}`,
        childResults: [childInput(chunkForRows(), blankRow)],
      })).toThrow('manual_reviews');
    }
  });

  it('rejects malformed main tables but allows arbitrary AI-owned cell content', () => {
    const child = childInput(chunkForRows(), pricedRow);
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: `## system_order\n\n${table(systemHeaders.slice(1), [pricedRow.slice(1)])}`,
      childResults: [child],
    })).toThrow('16-column system_order');
    expect(() => finalizeQuotationMainResponse({
      fullOcrResult: ocr([['F1', 'P1', '鐵板', '2', '6', '100', '200']]),
      mainResponse: `## system_order\n\n${table(systemHeaders, [])}`,
      childResults: [child],
    })).toThrow('16-column system_order');
  });
});
