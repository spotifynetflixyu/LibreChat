import { parseMarkdownTables } from './table';

export const OCR_COMPLETION_DIRECTIVE_MARKER = '# Current-turn OCR completion directive';

const OCR_SUMMARY_PATTERN =
  /(?:^|\r?\n)OCR 整理完成：共 (?:\d+ 個來源、\d+ 筆資料，無待複核事項|\d+ 個來源、\d+ 筆資料(?:、\d+ 項待複核事項)?|\d+ 個來源、\d+ 項待複核事項|\d+ 個來源|\d+ 筆資料、\d+ 項待複核事項|\d+ 筆資料|\d+ 項待複核事項)。[ \t]*(?:\r?\n[ \t]*)*$/u;
const H2_PATTERN = /^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u;
const FENCE_START_PATTERN = /^ {0,3}(`{3,}|~{3,})/u;
const FENCE_END_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

const SOURCE_SECTION_TITLE = 'source_file_mapping';
const RESULT_SECTION_TITLE = 'ocr_result';
const REVIEW_SECTION_TITLE = 'manual_review';
const SOURCE_HEADERS = ['來源', '檔名'];
const RESULT_REQUIRED_HEADERS = ['來源', '零件編號'];
const REVIEW_REQUIRED_HEADERS = ['來源', '問題欄位'];

interface OcrSection {
  body: string;
  title: string;
}

interface MarkdownFence {
  length: number;
  marker: '`' | '~';
}

function getFenceStart(line: string): MarkdownFence | undefined {
  const match = FENCE_START_PATTERN.exec(line);
  const fence = match?.[1];
  const marker = fence?.[0];
  if (!fence || (marker !== '`' && marker !== '~')) {
    return undefined;
  }

  return { length: fence.length, marker };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const marker = FENCE_END_PATTERN.exec(line)?.[1];
  return marker?.[0] === fence.marker && marker.length >= fence.length;
}

function normalizeH2Title(line: string): string | undefined {
  const match = H2_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }

  return (match[1] ?? '').replace(/[ \t]+#+[ \t]*$/u, '').trim();
}

function getOcrSections(text: string): OcrSection[] {
  const sections: OcrSection[] = [];
  let fence: MarkdownFence | undefined;
  let title: string | undefined;
  let body: string[] = [];

  const pushSection = () => {
    if (title !== undefined) {
      sections.push({ title, body: body.join('\n') });
    }
  };

  for (const line of text.split(/\r?\n/u)) {
    if (fence) {
      if (closesFence(line, fence)) {
        fence = undefined;
      }
      continue;
    }

    const nextFence = getFenceStart(line);
    if (nextFence) {
      if (title !== undefined) {
        body.push('');
      }
      fence = nextFence;
      continue;
    }

    const nextTitle = normalizeH2Title(line);
    if (nextTitle !== undefined) {
      pushSection();
      title = nextTitle;
      body = [];
      continue;
    }

    if (title !== undefined) {
      body.push(line);
    }
  }

  pushSection();
  return sections;
}

function getFirstSectionTable(section: OcrSection | undefined) {
  if (!section) {
    return undefined;
  }

  return parseMarkdownTables(section.body)[0];
}

function isValidTable(
  table: ReturnType<typeof getFirstSectionTable>,
  requiredHeaders: readonly string[],
  exactHeaders = false,
): table is NonNullable<ReturnType<typeof getFirstSectionTable>> {
  if (
    !table ||
    table.rows.length === 0 ||
    table.rows.some((row) => row.length !== table.headers.length)
  ) {
    return false;
  }

  if (exactHeaders) {
    return table.headers.length === requiredHeaders.length &&
      requiredHeaders.every((header, index) => table.headers[index] === header);
  }

  return requiredHeaders.every((header) => table.headers.includes(header));
}

function stripTrailingOcrSummary(text: string): string {
  const match = OCR_SUMMARY_PATTERN.exec(text);
  return match ? text.slice(0, match.index) : text;
}

function appendSummary(text: string, summary: string): string {
  if (text === '') {
    return summary;
  }

  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const doubleNewline = `${newline}${newline}`;
  if (text.endsWith(doubleNewline)) {
    return `${text}${summary}`;
  }

  if (text.endsWith(newline)) {
    return `${text}${newline}${summary}`;
  }

  return `${text}${doubleNewline}${summary}`;
}

export function finalizeOcrMarkdown(text: string): string {
  const sections = getOcrSections(text);
  const mappingTable = getFirstSectionTable(
    sections.find(({ title }) => title === SOURCE_SECTION_TITLE),
  );
  const resultTable = getFirstSectionTable(
    sections.find(({ title }) => title === RESULT_SECTION_TITLE),
  );
  const reviewSection = sections.find(({ title }) => title === REVIEW_SECTION_TITLE);

  const validMappingTable = isValidTable(mappingTable, SOURCE_HEADERS, true)
    ? mappingTable
    : undefined;
  const validResultTable = isValidTable(resultTable, RESULT_REQUIRED_HEADERS)
    ? resultTable
    : undefined;
  const reviewTable = getFirstSectionTable(reviewSection);
  const validReviewTable = isValidTable(reviewTable, REVIEW_REQUIRED_HEADERS)
    ? reviewTable
    : undefined;

  const clauses: string[] = [];
  if (validMappingTable) {
    clauses.push(`${validMappingTable.rows.length} 個來源`);
  }
  if (validResultTable) {
    clauses.push(`${validResultTable.rows.length} 筆資料`);
  }
  if (validReviewTable) {
    clauses.push(`${validReviewTable.rows.length} 項待複核事項`);
  }

  if (clauses.length === 0) {
    return text;
  }

  const summary = `OCR 整理完成：共 ${clauses.join('、')}。`;

  return appendSummary(stripTrailingOcrSummary(text), summary);
}
