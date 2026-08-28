import {
  escapeMarkdownTableCell,
  isMarkdownTableSeparatorCell,
  parsePipeTableRow,
} from './row-codec';

export interface CustomerQuoteComposition {
  markdown: string;
  sourceEnd: number;
}

export interface CustomerQuoteParser {
  append(delta: string): void;
  getSafeTextEnd(): number;
  finish(): CustomerQuoteComposition | undefined;
}

interface MarkdownFence {
  character: '`' | '~';
  length: number;
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

function getFenceOpening(line: string): MarkdownFence | undefined {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})(?:.*)$/)?.[1];
  if (!marker) {
    return undefined;
  }

  return {
    character: marker[0] as '`' | '~',
    length: marker.length,
  };
}

function isFenceClosing(line: string, fence: MarkdownFence): boolean {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
  return marker?.[0] === fence.character && marker.length >= fence.length;
}

function getH2Title(line: string): string | undefined {
  const match = line.match(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/);
  if (!match) {
    return undefined;
  }

  return (match[1] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
}

function parseSystemOrderHeading(line: string): SystemOrderHeading | undefined {
  const title = getH2Title(line);
  if (!title) {
    return undefined;
  }

  const separatorIndex = title.indexOf('｜');
  if (separatorIndex < 0) {
    return title === 'system_order' ? {} : undefined;
  }

  const baseName = title.slice(0, separatorIndex).trim();
  const suffix = title.slice(separatorIndex + 1).trim();
  if (baseName !== 'system_order' || suffix.length === 0) {
    return undefined;
  }

  return { suffix };
}

function isCustomerQuoteHeading(line: string): boolean {
  const title = getH2Title(line);
  if (!title) {
    return false;
  }

  const separatorIndex = title.indexOf('｜');
  if (separatorIndex < 0) {
    return title === 'customer_quote';
  }

  return (
    title.slice(0, separatorIndex).trim() === 'customer_quote' &&
    title.slice(separatorIndex + 1).trim().length > 0
  );
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
      if (isFenceClosing(line, fence)) {
        fence = undefined;
      }
      safeTextEnd = existingCustomerQuote || !selectedTable ? sourceEnd : selectedTable.sourceEnd;
      return;
    }

    const opening = getFenceOpening(line);
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
