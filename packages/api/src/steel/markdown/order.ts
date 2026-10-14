import { isSteelSectionTitle } from 'librechat-data-provider';
import type { MarkdownFence } from './parser';
import { escapeMarkdownTableCell } from './row-codec';
import { getFenceStart, closesFence, getH2Title } from './parser';

export const systemOrderColumns = [
  '型號',
  '品名規格',
  '材質編號',
  '單價',
  '數量',
  '總數',
  '厚度',
  '寬度',
  '長度',
  '肚',
  '單位',
  '類別',
  '單重',
  '計價基準',
  '公式編號',
  '備註',
] as const;

export interface SystemOrderNormalizer {
  append(delta: string): string;
  finish(options?: { raw?: boolean }): string;
}

interface RawCell {
  end: number;
  start: number;
  value: string;
}

interface RawRow {
  cells: RawCell[];
  values: string[];
}

const DIMENSION_HEADERS = new Set(['厚度', '寬度', '長度', '肚']);
const NUMERIC_HEADERS = new Set(['數量', '單重', '總數', '單價', '厚度', '寬度', '長度', '肚']);
const DECIMAL_TOKEN = /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/u;

function isSeparatorCell(value: string): boolean {
  return /^:?-{3,}:?$/u.test(value);
}

function decodeCell(value: string): string {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    const next = value[index + 1] ?? '';
    if (character === '\\' && (next === '|' || next === '\\')) {
      decoded += next;
      index += 1;
    } else {
      decoded += character;
    }
  }
  return decoded.trim();
}

function parseRawRow(line: string): RawRow | undefined {
  const start = line.search(/\S/u);
  if (start < 0) return undefined;
  const trailing = line.slice(start).match(/\s*$/u)?.[0] ?? '';
  const end = line.length - trailing.length;
  const source = line.slice(start, end);
  const parts: Array<{ end: number; start: number }> = [];
  let partStart = 0;
  let pipeCount = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character !== '|') {
      continue;
    }
    pipeCount += 1;
    parts.push({ start: partStart, end: index });
    partStart = index + 1;
  }
  if (pipeCount === 0) return undefined;
  parts.push({ start: partStart, end: source.length });
  if (source.startsWith('|')) parts.shift();
  const lastPart = parts[parts.length - 1];
  if (source.endsWith('|') && lastPart?.start === lastPart?.end) parts.pop();
  if (
    parts.length === 0 ||
    (parts.length === 1 && !(source.startsWith('|') && source.endsWith('|')))
  ) {
    return undefined;
  }
  const cells = parts.map((part) => ({
    start: start + part.start,
    end: start + part.end,
    value: decodeCell(source.slice(part.start, part.end)),
  }));
  return { cells, values: cells.map((cell) => cell.value) };
}

function isSystemOrderTitle(title: string): boolean {
  if (title === 'system_order_chunk' || title === 'system_order_updates') return true;
  return isSteelSectionTitle(title, 'system_order');
}

function cleanDecimal(value: string): string {
  const text = value.trim();
  if (
    text === '' ||
    /[+\-\u00B1\u02D7\u2010-\u2015\u207A\u207B\u208A\u208B\u2212\u2213\u2795\u2796\uFE62\uFE63\uFF0B\uFF0D]/u.test(
      text,
    )
  ) {
    return '';
  }
  const matches = Array.from(text.matchAll(/\d[\d,]*(?:\.\d+)?/gu));
  if (matches.length !== 1) return '';
  const match = matches[0];
  const token = match?.[0] ?? '';
  const position = match?.index ?? -1;
  if (!token || position < 0) return '';
  if (
    text[position - 1] === '.' ||
    text[position - 1] === ',' ||
    text[position + token.length] === '.' ||
    text[position + token.length] === ','
  ) {
    return '';
  }
  return DECIMAL_TOKEN.test(token) ? token.replace(/,/gu, '') : '';
}

export function cleanSystemOrderNumber(value: string): string {
  return cleanDecimal(value);
}

function dimensionFactor(value: string): { numerator: bigint; denominator: bigint } {
  const unit = value
    .toLowerCase()
    .match(/(?:mm|m\/m|毫米|公厘|cm|公分|厘米|inch|in\b|英吋|英寸|吋|"|m\b|公尺|米)/u)?.[0];
  if (unit && /^(?:cm|公分|厘米)$/u.test(unit))
    return { numerator: BigInt(10), denominator: BigInt(1) };
  if (unit && /^(?:m|公尺|米)$/u.test(unit))
    return { numerator: BigInt(1_000), denominator: BigInt(1) };
  if (unit && /^(?:inch|in|英吋|英寸|吋|")$/u.test(unit))
    return { numerator: BigInt(254), denominator: BigInt(10) };
  return { numerator: BigInt(1), denominator: BigInt(1) };
}

export function readSystemOrderDimension(value: string): number | undefined {
  const decimal = cleanDecimal(value);
  if (!decimal) return undefined;
  const factor = dimensionFactor(value);
  const result = (Number(decimal) * Number(factor.numerator)) / Number(factor.denominator);
  return Number.isFinite(result) ? result : undefined;
}

export function cleanSystemOrderDimension(
  value: string,
  rounding: 'half-up' | 'ceil' = 'half-up',
): string {
  const decimal = cleanDecimal(value);
  if (!decimal) return '';
  const { numerator, denominator } = dimensionFactor(value);
  const [integer = '0', fraction = ''] = decimal.split('.');
  const scale = BigInt('1' + '0'.repeat(fraction.length)) * denominator;
  const digits = BigInt(integer + fraction) * numerator;
  if (rounding === 'ceil') return ((digits + scale - BigInt(1)) / scale).toString();
  return ((digits * BigInt(2) + scale) / (scale * BigInt(2))).toString();
}

function cleanCell(header: string, value: string): string | undefined {
  if (DIMENSION_HEADERS.has(header))
    return cleanSystemOrderDimension(
      value,
      header === '長度' || header === '寬度' ? 'ceil' : 'half-up',
    );
  if (NUMERIC_HEADERS.has(header)) return cleanDecimal(value);
  if (header !== '計價基準') return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(text)) return text;
  const basis = text.toUpperCase();
  if (/^[A-F]$/u.test(basis)) return String(basis.charCodeAt(0) - 64);
  return '';
}

function replaceCell(line: string, cell: RawCell, value: string): string {
  const raw = line.slice(cell.start, cell.end);
  const leading = raw.match(/^\s*/u)?.[0] ?? '';
  const trailing = raw.match(/\s*$/u)?.[0] ?? '';
  const leadingEnd = leading.length;
  const trailingStart = raw.length - trailing.length;
  if (value === '') return leadingEnd >= trailingStart ? raw : `${leading}${trailing}`;
  return `${leading}${value}${trailing}`;
}

function normalizeRow(line: string, row: RawRow, headers: string[]): string {
  const replacements = row.cells.map((_, index) =>
    cleanCell(headers[index] ?? '', row.values[index] ?? ''),
  );
  const noteIndex = headers.indexOf('備註');
  if (noteIndex >= 0) {
    const originals = headers.flatMap((header, index) => {
      if (!DIMENSION_HEADERS.has(header)) return [];
      const original = readSystemOrderDimension(row.values[index] ?? '');
      const rounded = replacements[index];
      return original !== undefined && rounded && original !== Number(rounded)
        ? [`原${header} ${original} mm`]
        : [];
    });
    if (originals.length > 0) {
      replacements[noteIndex] = escapeMarkdownTableCell(
        [row.values[noteIndex], ...originals].filter(Boolean).join('；'),
      );
    }
  }
  let result = '';
  let cursor = 0;
  row.cells.forEach((cell, index) => {
    const replacement = replacements[index];
    if (replacement === undefined) return;
    result += line.slice(cursor, cell.start) + replaceCell(line, cell, replacement);
    cursor = cell.end;
  });
  return result + line.slice(cursor);
}

function tableHeaders(header: RawRow, separator: RawRow): string[] | undefined {
  return header.values.length === separator.values.length && separator.values.every(isSeparatorCell)
    ? header.values
    : undefined;
}

function columnIndices(headers: readonly string[]): number[] | undefined {
  if (headers.length !== systemOrderColumns.length) return undefined;
  const indices = systemOrderColumns.map((header) => headers.indexOf(header));
  return indices.every((index) => index >= 0) ? indices : undefined;
}

function reorderRow(line: string, row: RawRow, indices: readonly number[] | undefined): string {
  if (!indices || row.cells.length !== indices.length) return line;
  return (
    line.slice(0, row.cells[0].start) +
    indices.map((index) => line.slice(row.cells[index].start, row.cells[index].end)).join('|') +
    line.slice(row.cells[row.cells.length - 1].end)
  );
}

export function createSystemOrderNormalizer(): SystemOrderNormalizer {
  let pending = '';
  let finished = false;
  let fence: MarkdownFence | undefined;
  let sectionActive = false;
  let tableChecked = false;
  let candidateHeaders: string[] | undefined;
  let headers: string[] | undefined;
  let indices: number[] | undefined;
  let pendingHeader: { raw: string; ordered: string } | undefined;

  const processLine = (line: string): string => {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      return line;
    }
    const opening = getFenceStart(line);
    if (opening) {
      fence = opening;
      candidateHeaders = undefined;
      headers = undefined;
      indices = undefined;
      return line;
    }
    const title = getH2Title(line);
    if (title !== undefined) {
      sectionActive = isSystemOrderTitle(title);
      tableChecked = false;
      candidateHeaders = undefined;
      headers = undefined;
      indices = undefined;
      return line;
    }
    const row = parseRawRow(line);
    if (headers) {
      if (!row) {
        headers = undefined;
        indices = undefined;
        return line;
      }
      const normalized = normalizeRow(line, row, headers);
      const normalizedRow = indices ? parseRawRow(normalized) : undefined;
      return normalizedRow ? reorderRow(normalized, normalizedRow, indices) : normalized;
    }
    if (!sectionActive || tableChecked) return line;
    if (!row) {
      candidateHeaders = undefined;
      indices = undefined;
      return line;
    }
    if (candidateHeaders) {
      const parsedHeaders = tableHeaders({ cells: [], values: candidateHeaders }, row);
      if (parsedHeaders) {
        headers = parsedHeaders;
        tableChecked = true;
        candidateHeaders = undefined;
        return reorderRow(line, row, indices);
      }
    }
    candidateHeaders = row.values.map((header) => header.replace(/^(\*\*|__)(.+)\1$/u, '$2'));
    indices = columnIndices(candidateHeaders);
    return reorderRow(line, row, indices);
  };

  const processTextLine = (content: string, ending: string): string => {
    const previousHeader = pendingHeader;
    pendingHeader = undefined;
    const output = processLine(content);
    const previousLine = headers ? previousHeader?.ordered : previousHeader?.raw;
    const prefix = previousLine ?? '';
    if (candidateHeaders && indices && !headers) {
      pendingHeader = { raw: content + ending, ordered: output + ending };
      return prefix;
    }
    return prefix + output + ending;
  };

  const processCompleteLine = (line: string): string => {
    const hasCarriageReturn = line.endsWith('\r');
    const content = hasCarriageReturn ? line.slice(0, -1) : line;
    return processTextLine(content, hasCarriageReturn ? '\r\n' : '\n');
  };

  return {
    append(delta: string): string {
      if (finished || delta === '') return '';
      pending += delta;
      let output = '';
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        output += processCompleteLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
      return output;
    },
    finish(options): string {
      if (finished) return '';
      finished = true;
      if (options?.raw) {
        const raw = (pendingHeader?.raw ?? '') + pending;
        pendingHeader = undefined;
        pending = '';
        return raw;
      }
      const final = pending;
      pending = '';
      if (final === '') {
        const raw = pendingHeader?.raw ?? '';
        pendingHeader = undefined;
        return raw;
      }
      const hasCarriageReturn = final.endsWith('\r');
      const content = hasCarriageReturn ? final.slice(0, -1) : final;
      const output = processTextLine(content, hasCarriageReturn ? '\r' : '');
      const raw = pendingHeader?.raw ?? '';
      pendingHeader = undefined;
      return output + raw;
    },
  };
}

export function normalizeSystemOrderMarkdown(markdown: string): string {
  const normalizer = createSystemOrderNormalizer();
  return normalizer.append(markdown) + normalizer.finish();
}
