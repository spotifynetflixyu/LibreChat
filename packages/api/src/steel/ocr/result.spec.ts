import {
  buildOcrUpdateSummary,
  finalizeOcrResponse,
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

  it('does not restore old unkeyed rows and aligns dynamic columns', () => {
    const previous = ocr(['來源', '零件編號', '舊欄'], [['F1', 'P1', 'old'], ['', '', 'orphan']]);
    const current = ocr(['來源', '零件編號', '新欄'], [['F1', 'P1', 'new']]);
    expect(reconcileOcrResults(previous, current).rows).toEqual([['F1', 'P1', 'new']]);
    expect(reconcileOcrResults(ocr(['來源', '零件編號'], [['F1', 'P1']]), current).rows).toEqual([
      ['F1', 'P1', 'new'],
    ]);
    const summary = buildOcrUpdateSummary(
      ocr(['來源', '零件編號'], [['F1', 'P1']]),
      current,
    );
    expect(summary.markdown).toContain('new (~~~~)');
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
