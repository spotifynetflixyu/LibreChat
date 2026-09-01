import { finalizeOcrMarkdown, OCR_COMPLETION_DIRECTIVE_MARKER } from './ocr';

function table(title: string, headers: string[], rows: string[][]): string {
  const separator = headers.map(() => '---');
  return [
    title,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const mapping = (title = '## source_file_mapping', rows = [['F1', 'file.pdf']]) =>
  table(title, ['來源', '檔名'], rows);
const result = (
  title = '## ocr_result',
  headers = ['來源', '零件編號', '類別'],
  rows = [['F1', 'P1', '板材']],
) => table(title, headers, rows);
const review = (
  title = '## manual_review',
  headers = ['來源', '問題欄位', '目前判斷'],
  rows = [['F1', '尺寸', '待確認']],
) => table(title, headers, rows);

describe('finalizeOcrMarkdown', () => {
  it('counts canonical mapping, OCR, and review tables', () => {
    const input = [
      mapping('  ## source_file_mapping ###', [['F1', 'file.pdf']]),
      result('## ocr_result #', ['來源', '零件編號', '類別', '數量'], [
        ['F1', 'P1', '板材', '2'],
        ['F1', 'P2', '板材', '3'],
      ]),
      review('## manual_review', ['來源', '問題欄位', '目前判斷', '需確認內容'], [
        ['F1', '尺寸', '650', '確認長度'],
      ]),
    ].join('\n\n');

    expect(finalizeOcrMarkdown(input)).toBe(
      `${input}\n\nOCR 整理完成：共 1 個來源、2 筆資料、1 項待複核事項。`,
    );
  });

  it.each([
    mapping('## 來源檔案對照表'),
    result('## OCR 結果確認表'),
  ])('rejects a legacy Chinese table title', (input) => {
    expect(finalizeOcrMarkdown(input)).toBe(input);
  });

  it.each([
    [mapping(), 'OCR 整理完成：共 1 個來源。'],
    [
      result('## ocr_result', ['來源', '零件編號'], [
        ['F1', 'P1'],
        ['F1', 'P2'],
      ]),
      'OCR 整理完成：共 2 筆資料。',
    ],
    [review(), 'OCR 整理完成：共 1 項待複核事項。'],
    [
      [mapping(), review()].join('\n\n'),
      'OCR 整理完成：共 1 個來源、1 項待複核事項。',
    ],
    [
      [result(), review()].join('\n\n'),
      'OCR 整理完成：共 1 筆資料、1 項待複核事項。',
    ],
  ])('summarizes independently valid sections', (input, summary) => {
    expect(finalizeOcrMarkdown(input)).toBe(`${input}\n\n${summary}`);
  });

  it('counts blank cells while preserving escaped pipe cells', () => {
    const input = [
      mapping('## source_file_mapping', [['F1', 'file\\|name.pdf'], ['', '']]),
      result('## ocr_result', ['來源', '零件編號'], [['F1', 'value\\|with\\|pipes'], ['', '']]),
      review('## manual_review', ['來源', '問題欄位'], [['', '']]),
    ].join('\n\n');

    expect(finalizeOcrMarkdown(input)).toContain(
      'OCR 整理完成：共 2 個來源、2 筆資料、1 項待複核事項。',
    );
  });

  it('omits only malformed or wrong-schema clauses', () => {
    const malformedMapping = [
      '## source_file_mapping',
      '',
      '| 來源 | 檔名 |',
      '| not a separator |',
      '| F1 | file.pdf |',
    ].join('\n');
    const wrongResult = result('## ocr_result', ['來源', '類別'], [['F1', '板材']]);
    const malformedReview = [
      '## manual_review',
      '',
      '| 來源 | 問題欄位 |',
      '| --- | --- |',
    ].join('\n');
    const input = [malformedMapping, wrongResult, malformedReview].join('\n\n');

    expect(finalizeOcrMarkdown(input)).toBe(input);

    const validMappingInput = [mapping(), wrongResult, malformedReview].join('\n\n');
    expect(finalizeOcrMarkdown(validMappingInput)).toBe(
      `${validMappingInput}\n\nOCR 整理完成：共 1 個來源。`,
    );
  });

  it('rejects header-only tables', () => {
    const input = [
      '## source_file_mapping',
      '',
      '| 來源 | 檔名 |',
      '| --- | --- |',
      '',
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
    ].join('\n');

    expect(finalizeOcrMarkdown(input)).toBe(input);
  });

  it.each([
    '# source_file_mapping',
    '### source_file_mapping',
    '## 來源檔案對照表（source_file_mapping）',
    '## source_file_mapping / ocr_result',
    '## OCR 結果確認表｜file.pdf',
  ])('rejects non-exact H2 title %s', (title) => {
    const input = table(title, ['來源', '檔名'], [['F1', 'file.pdf']]);
    expect(finalizeOcrMarkdown(input)).toBe(input);
  });

  it('ignores H2 sections and pipe tables inside fenced code blocks', () => {
    const fenced = ['```markdown', mapping(), result(), '```'].join('\n');

    expect(finalizeOcrMarkdown(fenced)).toBe(fenced);

    const input = [
      '## ocr_result',
      '',
      '~~~markdown',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| F0 | fenced |',
      '~~~',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| F1 | P1 |',
    ].join('\n');
    expect(finalizeOcrMarkdown(input)).toBe(
      `${input}\n\nOCR 整理完成：共 1 筆資料。`,
    );

    const splitTable = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '```text',
      'ignored',
      '```',
      '| F1 | P1 |',
    ].join('\n');
    expect(finalizeOcrMarkdown(splitTable)).toBe(splitTable);
  });

  it('keeps malformed adjacent pipe blocks independent', () => {
    const input = [
      '## source_file_mapping',
      '',
      '| 來源 | 檔名 |',
      '| --- | --- |',
      '| F1 | file.pdf |',
      'not a pipe row',
      '| F2 | file-2.pdf |',
      '',
      result(),
    ].join('\n');

    expect(finalizeOcrMarkdown(input)).toContain('OCR 整理完成：共 1 個來源、1 筆資料。');
  });

  it.each([
    'OCR 整理完成：共 99 個來源、99 筆資料，無待複核事項。',
    'OCR 整理完成：共 99 個來源、99 筆資料、99 項待複核事項。',
    'OCR 整理完成：共 99 個來源。',
  ])('replaces constrained trailing summary %s', (oldSummary) => {
    const input = `${mapping()}\n\n${result()}\n\n${oldSummary}`;
    const expected = `${mapping()}\n\n${result()}\n\nOCR 整理完成：共 1 個來源、1 筆資料。`;

    expect(finalizeOcrMarkdown(input)).toBe(expected);
  });

  it('does not treat arbitrary trailing text as a summary', () => {
    const trailingText = 'OCR 整理完成：共 99 個來源、自由文字。';
    const input = `${mapping()}\n\n${trailingText}`;

    expect(finalizeOcrMarkdown(input)).toBe(
      `${input}\n\nOCR 整理完成：共 1 個來源。`,
    );
  });

  it('exports the exact backend directive marker', () => {
    expect(OCR_COMPLETION_DIRECTIVE_MARKER).toBe('# Current-turn OCR completion directive');
  });
});
