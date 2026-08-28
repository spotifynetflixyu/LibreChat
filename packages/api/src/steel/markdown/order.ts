export interface SystemOrderNormalizer {
  append(delta: string): string;
  finish(options?: { raw?: boolean }): string;
}

interface Fence {
  character: '`' | '~';
  length: number;
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

function getH2Title(line: string): string | undefined {
  const match = line.match(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u);
  if (!match) return undefined;
  return (match[1] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim();
}

function isSystemOrderTitle(title: string): boolean {
  const separator = title.indexOf('｜');
  if (separator < 0) return title === 'system_order';
  return (
    title.slice(0, separator).trim() === 'system_order' &&
    title.slice(separator + 1).trim() !== ''
  );
}

function getFenceOpening(line: string): Fence | undefined {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})(?:.*)$/u)?.[1];
  return marker ? { character: marker[0] as '`' | '~', length: marker.length } : undefined;
}

function isFenceClosing(line: string, fence: Fence): boolean {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
  return marker?.[0] === fence.character && marker.length >= fence.length;
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

function cleanCell(header: string, value: string): string | undefined {
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
  let result = '';
  let cursor = 0;
  row.cells.forEach((cell, index) => {
    const replacement = cleanCell(headers[index] ?? '', row.values[index] ?? '');
    if (replacement === undefined) return;
    result += line.slice(cursor, cell.start) + replaceCell(line, cell, replacement);
    cursor = cell.end;
  });
  return result + line.slice(cursor);
}

function tableHeaders(header: RawRow, separator: RawRow): string[] | undefined {
  return header.values.length === separator.values.length &&
    separator.values.every(isSeparatorCell)
    ? header.values
    : undefined;
}

export function createSystemOrderNormalizer(): SystemOrderNormalizer {
  let pending = '';
  let finished = false;
  let fence: Fence | undefined;
  let sectionActive = false;
  let tableChecked = false;
  let candidateHeaders: string[] | undefined;
  let headers: string[] | undefined;

  const processLine = (line: string): string => {
    if (fence) {
      if (isFenceClosing(line, fence)) fence = undefined;
      return line;
    }
    const opening = getFenceOpening(line);
    if (opening) {
      fence = opening;
      candidateHeaders = undefined;
      headers = undefined;
      return line;
    }
    const title = getH2Title(line);
    if (title !== undefined) {
      sectionActive = isSystemOrderTitle(title);
      tableChecked = false;
      candidateHeaders = undefined;
      headers = undefined;
      return line;
    }
    const row = parseRawRow(line);
    if (headers) {
      if (!row) {
        headers = undefined;
        return line;
      }
      return normalizeRow(line, row, headers);
    }
    if (!sectionActive || tableChecked) return line;
    if (!row) {
      candidateHeaders = undefined;
      return line;
    }
    if (candidateHeaders) {
      const parsedHeaders = tableHeaders({ cells: [], values: candidateHeaders }, row);
      if (parsedHeaders) {
        headers = parsedHeaders;
        tableChecked = true;
        candidateHeaders = undefined;
        return line;
      }
    }
    candidateHeaders = row.values;
    return line;
  };

  const processCompleteLine = (line: string): string => {
    const hasCarriageReturn = line.endsWith('\r');
    const content = hasCarriageReturn ? line.slice(0, -1) : line;
    return `${processLine(content)}${hasCarriageReturn ? '\r\n' : '\n'}`;
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
        const raw = pending;
        pending = '';
        return raw;
      }
      const final = pending;
      pending = '';
      if (final === '') return '';
      const hasCarriageReturn = final.endsWith('\r');
      const content = hasCarriageReturn ? final.slice(0, -1) : final;
      return `${processLine(content)}${hasCarriageReturn ? '\r' : ''}`;
    },
  };
}

export function normalizeSystemOrderMarkdown(markdown: string): string {
  const normalizer = createSystemOrderNormalizer();
  return normalizer.append(markdown) + normalizer.finish();
}
