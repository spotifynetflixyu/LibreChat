import { isSteelSectionTitle, parseSteelSectionTitle } from 'librechat-data-provider';
import type { MarkdownFence } from './parser';
import {
  escapeMarkdownTableCell,
  isMarkdownTableSeparatorCell,
  parsePipeTableRow,
} from './row-codec';
import { getFenceStart, closesFence, getH2Title } from './parser';

export interface CustomerQuoteComposition {
  markdown: string;
  sourceEnd: number;
}

export interface CustomerQuoteParser {
  append(delta: string): void;
  getSafeTextEnd(): number;
  finish(): CustomerQuoteComposition | undefined;
}

interface MarkdownLine {
  text: string;
}

interface SystemOrderHeading {
  suffix?: string;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
  sourceEnd: number;
}

interface DecimalValue {
  digits: string;
  scale: number;
}

const REQUIRED_HEADERS = {
  item: '品名規格',
  quantity: '總數',
  unitPrice: '單價',
} as const;

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

function parseSystemOrderHeading(line: string): SystemOrderHeading | undefined {
  const title = getH2Title(line);
  if (!title) {
    return undefined;
  }

  if (!isSteelSectionTitle(title, 'system_order')) {
    return undefined;
  }
  const { label } = parseSteelSectionTitle(title);
  return label ? { suffix: label } : {};
}

function isCustomerQuoteHeading(line: string): boolean {
  const title = getH2Title(line);
  if (!title) {
    return false;
  }

  return isSteelSectionTitle(title, 'customer_quote');
}

function extractDecimal(value: string): DecimalValue | undefined {
  if (/[+-]/.test(value)) {
    return undefined;
  }

  const matches = Array.from(value.matchAll(/\d[\d,]*(?:\.\d+)?/g));
  if (matches.length !== 1) {
    return undefined;
  }

  const match = matches[0];
  const token = match?.[0];
  const tokenIndex = match?.index;
  if (!token || tokenIndex === undefined) {
    return undefined;
  }

  const previous = value[tokenIndex - 1];
  const next = value[tokenIndex + token.length];
  if (previous === '.' || previous === ',' || next === '.' || next === ',') {
    return undefined;
  }

  const valid = /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(token);
  if (!valid) {
    return undefined;
  }

  const normalized = token.replace(/,/g, '');
  const decimalIndex = normalized.indexOf('.');
  const whole = decimalIndex < 0 ? normalized : normalized.slice(0, decimalIndex);
  const fraction = decimalIndex < 0 ? '' : normalized.slice(decimalIndex + 1);
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';

  return {
    digits,
    scale: fraction.length,
  };
}

function multiplyAndCeil(left: string, right: string): string | undefined {
  const leftValue = extractDecimal(left);
  const rightValue = extractDecimal(right);
  if (!leftValue || !rightValue) {
    return undefined;
  }

  const product = BigInt(leftValue.digits) * BigInt(rightValue.digits);
  const scale = leftValue.scale + rightValue.scale;
  if (scale === 0) {
    return product.toString();
  }

  const divisor = BigInt(`1${'0'.repeat(scale)}`);
  const quotient = product / divisor;
  return (product % divisor === BIGINT_ZERO ? quotient : quotient + BIGINT_ONE).toString();
}

function composeQuote(table: ParsedTable, suffix: string | undefined): CustomerQuoteComposition {
  const itemIndex = table.headers.indexOf(REQUIRED_HEADERS.item);
  const quantityIndex = table.headers.indexOf(REQUIRED_HEADERS.quantity);
  const unitPriceIndex = table.headers.indexOf(REQUIRED_HEADERS.unitPrice);
  const outputRows: string[] = [];
  let total = BIGINT_ZERO;
  let usableSubtotalCount = 0;

  for (const row of table.rows) {
    const item = row[itemIndex] ?? '';
    const quantity = row[quantityIndex] ?? '';
    const unitPrice = row[unitPriceIndex] ?? '';
    const subtotal = multiplyAndCeil(quantity, unitPrice);
    if (subtotal !== undefined) {
      total += BigInt(subtotal);
      usableSubtotalCount += 1;
    }

    outputRows.push(
      `| ${escapeMarkdownTableCell(item)} | ${escapeMarkdownTableCell(quantity)} | ${subtotal ?? ''} |`,
    );
  }

  const title = suffix ? `## customer_quote｜${suffix}` : '## customer_quote';
  const totalCell = usableSubtotalCount > 0 ? total.toString() : '';
  const markdown = [
    title,
    '',
    '| 項目 | 總數 | 小計 |',
    '| --- | --- | --- |',
    ...outputRows,
    `| 總計 |  | ${totalCell} |`,
  ].join('\n');

  return { markdown, sourceEnd: table.sourceEnd };
}

function isPendingMarkdownControlLine(line: string): boolean {
  const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
  const indent = normalizedLine.match(/^ */)?.[0].length ?? 0;
  if (indent > 3) {
    return false;
  }

  const content = normalizedLine.slice(indent);
  if (
    '```'.startsWith(content) ||
    content.startsWith('```') ||
    '~~~'.startsWith(content) ||
    content.startsWith('~~~')
  ) {
    return true;
  }

  if ('##'.startsWith(content)) {
    return true;
  }
  if (!content.startsWith('##')) {
    return false;
  }

  const nextCharacter = content[2];
  return nextCharacter === undefined || /[ \t]/.test(nextCharacter);
}

interface CustomerQuoteSection {
  heading: SystemOrderHeading;
  previousLine?: MarkdownLine;
  firstTableChecked: boolean;
}

export function createCustomerQuoteParser(): CustomerQuoteParser {
  let fence: MarkdownFence | undefined;
  let section: CustomerQuoteSection | undefined;
  let selectedTable: ParsedTable | undefined;
  let selectedSuffix: string | undefined;
  let tableTailFrozen = false;
  let existingCustomerQuote = false;
  let safeTextEnd = 0;
  let textLength = 0;
  let pendingLineStart = 0;
  let pendingLineParts: string[] = [];
  let finished = false;

  const processLine = (rawLine: string, sourceEnd: number): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (fence) {
      if (closesFence(line, fence)) {
        fence = undefined;
      }
      safeTextEnd = existingCustomerQuote || !selectedTable ? sourceEnd : selectedTable.sourceEnd;
      return;
    }

    const opening = getFenceStart(line);
    if (opening) {
      fence = opening;
      if (selectedTable) {
        tableTailFrozen = true;
        safeTextEnd = selectedTable.sourceEnd;
      } else {
        if (section) {
          section.previousLine = undefined;
        }
        safeTextEnd = sourceEnd;
      }
      return;
    }

    const title = getH2Title(line);
    if (title !== undefined) {
      if (isCustomerQuoteHeading(line)) {
        existingCustomerQuote = true;
        safeTextEnd = sourceEnd;
        return;
      }

      if (!selectedTable) {
        const heading = parseSystemOrderHeading(line);
        section = heading
          ? {
              heading,
              firstTableChecked: false,
            }
          : undefined;
        safeTextEnd = sourceEnd;
      } else {
        tableTailFrozen = true;
        safeTextEnd = selectedTable.sourceEnd;
      }
      return;
    }

    if (existingCustomerQuote) {
      safeTextEnd = sourceEnd;
      return;
    }

    if (selectedTable) {
      if (tableTailFrozen) {
        return;
      }

      const row = parsePipeTableRow(line);
      if (!row) {
        tableTailFrozen = true;
        safeTextEnd = selectedTable.sourceEnd;
        return;
      }

      selectedTable.rows.push(row);
      selectedTable.sourceEnd = sourceEnd;
      safeTextEnd = sourceEnd;
      return;
    }

    if (!section) {
      safeTextEnd = sourceEnd;
      return;
    }

    if (section.firstTableChecked) {
      safeTextEnd = sourceEnd;
      return;
    }

    const previousLine = section.previousLine;
    if (!previousLine) {
      section.previousLine = { text: line };
      safeTextEnd = sourceEnd;
      return;
    }

    const headers = parsePipeTableRow(previousLine.text);
    const separator = parsePipeTableRow(line);
    if (
      !headers ||
      !separator ||
      headers.length !== separator.length ||
      !separator.every(isMarkdownTableSeparatorCell)
    ) {
      section.previousLine = { text: line };
      safeTextEnd = sourceEnd;
      return;
    }

    section.firstTableChecked = true;
    section.previousLine = undefined;
    const normalizedHeaders = headers.map((header) => header.trim());
    if (
      !normalizedHeaders.includes(REQUIRED_HEADERS.item) ||
      !normalizedHeaders.includes(REQUIRED_HEADERS.quantity) ||
      !normalizedHeaders.includes(REQUIRED_HEADERS.unitPrice)
    ) {
      safeTextEnd = sourceEnd;
      return;
    }

    selectedTable = {
      headers: normalizedHeaders,
      rows: [],
      sourceEnd,
    };
    selectedSuffix = section.heading.suffix;
    safeTextEnd = sourceEnd;
  };

  const updatePendingSafeEnd = (): void => {
    if (existingCustomerQuote) {
      safeTextEnd = textLength;
      return;
    }

    const pendingLine = pendingLineParts.join('');
    if (selectedTable) {
      if (
        !tableTailFrozen &&
        pendingLine !== '' &&
        !isPendingMarkdownControlLine(pendingLine) &&
        parsePipeTableRow(pendingLine)
      ) {
        safeTextEnd = textLength;
        return;
      }
      safeTextEnd = selectedTable.sourceEnd;
      return;
    }

    safeTextEnd = isPendingMarkdownControlLine(pendingLine) ? pendingLineStart : textLength;
  };

  return {
    append(delta: string): void {
      if (finished || delta === '') {
        return;
      }

      const baseOffset = textLength;
      let segmentStart = 0;
      while (segmentStart < delta.length) {
        const newlineIndex = delta.indexOf('\n', segmentStart);
        const segmentEnd = newlineIndex < 0 ? delta.length : newlineIndex;
        pendingLineParts.push(delta.slice(segmentStart, segmentEnd));
        if (newlineIndex < 0) {
          break;
        }

        const lineEnd = baseOffset + newlineIndex + 1;
        processLine(pendingLineParts.join(''), lineEnd);
        pendingLineParts = [];
        pendingLineStart = lineEnd;
        segmentStart = newlineIndex + 1;
      }

      textLength = baseOffset + delta.length;
      updatePendingSafeEnd();
    },

    getSafeTextEnd(): number {
      return safeTextEnd;
    },

    finish(): CustomerQuoteComposition | undefined {
      if (!finished) {
        const pendingLine = pendingLineParts.join('');
        if (pendingLine !== '') {
          processLine(pendingLine, textLength);
        }
        finished = true;
        updatePendingSafeEnd();
      }

      if (existingCustomerQuote || !selectedTable) {
        return undefined;
      }

      return composeQuote(selectedTable, selectedSuffix);
    },
  };
}

export function buildCustomerQuoteFromMarkdown(
  markdown: string,
): CustomerQuoteComposition | undefined {
  const parser = createCustomerQuoteParser();
  parser.append(markdown);
  return parser.finish();
}
