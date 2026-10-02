import type { SteelToolJsonObject, SteelToolJsonValue, SteelToolResult } from '../tools/results';
import { cleanSystemOrderNumber, readSystemOrderDimension } from '../markdown/order';

interface WeightCandidate {
  code: string;
  category: string;
  density?: number;
  widthMm?: number;
  lengthMm?: number;
  unitWeight?: number;
  basis?: string;
}

const PROFILE_CATEGORIES = new Set(['H型鋼', 'C型鋼', '角鐵', '槽鐵', '扁鐵', '方管', '圓管', '圓鐵']);

function object(value: SteelToolJsonValue | undefined): SteelToolJsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function positive(value: SteelToolJsonValue | undefined): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function candidates(results: readonly SteelToolResult[]): Map<string, WeightCandidate[]> {
  const matches = new Map<string, WeightCandidate[]>();
  for (const result of results) {
    if (!result.ok || result.toolName !== 'search_price_candidates') continue;
    const queries = result.data.queryResults;
    if (!Array.isArray(queries)) continue;
    for (const query of queries) {
      const rows = object(query)?.candidates;
      if (!Array.isArray(rows)) continue;
      for (const value of rows) {
        const row = object(value);
        if (!row || row.quoteEligible === false || typeof row.erpItemCode !== 'string' || typeof row.category !== 'string') continue;
        const candidate: WeightCandidate = {
          code: row.erpItemCode, category: row.category,
          density: positive(row.density), widthMm: positive(row.widthMm), lengthMm: positive(row.lengthMm),
          unitWeight: positive(row.unitWeightValue), basis: typeof row.unitWeightBasis === 'string' ? row.unitWeightBasis : undefined,
        };
        const key = `${candidate.code}\u0000${candidate.category}`;
        const existing = matches.get(key) ?? [];
        if (!existing.some((entry) => JSON.stringify(entry) === JSON.stringify(candidate))) existing.push(candidate);
        matches.set(key, existing);
      }
    }
  }
  return matches;
}

function dimension(row: readonly string[], headers: readonly string[], name: string): number | undefined {
  const notes = row[headers.indexOf('備註')] ?? '';
  const originals = [...notes.matchAll(new RegExp(`原${name}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*mm`, 'gu'))];
  const values = new Set(originals.map((entry) => entry[1]));
  if (values.size > 1) return undefined;
  const original = originals[0]?.[1];
  return readSystemOrderDimension(original ?? row[headers.indexOf(name)] ?? '');
}

function decimal(value: number): string {
  const text = String(value);
  if (!/[eE]/u.test(text)) return text;
  const [coefficient = '', power = '0'] = text.toLowerCase().split('e');
  const [integer = '', fraction = ''] = coefficient.split('.');
  const digits = integer + fraction;
  const position = integer.length + Number(power);
  if (position <= 0) return `0.${'0'.repeat(-position)}${digits}`;
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length);
  return `${digits.slice(0, position)}.${digits.slice(position)}`;
}

function multiply(values: readonly (number | string)[], divideScale = 0): string {
  let digits = BigInt(1);
  let scale = divideScale;
  for (const value of values) {
    const [integer = '0', fraction = ''] = (typeof value === 'string' ? value : decimal(value)).split('.');
    digits *= BigInt(integer + fraction);
    scale += fraction.length;
  }
  const text = digits.toString().padStart(scale + 1, '0');
  if (scale === 0) return text;
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/0+$/u, '').replace(/\.$/u, '');
}

/** Recalculate only rows with one matching price candidate and sufficient physical data. */
export function recalculateSystemOrderWeights(input: {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  results: readonly SteelToolResult[];
}): string[][] {
  const matches = candidates(input.results);
  const index = (name: string) => input.headers.indexOf(name);
  return input.rows.map((source) => {
    const row = [...source];
    if ((row[index('單位')] ?? '').toLowerCase() !== 'kg') return row;
    const category = row[index('類別')] ?? '';
    const selected = matches.get(`${row[index('型號')] ?? ''}\u0000${category}`);
    if (selected?.length !== 1) return row;
    const candidate = selected[0];
    if (!candidate) return row;
    const length = dimension(row, input.headers, '長度');
    const quantityText = cleanSystemOrderNumber(row[index('數量')] ?? '');
    const quantity = quantityText ? Number(quantityText) : undefined;
    let weight: string | undefined;
    if (category === '鐵板') {
      const thickness = dimension(row, input.headers, '厚度');
      const width = dimension(row, input.headers, '寬度');
      if (candidate.density && thickness && width && length) {
        weight = multiply([thickness, width, length, candidate.density], 6);
      }
    } else if (category === '方鐵') {
      if (candidate.density && candidate.widthMm && length) {
        weight = multiply([candidate.widthMm, candidate.widthMm, length, candidate.density], 6);
      }
    } else if (PROFILE_CATEGORIES.has(category) && candidate.unitWeight && length &&
      !/(?:C2|2C|結筒)/iu.test(`${row[index('品名規格')] ?? ''} ${row[index('備註')] ?? ''}`)) {
      if (candidate.basis === 'kg_per_piece_or_stock_length' && candidate.lengthMm) {
        weight = decimal(candidate.unitWeight * length / candidate.lengthMm);
      } else if (['M', 'kg_per_m', 'kg/m'].includes(candidate.basis ?? '')) {
        weight = multiply([candidate.unitWeight, length], 3);
      }
    }
    if (weight === undefined || !Number.isFinite(Number(weight))) return row;
    const unitWeightIndex = index('單重');
    const totalIndex = index('總數');
    if (unitWeightIndex >= 0) row[unitWeightIndex] = weight;
    if (totalIndex >= 0) {
      row[totalIndex] = quantity !== undefined && Number.isFinite(quantity)
        ? multiply([weight, quantityText]) : '';
    }
    return row;
  });
}
