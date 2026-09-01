import { finalizeOcrMarkdown, OCR_COMPLETION_DIRECTIVE_MARKER } from './ocr';

function table(title: string, rows: string[]): string {
  return [title, '', '| 欄位 |', '| --- |', ...rows].join('\n');
}

describe('finalizeOcrMarkdown', () => {
  it('counts mapping, OCR, and review body rows for large documents', () => {
    const mappingRows = ['| F1 | file.pdf |'];
    const resultRows = Array.from({ length: 277 }, (_, index) => `| row-${index + 1} |`);
    const reviewRows = Array.from({ length: 17 }, (_, index) => `| review-${index + 1} |`);
    const input = [
      table('  ## 來源檔案對照表 ###', mappingRows),
      table('## OCR 結果確認表 #', resultRows),
      table('## manual_review', reviewRows),
    ].join('\n\n');

    expect(
      finalizeOcrMarkdown(input).endsWith(
        'OCR 整理完成：共 1 個來源、277 筆資料、17 項待複核事項。',
      ),
    ).toBe(true);
  });

  it('uses zero reviews when manual_review is absent', () => {
    const input = [
      table('## 來源檔案對照表', ['| F1 | file.pdf |']),
      table('## OCR 結果確認表', ['| row |']),
    ].join('\n\n');

    expect(finalizeOcrMarkdown(input)).toBe(
      `${input}\n\nOCR 整理完成：共 1 個來源、1 筆資料，無待複核事項。`,
    );
  });

  it('counts blank rows and preserves escaped pipe cells', () => {
    const input = [
      table('## 來源檔案對照表', ['| F1 | file\\|name.pdf |', '|  |  |']),
      table('## OCR 結果確認表', ['| value\\|with\\|pipes |', '|  |']),
      table('## manual_review', ['|  |']),
    ].join('\n\n');

    expect(finalizeOcrMarkdown(input)).toContain(
      'OCR 整理完成：共 2 個來源、2 筆資料、1 項待複核事項。',
    );
  });

  it.each([
    '',
    'plain text',
    table('## 來源檔案對照表', ['| F1 | file.pdf |']),
    [table('## 來源檔案對照表', ['| F1 | file.pdf |']), '## OCR 結果確認表', 'not a table'].join(
      '\n\n',
    ),
    [
      table('## 來源檔案對照表', ['| F1 | file.pdf |']),
      table('## OCR 結果確認表', ['| row |']),
      '## manual_review',
    ].join('\n\n'),
  ])('leaves missing or malformed required sections unchanged', (input) => {
    expect(finalizeOcrMarkdown(input)).toBe(input);
  });

  it('replaces only a trailing legacy summary and leaves earlier text intact', () => {
    const input = [
      table('## 來源檔案對照表', ['| F1 | file.pdf |']),
      table('## OCR 結果確認表', ['| row |']),
      'OCR 整理完成：共 99 個來源、99 筆資料，無待複核事項。',
      '   ',
    ].join('\n\n');
    const expected = [
      table('## 來源檔案對照表', ['| F1 | file.pdf |']),
      table('## OCR 結果確認表', ['| row |']),
      'OCR 整理完成：共 1 個來源、1 筆資料，無待複核事項。',
    ].join('\n\n');

    expect(finalizeOcrMarkdown(input)).toBe(expected);
  });

  it('exports the exact backend directive marker', () => {
    expect(OCR_COMPLETION_DIRECTIVE_MARKER).toBe('# Current-turn OCR completion directive');
  });
});
