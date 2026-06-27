import { readFile } from 'fs/promises';
import path from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import expected from './fixtures/c.expected.json';

const runCPdfOcr = process.env.STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST === 'true';
const describeCPdfOcr = runCPdfOcr ? describe : describe.skip;
const caseTimeoutMs = Number(process.env.STEEL_PADDLEOCR_MCP_TIMEOUT_MS ?? 1200000);
const expectedRows = expected.rows;
const repoRoot = path.resolve(__dirname, '../../../../../');

type ExpectedRow = (typeof expectedRows)[number];
type PaddleOcrToolResult = Awaited<ReturnType<Client['callTool']>>;

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[xX＊*]/g, '×')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsPartNo(text: string, partNo: string) {
  return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(partNo)}([^A-Z0-9]|$)`, 'i').test(text);
}

function boltTotalMatches(rowText: string, expectedRow: ExpectedRow) {
  return (
    rowText.includes(String(expectedRow.boltTotal)) ||
    rowText.includes(normalize(expectedRow.boltTotalExpression))
  );
}

function rowMatchesSegment(segment: string, expectedRow: ExpectedRow) {
  const rowText = normalize(segment);

  return (
    containsPartNo(rowText, expectedRow.partNo) &&
    rowText.includes(expectedRow.name) &&
    rowText.includes(normalize(expectedRow.spec)) &&
    rowText.includes(String(expectedRow.quantity)) &&
    rowText.includes(expectedRow.boltSize) &&
    boltTotalMatches(rowText, expectedRow)
  );
}

function extractText(result: PaddleOcrToolResult) {
  return result.content
    .filter((part): part is Extract<(typeof result.content)[number], { type: 'text' }> => {
      return part.type === 'text';
    })
    .map((part) => part.text)
    .join('\n');
}

function extractSegments(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const windows = lines.map((_, index) => lines.slice(Math.max(0, index - 1), index + 2).join(' '));

  return [...new Set([...lines, ...windows])];
}

function candidateRowsFor(segments: readonly string[], partNo: string) {
  return segments
    .filter((segment) => containsPartNo(normalize(segment), partNo))
    .slice(0, 3)
    .map((segment) => normalize(segment));
}

function getInheritedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}

function getPaddleOcrEnv() {
  const accessToken = process.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    throw new Error(
      'PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN is required for STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST=true. Set it in .env and run Jest with dotenv/config.',
    );
  }

  return {
    ...getInheritedEnv(),
    PADDLEOCR_MCP_MODEL: 'PaddleOCR-VL-1.6',
    PADDLEOCR_MCP_PPOCR_SOURCE: 'aistudio',
    PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN: accessToken,
  };
}

describeCPdfOcr('Steel PaddleOCR MCP c.pdf drawing OCR full accuracy', () => {
  it(
    'extracts table row data equivalent to c.expected.json without requiring exact field names',
    async () => {
      const pdfPath = path.join(repoRoot, 'docs/reference/example/c.pdf');
      await readFile(pdfPath);
      const transport = new StdioClientTransport({
        command: 'uvx',
        args: ['--from', 'paddleocr-mcp', 'paddleocr_mcp'],
        env: getPaddleOcrEnv(),
        stderr: 'pipe',
      });
      const client = new Client({ name: 'librechat-steel-paddleocr-test', version: '0.0.0' });
      const stderrChunks: string[] = [];
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void client.close();
      }, caseTimeoutMs);

      transport.stderr?.on('data', (chunk) => {
        stderrChunks.push(String(chunk));
      });

      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.some((tool) => tool.name === 'paddleocr_vl')).toBe(true);

        const response = await client.callTool(
          {
            name: 'paddleocr_vl',
            arguments: {
              input_data: pdfPath,
              output_mode: 'detailed',
              file_type: 'pdf',
              return_images: false,
              runtime_params: {
                max_new_tokens: 12000,
                use_doc_orientation_classify: true,
                use_doc_unwarping: true,
                use_layout_detection: true,
              },
            },
          },
          undefined,
          { timeout: caseTimeoutMs },
        );
        const ocrText = extractText(response);
        const segments = extractSegments(ocrText);
        const matchedRows = expectedRows.filter((expectedRow) =>
          segments.some((segment) => rowMatchesSegment(segment, expectedRow)),
        );
        const missingRows = expectedRows.filter((row) => !matchedRows.includes(row));
        const result = {
          matchedPartNos: matchedRows.map((row) => row.partNo),
          missingRows: missingRows.map((row) => ({
            ...row,
            candidateRows: candidateRowsFor(segments, row.partNo),
          })),
          ocrTextPreview: normalize(ocrText).slice(0, 800),
          stderrPreview: stderrChunks.join('').slice(-800),
        };

        if (timedOut) {
          throw new Error(`PaddleOCR MCP c.pdf OCR timed out after ${caseTimeoutMs} ms.`);
        }

        expect(result).toEqual(
          expect.objectContaining({
            matchedPartNos: expectedRows.map((row) => row.partNo),
            missingRows: [],
          }),
        );
        expect(JSON.stringify(response)).not.toMatch(
          /PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN|access_token|authorization|Bearer/i,
        );
      } finally {
        clearTimeout(timeout);
        await client.close();
      }
    },
    caseTimeoutMs + 10000,
  );
});
