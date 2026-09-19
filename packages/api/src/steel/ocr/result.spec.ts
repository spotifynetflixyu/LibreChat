import { createHash } from 'node:crypto';
import {
  buildOcrUpdateSummary,
  finalizeOcrResponse,
  hasOcrResultUpdates,
  parseAssistantMarkdown,
  parseOcrResultTable,
  reconcileOcrResults,
  validateSourceMapping,
  type OcrTable,
  type SourceMappingEntry,
} from './result';

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function ocr(headers: readonly string[], rows: readonly (readonly string[])[]): OcrTable {
  return { headers, rows };
}

const mapping: readonly SourceMappingEntry[] = [
  { sourceCode: 'F1', sourceFilename: 'first.pdf' },
  { sourceCode: 'F2', sourceFilename: 'second.pdf' },
];

describe('parseAssistantMarkdown', () => {
  it('keeps sections in source order and ignores headings in fences', () => {
    const markdown = [
      'intro',
      '',
      '## ocr_result',
      'body',
      '```markdown',
      '## source_file_mapping',
      '```',
      '',
      '## source_file_mapping',
      'mapping',
      '',
      'tail',
    ].join('\n');
    const parsed = parseAssistantMarkdown(markdown);
    expect(parsed.sections.map(({ title }) => title)).toEqual(['ocr_result', 'source_file_mapping']);
    expect(parsed.sections[0]?.body).toContain('## source_file_mapping');
    expect(parsed.preamble).toBe('intro\n\n');
    expect(parsed.segments).toHaveLength(3);
  });
});

describe('table and mapping validation', () => {
  it('decodes escaped pipes and trims cells', () => {
    const parsed = parseOcrResultTable(table([' 來源 ', '零件編號', '描述'], [[' F1 ', ' P1 ', 'a\\|b']]));
    expect(parsed).toEqual({
      ok: true,
      table: { headers: ['來源', '零件編號', '描述'], rows: [['F1', 'P1', 'a|b']] },
    });
  });

  it('rejects missing rows and malformed separators', () => {
    expect(parseOcrResultTable(table(['來源', '零件編號'], []))).toEqual({
      ok: false,
      reason: 'invalid_table',
    });
    expect(parseOcrResultTable('| 來源 | 零件編號 |\n| --- | nope |')).toEqual({
      ok: false,
      reason: 'invalid_table',
    });
  });

  it('accepts OCR tables without source or part-number columns', () => {
    expect(parseOcrResultTable(table(['描述', '數量'], [['plate', '2']]))).toEqual({
      ok: true,
      table: { headers: ['描述', '數量'], rows: [['plate', '2']] },
    });
  });

  it('matches mapping pairs independent of row order and full filename', () => {
    const parsed = validateSourceMapping(
      { headers: ['來源', '檔名'], rows: [['F2', 'second.pdf'], ['F1', 'first.pdf']] },
      mapping,
    );
    expect(parsed).toEqual({ ok: true, entries: [['F2', 'second.pdf'], ['F1', 'first.pdf']].map(([sourceCode, sourceFilename]) => ({ sourceCode, sourceFilename })) });
    const mismatch = validateSourceMapping(
      { headers: ['來源', '檔名'], rows: [['F1', 'first'], ['F2', 'second.pdf']] },
      mapping,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.kind).toBe('different');
    }
  });

  it('reports missing, extra, and duplicate pairs', () => {
    const result = validateSourceMapping(
      { headers: ['來源', '檔名'], rows: [['F1', 'first.pdf'], ['F1', 'first.pdf'], ['F9', 'other.pdf']] },
      mapping,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('duplicate');
      expect(result.missing).toEqual([{ sourceCode: 'F2', sourceFilename: 'second.pdf' }]);
      expect(result.extra).toEqual([{ sourceCode: 'F9', sourceFilename: 'other.pdf' }]);
    }
  });
});

describe('reconcileOcrResults', () => {
  it('restores omitted old keyed rows in old order and keeps current rows', () => {
    const previous = ocr(['來源', '零件編號', '數量'], [
      ['F1', 'P1', '1'],
      ['F1', 'P2', '2'],
      ['F2', 'P3', '3'],
    ]);
    const current = ocr(['來源', '零件編號', '數量'], [
      ['F1', 'P2', '20'],
      ['F1', 'P4', '4'],
    ]);
    const result = reconcileOcrResults(previous, current);
    expect(result.rows).toEqual([
      ['F1', 'P1', '1'],
      ['F1', 'P2', '20'],
      ['F1', 'P4', '4'],
      ['F2', 'P3', '3'],
    ]);
    expect(result.restoredRows).toEqual([['F1', 'P1', '1'], ['F2', 'P3', '3']]);
    expect(result.newKeys).toEqual(['F1\u0000P4']);
  });

  it('preserves old columns and unkeyed rows while aligning new columns', () => {
    const previous = ocr(['來源', '零件編號', '舊欄'], [['F1', 'P1', 'old'], ['', '', 'orphan']]);
    const current = ocr(['來源', '零件編號', '新欄'], [['F1', 'P1', 'new']]);
    const merged = reconcileOcrResults(previous, current);
    expect(merged.headers).toEqual(['來源', '零件編號', '舊欄', '新欄']);
    expect(merged.rows).toEqual([['F1', 'P1', 'old', 'new'], ['', '', 'orphan', '']]);
    expect(reconcileOcrResults(ocr(['來源', '零件編號'], [['F1', 'P1']]), current).rows).toEqual([
      ['F1', 'P1', 'new'],
    ]);
    const summary = buildOcrUpdateSummary(
      ocr(['來源', '零件編號'], [['F1', 'P1']]),
      current,
    );
    expect(summary.markdown).toContain('new (~~~~)');
  });

  it('maps reordered delta columns by name and preserves absent cells', () => {
    const previous = ocr(['來源', '零件編號', '數量', '備註'], [
      ['F1', 'P1', '1', 'keep'], ['F1', 'P2', '2', 'clear'], ['F2', 'P3', '3', 'untouched'],
    ]);
    const current = ocr(['數量', '零件編號', '來源'], [['20', 'P2', 'F1'], ['4', 'P4', 'F1']]);
    const result = reconcileOcrResults(previous, current);
    expect(result.headers).toEqual(previous.headers);
    expect(result.rows).toEqual([
      ['F1', 'P1', '1', 'keep'], ['F1', 'P2', '20', 'clear'],
      ['F1', 'P4', '4', ''], ['F2', 'P3', '3', 'untouched'],
    ]);
    expect(result.changedKeys).toEqual(['F1\u0000P2']);
    expect(reconcileOcrResults(previous, ocr(['備註', '來源', '零件編號'], [['', 'F1', 'P2']])).rows[1])
      .toEqual(['F1', 'P2', '2', '']);
  });

  it('does not duplicate unchanged unkeyed rows and keeps repeated independent rows', () => {
    const previous = ocr(['來源', '零件編號', '數量'], [['F1', '', '1'], ['F1', '', '1']]);
    expect(reconcileOcrResults(previous, previous).rows).toEqual(previous.rows);
    expect(reconcileOcrResults(previous, ocr(previous.headers, [])).rows).toEqual(previous.rows);
  });

  it('leaves duplicate-key current rows untouched and excludes them from diff', () => {
    const previous = ocr(['來源', '零件編號', '數量'], [['F1', 'P1', '1']]);
    const current = ocr(['來源', '零件編號', '數量'], [['F1', 'P1', '2'], ['F1', 'P1', '3']]);
    const result = reconcileOcrResults(previous, current);
    expect(result.rows).toEqual(current.rows);
    expect(result.duplicateKeys).toEqual(['F1\u0000P1']);
    expect(buildOcrUpdateSummary(previous, current, result).markdown).toBe('無變動資料');
  });

  it('restores every previous duplicate row when the current result omits that key', () => {
    const previous = ocr(['來源', '零件編號', '數量'], [
      ['F1', 'P1', '1'],
      ['F1', 'P1', '2'],
      ['F1', 'P2', '3'],
    ]);
    const current = ocr(['來源', '零件編號', '數量'], [['F1', 'P2', '4']]);
    expect(reconcileOcrResults(previous, current).rows).toEqual([
      ['F1', 'P1', '1'],
      ['F1', 'P1', '2'],
      ['F1', 'P2', '4'],
    ]);
  });
});

describe('finalizeOcrResponse', () => {
  it('normalizes section order, reconciles, and emits delegate change summary', () => {
    const previous = [
      '## ocr_result',
      '',
      table(['來源', '零件編號', '數量'], [['F1', 'P1', '8']]),
    ].join('\n');
    const response = [
      'assistant note',
      '',
      '## ocr_result',
      '',
      table(['來源', '零件編號', '數量'], [['F1', 'P1', '10'], ['F1', '', 'manual']]),
      '',
      '## manual_review',
      '',
      table(['來源', '問題欄位'], [['F1', '尺寸']]),
      '',
      '## source_file_mapping',
      '',
      table(['來源', '檔名'], [['F2', 'second.pdf'], ['F1', 'first.pdf']]),
    ].join('\n');
    const result = finalizeOcrResponse({
      assistantResponse: response,
      previousOcrMarkdown: previous,
      canonicalMapping: mapping,
      delegateSummary: true,
      agentKind: 'delegate_ocr',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalResponse.indexOf('## source_file_mapping')).toBeLessThan(result.finalResponse.indexOf('## ocr_result'));
      expect(result.finalResponse.indexOf('## ocr_result')).toBeLessThan(result.finalResponse.indexOf('## manual_review'));
      expect(result.finalResponse).toContain('10 (~~8~~)');
      expect(result.finalResponse).toContain('| F1 |  | manual |');
      expect(result.summary).toContain('## ocr_update_summary');
      expect(result.summary).toContain('10 (~~8~~)');
    }
  });

  it('returns exact no-change text and no summary for regular OCR', () => {
    const response = [
      '## source_file_mapping',
      '',
      table(['來源', '檔名'], [['F2', 'second.pdf'], ['F1', 'first.pdf']]),
      '',
      '## ocr_result',
      '',
      table(['來源', '零件編號'], [['F1', 'P1']]),
    ].join('\n');
    const result = finalizeOcrResponse({
      assistantResponse: response,
      previousOcrMarkdown: response,
      canonicalMapping: mapping,
      agentKind: 'regular_ocr',
      delegateSummary: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toBe('');
      expect(result.finalResponse).not.toContain('ocr_update_summary');
      expect(result.finalResponse).not.toContain('無變動資料');
      expect(result.finalResponse.indexOf('| F1 | first.pdf |')).toBeLessThan(
        result.finalResponse.indexOf('| F2 | second.pdf |'),
      );
    }
  });

  it('separates missing and invalid OCR failures from mapping mismatch', () => {
    const mappingSection = `## source_file_mapping\n\n${table(['來源', '檔名'], [['F1', 'first.pdf'], ['F2', 'second.pdf']])}`;
    const missing = finalizeOcrResponse({ assistantResponse: mappingSection, canonicalMapping: mapping });
    expect(missing).toEqual({ ok: false, reason: 'missing_ocr_result' });
    const invalid = finalizeOcrResponse({
      assistantResponse: `${mappingSection}\n\n## ocr_result\n\n| 來源 | 零件編號 |\n| --- | nope |`,
      canonicalMapping: mapping,
    });
    expect(invalid).toEqual({ ok: false, reason: 'invalid_ocr_result_table' });
    const mismatch = finalizeOcrResponse({
      assistantResponse: `## source_file_mapping\n\n${table(['來源', '檔名'], [['F1', 'first']])}\n\n## ocr_result\n\n${table(['來源', '零件編號'], [['F1', 'P1']])}`,
      canonicalMapping: mapping,
      agentKind: 'regular_ocr',
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe('mapping_mismatch');
      expect(mismatch.mappingRetryable).toBe(true);
    }
  });

  it('finalizes other AI OCR output without requiring source mapping or key columns', () => {
    const response = `## ocr_result\n\n${table(['描述', '數量'], [['plate', '2']])}`;
    const result = finalizeOcrResponse({
      assistantResponse: response,
      canonicalMapping: mapping,
      agentKind: 'other',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalResponse).toBe(response);
      expect(result.ocrResultMarkdown).toBe(response);
    }
  });
});


describe('explicit order deletion', () => {
  const previous = `## ocr_result\n\n${table(['來源', '零件編號', '數量'], [['文字訂單', '1', '2'], ['文字訂單', '2', '3']])}`;
  const hash = createHash('sha256').update(previous).digest('hex');
  const deletions = (ids: string[], fingerprint = hash) => `## ocr_deletions\n\n${table(['order_hash', '來源', '零件編號'], ids.map((id) => [fingerprint, '文字訂單', id]))}`;
  const run = (rows: string[][], control: string, text = '刪除項目 1') => finalizeOcrResponse({
    assistantResponse: `## ocr_result_updates\n\n${table(['來源', '零件編號', '數量'], rows)}\n\n${control}`,
    previousOcrMarkdown: previous, canonicalMapping: [], agentKind: 'other', currentUserTurn: text,
  });
  it('does not restore explicitly deleted rows and strips deletion control from display', () => {
    const result = run([['文字訂單', '2', '3']], deletions(['1']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ocrResultMarkdown).not.toContain('| 文字訂單 | 1 |');
    expect(result.finalResponse).not.toContain('ocr_deletions');
  });
  it('treats omitted delta rows as unchanged even in deletion-only responses', () => {
    expect(run([], deletions(['1', '2']), '刪除全部').ok).toBe(true);
    const partial = run([], deletions(['1']));
    expect(partial.ok && partial.reconciliation.rows).toEqual([['文字訂單', '2', '3']]);
    const unchanged = run([], '');
    expect(unchanged.ok && unchanged.ocrResultMarkdown).toBe(previous);
  });
  it('rejects stale hashes, unrequested deletion and a deleted row retained in the table', () => {
    expect(run([['文字訂單', '2', '3']], deletions(['1'], 'stale')).ok).toBe(false);
    expect(run([['文字訂單', '2', '3']], deletions(['1']), '請報價').ok).toBe(false);
    expect(run([['文字訂單', '1', '2'], ['文字訂單', '2', '3']], deletions(['1'])).ok).toBe(false);
  });
});

describe('OCR delta identity validation', () => {
  const previous = `## ocr_result\n\n${table(['來源', '零件編號', '數量', '頁碼'], [
    ['F1', 'P1', '1', '1'], ['F1', 'P1', '2', '2'], ['F1', 'P2', '3', '3'],
  ])}`;
  const run = (headers: string[], rows: string[][]) => finalizeOcrResponse({
    assistantResponse: `## ocr_result_updates\n\n${table(headers, rows)}`,
    previousOcrMarkdown: previous, canonicalMapping: [], agentKind: 'other',
  });

  it('rejects partial duplicate groups and groups missing distinguishing columns', () => {
    expect(run(['來源', '零件編號', '數量', '頁碼'], [['F1', 'P1', '20', '2']]))
      .toEqual({ ok: false, reason: 'ambiguous_ocr_update' });
    expect(run(['來源', '零件編號', '數量'], [['F1', 'P1', '1'], ['F1', 'P1', '20']]))
      .toEqual({ ok: false, reason: 'ambiguous_ocr_update' });
  });

  it('updates a complete duplicate group at its old position and preserves other rows', () => {
    const result = run(['頁碼', '數量', '零件編號', '來源'], [['1', '1', 'P1', 'F1'], ['2', '20', 'P1', 'F1']]);
    expect(result.ok && result.reconciliation.rows).toEqual([
      ['F1', 'P1', '1', '1'], ['F1', 'P1', '20', '2'], ['F1', 'P2', '3', '3'],
    ]);
  });

  it('requires identity columns for updates and cannot create an empty initial order', () => {
    expect(run(['數量'], [['1']])).toEqual({ ok: false, reason: 'invalid_ocr_result_table' });
    expect(finalizeOcrResponse({
      assistantResponse: `## ocr_result\n\n${table(['來源', '零件編號'], [])}`,
      canonicalMapping: [], agentKind: 'other',
    }).ok).toBe(false);
  });
});

describe('visible OCR correction protocol', () => {
  const previous = `## ocr_result\n\n${table(['來源', '零件編號', '數量'], [['F1', 'A-6M74', '5'], ['F1', 'P2', '3']])}`;
  const updates = `說明\n\n## ocr_result_updates\n\n${table(['數量', '零件編號', '來源'], [['1', 'A-6M74', 'F1']])}\n\n## manual_review\n\n請確認數量。\n`;
  const finalize = (assistantResponse: string, previousOcrMarkdown: string | undefined = previous) =>
    finalizeOcrResponse({ assistantResponse, previousOcrMarkdown, canonicalMapping: [], agentKind: 'other' });

  it('preserves the exact visible correction and appends the full order last', () => {
    const result = finalize(updates);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalResponse).toBe(`${updates}\n\n${result.ocrResultMarkdown}`);
    expect(result.reconciliation.rows).toEqual([['F1', 'A-6M74', '1'], ['F1', 'P2', '3']]);
    expect(parseAssistantMarkdown(result.finalResponse).sections.map(({ title }) => title))
      .toEqual(['ocr_result_updates', 'manual_review', 'ocr_result']);
    expect(result.ocrResultMarkdown).not.toContain('updates');
  });

  it('can append new rows after an explicitly emptied order', () => {
    const emptyBase = `## ocr_result\n\n${table(['來源', '零件編號', '數量'], [])}`;
    const result = finalize(updates, emptyBase);
    expect(result.ok && result.reconciliation.rows).toEqual([['F1', 'A-6M74', '1']]);
  });

  it('requires a valid saved base and rejects ambiguous or already combined model output', () => {
    expect(finalize(updates, '')).toEqual({ ok: false, reason: 'missing_ocr_base' });
    expect(finalize(`${updates}\n${updates}`)).toEqual({ ok: false, reason: 'conflicting_ocr_sections' });
    expect(finalize(`${updates}\n${previous}`)).toEqual({ ok: false, reason: 'conflicting_ocr_sections' });
    expect(finalize('## ocr_result_updates\n\nnot a table').ok).toBe(false);
    expect(finalize(`## ocr_result_updates\n\n${table(['來源', '零件編號'], [['F1', 'P1']])}\n\n${table(['來源', '零件編號'], [['F1', 'P2']])}`).ok).toBe(false);
  });

  it('ignores fenced update examples and accepts full legacy snapshots without keyed merging', () => {
    const full = `## ocr_result\n\n${table(['描述', '數量'], [['鋼板', '3']])}`;
    const result = finalize(full, `## ocr_result\n\n${table(['描述', '數量'], [['鋼板', '2']])}`);
    expect(result.ok && result.ocrResultMarkdown).toBe(full);
    expect(hasOcrResultUpdates(updates)).toBe(true);
    expect(hasOcrResultUpdates(`\x60\x60\x60markdown\n${updates}\n\x60\x60\x60`)).toBe(false);
    expect(finalize(`\x60\x60\x60markdown\n${updates}\n\x60\x60\x60`).ok).toBe(false);
    const complete = `## ocr_result\n\n${table(['來源', '零件編號', '數量'], [['F1', 'A-6M74', '1']])}`;
    const snapshot = finalize(complete);
    expect(snapshot.ok && snapshot.ocrResultMarkdown).toBe(complete);
  });
});
