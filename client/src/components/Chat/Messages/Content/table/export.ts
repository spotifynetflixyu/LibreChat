import JSZip from 'jszip';
import filenamify from 'filenamify';

export type TableMatrix = string[][];
export type MaterialGroup = { material: string[]; processing: TableMatrix };

type CsvGroup = { category: string; thickness: string; rows: TableMatrix };

const csvMimeType = 'text/csv;charset=utf-8';
const csvFormulaPrefix = /^[=+\-@\t\r]/;

function escapeCsvCell(value: string): string {
  const guarded = csvFormulaPrefix.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function createCsv(matrix: TableMatrix): string {
  return '\uFEFF' + matrix.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function createCsvBlob(matrix: TableMatrix): Blob {
  return new Blob([createCsv(matrix)], { type: csvMimeType });
}

function getGroupingColumns(header: string[] = []): { category: number; thickness: number } {
  return {
    category: header.indexOf('類別'),
    thickness: header.findIndex((value) => /^厚度(?:[（(]mm[）)])?$/i.test(value)),
  };
}

export function canGroupByThickness(matrix: TableMatrix): boolean {
  const { category, thickness } = getGroupingColumns(matrix[0]);
  return matrix.length > 1 && category >= 0 && thickness >= 0;
}

function normalizeThickness(value: string): string {
  const trimmed = value.trim();
  const thickness = Number(trimmed);
  return /^\d+(?:\.\d+)?$/.test(trimmed) && Number.isFinite(thickness) && thickness > 0
    ? String(thickness)
    : '';
}

export function groupMaterialRows(matrix: TableMatrix): MaterialGroup[] {
  const [header, ...rows] = matrix;
  const categoryColumn = header?.indexOf('類別') ?? -1;
  if (categoryColumn < 0) {
    throw new Error('Table requires a category column.');
  }

  const groups: MaterialGroup[] = [];
  for (const row of rows) {
    if (row[categoryColumn]?.trim().startsWith('加工/')) {
      const materialGroup = groups[groups.length - 1];
      if (!materialGroup) {
        throw new Error('Processing row requires a preceding material row.');
      }
      materialGroup.processing.push(row);
      continue;
    }

    groups.push({ material: row, processing: [] });
  }
  return groups;
}

export async function createThicknessZip(matrix: TableMatrix): Promise<Blob> {
  if (!canGroupByThickness(matrix)) {
    throw new Error('Table requires category, thickness, and data rows.');
  }

  const [header] = matrix;
  const columns = getGroupingColumns(header);
  const groups = new Map<string, CsvGroup>();
  for (const { material, processing } of groupMaterialRows(matrix)) {
    const category = material[columns.category]?.trim() ?? '';
    const thickness = normalizeThickness(material[columns.thickness] ?? '');
    const key = JSON.stringify([category, thickness]);
    let group = groups.get(key);
    if (!group) {
      group = { category, thickness, rows: [header] };
      groups.set(key, group);
    }
    group.rows.push(material, ...processing);
  }

  const zip = new JSZip();
  let index = 0;
  for (const group of groups.values()) {
    index += 1;
    const category = filenamify(group.category) || 'no-category';
    const filename = `${String(index).padStart(2, '0')}_${category}_${group.thickness || 'no-thickness'}.csv`;
    zip.file(filename, createCsv(group.rows));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
