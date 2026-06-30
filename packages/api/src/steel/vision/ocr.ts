import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { RunVisualInspectionInput } from '../tools/schemas';

type PaddleOcrToolResult = Awaited<ReturnType<Client['callTool']>>;
type CanvasModule = typeof import('@napi-rs/canvas');
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type McpTextContent = { type: 'text'; text: string };

const paddleOcrProvider = 'aistudio';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<CanvasModule | PdfJsModule>;

export interface SteelFileOcrSourceFile {
  filename?: string;
  mediaType: string;
  data: Uint8Array | string | URL;
  pageCount?: number;
}

export interface SteelFileOcrInput {
  filename?: string;
  fileIndex?: number;
  output_mode?: 'markdown' | 'detailed' | 'json';
  dpi?: number;
}

export interface SteelFileOcrOptions {
  arguments: SteelFileOcrInput;
  files: readonly SteelFileOcrSourceFile[];
  providerToolCallId: string;
}

export type SteelFileOcrResult =
  | {
      ok: true;
      source: 'paddleocr_mcp';
      data: {
        filename: string;
        mediaType: string;
        fileType: 'image' | 'pdf';
        outputMode: 'markdown' | 'detailed' | 'json';
        ocrEngine: 'PaddleOCR MCP';
        model: string;
        text: string;
        imageIndex?: number;
      };
      sourceRefs: [];
      durationMs: number;
      redactionVersion: 1;
    }
  | {
      ok: false;
      source: 'paddleocr_mcp';
      errorCategory: 'repository_error';
      errorSummary: string;
      durationMs: number;
      redactionVersion: 1;
    };

export interface SteelPreparedImagePage {
  filename: string;
  mediaType: string;
  fileType: 'image' | 'pdf';
  page?: number;
  imageIndex?: number;
  data: Uint8Array;
  dpi?: number;
  width?: number;
  height?: number;
}

interface RenderedPdfPage {
  path: string;
  width: number;
  height: number;
  dpi: number;
}

function getDurationMs(startTime: number): number {
  return Math.max(0, Date.now() - startTime);
}

function getInheritedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}

function getPaddleOcrEnv() {
  const env = {
    ...getInheritedEnv(),
    PADDLEOCR_MCP_MODEL: process.env.PADDLEOCR_MCP_MODEL ?? 'PaddleOCR-VL-1.6',
    PADDLEOCR_MCP_PPOCR_SOURCE: paddleOcrProvider,
  };

  const accessToken = process.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error('PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN is required for Steel OCR.');
  }

  return {
    ...env,
    PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN: accessToken,
  };
}

function getTimeoutMs() {
  return Number(process.env.STEEL_PADDLEOCR_MCP_TIMEOUT_MS ?? 1200000);
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Steel OCR execution failed.';

  return message.replace(
    /PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN|access_token|authorization|api_key|Bearer\s+\S+/gi,
    '[redacted]',
  );
}

export function getSteelFileBytes(file: SteelFileOcrSourceFile): Uint8Array {
  if (file.data instanceof URL) {
    throw new Error('Steel OCR cannot read URL attachments; resolved file bytes are required.');
  }

  if (file.data instanceof Uint8Array) {
    return new Uint8Array(file.data);
  }

  const data = file.data.trim();
  const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function normalizeFilename(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function sanitizeLocalFilename(value: string): string {
  const basename = path.basename(value).replace(/[^\w.\-()\u4e00-\u9fff]+/gu, '_');
  return basename.length > 0 ? basename : 'steel-ocr-input';
}

export function findSteelSourceFile(
  files: readonly SteelFileOcrSourceFile[],
  input: SteelFileOcrInput | RunVisualInspectionInput,
): SteelFileOcrSourceFile {
  if (input.fileIndex !== undefined) {
    const file = files[input.fileIndex];
    if (!file) {
      throw new Error(`No uploaded file found for fileIndex ${input.fileIndex}.`);
    }

    return file;
  }

  const expected = normalizeFilename(input.filename);
  const file = files.find((candidate) => normalizeFilename(candidate.filename) === expected);
  if (!file) {
    throw new Error(`No uploaded file found for filename ${input.filename}.`);
  }

  return file;
}

async function renderPdfPageToPng({
  bytes,
  dpi,
  outputDir,
  page,
}: {
  bytes: Uint8Array;
  dpi: number;
  outputDir: string;
  page: number;
}): Promise<RenderedPdfPage> {
  const [{ createCanvas }, { getDocument }] = await Promise.all([
    dynamicImport('@napi-rs/canvas') as Promise<CanvasModule>,
    dynamicImport('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJsModule>,
  ]);
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  try {
    if (page > pdf.numPages) {
      throw new Error(`PDF page ${page} exceeds page count ${pdf.numPages}.`);
    }

    const pdfPage = await pdf.getPage(page);
    const scale = dpi / 72;
    const viewport = pdfPage.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    await pdfPage.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const outputPath = path.join(outputDir, `page-${page}.png`);
    await writeFile(outputPath, canvas.toBuffer('image/png'));

    return { path: outputPath, width, height, dpi };
  } finally {
    await pdf.destroy();
  }
}

export async function getSteelPdfPageCount(file: SteelFileOcrSourceFile): Promise<number> {
  const { getDocument } = (await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJsModule;
  const loadingTask = getDocument({
    data: getSteelFileBytes(file),
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}

function isMcpTextContent(value: unknown): value is McpTextContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as { type?: unknown; text?: unknown };
  return entry.type === 'text' && typeof entry.text === 'string';
}

function extractMcpText(result: PaddleOcrToolResult): string {
  const content = Array.isArray(result.content) ? result.content : [];

  return content
    .filter(isMcpTextContent)
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function callPaddleOcr({
  filePath,
  fileType,
  outputMode,
}: {
  filePath: string;
  fileType: 'image' | 'pdf';
  outputMode: 'markdown' | 'detailed' | 'json';
}): Promise<string> {
  const transport = new StdioClientTransport({
    command: 'uvx',
    args: ['--from', 'paddleocr-mcp', 'paddleocr_mcp'],
    env: getPaddleOcrEnv(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'librechat-steel-file-ocr', version: '0.0.0' });

  try {
    await client.connect(transport);
    const response = await client.callTool(
      {
        name: 'paddleocr_vl',
        arguments: {
          input_data: filePath,
          output_mode: outputMode,
          file_type: fileType,
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
      { timeout: getTimeoutMs() },
    );

    return extractMcpText(response);
  } finally {
    await client.close();
  }
}

function getDpi(input: SteelFileOcrInput | RunVisualInspectionInput): number {
  return input.dpi ?? Number(process.env.STEEL_PADDLEOCR_MCP_D_PDF_DPI ?? 400);
}

export async function prepareSteelImagePage({
  files,
  input,
  outputDir,
}: {
  files: readonly SteelFileOcrSourceFile[];
  input: SteelFileOcrInput | RunVisualInspectionInput;
  outputDir: string;
}): Promise<SteelPreparedImagePage> {
  const file = findSteelSourceFile(files, input);
  const bytes = getSteelFileBytes(file);
  const mediaType = file.mediaType.trim().toLowerCase();
  const filename = file.filename ?? input.filename ?? `file-${input.fileIndex ?? 0}`;
  const isPdf = mediaType === 'application/pdf';

  if (isPdf) {
    return {
      filename,
      mediaType,
      fileType: 'pdf',
      data: bytes,
    };
  }

  return {
    filename,
    mediaType,
    fileType: 'image',
    imageIndex: 1,
    data: bytes,
  };
}

export async function runSteelFileOcr(options: SteelFileOcrOptions): Promise<SteelFileOcrResult> {
  const startTime = Date.now();
  const outputMode = options.arguments.output_mode ?? 'detailed';
  let tempDir: string | undefined;

  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'steel-file-ocr-'));
    const prepared = await prepareSteelImagePage({
      files: options.files,
      input: options.arguments,
      outputDir: tempDir,
    });

    if (prepared.fileType === 'pdf') {
      const pdfFilename = sanitizeLocalFilename(
        prepared.filename.toLowerCase().endsWith('.pdf')
          ? prepared.filename
          : `${prepared.filename}.pdf`,
      );
      const pdfPath = path.join(tempDir, pdfFilename);
      await writeFile(pdfPath, prepared.data);
      const text = await callPaddleOcr({
        filePath: pdfPath,
        fileType: 'pdf',
        outputMode,
      });

      return {
        ok: true,
        source: 'paddleocr_mcp',
        data: {
          filename: prepared.filename,
          mediaType: prepared.mediaType,
          fileType: 'pdf',
          outputMode,
          ocrEngine: 'PaddleOCR MCP',
          model: process.env.PADDLEOCR_MCP_MODEL ?? 'PaddleOCR-VL-1.6',
          text,
        },
        sourceRefs: [],
        durationMs: getDurationMs(startTime),
        redactionVersion: 1,
      };
    }

    const imagePath = path.join(tempDir, `image-${prepared.imageIndex ?? 1}.png`);
    await writeFile(imagePath, prepared.data);
    const text = await callPaddleOcr({
      filePath: imagePath,
      fileType: 'image',
      outputMode,
    });

    return {
      ok: true,
      source: 'paddleocr_mcp',
      data: {
        filename: prepared.filename,
        mediaType: prepared.mediaType,
        imageIndex: prepared.imageIndex ?? 1,
        fileType: 'image',
        outputMode,
        ocrEngine: 'PaddleOCR MCP',
        model: process.env.PADDLEOCR_MCP_MODEL ?? 'PaddleOCR-VL-1.6',
        text,
      },
      sourceRefs: [],
      durationMs: getDurationMs(startTime),
      redactionVersion: 1,
    };
  } catch (error) {
    return {
      ok: false,
      source: 'paddleocr_mcp',
      errorCategory: 'repository_error',
      errorSummary: sanitizeError(error),
      durationMs: getDurationMs(startTime),
      redactionVersion: 1,
    };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
