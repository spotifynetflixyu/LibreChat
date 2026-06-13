import fs from 'fs';
import path from 'path';

import { getSteelFileBytes } from './ocr';

describe('Steel OCR file bytes', () => {
  it('copies Uint8Array source bytes before OCR processing can transfer them', () => {
    const source = new Uint8Array([1, 2, 3]);

    const bytes = getSteelFileBytes({
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
      data: source,
    });

    expect(bytes).toEqual(source);
    expect(bytes).not.toBe(source);

    bytes[0] = 9;
    expect(source[0]).toBe(1);
  });
});

describe('Steel OCR rules', () => {
  function readOcrRules(): string {
    return fs.readFileSync(path.resolve(process.cwd(), '../../docs/rules/OCR規則.txt'), 'utf8');
  }

  function hasAnyConcept(text: string, concepts: readonly string[]): boolean {
    return concepts.some((concept) => text.includes(concept));
  }

  it('limits file_analysis_data patches to quote-relevant material facts', () => {
    const rules = readOcrRules();

    expect(hasAnyConcept(rules, ['材料', '板件', '螺栓', '切割'])).toBe(true);
    expect(hasAnyConcept(rules, ['規格', '尺寸', '厚度', '數量'])).toBe(true);
    expect(hasAnyConcept(rules, ['報價', '價格', '加工', '孔', '開槽', '折彎'])).toBe(true);
    expect(hasAnyConcept(rules, ['精簡', '簡短'])).toBe(true);
    expect(hasAnyConcept(rules, ['專案名稱', '工程名稱', '日期', '地點', '人名', '承辦'])).toBe(
      true,
    );
  });

  it('keeps OCR rules independent from workbook patch guidance', () => {
    const rules = readOcrRules().toLowerCase();

    expect(rules.includes('workbook')).toBe(false);
    expect(rules.includes('patch_quote_workbook')).toBe(false);
  });
});
