import { parseMarkdownTables } from './table';

export const OCR_COMPLETION_DIRECTIVE_MARKER = '# Current-turn OCR completion directive';

const LEGACY_OCR_SUMMARY_PATTERN =
  /(?:^|\r?\n)OCR 整理完成：共 \d+ 個來源、\d+ 筆資料(?:、\d+ 項待複核事項|，無待複核事項)。[ \t]*(?:\r?\n[ \t]*)*$/u;
const H2_PATTERN = /^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u;

interface OcrSection {
  body: string;
  title: string;
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
  let title: string | undefined;
  let body: string[] = [];

  const pushSection = () => {
    if (title !== undefined) {
      sections.push({ title, body: body.join('\n') });
    }
  };

  for (const line of text.split(/\r?\n/u)) {
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

function stripTrailingLegacySummary(text: string): string {
  const match = LEGACY_OCR_SUMMARY_PATTERN.exec(text);
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
    sections.find(({ title }) => title === '來源檔案對照表'),
  );
  const resultTable = getFirstSectionTable(
    sections.find(({ title }) => title === 'OCR 結果確認表'),
  );
  const reviewSection = sections.find(({ title }) => title === 'manual_review');

  if (!mappingTable || !resultTable) {
    return text;
  }

  const reviewTable = reviewSection ? getFirstSectionTable(reviewSection) : undefined;
  if (reviewSection && !reviewTable) {
    return text;
  }

  const sourceCount = mappingTable.rows.length;
  const resultCount = resultTable.rows.length;
  const reviewCount = reviewTable?.rows.length ?? 0;
  const summary =
    reviewCount > 0
      ? `OCR 整理完成：共 ${sourceCount} 個來源、${resultCount} 筆資料、${reviewCount} 項待複核事項。`
      : `OCR 整理完成：共 ${sourceCount} 個來源、${resultCount} 筆資料，無待複核事項。`;

  return appendSummary(stripTrailingLegacySummary(text), summary);
}
