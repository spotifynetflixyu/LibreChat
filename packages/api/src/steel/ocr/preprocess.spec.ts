import { buildPdfPageChunks } from './chunks';
import { ocrPreprocessingChunkSizePagesEnvKey } from './config';
import { mergeChunkMarkdownForFileKey } from './merge';
import { runOcrPreprocessingBatchPipeline, runOcrPreprocessingPipeline } from './preprocess';
import { parseMarkdownTables } from '../markdown/table';

import type { OcrPreprocessingState } from '../memory/service';
import type { OcrOrganizer } from './organizer';

function emptyState(input: {
  ocrFileKey: string;
  sourcePdfKey: string;
  ocrRuleVersion: string;
  chunkCount?: number;
}): OcrPreprocessingState {
  return {
    ocrFileKey: input.ocrFileKey,
    sourcePdfKey: input.sourcePdfKey,
    pipelineVersion: 1,
    ocrRuleVersion: input.ocrRuleVersion,
    chunkSizePages: 50,
    chunkCount: input.chunkCount ?? 0,
    chunks: [],
  };
}

function tableMarkdown(value: string): string {
  return `| result |\n| --- |\n| ${value} |`;
}

function adaptiveSplitEligibleError(message: string) {
  const error = new Error(message) as Error & { ocrAdaptiveSplitEligible: boolean };
  error.ocrAdaptiveSplitEligible = true;
  return error;
}

function organizerRetryFixture(input: { organizer: OcrOrganizer }) {
  const chunks = buildPdfPageChunks({ pageCount: 1 });
  const baseState = emptyState({
    ocrFileKey: 'file:organizer-retry',
    sourcePdfKey: 'uploads/organizer-retry.pdf',
    ocrRuleVersion: 'rules-v2',
    chunkCount: 1,
  });
  const rawState: OcrPreprocessingState = {
    ...baseState,
    chunks: [
      {
        ...chunks[0],
        rawSaved: true,
        organizedSaved: false,
        rawResultHash: 'hash-1',
        rawOcrText: 'raw OCR text',
      },
    ],
  };
  const organizedState: OcrPreprocessingState = {
    ...rawState,
    chunks: [
      {
        ...rawState.chunks[0],
        organizedSaved: true,
        organizedMarkdown: tableMarkdown('organized markdown'),
      },
    ],
  };
  const memory = {
    readOcrPreprocessingState: jest
      .fn()
      .mockResolvedValueOnce(rawState)
      .mockResolvedValueOnce(rawState)
      .mockResolvedValueOnce(organizedState),
    capturePaddleOcrChunkResult: jest.fn(),
    captureOcrPreprocessingChunkMarkdown: jest.fn().mockResolvedValue({
      savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
    }),
  };

  return {
    chunks,
    memory,
    input: {
      conversationId: 'steel_conversation_organizer_retry',
      file: {
        ocrFileKey: 'file:organizer-retry',
        fileId: 'organizer-retry',
        filename: 'organizer-retry.pdf',
        sourcePdfKey: 'uploads/organizer-retry.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () => [
          {
            ...chunks[0],
            filepath: 'https://cdn.example/organizer-retry-1.pdf',
            storageKey: 'chunks/organizer-retry-1.pdf',
          },
        ]),
      },
      memory,
      organizer: input.organizer,
      paddleOcr: { runChunk: jest.fn() },
    },
  };
}

describe('OCR preprocessing orchestrator', () => {
  it('pairs each chunk raw text with its own signed artifact and stores tables only', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 100 });
    const baseState = emptyState({
      ocrFileKey: 'file:paired',
      sourcePdfKey: 'uploads/paired.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: chunks.length,
    });
    const rawState: OcrPreprocessingState = {
      ...baseState,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        rawSaved: true,
        organizedSaved: false,
        rawResultHash: `hash-${chunk.chunkIndex}`,
        rawOcrText: `raw chunk ${chunk.chunkIndex}`,
      })),
    };
    const organizedState: OcrPreprocessingState = {
      ...rawState,
      chunks: rawState.chunks.map((chunk) => ({
        ...chunk,
        organizedSaved: true,
        organizedMarkdown: `| file | value |\n| --- | --- |\n| ${chunk.chunkIndex} | organized |`,
      })),
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(rawState)
        .mockResolvedValueOnce(rawState)
        .mockResolvedValueOnce(organizedState),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn().mockResolvedValue({
        savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
      }),
    };
    const organizer = {
      organize: jest.fn(async ({ rawOcrText, artifactUrl }) => ({
        markdown: [
          `prose for ${rawOcrText}`,
          `| file | value |`,
          `| --- | --- |`,
          `| ${rawOcrText} | ${artifactUrl} |`,
          `| canonical | ${new URL(artifactUrl).origin}${new URL(artifactUrl).pathname} |`,
          `| encoded | ${encodeURIComponent(`${new URL(artifactUrl).origin}${new URL(artifactUrl).pathname}`)} |`,
          `| reordered | ${new URL(artifactUrl).origin}${new URL(artifactUrl).pathname}?expires=123&signature=reordered |`,
          `| raw-path-encoded-query | ${new URL(artifactUrl).origin}${new URL(artifactUrl).pathname}%3Fsignature%3Dcross-encoded |`,
          `| encoded-path-raw-query | ${encodeURIComponent(`${new URL(artifactUrl).origin}${new URL(artifactUrl).pathname}`)}?signature=cross-raw |`,
          `| supplier | https://supplier.example/catalog/part-1 |`,
        ].join('\n'),
      })),
    };
    const artifacts = {
      ensurePdfChunkArtifacts: jest.fn(async () =>
        chunks.map((chunk) => ({
          ...chunk,
          filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf?signature=secret`,
          storageKey: `chunks/chunk-${chunk.chunkIndex}.pdf`,
        })),
      ),
    };

    await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_pairing',
      file: {
        ocrFileKey: 'file:paired',
        fileId: 'paired',
        filename: 'paired.pdf',
        mediaType: 'application/pdf',
        sourcePdfKey: 'uploads/paired.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts,
      memory,
      organizer,
      paddleOcr: { runChunk: jest.fn() },
    });

    expect(organizer.organize).toHaveBeenCalledTimes(2);
    expect(organizer.organize.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        rawOcrText: 'raw chunk 1',
        artifactUrl: 'https://cdn.example/chunk-1.pdf?signature=secret',
        mediaType: 'application/pdf',
        pageStart: 1,
        pageEnd: 50,
      }),
      expect.objectContaining({
        rawOcrText: 'raw chunk 2',
        artifactUrl: 'https://cdn.example/chunk-2.pdf?signature=secret',
        mediaType: 'application/pdf',
        pageStart: 51,
        pageEnd: 100,
      }),
    ]);
    expect(memory.captureOcrPreprocessingChunkMarkdown.mock.calls).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ content: expect.not.stringContaining('prose for') })],
        [expect.objectContaining({ content: expect.not.stringContaining('https://cdn.example') })],
        [expect.objectContaining({ content: expect.not.stringContaining('https%3A%2F%2F') })],
        [expect.objectContaining({ content: expect.not.stringContaining('signature=') })],
        [expect.objectContaining({ content: expect.not.stringContaining('expires=') })],
        [expect.objectContaining({ content: expect.not.stringContaining('signature%3D') })],
        [expect.objectContaining({ content: expect.not.stringContaining('cross-raw') })],
        [
          expect.objectContaining({
            content: expect.stringContaining('https://supplier.example/catalog/part-1'),
          }),
        ],
      ]),
    );
  });

  it('uses the refreshed artifact from the successful PaddleOCR attempt for persistence and Organizer Vision', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 1 });
    const chunk = chunks[0]!;
    const baseState = emptyState({
      ocrFileKey: 'file:refreshed',
      sourcePdfKey: 'uploads/refreshed.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const rawState: OcrPreprocessingState = {
      ...baseState,
      chunks: [
        {
          ...chunk,
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-refreshed',
          rawOcrText: 'raw refreshed OCR',
        },
      ],
    };
    const organizedState: OcrPreprocessingState = {
      ...rawState,
      chunks: [
        {
          ...rawState.chunks[0],
          organizedSaved: true,
          organizedMarkdown: tableMarkdown('organized refreshed OCR'),
        },
      ],
    };
    const originalArtifact = {
      ...chunk,
      filepath: 'https://cdn.example/refreshed.pdf?signature=old',
      storageKey: 'chunks/refreshed.pdf',
      source: 's3' as const,
    };
    const refreshedArtifact = {
      ...originalArtifact,
      filepath: 'https://cdn.example/refreshed.pdf?signature=new',
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(baseState)
        .mockResolvedValueOnce(rawState)
        .mockResolvedValueOnce(organizedState),
      capturePaddleOcrChunkResult: jest.fn().mockResolvedValue({ savedCounts: {} }),
      captureOcrPreprocessingChunkMarkdown: jest.fn().mockResolvedValue({ savedCounts: {} }),
    };
    const organizer = {
      organize: jest.fn().mockResolvedValue({ markdown: tableMarkdown('organized refreshed OCR') }),
    };

    await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_refreshed',
      file: {
        ocrFileKey: 'file:refreshed',
        fileId: 'refreshed',
        filename: 'refreshed.pdf',
        mediaType: 'application/pdf',
        sourcePdfKey: 'uploads/refreshed.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn().mockResolvedValue([originalArtifact]),
      },
      memory,
      organizer,
      paddleOcr: {
        runChunk: jest.fn().mockResolvedValue({
          rawResult: { content: 'raw refreshed OCR' },
          rawOcrText: 'raw refreshed OCR',
          rawResultHash: 'hash-refreshed',
          artifact: refreshedArtifact,
        }),
      },
    });

    expect(memory.capturePaddleOcrChunkResult).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: expect.objectContaining({
          pdfChunk: expect.objectContaining({ filepath: refreshedArtifact.filepath }),
        }),
      }),
    );
    expect(organizer.organize).toHaveBeenCalledWith(
      expect.objectContaining({ artifactUrl: refreshedArtifact.filepath }),
    );
  });

  it('runs all message PaddleOCR chunks before any organizer chunk across multiple files', async () => {
    const firstChunk = buildPdfPageChunks({ pageCount: 1 });
    const secondChunk = buildPdfPageChunks({ pageCount: 1 });
    const calls: string[] = [];
    const firstEmpty = emptyState({
      ocrFileKey: 'file:file-a',
      sourcePdfKey: 'uploads/file-a.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const secondEmpty = emptyState({
      ocrFileKey: 'file:file-b',
      sourcePdfKey: 'uploads/file-b.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const firstRaw: OcrPreprocessingState = {
      ...firstEmpty,
      chunks: [
        {
          ...firstChunk[0],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-a',
          rawOcrText: 'raw a',
        },
      ],
    };
    const secondRaw: OcrPreprocessingState = {
      ...secondEmpty,
      chunks: [
        {
          ...secondChunk[0],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-b',
          rawOcrText: 'raw b',
        },
      ],
    };
    const firstOrganized: OcrPreprocessingState = {
      ...firstEmpty,
      chunks: [
        {
          ...firstChunk[0],
          rawSaved: true,
          organizedSaved: true,
          rawResultHash: 'hash-a',
          rawOcrText: 'raw a',
          organizedMarkdown: '| file | value |\n|---|---|\n| A | organized a |',
        },
      ],
    };
    const secondOrganized: OcrPreprocessingState = {
      ...secondEmpty,
      chunks: [
        {
          ...secondChunk[0],
          rawSaved: true,
          organizedSaved: true,
          rawResultHash: 'hash-b',
          rawOcrText: 'raw b',
          organizedMarkdown: '| file | value |\n|---|---|\n| B | organized b |',
        },
      ],
    };
    const states = new Map([
      ['file:file-a', [firstEmpty, firstRaw, firstOrganized]],
      ['file:file-b', [secondEmpty, secondRaw, secondOrganized]],
    ]);
    const memory = {
      readOcrPreprocessingState: jest.fn(async ({ ocrFileKey }) => {
        const queue = states.get(ocrFileKey);
        const state = queue?.shift();
        if (!state) {
          throw new Error(`No state queued for ${ocrFileKey}`);
        }
        return state;
      }),
      capturePaddleOcrChunkResult: jest.fn(async (input) => {
        calls.push(`save-raw:${input.file.ocrFileKey}:${input.chunk.chunkIndex}`);
        return { savedCounts: { paddleocr_preflight: 1 } };
      }),
      captureOcrPreprocessingChunkMarkdown: jest.fn(async (input) => {
        calls.push(`save-md:${input.file.ocrFileKey}:${input.chunk.chunkIndex}`);
        return { savedCounts: { ocr_preprocessing_chunk_markdown: 1 } };
      }),
    };
    const organizer: OcrOrganizer = {
      organize: jest.fn(async (input) => {
        calls.push(`organize:${input.rawOcrText}`);
        return {
          markdown: tableMarkdown(`organized ${input.rawOcrText.replace('raw ', '')}`),
        };
      }),
    };
    const paddleOcr = {
      runChunk: jest.fn(async ({ file, chunk }) => {
        calls.push(`paddle:${file.ocrFileKey}:${chunk.chunkIndex}`);
        return {
          rawResult: { text: `raw ${file.ocrFileKey}` },
          rawOcrText: `raw ${file.ocrFileKey}`,
          rawResultHash: `hash-${file.ocrFileKey}`,
        };
      }),
    };

    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_batch',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      memory,
      organizer,
      paddleOcr,
      files: [
        {
          file: {
            ocrFileKey: 'file:file-a',
            fileId: 'file-a',
            filename: 'a.pdf',
            sourcePdfKey: 'uploads/file-a.pdf',
          },
          chunks: firstChunk,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () => [
              {
                ...firstChunk[0],
                filepath: 'https://cdn.example/a-1.pdf',
                storageKey: 'chunks/a-1.pdf',
              },
            ]),
          },
        },
        {
          file: {
            ocrFileKey: 'file:file-b',
            fileId: 'file-b',
            filename: 'b.pdf',
            sourcePdfKey: 'uploads/file-b.pdf',
          },
          chunks: secondChunk,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () => [
              {
                ...secondChunk[0],
                filepath: 'https://cdn.example/b-1.pdf',
                storageKey: 'chunks/b-1.pdf',
              },
            ]),
          },
        },
      ],
    });

    expect(calls).toEqual([
      'paddle:file:file-a:1',
      'save-raw:file:file-a:1',
      'paddle:file:file-b:1',
      'save-raw:file:file-b:1',
      'organize:raw a',
      'save-md:file:file-a:1',
      'organize:raw b',
      'save-md:file:file-b:1',
    ]);
    expect(organizer.organize).toHaveBeenNthCalledWith(1, {
      ocrRulesText: 'rules',
      rawOcrText: 'raw a',
      sourceFile: 'a.pdf',
      fileKey: 'file:file-a',
      artifactUrl: 'https://cdn.example/a-1.pdf',
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 1,
      chunkCount: 1,
    });
    expect(organizer.organize).toHaveBeenNthCalledWith(2, {
      ocrRulesText: 'rules',
      rawOcrText: 'raw b',
      sourceFile: 'b.pdf',
      fileKey: 'file:file-b',
      artifactUrl: 'https://cdn.example/b-1.pdf',
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 1,
      chunkCount: 1,
    });
    expect(result.files).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ ocrFileKey: 'file:file-a' }),
        markdown: expect.stringContaining('organized a'),
      }),
      expect.objectContaining({
        file: expect.objectContaining({ ocrFileKey: 'file:file-b' }),
        markdown: expect.stringContaining('organized b'),
      }),
    ]);
  });

  it('omits page metadata for image organizer inputs and returns empty page ranges', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 1 });
    const state = {
      ...emptyState({
        ocrFileKey: 'file:photo',
        sourcePdfKey: 'uploads/photo.jpg',
        ocrRuleVersion: 'rules-v2',
        chunkCount: 1,
      }),
      chunks: [
        {
          ...chunks[0],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-photo',
          rawOcrText: 'raw photo',
        },
      ],
    };
    const organizedState = {
      ...state,
      chunks: [
        { ...state.chunks[0], organizedSaved: true, organizedMarkdown: tableMarkdown('organized photo') },
      ],
    };
    const organizer = { organize: jest.fn(async () => ({ markdown: tableMarkdown('organized photo') })) };
    const result = await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_image',
      file: {
        ocrFileKey: 'file:photo',
        fileId: 'photo',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        sourcePdfKey: 'uploads/photo.jpg',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () => [
          {
            ...chunks[0],
            filepath: 'https://cdn.example/photo.jpg',
            storageKey: 'ocr/photo.jpg',
          },
        ]),
      },
      memory: {
        readOcrPreprocessingState: jest
          .fn()
          .mockResolvedValueOnce(state)
          .mockResolvedValueOnce(state)
          .mockResolvedValueOnce(organizedState),
        capturePaddleOcrChunkResult: jest.fn(),
        captureOcrPreprocessingChunkMarkdown: jest.fn().mockResolvedValue({
          savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
        }),
      },
      organizer,
      paddleOcr: { runChunk: jest.fn() },
    });

    expect(organizer.organize).toHaveBeenCalledWith({
      ocrRulesText: 'rules',
      rawOcrText: 'raw photo',
      sourceFile: 'photo.jpg',
      fileKey: 'file:photo',
      artifactUrl: 'https://cdn.example/photo.jpg',
      mediaType: 'image/jpeg',
    });
    expect(result).toEqual({
      status: 'completed',
      markdown: tableMarkdown('organized photo'),
      chunkCount: 1,
      pageRanges: [],
    });
  });

  it.each([
    { label: 'filename-only', mediaType: undefined, filename: 'photo.png' },
    { label: 'octet-stream', mediaType: 'application/octet-stream', filename: 'photo.webp' },
  ])('recognizes $label image inputs without page metadata', async ({ mediaType, filename }) => {
    const chunks = buildPdfPageChunks({ pageCount: 1 });
    const baseState = emptyState({
      ocrFileKey: `file:${filename}`,
      sourcePdfKey: `uploads/${filename}`,
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const rawState = {
      ...baseState,
      chunks: [
        {
          ...chunks[0],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: `hash-${filename}`,
          rawOcrText: `raw ${filename}`,
        },
      ],
    };
    const organizedState = {
      ...rawState,
      chunks: [
        {
          ...rawState.chunks[0],
          organizedSaved: true,
          organizedMarkdown: tableMarkdown(`organized ${filename}`),
        },
      ],
    };
    let readCount = 0;
    const organizer = {
      organize: jest.fn(async () => ({ markdown: tableMarkdown(`organized ${filename}`) })),
    };
    const result = await runOcrPreprocessingPipeline({
      conversationId: `steel_conversation_${filename}`,
      file: {
        ocrFileKey: `file:${filename}`,
        fileId: filename,
        filename,
        ...(mediaType !== undefined ? { mediaType } : {}),
        sourcePdfKey: `uploads/${filename}`,
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () => [
          {
            ...chunks[0],
            filepath: `https://cdn.example/${filename}`,
            storageKey: `ocr/${filename}`,
          },
        ]),
      },
      memory: {
        readOcrPreprocessingState: jest.fn(async () => {
          readCount += 1;
          return readCount === 3 ? organizedState : rawState;
        }),
        capturePaddleOcrChunkResult: jest.fn(),
        captureOcrPreprocessingChunkMarkdown: jest.fn().mockResolvedValue({
          savedCounts: { ocr_preprocessing_chunk_markdown: 1 },
        }),
      },
      organizer,
      paddleOcr: { runChunk: jest.fn() },
    });

    expect(organizer.organize).toHaveBeenCalledWith({
      ocrRulesText: 'rules',
      rawOcrText: `raw ${filename}`,
      sourceFile: filename,
      fileKey: `file:${filename}`,
      artifactUrl: `https://cdn.example/${filename}`,
      ...(mediaType !== undefined ? { mediaType } : {}),
    });
    expect(result).toEqual({
      status: 'completed',
          markdown: tableMarkdown(`organized ${filename}`),
      chunkCount: 1,
      pageRanges: [],
    });
  });

  it('resumes each file from its own saved PaddleOCR and organizer progress', async () => {
    const firstChunk = buildPdfPageChunks({ pageCount: 1 });
    const secondChunk = buildPdfPageChunks({ pageCount: 1 });
    const calls: string[] = [];
    const firstRaw = {
      ...emptyState({
        ocrFileKey: 'file:file-a',
        sourcePdfKey: 'uploads/file-a.pdf',
        ocrRuleVersion: 'rules-v2',
        chunkCount: 1,
      }),
      chunks: [
        {
          ...firstChunk[0],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-a',
          rawOcrText: 'raw a',
        },
      ],
    };
    const firstOrganized: OcrPreprocessingState = {
      ...firstRaw,
      chunks: [
        {
          ...firstRaw.chunks[0],
          organizedSaved: true,
          organizedMarkdown: '| file | value |\n|---|---|\n| A | organized a |',
        },
      ],
    };
    const secondEmpty = emptyState({
      ocrFileKey: 'file:file-b',
      sourcePdfKey: 'uploads/file-b.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const secondRaw: OcrPreprocessingState = {
      ...secondEmpty,
      chunks: [
        {
          ...secondChunk[0],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-b',
          rawOcrText: 'raw b',
        },
      ],
    };
    const secondOrganized: OcrPreprocessingState = {
      ...secondEmpty,
      chunks: [
        {
          ...secondChunk[0],
          rawSaved: true,
          organizedSaved: true,
          rawResultHash: 'hash-b',
          rawOcrText: 'raw b',
          organizedMarkdown: '| file | value |\n|---|---|\n| B | organized b |',
        },
      ],
    };
    const states = new Map([
      ['file:file-a', [firstRaw, firstRaw, firstOrganized]],
      ['file:file-b', [secondEmpty, secondRaw, secondOrganized]],
    ]);
    const firstArtifacts = {
      ensurePdfChunkArtifacts: jest.fn(async () => {
        calls.push('artifact:file:file-a');
        return [
          {
            ...firstChunk[0],
            filepath: 'https://cdn.example/a-1.pdf',
            storageKey: 'chunks/a-1.pdf',
          },
        ];
      }),
    };
    const secondArtifacts = {
      ensurePdfChunkArtifacts: jest.fn(async () => {
        calls.push('artifact:file:file-b');
        return [
          {
            ...secondChunk[0],
            filepath: 'https://cdn.example/b-1.pdf',
            storageKey: 'chunks/b-1.pdf',
          },
        ];
      }),
    };
    const memory = {
      readOcrPreprocessingState: jest.fn(async ({ ocrFileKey }) => {
        const queue = states.get(ocrFileKey);
        const state = queue?.shift();
        if (!state) {
          throw new Error(`No state queued for ${ocrFileKey}`);
        }
        return state;
      }),
      capturePaddleOcrChunkResult: jest.fn(async (input) => {
        calls.push(`save-raw:${input.file.ocrFileKey}:${input.chunk.chunkIndex}`);
        return { savedCounts: { paddleocr_preflight: 1 } };
      }),
      captureOcrPreprocessingChunkMarkdown: jest.fn(async (input) => {
        calls.push(`save-md:${input.file.ocrFileKey}:${input.chunk.chunkIndex}`);
        return { savedCounts: { ocr_preprocessing_chunk_markdown: 1 } };
      }),
    };
    const organizer: OcrOrganizer = {
      organize: jest.fn(async (input) => {
        calls.push(`organize:${input.rawOcrText}`);
        return {
          markdown: tableMarkdown(`organized ${input.rawOcrText.replace('raw ', '')}`),
        };
      }),
    };
    const paddleOcr = {
      runChunk: jest.fn(async ({ file, chunk }) => {
        calls.push(`paddle:${file.ocrFileKey}:${chunk.chunkIndex}`);
        return {
          rawResult: { text: `raw ${file.ocrFileKey}` },
          rawOcrText: `raw ${file.ocrFileKey}`,
          rawResultHash: `hash-${file.ocrFileKey}`,
        };
      }),
    };

    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_batch_resume',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      memory,
      organizer,
      paddleOcr,
      files: [
        {
          file: {
            ocrFileKey: 'file:file-a',
            fileId: 'file-a',
            filename: 'a.pdf',
            sourcePdfKey: 'uploads/file-a.pdf',
          },
          chunks: firstChunk,
          artifacts: firstArtifacts,
        },
        {
          file: {
            ocrFileKey: 'file:file-b',
            fileId: 'file-b',
            filename: 'b.pdf',
            sourcePdfKey: 'uploads/file-b.pdf',
          },
          chunks: secondChunk,
          artifacts: secondArtifacts,
        },
      ],
    });

    expect(firstArtifacts.ensurePdfChunkArtifacts).toHaveBeenCalledTimes(1);
    expect(secondArtifacts.ensurePdfChunkArtifacts).toHaveBeenCalledTimes(1);
    expect(paddleOcr.runChunk).toHaveBeenCalledTimes(1);
    expect(paddleOcr.runChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ ocrFileKey: 'file:file-b' }),
        chunk: expect.objectContaining({ chunkIndex: 1 }),
      }),
    );
    expect(organizer.organize).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      'artifact:file:file-a',
      'artifact:file:file-b',
      'paddle:file:file-b:1',
      'save-raw:file:file-b:1',
      'organize:raw a',
      'save-md:file:file-a:1',
      'organize:raw b',
      'save-md:file:file-b:1',
    ]);
    expect(memory.readOcrPreprocessingState).toHaveBeenCalledWith(
      expect.objectContaining({
        ocrFileKey: 'file:file-a',
        sourcePdfKey: 'uploads/file-a.pdf',
      }),
    );
    expect(memory.readOcrPreprocessingState).toHaveBeenCalledWith(
      expect.objectContaining({
        ocrFileKey: 'file:file-b',
        sourcePdfKey: 'uploads/file-b.pdf',
      }),
    );
    expect(result.files).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ ocrFileKey: 'file:file-a' }),
        markdown: expect.stringContaining('organized a'),
      }),
      expect.objectContaining({
        file: expect.objectContaining({ ocrFileKey: 'file:file-b' }),
        markdown: expect.stringContaining('organized b'),
      }),
    ]);
  });

  it('skips OCR work and runtime-merges Markdown when all organized chunks are already saved', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 100 });
    const rawRunner = jest.fn();
    const organizer: OcrOrganizer = {
      organize: jest.fn(),
    };
    const memory = {
      readOcrPreprocessingState: jest.fn(async () => ({
        ...emptyState({
          ocrFileKey: 'file:file-100',
          sourcePdfKey: 's3://bucket/original.pdf',
          ocrRuleVersion: 'rules-v2',
          chunkCount: 2,
        }),
        chunks: [
          {
            ...chunks[0],
            rawSaved: true,
            organizedSaved: true,
            rawResultHash: 'hash-1',
            rawOcrText: 'raw 1',
            organizedMarkdown:
              '## quote.pdf OCR 結果確認表｜第 1～50 頁\n\n| 品名 | 數量 |\n|---|---|\n| A | 1 |',
          },
          {
            ...chunks[1],
            rawSaved: true,
            organizedSaved: true,
            rawResultHash: 'hash-2',
            rawOcrText: 'raw 2',
            organizedMarkdown:
              '## quote.pdf OCR 結果確認表｜第 51～100 頁\n\n| 品名 | 材質 |\n|---|---|\n| B | SS400 |',
          },
        ],
      })),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };
    const artifacts = {
      ensurePdfChunkArtifacts: jest.fn(),
    };
    const progress: object[] = [];

    await expect(
      runOcrPreprocessingPipeline({
        conversationId: 'steel_conversation_preprocess',
        file: {
          ocrFileKey: 'file:file-100',
          fileId: 'file-100',
          filename: 'quote.pdf',
          sourcePdfKey: 's3://bucket/original.pdf',
        },
        ocrRuleVersion: 'rules-v2',
        ocrRulesText: 'rules',
        chunks,
        artifacts,
        memory,
        organizer,
        paddleOcr: { runChunk: rawRunner },
        onProgress: (event) => {
          progress.push(event);
        },
      }),
    ).resolves.toEqual({
      status: 'ready',
      markdown: [
        '| 品名 | 數量 | 材質 |',
        '| --- | --- | --- |',
        '| A | 1 |  |',
        '| B |  | SS400 |',
      ].join('\n'),
      chunkCount: 2,
      pageRanges: [
        { pageStart: 1, pageEnd: 50 },
        { pageStart: 51, pageEnd: 100 },
      ],
    });
    expect(artifacts.ensurePdfChunkArtifacts).not.toHaveBeenCalled();
    expect(rawRunner).not.toHaveBeenCalled();
    expect(organizer.organize).not.toHaveBeenCalled();
    expect(memory.capturePaddleOcrChunkResult).not.toHaveBeenCalled();
    expect(memory.captureOcrPreprocessingChunkMarkdown).not.toHaveBeenCalled();
    expect(memory).not.toHaveProperty('captureOfficialOcrMarkdown');
    expect(progress).toEqual([
      { stage: 'merged_markdowns_read', chunkCount: 2 },
      { stage: 'processing_with_merged_markdown', chunkCount: 2 },
    ]);
  });

  it('propagates ordinary progress callback failures', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 1 });
    const state: OcrPreprocessingState = {
      ...emptyState({
        ocrFileKey: 'file:file-progress-error',
        sourcePdfKey: 'uploads/file-progress-error.pdf',
        ocrRuleVersion: 'rules-v2',
        chunkCount: 1,
      }),
      chunks: [
        {
          ...chunks[0],
          rawSaved: true,
          organizedSaved: true,
          rawResultHash: 'hash-progress-error',
          rawOcrText: 'raw progress error',
          organizedMarkdown: '| file | value |\n|---|---|\n| A | 1 |',
        },
      ],
    };
    const progressError = new Error('event sink failed');

    await expect(
      runOcrPreprocessingPipeline({
        conversationId: 'steel_conversation_progress_error',
        file: {
          ocrFileKey: 'file:file-progress-error',
          fileId: 'file-progress-error',
          filename: 'progress-error.pdf',
          sourcePdfKey: 'uploads/file-progress-error.pdf',
        },
        ocrRuleVersion: 'rules-v2',
        ocrRulesText: 'rules',
        chunks,
        artifacts: {
          ensurePdfChunkArtifacts: jest.fn(),
        },
        memory: {
          readOcrPreprocessingState: jest.fn().mockResolvedValue(state),
          capturePaddleOcrChunkResult: jest.fn(),
          captureOcrPreprocessingChunkMarkdown: jest.fn(),
        },
        organizer: { organize: jest.fn() },
        paddleOcr: { runChunk: jest.fn() },
        onProgress: jest.fn(async () => {
          throw progressError;
        }),
      }),
    ).rejects.toBe(progressError);
  });

  it('resumes from saved raw chunks and organizes only missing current-rule chunks', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 100 });
    const rawRunner = jest.fn();
    const organizer: OcrOrganizer = {
      organize: jest.fn(async (input) => ({
        markdown: tableMarkdown(`organized ${input.rawOcrText.replace('raw ', '')}`),
      })),
    };
    const initialState: OcrPreprocessingState = {
      ...emptyState({
        ocrFileKey: 'file:file-100',
        sourcePdfKey: 's3://bucket/original.pdf',
        ocrRuleVersion: 'rules-v2',
        chunkCount: 2,
      }),
      chunks: [
        {
          ...chunks[0],
          rawSaved: true,
          organizedSaved: true,
          rawResultHash: 'hash-1',
          rawOcrText: 'raw 1',
          organizedMarkdown: 'organized 1',
        },
        {
          ...chunks[1],
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-2',
          rawOcrText: 'raw 2',
        },
      ],
    };
    const organizedState: OcrPreprocessingState = {
      ...initialState,
      chunks: [
        initialState.chunks[0],
        {
          ...initialState.chunks[1],
          organizedSaved: true,
          organizedMarkdown: tableMarkdown('organized 2'),
        },
      ],
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(initialState)
        .mockResolvedValueOnce(initialState)
        .mockResolvedValueOnce(organizedState),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };

    const result = await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_preprocess',
      file: {
        ocrFileKey: 'file:file-100',
        fileId: 'file-100',
        filename: 'quote.pdf',
        sourcePdfKey: 's3://bucket/original.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () =>
          chunks.map((chunk) => ({
            ...chunk,
            filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf`,
            storageKey: `ocr/chunk-${chunk.chunkIndex}.pdf`,
          })),
        ),
      },
      memory,
      organizer,
      paddleOcr: { runChunk: rawRunner },
    });

    expect(rawRunner).not.toHaveBeenCalled();
    expect(organizer.organize).toHaveBeenCalledTimes(1);
    expect(memory.readOcrPreprocessingState).toHaveBeenCalledTimes(3);
    expect(organizer.organize).toHaveBeenCalledWith(
      {
        ocrRulesText: 'rules',
        rawOcrText: 'raw 2',
        sourceFile: 'quote.pdf',
        fileKey: 'file:file-100',
        artifactUrl: 'https://cdn.example/chunk-2.pdf',
        pageStart: 51,
        pageEnd: 100,
        chunkIndex: 2,
        chunkCount: 2,
      },
    );
    expect(memory.captureOcrPreprocessingChunkMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResultHash: 'hash-2',
        content: tableMarkdown('organized 2'),
      }),
    );
    expect(memory).not.toHaveProperty('captureOfficialOcrMarkdown');
    expect(result.markdown).toContain('organized 2');
    expect(result.status).toBe('completed');
  });

  it('emits fetched PDF chunk progress when every chunk artifact came from verified stored rows', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 106 });
    const progress: object[] = [];
    const emptyPreprocessState = emptyState({
      ocrFileKey: 'file:file-106',
      sourcePdfKey: 'uploads/user/file-106.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 3,
    });
    const rawSavedState: OcrPreprocessingState = {
      ...emptyPreprocessState,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        rawSaved: true,
        organizedSaved: false,
        rawResultHash: `hash-${chunk.chunkIndex}`,
        rawOcrText: `raw pages ${chunk.pageStart}-${chunk.pageEnd}`,
      })),
    };
    const organizedSavedState: OcrPreprocessingState = {
      ...emptyPreprocessState,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        rawSaved: true,
        organizedSaved: true,
        rawResultHash: `hash-${chunk.chunkIndex}`,
        rawOcrText: `raw pages ${chunk.pageStart}-${chunk.pageEnd}`,
        organizedMarkdown: `organized ${chunk.chunkIndex}`,
      })),
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(emptyPreprocessState)
        .mockResolvedValueOnce(rawSavedState)
        .mockResolvedValueOnce(organizedSavedState),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };

    await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_preprocess',
      file: {
        ocrFileKey: 'file:file-106',
        fileId: 'file-106',
        filename: 'large.pdf',
        sourcePdfKey: 'uploads/user/file-106.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () =>
          chunks.map((chunk) => ({
            ...chunk,
            filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf`,
            storageKey: `ocr/chunk-${chunk.chunkIndex}.pdf`,
            artifactOrigin: 'existing' as const,
          })),
        ),
      },
      memory,
      organizer: {
        organize: jest.fn(async () => ({ markdown: 'organized' })),
      },
      paddleOcr: {
        runChunk: jest.fn(async ({ chunk }) => ({
          rawResult: { text: `raw pages ${chunk.pageStart}-${chunk.pageEnd}` },
          rawOcrText: `raw pages ${chunk.pageStart}-${chunk.pageEnd}`,
          rawResultHash: `hash-${chunk.chunkIndex}`,
        })),
      },
      onProgress: (event) => {
        progress.push(event);
      },
    });

    expect(progress[0]).toEqual({
      stage: 'pdf_chunks_ready',
      pageCount: 106,
      chunkCount: 3,
      source: 'fetched',
    });
  });

  it('runs a synthetic 251-page OCR preprocessing pressure path as six 50-page chunks', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 251 });
    const progress: object[] = [];
    let organizerChunkIndex = 0;
    const organizer: OcrOrganizer = {
      organize: jest.fn(async () => {
        organizerChunkIndex += 1;
        const chunk = chunks[organizerChunkIndex - 1];
        if (!chunk) {
          throw new Error('Missing test chunk');
        }
        return {
          markdown: `| chunk | pages |\n|---|---|\n| ${chunk.chunkIndex} | ${chunk.pageStart}-${chunk.pageEnd} |`,
        };
      }),
    };
    const emptyPreprocessState = emptyState({
      ocrFileKey: 'file:file-251',
      sourcePdfKey: 'uploads/user/file-251.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 6,
    });
    const rawSavedState: OcrPreprocessingState = {
      ...emptyPreprocessState,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        rawSaved: true,
        organizedSaved: false,
        rawResultHash: `hash-${chunk.chunkIndex}`,
        rawOcrText: `raw pages ${chunk.pageStart}-${chunk.pageEnd}`,
      })),
    };
    const organizedSavedState: OcrPreprocessingState = {
      ...emptyPreprocessState,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        rawSaved: true,
        organizedSaved: true,
        rawResultHash: `hash-${chunk.chunkIndex}`,
        rawOcrText: `raw pages ${chunk.pageStart}-${chunk.pageEnd}`,
        organizedMarkdown: `| chunk | pages |\n|---|---|\n| ${chunk.chunkIndex} | ${chunk.pageStart}-${chunk.pageEnd} |`,
      })),
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(emptyPreprocessState)
        .mockResolvedValueOnce(rawSavedState)
        .mockResolvedValueOnce(organizedSavedState),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };
    const paddleOcr = {
      runChunk: jest.fn(async ({ chunk }) => ({
        rawResult: { text: `raw pages ${chunk.pageStart}-${chunk.pageEnd}` },
        rawOcrText: `raw pages ${chunk.pageStart}-${chunk.pageEnd}`,
        rawResultHash: `hash-${chunk.chunkIndex}`,
      })),
    };

    const result = await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_preprocess',
      file: {
        ocrFileKey: 'file:file-251',
        fileId: 'file-251',
        filename: 'large.pdf',
        sourcePdfKey: 'uploads/user/file-251.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () =>
          chunks.map((chunk) => ({
            ...chunk,
            filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf`,
            storageKey: `ocr/chunk-${chunk.chunkIndex}.pdf`,
          })),
        ),
      },
      memory,
      organizer,
      paddleOcr,
      onProgress: (event) => {
        progress.push(event);
      },
    });

    expect(chunks).toHaveLength(6);
    expect(paddleOcr.runChunk).toHaveBeenCalledTimes(6);
    expect(organizer.organize).toHaveBeenCalledTimes(6);
    expect(memory.readOcrPreprocessingState).toHaveBeenCalledTimes(3);
    expect(memory.capturePaddleOcrChunkResult).toHaveBeenCalledTimes(6);
    expect(memory.captureOcrPreprocessingChunkMarkdown).toHaveBeenCalledTimes(6);
    expect(result.markdown).toContain('| 6 | 251-251 |');
    expect(progress).toEqual([
      { stage: 'pdf_chunks_ready', pageCount: 251, chunkCount: 6, source: 'uploaded' },
      { stage: 'paddleocr_chunk_started', chunkIndex: 1, chunkCount: 6 },
      { stage: 'paddleocr_chunk_saved', chunkIndex: 1, chunkCount: 6 },
      { stage: 'paddleocr_chunk_started', chunkIndex: 2, chunkCount: 6 },
      { stage: 'paddleocr_chunk_saved', chunkIndex: 2, chunkCount: 6 },
      { stage: 'paddleocr_chunk_started', chunkIndex: 3, chunkCount: 6 },
      { stage: 'paddleocr_chunk_saved', chunkIndex: 3, chunkCount: 6 },
      { stage: 'paddleocr_chunk_started', chunkIndex: 4, chunkCount: 6 },
      { stage: 'paddleocr_chunk_saved', chunkIndex: 4, chunkCount: 6 },
      { stage: 'paddleocr_chunk_started', chunkIndex: 5, chunkCount: 6 },
      { stage: 'paddleocr_chunk_saved', chunkIndex: 5, chunkCount: 6 },
      { stage: 'paddleocr_chunk_started', chunkIndex: 6, chunkCount: 6 },
      { stage: 'paddleocr_chunk_saved', chunkIndex: 6, chunkCount: 6 },
      { stage: 'organizer_chunk_started', chunkIndex: 1, chunkCount: 6 },
      { stage: 'organizer_chunk_saved', chunkIndex: 1, chunkCount: 6 },
      { stage: 'organizer_chunk_started', chunkIndex: 2, chunkCount: 6 },
      { stage: 'organizer_chunk_saved', chunkIndex: 2, chunkCount: 6 },
      { stage: 'organizer_chunk_started', chunkIndex: 3, chunkCount: 6 },
      { stage: 'organizer_chunk_saved', chunkIndex: 3, chunkCount: 6 },
      { stage: 'organizer_chunk_started', chunkIndex: 4, chunkCount: 6 },
      { stage: 'organizer_chunk_saved', chunkIndex: 4, chunkCount: 6 },
      { stage: 'organizer_chunk_started', chunkIndex: 5, chunkCount: 6 },
      { stage: 'organizer_chunk_saved', chunkIndex: 5, chunkCount: 6 },
      { stage: 'organizer_chunk_started', chunkIndex: 6, chunkCount: 6 },
      { stage: 'organizer_chunk_saved', chunkIndex: 6, chunkCount: 6 },
      { stage: 'merged_markdowns_read', chunkCount: 6 },
      { stage: 'processing_with_merged_markdown', chunkCount: 6 },
    ]);
    expect(result.status).toBe('completed');
  });

  it('merges chunk Markdown tables with union headers and blank missing values', () => {
    const merged = mergeChunkMarkdownForFileKey({
      ocrFileKey: 'file:file-100',
      ocrRuleVersion: 'rules-v2',
      chunks: [
        {
          chunkIndex: 1,
          markdown: ['| 品名 | 數量 |', '|---|---:|', '| 鐵板 | 2 |'].join('\n'),
        },
        {
          chunkIndex: 2,
          markdown: ['| 品名 | 材質 | 備註 |', '|---|---|---|', '| 白鐵管 | 304 | 急件 |'].join(
            '\n',
          ),
        },
      ],
    });

    expect(merged).toContain('| 品名 | 數量 | 材質 | 備註 |');
    expect(merged).toContain('| 鐵板 | 2 |  |  |');
    expect(merged).toContain('| 白鐵管 |  | 304 | 急件 |');
  });

  it('round-trips escaped pipes and backslashes while rebuilding merged tables', () => {
    const source = ['| 品名 | 路徑 |', '| --- | --- |', '| A\\|B | C:\\\\path |'].join('\n');
    const merged = mergeChunkMarkdownForFileKey({
      ocrFileKey: 'file:escaped-cells',
      ocrRuleVersion: 'rules-v2',
      chunks: [{ chunkIndex: 1, markdown: source }],
    });

    expect(merged).toBe(source);
    expect(parseMarkdownTables(merged)[0]?.rows).toEqual([['A|B', 'C:\\path']]);
    expect(
      mergeChunkMarkdownForFileKey({
        ocrFileKey: 'file:escaped-cells',
        ocrRuleVersion: 'rules-v2',
        chunks: [{ chunkIndex: 1, markdown: merged }],
      }),
    ).toBe(source);
  });

  it('orders merged Markdown by page range rather than historical chunk index', () => {
    const merged = mergeChunkMarkdownForFileKey({
      ocrFileKey: 'file:range-order',
      ocrRuleVersion: 'rules-v2',
      chunks: [
        { chunkIndex: 1, pageStart: 51, pageEnd: 100, markdown: 'later range' },
        { chunkIndex: 99, pageStart: 1, pageEnd: 50, markdown: 'first range' },
      ],
    });
    expect(merged.indexOf('first range')).toBeLessThan(merged.indexOf('later range'));
  });

  it('returns a resumable file failure instead of throwing', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 10 });
    const paddleOcr = { runChunk: jest.fn() };
    const result = await runOcrPreprocessingPipeline({
      conversationId: 'steel_conversation_failed_file',
      file: {
        ocrFileKey: 'file:failed-pdf',
        fileId: 'failed-pdf',
        filename: 'failed.pdf',
        sourcePdfKey: 'uploads/failed.pdf',
      },
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      chunks,
      artifacts: {
        ensurePdfChunkArtifacts: jest.fn(async () => {
          throw new Error('artifact unavailable');
        }),
      },
      memory: {
        readOcrPreprocessingState: jest.fn(async () =>
          emptyState({
            ocrFileKey: 'file:failed-pdf',
            sourcePdfKey: 'uploads/failed.pdf',
            ocrRuleVersion: 'rules-v2',
            chunkCount: 1,
          }),
        ),
        capturePaddleOcrChunkResult: jest.fn(),
        captureOcrPreprocessingChunkMarkdown: jest.fn(),
      },
      organizer: { organize: jest.fn() },
      paddleOcr,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        stage: 'artifacts',
        errorMessage: 'artifact unavailable',
      }),
    );
    expect(paddleOcr.runChunk).not.toHaveBeenCalled();
  });

  it('keeps a successful sibling file when another file fails', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 1 });
    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_partial_batch',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [
        {
          file: {
            ocrFileKey: 'file:failed',
            filename: 'failed.pdf',
            sourcePdfKey: 'uploads/failed.pdf',
          },
          chunks,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () => {
              throw new Error('PaddleOCR input unavailable');
            }),
          },
        },
        {
          file: {
            ocrFileKey: 'file:ready',
            filename: 'ready.pdf',
            sourcePdfKey: 'uploads/ready.pdf',
          },
          chunks,
          artifacts: { ensurePdfChunkArtifacts: jest.fn() },
        },
      ],
      memory: {
        readOcrPreprocessingState: jest.fn(async ({ ocrFileKey }) => {
          if (ocrFileKey === 'file:failed') {
            return emptyState({
              ocrFileKey,
              sourcePdfKey: 'uploads/failed.pdf',
              ocrRuleVersion: 'rules-v2',
              chunkCount: 1,
            });
          }
          return {
            ...emptyState({
              ocrFileKey,
              sourcePdfKey: 'uploads/ready.pdf',
              ocrRuleVersion: 'rules-v2',
              chunkCount: 1,
            }),
            chunks: [
              {
                ...chunks[0],
                rawSaved: true,
                organizedSaved: true,
                organizedMarkdown: '| file | value |\n|---|---|\n| ready | complete |',
              },
            ],
          };
        }),
        capturePaddleOcrChunkResult: jest.fn(),
        captureOcrPreprocessingChunkMarkdown: jest.fn(),
      },
      organizer: { organize: jest.fn() },
      paddleOcr: { runChunk: jest.fn() },
    });

    expect(result.files).toEqual([
      expect.objectContaining({ status: 'failed', file: expect.objectContaining({ ocrFileKey: 'file:failed' }) }),
      expect.objectContaining({ status: 'ready', markdown: expect.stringContaining('complete') }),
    ]);
  });

  it('continues later chunks in the same file after one PaddleOCR chunk fails', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 70, chunkSizePages: 25 });
    const initialState = emptyState({
      ocrFileKey: 'file:partial',
      sourcePdfKey: 'uploads/partial.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 3,
    });
    const rawState: OcrPreprocessingState = {
      ...initialState,
      chunks: [chunks[0], chunks[2]].map((chunk) => ({
        ...chunk,
        rawSaved: true,
        organizedSaved: false,
        rawResultHash: `hash-${chunk.chunkIndex}`,
        rawOcrText: `raw-${chunk.chunkIndex}`,
      })),
    };
    const organizedState: OcrPreprocessingState = {
      ...rawState,
      chunks: [
        ...rawState.chunks.map((chunk) => ({
          ...chunk,
          organizedSaved: true,
          organizedMarkdown:
            chunk.chunkIndex === 1
              ? '| item | value |\n|---|---|\n| first | 1 |'
              : '| item | value |\n|---|---|\n| third | 3 |',
        })),
        {
          ...chunks[1]!,
          organizedSaved: true,
          organizedMarkdown: '| item | value |\n|---|---|\n| stale failed | 2 |',
        },
      ],
    };
    const paddleError = new Error('chunk 2 failed') as Error & { ocrFileUrl: string };
    paddleError.ocrFileUrl = 'https://refreshed.example/chunk-2.pdf';
    Object.defineProperty(paddleError, 'diagnosticCode', {
      value: 'ai_studio_job_failed',
      enumerable: false,
    });
    const paddleOcr = {
      runChunk: jest.fn(async ({ chunk }) => {
        if (chunk.chunkIndex === 2) {
          throw paddleError;
        }
        return {
          rawResult: { text: `raw-${chunk.chunkIndex}` },
          rawOcrText: `raw-${chunk.chunkIndex}`,
          rawResultHash: `hash-${chunk.chunkIndex}`,
        };
      }),
    };
    const organizer = {
      organize: jest.fn(async () => ({ markdown: tableMarkdown('organized') })),
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(initialState)
        .mockResolvedValueOnce(rawState)
        .mockResolvedValueOnce(organizedState),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };

    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_partial_file',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [
        {
          file: {
            ocrFileKey: 'file:partial',
            filename: 'partial.pdf',
            sourcePdfKey: 'uploads/partial.pdf',
          },
          chunks,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () =>
              chunks.map((chunk) => ({
                ...chunk,
                filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf`,
                storageKey: `chunks/${chunk.chunkIndex}.pdf`,
              })),
            ),
          },
        },
      ],
      memory,
      organizer,
      paddleOcr,
    });

    expect(paddleOcr.runChunk).toHaveBeenCalledTimes(3);
    expect(organizer.organize).toHaveBeenCalledTimes(2);
    expect(memory.capturePaddleOcrChunkResult).toHaveBeenCalledTimes(2);
    expect(memory.captureOcrPreprocessingChunkMarkdown).toHaveBeenCalledTimes(2);
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        failures: [
          expect.objectContaining({
            stage: 'paddleocr',
            chunkIndex: 2,
            pageStart: 26,
            pageEnd: 50,
            fileUrl: 'https://refreshed.example/chunk-2.pdf',
            diagnosticCode: 'ai_studio_job_failed',
          }),
        ],
        partial: {
          markdown: '| item | value |\n| --- | --- |\n| first | 1 |\n| third | 3 |',
          pageRanges: [
            { pageStart: 1, pageEnd: 25 },
            { pageStart: 51, pageEnd: 70 },
          ],
          chunkCount: 2,
        },
      }),
    );
    expect(result.files[0]).not.toHaveProperty('markdown');
  });

  it('retains primary PaddleOCR failure when partial state reread fails', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 2, chunkSizePages: 1 });
    const initialState = emptyState({
      ocrFileKey: 'file:partial-reread-failure',
      sourcePdfKey: 'uploads/partial-reread-failure.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 2,
    });
    const rawState: OcrPreprocessingState = {
      ...initialState,
      chunks: [
        {
          ...chunks[0]!,
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-1',
          rawOcrText: 'raw-1',
        },
      ],
    };
    const paddleError = new Error('chunk 2 failed');
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(initialState)
        .mockResolvedValueOnce(rawState)
        .mockRejectedValueOnce(new Error('state reread failed')),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };

    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_partial_reread_failure',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [
        {
          file: {
            ocrFileKey: 'file:partial-reread-failure',
            filename: 'partial-reread-failure.pdf',
            sourcePdfKey: 'uploads/partial-reread-failure.pdf',
          },
          chunks,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () =>
              chunks.map((chunk) => ({
                ...chunk,
                filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf`,
                storageKey: `chunks/${chunk.chunkIndex}.pdf`,
              })),
            ),
          },
        },
      ],
      memory,
      organizer: { organize: jest.fn(async () => ({ markdown: tableMarkdown('organized first') })) },
      paddleOcr: {
        runChunk: jest.fn(async ({ chunk }) => {
          if (chunk.chunkIndex === 2) {
            throw paddleError;
          }
          return {
            rawResult: { text: 'raw-1' },
            rawOcrText: 'raw-1',
            rawResultHash: 'hash-1',
          };
        }),
      },
    });

    expect(result.files[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        stage: 'paddleocr',
        chunkIndex: 2,
        pageStart: 2,
        pageEnd: 2,
        fileUrl: 'https://cdn.example/chunk-2.pdf',
        errorMessage: 'chunk 2 failed',
        failures: [
          expect.objectContaining({
            stage: 'paddleocr',
            chunkIndex: 2,
            pageStart: 2,
            pageEnd: 2,
            fileUrl: 'https://cdn.example/chunk-2.pdf',
            errorMessage: 'chunk 2 failed',
          }),
        ],
      }),
    );
    expect(result.files[0]).not.toHaveProperty('partial');
  });

  it('splits configured 24-page parents and partial 15-page parents into retry ranges', async () => {
    const originalChunkSizeEnv = process.env[ocrPreprocessingChunkSizePagesEnvKey];
    process.env[ocrPreprocessingChunkSizePagesEnvKey] = '24';
    try {
      const initialChunks = buildPdfPageChunks({ pageCount: 39 });
      let effectiveChunks = initialChunks;
      const rawRanges = new Set<string>();
      const markdownRanges = new Set<string>();
      const rangeKey = (chunk: { pageStart: number; pageEnd: number }) =>
        `${chunk.pageStart}-${chunk.pageEnd}`;
      const readState = () => ({
        ocrFileKey: 'file:split-configured',
        sourcePdfKey: 'uploads/split-configured.pdf',
        pipelineVersion: 1,
        ocrRuleVersion: 'rules-v2',
        chunkSizePages: 24,
        chunkCount: effectiveChunks.length,
        chunks: effectiveChunks.map((chunk) => ({
          ...chunk,
          rawSaved: rawRanges.has(rangeKey(chunk)),
          organizedSaved: markdownRanges.has(rangeKey(chunk)),
          ...(rawRanges.has(rangeKey(chunk))
            ? {
                rawResultHash: `hash-${rangeKey(chunk)}`,
                rawOcrText: `raw-${rangeKey(chunk)}`,
              }
            : {}),
          ...(markdownRanges.has(rangeKey(chunk))
            ? { organizedMarkdown: `markdown-${rangeKey(chunk)}` }
            : {}),
        })),
      });
      const paddleRanges: string[] = [];
      const paddleOcr = {
        runChunk: jest.fn(async ({ chunk }) => {
          paddleRanges.push(rangeKey(chunk));
          if (!['1-12', '13-24', '25-36', '37-39'].includes(rangeKey(chunk))) {
            throw adaptiveSplitEligibleError(`parent exhausted ${rangeKey(chunk)}`);
          }
          return {
            rawResult: { text: `raw-${rangeKey(chunk)}` },
            rawOcrText: `raw-${rangeKey(chunk)}`,
            rawResultHash: `hash-${rangeKey(chunk)}`,
          };
        }),
      };
      const memory = {
        readOcrPreprocessingState: jest.fn(async () => readState()),
        capturePaddleOcrChunkResult: jest.fn(async ({ chunk }) => {
          rawRanges.add(rangeKey(chunk));
          return { savedCounts: { paddleocr_preflight: 1 } };
        }),
        captureOcrPreprocessingChunkMarkdown: jest.fn(async ({ chunk }) => {
          markdownRanges.add(rangeKey(chunk));
          return { savedCounts: { ocr_preprocessing_chunk_markdown: 1 } };
        }),
      };
      const artifacts = {
        ensurePdfChunkArtifacts: jest.fn(async ({ chunks }) =>
          chunks.map((chunk) => ({
            ...chunk,
            filepath: `https://cdn.example/${rangeKey(chunk)}.pdf`,
            storageKey: `chunks/${rangeKey(chunk)}.pdf`,
          })),
        ),
        commitPdfChunkSplit: jest.fn(async ({ chunks }) => {
          effectiveChunks = [...chunks];
          return chunks.map((chunk) => ({
            ...chunk,
            filepath: `https://cdn.example/${rangeKey(chunk)}.pdf`,
            storageKey: `chunks/${rangeKey(chunk)}.pdf`,
          }));
        }),
      };
      const result = await runOcrPreprocessingBatchPipeline({
        conversationId: 'steel_conversation_split_configured',
        ocrRuleVersion: 'rules-v2',
        ocrRulesText: 'rules',
        files: [
          {
            file: {
              ocrFileKey: 'file:split-configured',
              filename: 'split-configured.pdf',
              sourcePdfKey: 'uploads/split-configured.pdf',
            },
            chunks: initialChunks,
            artifacts,
          },
        ],
        memory,
        organizer: {
          organize: jest.fn(async ({ rawOcrText }) => ({
            markdown: tableMarkdown(`organized-${rawOcrText}`),
          })),
        },
        paddleOcr,
      });

      expect(paddleRanges).toEqual(['1-24', '1-12', '13-24', '25-39', '25-36', '37-39']);
      expect(artifacts.commitPdfChunkSplit).toHaveBeenCalledTimes(2);
      expect(result.files[0]).toEqual(
        expect.objectContaining({
          status: 'completed',
          chunkCount: 4,
          pageRanges: [
            { pageStart: 1, pageEnd: 12 },
            { pageStart: 13, pageEnd: 24 },
            { pageStart: 25, pageEnd: 36 },
            { pageStart: 37, pageEnd: 39 },
          ],
        }),
      );
    } finally {
      if (originalChunkSizeEnv === undefined) {
        delete process.env[ocrPreprocessingChunkSizePagesEnvKey];
      } else {
        process.env[ocrPreprocessingChunkSizePagesEnvKey] = originalChunkSizeEnv;
      }
    }
  });

  it('splits an exhausted exact 50-page parent, preserves later siblings, and suppresses the parent failure', async () => {
    const initialChunks = buildPdfPageChunks({ pageCount: 100, chunkSizePages: 50 });
    let effectiveChunks = initialChunks;
    const rawRanges = new Set<string>();
    const markdownRanges = new Set<string>();
    const rangeKey = (chunk: { pageStart: number; pageEnd: number }) =>
      `${chunk.pageStart}-${chunk.pageEnd}`;
    const readState = () => ({
      ocrFileKey: 'file:split-parent',
      sourcePdfKey: 'uploads/split-parent.pdf',
      pipelineVersion: 1,
      ocrRuleVersion: 'rules-v2',
      chunkSizePages: 50,
      chunkCount: effectiveChunks.length,
      chunks: effectiveChunks.map((chunk) => ({
        ...chunk,
        rawSaved: rawRanges.has(rangeKey(chunk)),
        organizedSaved: markdownRanges.has(rangeKey(chunk)),
        ...(rawRanges.has(rangeKey(chunk)) ? { rawResultHash: `hash-${rangeKey(chunk)}`, rawOcrText: `raw-${rangeKey(chunk)}` } : {}),
        ...(markdownRanges.has(rangeKey(chunk)) ? { organizedMarkdown: `markdown-${rangeKey(chunk)}` } : {}),
      })),
    });
    const paddleRanges: string[] = [];
    const paddleOcr = {
      runChunk: jest.fn(async ({ chunk }) => {
        paddleRanges.push(rangeKey(chunk));
        if (rangeKey(chunk) === '1-50') {
          throw adaptiveSplitEligibleError('parent exhausted');
        }
        return {
          rawResult: { text: `raw-${rangeKey(chunk)}` },
          rawOcrText: `raw-${rangeKey(chunk)}`,
          rawResultHash: `hash-${rangeKey(chunk)}`,
        };
      }),
    };
    const memory = {
      readOcrPreprocessingState: jest.fn(async () => readState()),
      capturePaddleOcrChunkResult: jest.fn(async ({ chunk }) => {
        rawRanges.add(rangeKey(chunk));
        return { savedCounts: { paddleocr_preflight: 1 } };
      }),
      captureOcrPreprocessingChunkMarkdown: jest.fn(async ({ chunk }) => {
        markdownRanges.add(rangeKey(chunk));
        return { savedCounts: { ocr_preprocessing_chunk_markdown: 1 } };
      }),
    };
    const artifacts = {
      ensurePdfChunkArtifacts: jest.fn(async ({ chunks }) =>
        chunks.map((chunk) => ({
          ...chunk,
          filepath: `https://cdn.example/${rangeKey(chunk)}.pdf`,
          storageKey: `chunks/${rangeKey(chunk)}.pdf`,
        })),
      ),
      commitPdfChunkSplit: jest.fn(async ({ chunks }) => {
        effectiveChunks = [...chunks];
        return chunks.map((chunk) => ({
          ...chunk,
          filepath: `https://cdn.example/${rangeKey(chunk)}.pdf`,
          storageKey: `chunks/${rangeKey(chunk)}.pdf`,
        }));
      }),
    };
    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_split_parent',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [
        {
          file: {
            ocrFileKey: 'file:split-parent',
            filename: 'split-parent.pdf',
            sourcePdfKey: 'uploads/split-parent.pdf',
          },
          chunks: initialChunks,
          artifacts,
        },
      ],
      memory,
      organizer: {
        organize: jest.fn(async ({ rawOcrText }) => ({ markdown: tableMarkdown(`organized-${rawOcrText}`) })),
      },
      paddleOcr,
    });

    expect(paddleRanges).toEqual(['1-50', '1-25', '26-50', '51-100']);
    expect(artifacts.commitPdfChunkSplit).toHaveBeenCalledTimes(1);
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        chunkCount: 3,
        pageRanges: [
          { pageStart: 1, pageEnd: 25 },
          { pageStart: 26, pageEnd: 50 },
          { pageStart: 51, pageEnd: 100 },
        ],
      }),
    );
    expect(result.files[0]).not.toHaveProperty('failures');
  });

  it('does not split an exact 50-page parent before two PaddleOCR invokes are exhausted', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 });
    const state = emptyState({
      ocrFileKey: 'file:no-early-split',
      sourcePdfKey: 'uploads/no-early-split.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const commitPdfChunkSplit = jest.fn();
    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_no_early_split',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [
        {
          file: {
            ocrFileKey: 'file:no-early-split',
            filename: 'no-early-split.pdf',
            sourcePdfKey: 'uploads/no-early-split.pdf',
          },
          chunks,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () => [
              {
                ...chunks[0]!,
                filepath: 'https://cdn.example/parent.pdf',
                storageKey: 'chunks/parent.pdf',
              },
            ]),
            commitPdfChunkSplit,
          },
        },
      ],
      memory: {
        readOcrPreprocessingState: jest.fn(async () => state),
        capturePaddleOcrChunkResult: jest.fn(),
        captureOcrPreprocessingChunkMarkdown: jest.fn(),
      },
      organizer: { organize: jest.fn() },
      paddleOcr: { runChunk: jest.fn(async () => { throw new Error('invalid credentials'); }) },
    });

    expect(commitPdfChunkSplit).not.toHaveBeenCalled();
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        pageStart: 1,
        pageEnd: 50,
        failures: [expect.objectContaining({ pageStart: 1, pageEnd: 50 })],
      }),
    );
  });

  it('reports only the unresolved 25-page child when a split child fails', async () => {
    const initialChunks = buildPdfPageChunks({ pageCount: 50, chunkSizePages: 50 });
    let effectiveChunks = initialChunks;
    const rawRanges = new Set<string>();
    const rangeKey = (chunk: { pageStart: number; pageEnd: number }) => `${chunk.pageStart}-${chunk.pageEnd}`;
    const memory = {
      readOcrPreprocessingState: jest.fn(async () => ({
        ocrFileKey: 'file:split-child-failure',
        sourcePdfKey: 'uploads/split-child-failure.pdf',
        pipelineVersion: 1,
        ocrRuleVersion: 'rules-v2',
        chunkSizePages: 50,
        chunkCount: effectiveChunks.length,
        chunks: effectiveChunks.map((chunk) => ({
          ...chunk,
          rawSaved: rawRanges.has(rangeKey(chunk)),
          organizedSaved: false,
          ...(rawRanges.has(rangeKey(chunk))
            ? { rawResultHash: `hash-${rangeKey(chunk)}`, rawOcrText: `raw-${rangeKey(chunk)}` }
            : {}),
        })),
      })),
      capturePaddleOcrChunkResult: jest.fn(async ({ chunk }) => {
        rawRanges.add(rangeKey(chunk));
        return { savedCounts: { paddleocr_preflight: 1 } };
      }),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };
    const artifacts = {
      ensurePdfChunkArtifacts: jest.fn(async ({ chunks }) =>
        chunks.map((chunk) => ({ ...chunk, filepath: `https://cdn/${rangeKey(chunk)}.pdf`, storageKey: rangeKey(chunk) })),
      ),
      commitPdfChunkSplit: jest.fn(async ({ chunks }) => {
        effectiveChunks = [...chunks];
        return chunks.map((chunk) => ({ ...chunk, filepath: `https://cdn/${rangeKey(chunk)}.pdf`, storageKey: rangeKey(chunk) }));
      }),
    };
    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_split_child_failure',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [{ file: { ocrFileKey: 'file:split-child-failure', filename: 'split.pdf', sourcePdfKey: 'uploads/split-child-failure.pdf' }, chunks: initialChunks, artifacts }],
      memory,
      organizer: { organize: jest.fn(async () => ({ markdown: tableMarkdown('organized') })) },
      paddleOcr: {
        runChunk: jest.fn(async ({ chunk }) => {
          if (rangeKey(chunk) === '1-50') {
            throw adaptiveSplitEligibleError('failed 1-50');
          }
          if (rangeKey(chunk) === '26-50') {
            throw new Error(`failed ${rangeKey(chunk)}`);
          }
          return { rawResult: { text: 'raw' }, rawOcrText: 'raw', rawResultHash: 'hash' };
        }),
      },
    });

    expect(result.files[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        pageStart: 26,
        pageEnd: 50,
        failures: [expect.objectContaining({ pageStart: 26, pageEnd: 50 })],
      }),
    );
    expect(result.files[0]?.failures).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ pageStart: 1, pageEnd: 50 })]),
    );
  });

  it('uses the committed mixed plan on the next run and retries only a missing 25-page child', async () => {
    const mixedChunks = [
      { chunkIndex: 1, chunkCount: 3, pageStart: 1, pageEnd: 25, chunkSizePages: 25 },
      { chunkIndex: 2, chunkCount: 3, pageStart: 26, pageEnd: 50, chunkSizePages: 25 },
      { chunkIndex: 3, chunkCount: 3, pageStart: 51, pageEnd: 100, chunkSizePages: 50 },
    ];
    const rawRanges = new Set(['1-25', '51-100']);
    const markdownRanges = new Set(['1-25', '51-100']);
    const rangeKey = (chunk: { pageStart: number; pageEnd: number }) => `${chunk.pageStart}-${chunk.pageEnd}`;
    const memory = {
      readOcrPreprocessingState: jest.fn(async () => ({
        ocrFileKey: 'file:mixed-resume',
        sourcePdfKey: 'uploads/mixed-resume.pdf',
        pipelineVersion: 1,
        ocrRuleVersion: 'rules-v2',
        chunkSizePages: 25,
        chunkCount: mixedChunks.length,
        chunks: mixedChunks.filter((chunk) => rawRanges.has(rangeKey(chunk))).map((chunk) => ({
          ...chunk,
          rawSaved: true,
          organizedSaved: markdownRanges.has(rangeKey(chunk)),
          rawResultHash: `hash-${rangeKey(chunk)}`,
          rawOcrText: `raw-${rangeKey(chunk)}`,
          ...(markdownRanges.has(rangeKey(chunk)) ? { organizedMarkdown: `md-${rangeKey(chunk)}` } : {}),
        })),
      })),
      capturePaddleOcrChunkResult: jest.fn(async ({ chunk }) => {
        rawRanges.add(rangeKey(chunk));
        return { savedCounts: { paddleocr_preflight: 1 } };
      }),
      captureOcrPreprocessingChunkMarkdown: jest.fn(async ({ chunk }) => {
        markdownRanges.add(rangeKey(chunk));
        return { savedCounts: { ocr_preprocessing_chunk_markdown: 1 } };
      }),
    };
    const paddleOcr = { runChunk: jest.fn(async ({ chunk }) => ({ rawResult: { text: 'missing' }, rawOcrText: 'missing', rawResultHash: 'missing' })) };
    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_mixed_resume',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [{
        file: { ocrFileKey: 'file:mixed-resume', filename: 'mixed.pdf', sourcePdfKey: 'uploads/mixed-resume.pdf' },
        chunks: [{ chunkIndex: 1, chunkCount: 2, pageStart: 1, pageEnd: 50, chunkSizePages: 50 }, { chunkIndex: 2, chunkCount: 2, pageStart: 51, pageEnd: 100, chunkSizePages: 50 }],
        artifacts: {
          resolveCanonicalChunks: jest.fn(async () => mixedChunks),
          ensurePdfChunkArtifacts: jest.fn(async ({ chunks }) => chunks.map((chunk) => ({ ...chunk, filepath: `https://cdn/${rangeKey(chunk)}.pdf`, storageKey: rangeKey(chunk) }))),
        },
      }],
      memory,
      organizer: {
        organize: jest.fn(async () => ({ markdown: tableMarkdown('organized missing child') })),
      },
      paddleOcr,
    });

    expect(paddleOcr.runChunk).toHaveBeenCalledTimes(1);
    expect(paddleOcr.runChunk).toHaveBeenCalledWith(expect.objectContaining({ chunk: expect.objectContaining({ pageStart: 26, pageEnd: 50 }) }));
    expect(result.files[0]).toEqual(expect.objectContaining({ status: 'completed', chunkCount: 3 }));
  });

  it('retries a transient organizer failure once and persists the second result', async () => {
    const organizer: OcrOrganizer = {
      organize: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient organizer failure'))
        .mockResolvedValueOnce({ markdown: tableMarkdown('organized markdown') }),
    };
    const fixture = organizerRetryFixture({ organizer });

    const result = await runOcrPreprocessingPipeline(fixture.input);

    expect(organizer.organize).toHaveBeenCalledTimes(2);
    expect(fixture.memory.captureOcrPreprocessingChunkMarkdown).toHaveBeenCalledTimes(1);
    expect(fixture.memory.captureOcrPreprocessingChunkMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ content: tableMarkdown('organized markdown') }),
    );
    expect(result).toEqual({
      status: 'completed',
      markdown: tableMarkdown('organized markdown'),
      chunkCount: 1,
      pageRanges: [{ pageStart: 1, pageEnd: 1 }],
    });
    expect(result.markdown).not.toContain('raw OCR text');
  });

  it('returns one ranged organizer failure after both organizer attempts fail', async () => {
    const finalError = new Error('final organizer failure');
    const organizer: OcrOrganizer = {
      organize: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient organizer failure'))
        .mockRejectedValueOnce(finalError),
    };
    const fixture = organizerRetryFixture({ organizer });

    const result = await runOcrPreprocessingPipeline(fixture.input);

    expect(organizer.organize).toHaveBeenCalledTimes(2);
    expect(fixture.memory.captureOcrPreprocessingChunkMarkdown).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        stage: 'organizer',
        chunkIndex: 1,
        pageStart: 1,
        pageEnd: 1,
        errorMessage: 'final organizer failure',
        failures: [
          {
            stage: 'organizer',
            chunkIndex: 1,
            pageStart: 1,
            pageEnd: 1,
            errorMessage: 'final organizer failure',
          },
        ],
      }),
    );
    expect(result).not.toHaveProperty('markdown');
  });

  it('uses cached organized chunks for partial output without rereading unchanged state', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 2, chunkSizePages: 1 });
    const state = {
      ...emptyState({
        ocrFileKey: 'file:cached-partial',
        sourcePdfKey: 'uploads/cached-partial.pdf',
        ocrRuleVersion: 'rules-v2',
        chunkCount: 2,
      }),
      chunks: [
        {
          ...chunks[0]!,
          rawSaved: true,
          organizedSaved: true,
          rawResultHash: 'hash-1',
          rawOcrText: 'raw-1',
          organizedMarkdown: '| item | value |\n|---|---|\n| cached | 1 |',
        },
        {
          ...chunks[1]!,
          rawSaved: true,
          organizedSaved: false,
          rawResultHash: 'hash-2',
          rawOcrText: 'raw-2',
        },
      ],
    };
    const memory = {
      readOcrPreprocessingState: jest.fn().mockResolvedValue(state),
      capturePaddleOcrChunkResult: jest.fn(),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };
    const organizer = {
      organize: jest.fn().mockRejectedValue(new Error('organizer unavailable')),
    };
    const result = await runOcrPreprocessingBatchPipeline({
      conversationId: 'steel_conversation_cached_partial',
      ocrRuleVersion: 'rules-v2',
      ocrRulesText: 'rules',
      files: [
        {
          file: {
            ocrFileKey: 'file:cached-partial',
            filename: 'cached-partial.pdf',
            sourcePdfKey: 'uploads/cached-partial.pdf',
          },
          chunks,
          artifacts: {
            ensurePdfChunkArtifacts: jest.fn(async () =>
              chunks.map((chunk) => ({
                ...chunk,
                filepath: `https://cdn.example/chunk-${chunk.chunkIndex}.pdf`,
                storageKey: `chunks/${chunk.chunkIndex}.pdf`,
              })),
            ),
          },
        },
      ],
      memory,
      organizer,
      paddleOcr: { runChunk: jest.fn() },
    });

    expect(memory.readOcrPreprocessingState).toHaveBeenCalledTimes(2);
    expect(organizer.organize).toHaveBeenCalledTimes(2);
    expect(memory.captureOcrPreprocessingChunkMarkdown).not.toHaveBeenCalled();
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        partial: {
          markdown: '| item | value |\n| --- | --- |\n| cached | 1 |',
          pageRanges: [{ pageStart: 1, pageEnd: 1 }],
          chunkCount: 1,
        },
      }),
    );
  });

  it('propagates PaddleOCR save cancellation without continuing to organizer', async () => {
    const chunks = buildPdfPageChunks({ pageCount: 1 });
    const state = emptyState({
      ocrFileKey: 'file:save-cancel',
      sourcePdfKey: 'uploads/save-cancel.pdf',
      ocrRuleVersion: 'rules-v2',
      chunkCount: 1,
    });
    const abortError = new Error('request canceled');
    const organizer: OcrOrganizer = { organize: jest.fn() };
    const memory = {
      readOcrPreprocessingState: jest.fn(async () => state),
      capturePaddleOcrChunkResult: jest.fn().mockRejectedValue(abortError),
      captureOcrPreprocessingChunkMarkdown: jest.fn(),
    };

    await expect(
      runOcrPreprocessingPipeline({
        conversationId: 'steel_conversation_save_cancel',
        file: {
          ocrFileKey: 'file:save-cancel',
          fileId: 'save-cancel',
          filename: 'save-cancel.pdf',
          sourcePdfKey: 'uploads/save-cancel.pdf',
        },
        ocrRuleVersion: 'rules-v2',
        ocrRulesText: 'rules',
        chunks,
        artifacts: {
          ensurePdfChunkArtifacts: jest.fn(async () => [
            {
              ...chunks[0]!,
              filepath: 'https://cdn.example/save-cancel.pdf',
              storageKey: 'chunks/save-cancel.pdf',
            },
          ]),
        },
        memory,
        organizer,
        paddleOcr: {
          runChunk: jest.fn(async () => ({
            rawResult: { text: 'raw OCR text' },
            rawOcrText: 'raw OCR text',
            rawResultHash: 'hash-save-cancel',
          })),
        },
      }),
    ).rejects.toBe(abortError);

    expect(organizer.organize).not.toHaveBeenCalled();
    expect(memory.captureOcrPreprocessingChunkMarkdown).not.toHaveBeenCalled();
  });

  it('propagates organizer cancellation without retrying', async () => {
    const abortError = new Error('request canceled');
    const organizer: OcrOrganizer = {
      organize: jest.fn().mockRejectedValue(abortError),
    };
    const fixture = organizerRetryFixture({ organizer });

    await expect(runOcrPreprocessingPipeline(fixture.input)).rejects.toBe(abortError);

    expect(organizer.organize).toHaveBeenCalledTimes(1);
    expect(fixture.memory.captureOcrPreprocessingChunkMarkdown).not.toHaveBeenCalled();
  });
});
