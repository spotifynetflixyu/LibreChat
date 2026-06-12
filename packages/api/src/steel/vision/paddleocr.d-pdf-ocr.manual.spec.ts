import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';

import { createSteelPostgresPool } from '../postgres';
import { searchSteelAgentRules } from '../repositories';

const runDPdfOcr = process.env.STEEL_PADDLEOCR_MCP_D_PDF_OCR_TEST === 'true';
const describeDPdfOcr = runDPdfOcr ? describe : describe.skip;
const caseTimeoutMs = Number(process.env.STEEL_PADDLEOCR_MCP_TIMEOUT_MS ?? 900000);
const renderDpi = Number(process.env.STEEL_PADDLEOCR_MCP_D_PDF_DPI ?? 400);
const minimumImageEdgePx = 2000;
const expectedPageCount = 2;
const repoRoot = path.resolve(__dirname, '../../../../../');

type PaddleOcrToolResult = Awaited<ReturnType<Client['callTool']>>;

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
      'PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN is required for STEEL_PADDLEOCR_MCP_D_PDF_OCR_TEST=true. Set it in .env and run Jest with dotenv/config.',
    );
  }

  return {
    ...getInheritedEnv(),
    PADDLEOCR_MCP_MODEL: 'PaddleOCR-VL-1.6',
    PADDLEOCR_MCP_PPOCR_SOURCE: 'aistudio',
    PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN: accessToken,
  };
}

function extractText(result: PaddleOcrToolResult) {
  return result.content
    .filter((part): part is Extract<(typeof result.content)[number], { type: 'text' }> => {
      return part.type === 'text';
    })
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function loadReviewedSupabaseOcrRule() {
  const pool = createSteelPostgresPool();

  try {
    const rules = await searchSteelAgentRules(pool, {
      reviewState: 'reviewed',
      ruleTypes: ['inference_order_rule', 'tool_flow_rule', 'output_policy_rule'],
      ruleSections: ['file_ocr', 'drawing_ocr', 'vision_evidence'],
      limit: 20,
    });
    const rule = rules.find((candidate) => candidate.slug === 'steel-drawing-ocr-policy');

    if (!rule) {
      throw new Error('Missing reviewed Supabase OCR rule: steel-drawing-ocr-policy');
    }

    return rule;
  } finally {
    await pool.end();
  }
}

async function renderPdfPageToPng({
  pdfPath,
  page,
  outputDir,
}: {
  pdfPath: string;
  page: number;
  outputDir: string;
}) {
  const [{ getDocument }, pdfBytes] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    readFile(pdfPath),
  ]);
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBytes),
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pdfPage = await pdf.getPage(page);
  const scale = renderDpi / 72;
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');

  await pdfPage.render({
    canvasContext: context,
    viewport,
  }).promise;

  const outputPath = path.join(outputDir, `d-page-${page}.png`);
  await writeFile(outputPath, canvas.toBuffer('image/png'));
  await pdf.destroy();

  return outputPath;
}

describeDPdfOcr('Steel PaddleOCR MCP d.pdf multi-page drawing OCR', () => {
  it(
    'loads Supabase OCR rules and processes d.pdf one high-resolution page image at a time',
    async () => {
      const pdfPath = path.join(repoRoot, 'docs/reference/example/d.pdf');
      await readFile(pdfPath);

      const ocrRule = await loadReviewedSupabaseOcrRule();
      expect(ocrRule).toEqual(
        expect.objectContaining({
          slug: 'steel-drawing-ocr-policy',
          reviewState: 'reviewed',
        }),
      );

      const outputDir = await mkdtemp(path.join(os.tmpdir(), 'steel-d-pdf-ocr-'));
      const transport = new StdioClientTransport({
        command: 'uvx',
        args: ['--from', 'paddleocr-mcp', 'paddleocr_mcp'],
        env: getPaddleOcrEnv(),
        stderr: 'pipe',
      });
      const client = new Client({ name: 'librechat-steel-paddleocr-d-pdf-test', version: '0.0.0' });
      const stderrChunks: string[] = [];
      const renderedPagePaths: string[] = [];
      const pageResults: Array<{
        page: number;
        imagePath: string;
        width: number;
        height: number;
        ocrTextPreview: string;
      }> = [];
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

        for (let page = 1; page <= expectedPageCount; page += 1) {
          const imagePath = await renderPdfPageToPng({ pdfPath, page, outputDir });
          renderedPagePaths.push(imagePath);
          const metadata = await sharp(imagePath).metadata();
          const width = metadata.width ?? 0;
          const height = metadata.height ?? 0;
          expect(Math.min(width, height)).toBeGreaterThanOrEqual(minimumImageEdgePx);

          const response = await client.callTool(
            {
              name: 'paddleocr_vl',
              arguments: {
                input_data: imagePath,
                output_mode: 'detailed',
                file_type: 'image',
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
          expect(ocrText.length).toBeGreaterThan(0);
          pageResults.push({
            page,
            imagePath,
            width,
            height,
            ocrTextPreview: ocrText.slice(0, 300),
          });
        }

        const patchProgress = pageResults.map((pageResult) => ({
          sourceFiles: [
            {
              fileId: 'd.pdf',
              filename: 'd.pdf',
              mediaType: 'application/pdf',
              pageCount: expectedPageCount,
              ocrEngine: 'PaddleOCR MCP',
              ocrStatus: 'completed',
            },
          ],
          patches: [
            {
              sheetId: 'interpretation_notes',
              upsertRows: [
                {
                  sourceRef: {
                    fileId: 'd.pdf',
                    filename: 'd.pdf',
                    mediaType: 'application/pdf',
                    sourceKey: `d.pdf:page:${pageResult.page}:ocr-progress`,
                    page: pageResult.page,
                    ocrEngine: 'PaddleOCR MCP',
                    ocrStatus: 'completed',
                  },
                  cells: {
                    note: `d.pdf page ${pageResult.page} processed from ${renderDpi} DPI image`,
                    width: pageResult.width,
                    height: pageResult.height,
                  },
                },
              ],
            },
          ],
        }));

        if (timedOut) {
          throw new Error(`PaddleOCR MCP d.pdf OCR timed out after ${caseTimeoutMs} ms.`);
        }

        expect(pageResults).toHaveLength(expectedPageCount);
        expect(renderedPagePaths).toHaveLength(expectedPageCount);
        expect(
          patchProgress.map((patch) => patch.patches[0]?.upsertRows[0]?.sourceRef.page),
        ).toEqual([1, 2]);
        expect(JSON.stringify(patchProgress)).toContain('ocrStatus');
        expect(JSON.stringify(patchProgress)).toContain('sourceKey');
        expect(JSON.stringify({ pageResults, stderr: stderrChunks.join('') })).not.toMatch(
          /PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN|access_token|authorization|Bearer/i,
        );

        const renderedFiles = await readdir(outputDir);
        expect(renderedFiles).toEqual(expect.arrayContaining(['d-page-1.png', 'd-page-2.png']));
      } finally {
        clearTimeout(timeout);
        await client.close();
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    caseTimeoutMs + 30000,
  );
});
