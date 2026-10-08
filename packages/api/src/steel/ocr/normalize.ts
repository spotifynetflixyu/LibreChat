import { cleanSystemOrderDimension, cleanSystemOrderNumber } from '../markdown/order';

export interface OcrTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const FIRST_HEADERS = ['類別', '零件編號', '品名規格', '厚度', '長度', '寬度', '數量'];
const LAST_HEADERS = ['來源', '頁碼', 'OCR來源'];
const DIMENSIONS = new Set(['厚度', '長度', '寬度']);

function headerName(header: string): string {
  return header.replace(/^(\*\*|__)(.+)\1$/u, '$2');
}

/** Prepares a new AI result and its review baseline; never used for historical reads. */
export function normalizeOcrTable(table: OcrTable): OcrTable {
  const headers = [...table.headers];
  const names = headers.map(headerName);
  const notes: string[][] = [];
  const rows = table.rows.map((row) => {
    const originals: string[] = [];
    const values = row.map((value, index) => {
      const name = names[index];
      if (!DIMENSIONS.has(name) && name !== '數量') return value;
      const cleaned = DIMENSIONS.has(name)
        ? cleanSystemOrderDimension(value)
        : cleanSystemOrderNumber(value);
      if (value && (cleaned === '' || Number(cleaned) !== Number(cleanSystemOrderNumber(value)))) {
        originals.push(`原${name} ${value}`);
      }
      return cleaned;
    });
    notes.push(originals);
    return values;
  });
  let noteIndex = names.indexOf('備註');
  if (notes.some((row) => row.length > 0)) {
    if (noteIndex < 0) {
      noteIndex = headers.length;
      headers.push('備註');
      names.push('備註');
    }
    rows.forEach((row, index) => {
      row[noteIndex] = [row[noteIndex], ...notes[index]].filter(Boolean).join('；');
    });
  }
  const indices = [
    ...FIRST_HEADERS.flatMap((name) =>
      names.flatMap((header, index) => (header === name ? [index] : [])),
    ),
    ...names.flatMap((name, index) =>
      !FIRST_HEADERS.includes(name) && !LAST_HEADERS.includes(name) ? [index] : [],
    ),
    ...LAST_HEADERS.flatMap((name) =>
      names.flatMap((header, index) => (header === name ? [index] : [])),
    ),
  ];
  return {
    headers: indices.map((index) => headers[index]),
    rows: rows.map((row) => indices.map((index) => row[index])),
  };
}
