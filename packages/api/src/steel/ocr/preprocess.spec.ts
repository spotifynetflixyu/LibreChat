import { buildPdfPageChunks } from './chunks';
import { mergeChunkMarkdownForFileKey } from './merge';
import { runOcrPreprocessingBatchPipeline, runOcrPreprocessingPipeline } from './preprocess';

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

describe('OCR preprocessing orchestrator', () => {
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
          markdown: `organized ${input.rawOcrText.replace('raw ', '')}`,
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
    });
    expect(organizer.organize).toHaveBeenNthCalledWith(2, {
      ocrRulesText: 'rules',
      rawOcrText: 'raw b',
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
        calls.push(
          `save-raw:${input.file.ocrFileKey}:${input.providerToolCallId}:${input.chunk.chunkIndex}`,
        );
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
          markdown: `organized ${input.rawOcrText.replace('raw ', '')}`,
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
      'save-raw:file:file-b:ocr_preprocessing_file_file-b_chunk_1:1',
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
        markdown: `organized ${input.rawOcrText.replace('raw ', '')}`,
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
          organizedMarkdown: 'organized 2',
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
      { ocrRulesText: 'rules', rawOcrText: 'raw 2' },
    );
    expect(memory.captureOcrPreprocessingChunkMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResultHash: 'hash-2',
        content: 'organized 2',
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
    const chunks = buildPdfPageChunks({ pageCount: 120, chunkSizePages: 50 });
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
    const paddleOcr = {
      runChunk: jest.fn(async ({ chunk }) => {
        if (chunk.chunkIndex === 2) {
          throw new Error('chunk 2 failed');
        }
        return {
          rawResult: { text: `raw-${chunk.chunkIndex}` },
          rawOcrText: `raw-${chunk.chunkIndex}`,
          rawResultHash: `hash-${chunk.chunkIndex}`,
        };
      }),
    };
    const organizer = {
      organize: jest.fn(async () => ({ markdown: 'organized' })),
    };
    const memory = {
      readOcrPreprocessingState: jest
        .fn()
        .mockResolvedValueOnce(initialState)
        .mockResolvedValueOnce(rawState),
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
            pageStart: 51,
            pageEnd: 100,
          }),
        ],
      }),
    );
    expect(result.files[0]).not.toHaveProperty('markdown');
  });
});
