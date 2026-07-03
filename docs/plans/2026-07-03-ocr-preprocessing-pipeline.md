# OCR Preprocessing Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a resumable, database-driven OCR preprocessing pipeline that converts page-range PDF chunk PaddleOCR raw results into saved OCR Markdown before the main Steel agent runs.

**Architecture:** The pipeline always reads persisted global PDF chunk artifacts, `paddleocr_preflight`, and `ocr_extract` rows before doing work. PDF chunk artifacts are indexed by the original PDF S3 file key/storage key rather than by conversation, so another conversation using the same original PDF can reuse the existing page-range PDF chunks. The pipeline uses 50 PDF pages per chunk by default, stores each PDF chunk in S3 before PaddleOCR, passes the chunk file URL to PaddleOCR MCP, runs PaddleOCR only for missing raw chunks, runs the OCR organizer subagent only for chunks missing organized Markdown, saves every successful chunk immediately, then passes the merged OCR Markdown to the main Steel agent.

**Tech Stack:** Node.js 24, TypeScript in `packages/api`, thin JS integration in `api`, Mongo/Mongoose Steel working-order memory, `pdfjs-dist` for page counts, `pdf-lib` for PDF page-range chunk files, existing S3/CloudFront storage strategies, PaddleOCR MCP, existing Steel native stream events, Jest.

---

## Non-Negotiable Scope

- Default PDF chunk size is 50 pages.
- PDF chunks must remain PDFs. Do not rasterize PDF pages into PNG/JPEG for preprocessing OCR chunks.
- Every split PDF chunk must be saved to S3/CloudFront storage before PaddleOCR runs. PaddleOCR MCP receives the downloadable chunk file URL, not local temp file content.
- PDF chunk artifact lookup is global by the original PDF source file key/storage key, not by conversation id.
- If another conversation uses the same original PDF source key and the chunk artifacts already exist, the pipeline must reuse those chunk PDFs and must not split/upload them again.
- Before creating a split PDF chunk, check the global persisted chunk artifact state and S3 for the deterministic chunk object. If it already exists, reuse it and refresh/regenerate the download URL instead of recreating or reuploading the PDF chunk.
- First slice does not implement token-budget truncation.
- First slice does not add `read_markdown(scope: "ocr", pageRange/contentPartIndex)`.
- The main Steel agent must not receive raw PaddleOCR chunks in `additional_instructions`.
- The pipeline must resume entirely from database state.
- Completed chunks must not rerun PaddleOCR, rerun organizer subagents, or parse/save twice.
- If final merged OCR Markdown already exists for the same source PDF key, file key, pipeline version, and current OCR rule version, skip preprocessing and start the Steel agent with that Markdown.
- The main Steel agent receives one merged OCR Markdown string per `ocrFileKey`. Do not pass chunk Markdown arrays or multiple independent chunk snippets into `additional_instructions`.
- OCR rule version is part of organized Markdown validity. When OCR rules change, reuse saved raw `paddleocr_preflight` chunks, but rerun organizer subagents for every chunk and replace the final merged Markdown.
- Chunk Markdown tables may have different headers. The final same-file-key merge must union table headers and leave missing row values blank instead of inferring or fabricating data.

## State Model

### Source PDF Key

Use the original PDF file's storage identity as the main index for PDF chunk artifacts:

```ts
type OcrSourcePdfKey = {
  sourcePdfKey: string; // prefer the original file storageKey/S3 key
  sourceStorageKey?: string;
  sourceFileId?: string;
  sourceFilename?: string;
  sourceBytes?: number;
};
```

`sourcePdfKey` must be derived from the original uploaded PDF record. Prefer the S3/CloudFront `storageKey` because it identifies the already-stored object across conversations. Fall back to the canonical `ocrFileKey`/`file:<id>` only if the file record has no storage key. Do not use `conversationId` as the PDF chunk artifact cache key.

Security boundary: the artifact lookup may be cross-conversation, but it must still be reachable only after the current request has already resolved and permission-checked the original LibreChat file record. The artifact registry is a reuse cache for the same stored PDF object, not a public file lookup API.

### Chunk Identity

Use this stable identity for raw OCR and organized rows:

```ts
type OcrPreprocessingChunkIdentity = {
  pipelineVersion: 1;
  sourcePdfKey: string;
  ocrFileKey: string;
  fileId?: string;
  filename?: string;
  chunkIndex: number; // 1-based
  chunkCount: number;
  pageStart: number; // 1-based inclusive
  pageEnd: number; // 1-based inclusive
  chunkSizePages: 50;
};
```

Keep the normal `payload.ocrFileKey` equal to the source file key. Do not invent a separate file key per chunk; chunk identity lives under `payload.ocrPreprocessing`.

`ocrRuleVersion` is required on organized chunk Markdown and final merged Markdown. It is optional metadata on raw `paddleocr_preflight` chunks because raw OCR can be reused across rule changes.

### Global PDF Chunk Artifact Row

After splitting a PDF into page-range chunks, upload all chunk PDFs to S3/CloudFront storage in one preprocessing phase and persist one artifact row per chunk in a global Steel Mongo collection.

Create a new model/collection instead of storing PDF chunk artifacts in conversation-scoped working-order memory:

- Model factory: `createSteelOcrPdfChunkArtifactModel`
- Schema file: `packages/data-schemas/src/schema/steel/ocrPdfChunkArtifact.ts`
- Collection: `steel_ocr_pdf_chunk_artifacts`
- Unique index: `{ sourcePdfKey: 1, pipelineVersion: 1, chunkSizePages: 1, chunkIndex: 1, pageStart: 1, pageEnd: 1 }`

Example document:

```ts
{
  sourcePdfKey: "s3://bucket/r/prod/t/tenant/uploads/original.pdf",
  sourceStorageKey: "r/prod/t/tenant/uploads/original.pdf",
  sourceFileId: "<id>",
  sourceFilename: "quote.pdf",
  sourceBytes: 9876543,
  pipelineVersion: 1,
  chunkIndex: 1,
  chunkCount: 5,
  pageStart: 1,
  pageEnd: 50,
  chunkSizePages: 50,
  artifact: {
    source: "s3",
    storageKey: "r/prod/t/tenant/ocr-preprocessing/<source-hash>/v1/pages-000001-000050.pdf",
    storageRegion: "ap-east-1",
    filepath: "<last generated signed or public chunk PDF URL>",
    filename: "quote.pages-000001-000050.pdf",
    bytes: 123456,
    contentType: "application/pdf"
  }
}
```

The artifact row is process state, not final OCR evidence. It exists so resubmits and other conversations using the same original PDF can reuse chunk PDFs without splitting or uploading again. If DB has an artifact row, refresh/regenerate the URL from `artifact.storageKey` before calling PaddleOCR. If the DB row is missing but the deterministic S3 key exists, repair the DB artifact row and reuse the existing object.

Raw `paddleocr_preflight` and `ocr_extract` rows may reference `sourcePdfKey` and `artifact.storageKey`, but they must not be the primary storage for PDF chunk artifacts.

### Raw Chunk Row

Store each PaddleOCR raw chunk as `memoryKind: "paddleocr_preflight"` with `payload.kind: "paddleocr_mcp_chunk_result"`:

```ts
{
  kind: "paddleocr_mcp_chunk_result",
  ocrSource: "paddleocr_mcp",
  ocrEngine: "paddleocr_vl",
  ocrFileKey: "file:<id>",
  fileId: "<id>",
  filename: "quote.pdf",
  ocrPreprocessing: {
    pipelineVersion: 1,
    sourcePdfKey: "s3://bucket/r/prod/t/tenant/uploads/original.pdf",
    chunkIndex: 1,
    chunkCount: 5,
    pageStart: 1,
    pageEnd: 50,
    chunkSizePages: 50,
    pdfChunk: {
      source: "s3",
      storageKey: "r/us-east-2/t/tenant/ocr-preprocessing/<file-id>/v1/pages-000001-000050.pdf",
      storageRegion: "us-east-2",
      filepath: "<PaddleOCR input URL used for this run>"
    },
    rawResultHash: "<sha256 of normalized raw result>"
  },
  result: <raw PaddleOCR MCP result>
}
```

### Organized Chunk Markdown Row

Store every organizer-subagent result immediately as `memoryKind: "ocr_extract"`:

```ts
{
  kind: "ocr_preprocessing_chunk_markdown",
  ocrSource: "ocr_preprocessing_subagent",
  ocrFileKey: "file:<id>",
  fileId: "<id>",
  filename: "quote.pdf",
  content: "<organized OCR Markdown for pages 1-50>",
  ocrPreprocessing: {
    pipelineVersion: 1,
    sourcePdfKey: "s3://bucket/r/prod/t/tenant/uploads/original.pdf",
    chunkIndex: 1,
    chunkCount: 5,
    pageStart: 1,
    pageEnd: 50,
    chunkSizePages: 50,
    rawResultHash: "<same hash as raw row>",
    ocrRuleVersion: "<current OCR rule version/hash>",
    organizerVersion: 1
  }
}
```

### Final Merged Markdown Row

Store the deterministic merge as `memoryKind: "ocr_extract"`:

```ts
{
  kind: "ocr_preprocessing_merged_markdown",
  ocrSource: "ocr_preprocessing_merge",
  ocrFileKey: "file:<id>",
  fileId: "<id>",
  filename: "quote.pdf",
  content: "<merged OCR Markdown in page/chunk order>",
  ocrPreprocessing: {
    pipelineVersion: 1,
    sourcePdfKey: "s3://bucket/r/prod/t/tenant/uploads/original.pdf",
    chunkCount: 5,
    chunkSizePages: 50,
    complete: true,
    ocrRuleVersion: "<current OCR rule version/hash>",
    organizerVersion: 1
  }
}
```

The final merged row is the only OCR Markdown payload for that `ocrFileKey` that may be injected into the main Steel agent. Chunk Markdown rows remain durable intermediate evidence for resume/idempotency and must be merged before entering `additional_instructions`.

When merging chunk Markdown, do not require identical table headers across chunks. For OCR tables that belong to the same final file-key table, build the final header set from the union of headers in first-seen order. For each row, copy available values by matching header name; if a source chunk did not contain a header or value, emit an empty cell. Do not invent values, normalize blanks into guesses, or drop rows because a chunk had a narrower table.

## Runtime State Machine

For each current file:

1. Resolve the original LibreChat file record and derive `sourcePdfKey` from the file's S3/CloudFront `storageKey`. Use `ocrFileKey` only as a fallback when no storage key exists.
2. Resolve the current OCR rule version/hash before reading preprocessing state.
3. Read all active `paddleocr_preflight` and `ocr_extract` rows for `payload.ocrFileKey` and `payload.ocrPreprocessing.sourcePdfKey`.
4. If a complete final merged row exists for the current source PDF key, pipeline version, and current OCR rule version:
   - skip PaddleOCR
   - skip organizer subagents
   - return the final Markdown for Steel context
5. Otherwise compute the expected page chunks:
   - PDF: 50-page page-range PDF chunks, e.g. pages 1-50, 51-100
   - non-PDF image: one chunk
6. Ensure PDF chunk artifacts exist before any PaddleOCR call:
   - read `steel_ocr_pdf_chunk_artifacts` rows by `sourcePdfKey` for every expected chunk
   - if all artifact rows exist, refresh/regenerate their file URLs from stored `artifact.storageKey`
   - if a DB artifact row is missing, check the deterministic S3 key derived from `sourcePdfKey`, pipeline version, and page range
   - if the S3 object exists, repair/save the global DB artifact row and reuse it
   - if neither DB nor S3 has the object, split the source PDF into the missing page-range PDF chunk
   - upload all newly-created missing chunk PDFs to S3/CloudFront storage
   - save artifact rows with `sourcePdfKey`, `artifact.storageKey`, `artifact.storageRegion`, `artifact.filepath`, filename, byte size, and page range
7. For each chunk:
   - if raw preflight row missing, run PaddleOCR using the chunk artifact URL and save raw row
   - if raw row exists and organized chunk Markdown for the current OCR rule version is missing, run organizer subagent and save chunk Markdown immediately
   - if organized chunk Markdown exists for the current OCR rule version, skip both work items
8. Treat organized chunk Markdown from older OCR rule versions as stale. Do not pass it to the main Steel agent and do not use it in the final merge.
9. After all chunks have organized Markdown for the current OCR rule version, merge chunk Markdown in `chunkIndex` order.
   - tables from different chunks may have different headers
   - merge same-file-key OCR tables with a union header set
   - fill missing row/header intersections with empty strings
   - preserve chunk/page order and do not infer missing values
10. Save or replace the final merged row for the current source PDF key and current OCR rule version.
11. Return one merged Markdown string per `ocrFileKey` to the main Steel agent context.
12. Build `additional_instructions` from these merged per-file Markdown strings, not from per-chunk Markdown rows.

## User-Visible Event Sequence

Use existing Steel stream event infrastructure, adding source/message fields as needed.

Expected example for a 250-page PDF:

1. `paddleocr_preflight (<fileKey>)`
2. `paddleocr_preflight data saved as 5 chunks (<fileKey>)`
3. `subagent process ocr 1/5 ocr preflight data (<fileKey>)`
4. `subagent process ocr 2/5 ocr preflight data (<fileKey>)`
5. `subagent process ocr 3/5 ocr preflight data (<fileKey>)`
6. `subagent process ocr 4/5 ocr preflight data (<fileKey>)`
7. `subagent process ocr 5/5 ocr preflight data (<fileKey>)`
8. `ocr markdown saved (<fileKey>)`

On resubmit after 2/5 completed, do not replay completed work as new work. Emit resumed progress only for missing work, then save final Markdown when complete.

---

### Task 1: Add Global PDF Chunk Artifact Schema

**Files:**
- Create: `packages/data-schemas/src/schema/steel/ocrPdfChunkArtifact.ts`
- Modify: `packages/data-schemas/src/schema/steel/index.ts`
- Modify: `packages/data-schemas/src/models/steel/index.ts`
- Modify: `packages/data-schemas/src/index.ts`
- Test: `packages/data-schemas/src/schema/steel.spec.ts`

**Step 1: Write failing schema/model tests**

Add tests that assert:

- `createSteelOcrPdfChunkArtifactModel(mongoose).collection.name` is `steel_ocr_pdf_chunk_artifacts`
- schema has `sourcePdfKey`, `sourceStorageKey`, `sourceFileId`, `pipelineVersion`, `chunkIndex`, `chunkCount`, `pageStart`, `pageEnd`, `chunkSizePages`, and `artifact.storageKey`
- unique index is based on `sourcePdfKey`, `pipelineVersion`, `chunkSizePages`, `chunkIndex`, `pageStart`, and `pageEnd`
- no `conversationId` path is required for chunk artifact identity

Expected core assertion:

```ts
expect(SteelOcrPdfChunkArtifact.schema.indexes()).toContainEqual([
  {
    sourcePdfKey: 1,
    pipelineVersion: 1,
    chunkSizePages: 1,
    chunkIndex: 1,
    pageStart: 1,
    pageEnd: 1,
  },
  expect.objectContaining({ unique: true }),
]);
```

**Step 2: Run test to verify failure**

```bash
cd packages/data-schemas && rtk npx jest src/schema/steel.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR PDF chunk artifact"
```

Expected: fail because the schema/model does not exist.

**Step 3: Implement schema and model export**

Create a strict Steel Mongo schema with:

- `sourcePdfKey: string` as the main lookup key
- original file metadata fields: `sourceStorageKey`, `sourceFileId`, `sourceFilename`, `sourceBytes`
- chunk metadata fields: `pipelineVersion`, `chunkIndex`, `chunkCount`, `pageStart`, `pageEnd`, `chunkSizePages`
- artifact fields: `artifact.source`, `artifact.storageKey`, `artifact.storageRegion`, `artifact.filepath`, `artifact.filename`, `artifact.bytes`, `artifact.contentType`
- timestamps

Export `steelOcrPdfChunkArtifactSchema` from `packages/data-schemas/src/schema/steel/index.ts`, export `createSteelOcrPdfChunkArtifactModel()` from `packages/data-schemas/src/models/steel/index.ts`, and re-export from `packages/data-schemas/src/index.ts`.

**Step 4: Run test to verify pass**

Run the same focused Jest command. Expected: pass.

### Task 2: Add OCR Preprocessing State Contracts

**Files:**
- Modify: `packages/api/src/steel/memory/service.ts`
- Test: `packages/api/src/steel/memory/service.spec.ts`

**Step 1: Write failing state-reader tests**

Add tests that create active memory rows for one file key:

- raw chunks 1-5 exist
- organized chunk Markdown exists for chunks 1-2 with the current OCR rule version
- no final merged row exists

Expected state:

```ts
expect(state).toEqual(
  expect.objectContaining({
    ocrFileKey: 'file:file-100',
    sourcePdfKey: 's3://bucket/r/prod/t/tenant/uploads/original.pdf',
    chunkSizePages: 50,
    chunkCount: 5,
    hasFinalMergedMarkdown: false,
    chunks: [
      expect.objectContaining({ chunkIndex: 1, rawSaved: true, organizedSaved: true }),
      expect.objectContaining({ chunkIndex: 2, rawSaved: true, organizedSaved: true }),
      expect.objectContaining({ chunkIndex: 3, rawSaved: true, organizedSaved: false }),
      expect.objectContaining({ chunkIndex: 4, rawSaved: true, organizedSaved: false }),
      expect.objectContaining({ chunkIndex: 5, rawSaved: true, organizedSaved: false }),
    ],
  }),
);
```

**Step 2: Run test to verify failure**

Run:

```bash
cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing"
```

Expected: fail because the state reader does not exist.

**Step 3: Implement state types and reader**

Add exported types/functions in `packages/api/src/steel/memory/service.ts`:

```ts
export const defaultOcrPreprocessingChunkSizePages = 50;
export const ocrPreprocessingPipelineVersion = 1;
export const ocrPreprocessingOrganizerVersion = 1;

export interface OcrPreprocessingStateInput {
  conversationId: string;
  sourcePdfKey: string;
  ocrFileKey: string;
}

export interface OcrPreprocessingChunkState {
  chunkIndex: number;
  chunkCount: number;
  pageStart: number;
  pageEnd: number;
  rawSaved: boolean;
  organizedSaved: boolean;
  rawResultHash?: string;
  ocrRuleVersion?: string;
  organizedMarkdown?: string;
}
```

Implement `readOcrPreprocessingState()` on the Mongoose writer or a dedicated reader. It must query DB rows by:

- `conversationId`
- `state: "active"`
- `memoryKind: { $in: ["paddleocr_preflight", "ocr_extract"] }`
- `payload.ocrFileKey`
- `payload.ocrPreprocessing.sourcePdfKey`
- `payload.ocrPreprocessing.pipelineVersion`
- current `payload.ocrPreprocessing.ocrRuleVersion` for organized chunk Markdown and final merged Markdown

**Step 4: Run test to verify pass**

Run the same focused Jest command. Expected: pass.

### Task 3: Make PaddleOCR Chunk Persistence Idempotent

**Files:**
- Modify: `packages/api/src/steel/memory/service.ts`
- Test: `packages/api/src/steel/memory/service.spec.ts`

**Step 1: Write failing chunk-persistence tests**

Add tests for:

- `capturePaddleOcrChunkResult()` saves chunk 1 without deleting chunk 2.
- Re-saving the same chunk identity replaces only that chunk row.
- Existing whole-file `paddleocr_preflight` rows from older pipeline versions do not count as completed chunk rows.

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "PaddleOCR chunk"
```

Expected: fail because `capturePaddleOcrResult()` currently deletes by whole `payload.ocrFileKey`.

**Step 3: Implement chunk capture**

Add a new method instead of changing whole-file capture behavior blindly:

```ts
async capturePaddleOcrChunkResult(input: CapturePaddleOcrChunkResultInput)
```

Replacement filter must include:

- `conversationId`
- `memoryKind: "paddleocr_preflight"`
- `payload.ocrFileKey`
- `payload.ocrPreprocessing.sourcePdfKey`
- `payload.ocrPreprocessing.pipelineVersion`
- `payload.ocrPreprocessing.chunkIndex`
- `payload.ocrPreprocessing.pageStart`
- `payload.ocrPreprocessing.pageEnd`

Do not delete all rows for the file key.

**Step 4: Run test to verify pass**

Run the focused Jest command. Expected: pass.

### Task 4: Add Organized Chunk Markdown Capture

**Files:**
- Modify: `packages/api/src/steel/memory/service.ts`
- Test: `packages/api/src/steel/memory/service.spec.ts`

**Step 1: Write failing tests**

Test that `captureOcrPreprocessingChunkMarkdown()`:

- saves one `ocr_extract` row immediately
- replaces only the matching chunk identity on retry
- records `payload.content`
- records `payload.ocrPreprocessing.rawResultHash`
- records `payload.ocrPreprocessing.ocrRuleVersion`
- increments `savedCounts.ocr_extract`

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "organized chunk markdown"
```

Expected: fail because the capture method does not exist.

**Step 3: Implement capture helper**

Add:

```ts
async captureOcrPreprocessingChunkMarkdown(input: CaptureOcrPreprocessingChunkMarkdownInput)
```

Use `memoryKind: "ocr_extract"` and `sourceKind: "ocr_result"`.

**Step 4: Run test to verify pass**

Run the focused Jest command. Expected: pass.

### Task 5: Add Final Merged Markdown Capture

**Files:**
- Modify: `packages/api/src/steel/memory/service.ts`
- Test: `packages/api/src/steel/memory/service.spec.ts`

**Step 1: Write failing tests**

Test that `captureOcrPreprocessingMergedMarkdown()`:

- saves a single final `ocr_extract` row
- replaces previous final merged row for the same file key/pipeline version/current OCR rule version
- does not delete chunk Markdown rows
- returns final Markdown when state is read again

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/memory/service.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "merged OCR markdown"
```

Expected: fail.

**Step 3: Implement final capture helper**

Use replacement filter:

- `conversationId`
- `memoryKind: "ocr_extract"`
- `payload.ocrFileKey`
- `payload.kind: "ocr_preprocessing_merged_markdown"`
- `payload.ocrPreprocessing.sourcePdfKey`
- `payload.ocrPreprocessing.pipelineVersion`
- `payload.ocrPreprocessing.ocrRuleVersion`

**Step 4: Run test to verify pass**

Run the focused Jest command. Expected: pass.

### Task 6: Add PDF Page-Range Chunking Helpers

**Files:**
- Modify: `packages/api/package.json`
- Modify: `package-lock.json`
- Create: `packages/api/src/steel/ocr/chunks.ts`
- Test: `packages/api/src/steel/ocr/chunks.spec.ts`
- Reference: `packages/api/src/files/documents/crud.ts`

Use a PDF-preserving page-range split:

- `pdfjs-dist/legacy/build/pdf.mjs` for page count.
- `pdf-lib` for copying source PDF pages into new 50-page PDF chunk bytes.

Do not render PDF pages to PNG/JPEG for preprocessing OCR chunks. Rasterizing can lose embedded PDF text and degrade vector text quality before PaddleOCR sees it. The pipeline's "50 pages per chunk" means creating real PDF page-range files such as pages `1-50`, `51-100`, and sending those PDF chunks to `paddleocr_vl`.

**Step 1: Write failing chunk calculation tests**

Expected behavior:

```ts
expect(buildPdfPageChunks({ pageCount: 1 })).toEqual([
  { chunkIndex: 1, chunkCount: 1, pageStart: 1, pageEnd: 1, chunkSizePages: 50 },
]);

expect(buildPdfPageChunks({ pageCount: 250 })).toHaveLength(5);
expect(buildPdfPageChunks({ pageCount: 251 })).toHaveLength(6);
```

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/ocr/chunks.spec.ts --runInBand --watch=false --coverage=false
```

Expected: fail because the file does not exist.

**Step 3: Verify `pdf-lib` dependency**

`pdf-lib` is already installed in this planning change. Verify it remains present:

```bash
rtk node -e "require.resolve('pdf-lib'); console.log('pdf-lib available')"
```

Expected: prints `pdf-lib available`. `packages/api/package.json` and `package-lock.json` include `pdf-lib`.

**Step 4: Implement chunk calculation**

Export:

```ts
export function buildPdfPageChunks(input: {
  pageCount: number;
  chunkSizePages?: number;
}): OcrPreprocessingPageChunk[];
```

Default `chunkSizePages` to `50`.

**Step 5: Add PDF page-count and page-range split helper**

Implement helpers:

```ts
export async function getPdfPageCount(input: { pdfBytes: Uint8Array }): Promise<number>;

export async function createPdfPageRangeChunk(input: {
  pdfBytes: Uint8Array;
  pageStart: number;
  pageEnd: number;
}): Promise<Uint8Array>;
```

Use `pdfjs-dist` for `numPages`. Use `pdf-lib` `PDFDocument.load()`, `PDFDocument.create()`, and `copyPages()` to create a new PDF containing the requested inclusive page range. Preserve original page content by copying PDF page objects instead of rendering.

**Step 6: Add global S3 chunk artifact helper**

Implement a helper that operates before PaddleOCR:

```ts
export interface OcrPdfChunkArtifact {
  sourcePdfKey: string;
  sourceStorageKey?: string;
  ocrFileKey: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  source: 's3' | 'cloudfront';
  storageKey: string;
  storageRegion?: string;
  filepath: string;
  filename: string;
  bytes: number;
  contentType: 'application/pdf';
}
```

Behavior:

- build a deterministic storage key/file name from `sourcePdfKey`, `pipelineVersion`, `chunkIndex`, `pageStart`, and `pageEnd`
- read `steel_ocr_pdf_chunk_artifacts` rows first by `sourcePdfKey`
- if DB has a row, refresh/regenerate the URL from `storageKey` and skip splitting/uploading
- if DB is missing, check whether the deterministic S3 object exists
- if S3 has the object, create/repair the DB artifact row and skip splitting/uploading
- if S3 is missing, create the page-range PDF bytes and upload them through the existing storage strategy `saveBuffer`
- save the global artifact DB row immediately after upload

The chunk artifact is the source of the PaddleOCR input URL on all future runs.

Add a regression where conversation A creates artifacts for `sourcePdfKey = X`, then conversation B preprocesses a current file resolving to the same `sourcePdfKey = X`. Conversation B must reuse the existing artifact rows and must not call `createPdfPageRangeChunk()` or `saveBuffer()`.

**Step 7: Add PaddleOCR chunk input contract**

The PaddleOCR runner must use the chunk artifact URL from DB/S3. Do not pass local temp files or raw PDF bytes to PaddleOCR MCP. Send:

```ts
{
  input_data: chunkArtifact.filepath,
  output_mode: 'detailed',
  file_type: 'pdf',
  return_images: false,
  runtime_params: {
    use_doc_orientation_classify: true,
    use_doc_unwarping: true,
    use_layout_detection: true,
  },
}
```

**Step 8: Run test to verify pass**

Run the focused Jest command. Expected: pass.

### Task 7: Add OCR Organizer Subagent Interface

**Files:**
- Create: `packages/api/src/steel/ocr/organizer.ts`
- Test: `packages/api/src/steel/ocr/organizer.spec.ts`

**Step 1: Write failing prompt-construction tests**

The organizer must receive only:

- OCR rules
- file/chunk metadata
- one chunk raw OCR result

It must not receive:

- full Steel runtime context
- workbook state
- price lookup data
- raw OCR chunks from other pages

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/ocr/organizer.spec.ts --runInBand --watch=false --coverage=false
```

Expected: fail.

**Step 3: Implement organizer interface**

Add:

```ts
export interface OcrOrganizerInput {
  ocrRulesText: string;
  file: {
    ocrFileKey: string;
    fileId?: string;
    filename?: string;
  };
  chunk: OcrPreprocessingChunkIdentity;
  rawOcrText: string;
}

export interface OcrOrganizer {
  organize(input: OcrOrganizerInput): Promise<{ markdown: string }>;
}
```

The production LLM runner can be wired in the API layer, but the orchestration must depend on this interface so tests use a fake organizer.

**Step 4: Run test to verify pass**

Run the focused Jest command. Expected: pass.

### Task 8: Add OCR Preprocessing Orchestrator

**Files:**
- Create: `packages/api/src/steel/ocr/preprocess.ts`
- Test: `packages/api/src/steel/ocr/preprocess.spec.ts`
- Modify: `packages/api/src/steel/ocr/index.ts` if an index file is useful

**Step 1: Write failing resume tests**

Use fakes for:

- state reader/writer
- PaddleOCR chunk runner
- organizer
- event sink

Test cases:

1. No DB state: runs PaddleOCR and organizer for all chunks.
2. Raw chunks exist but organized chunks missing: skips PaddleOCR, runs organizer.
3. Chunks 1-2 organized and chunks 3-5 raw-only: resumes at organizer 3/5.
4. Final merged Markdown exists: skips PaddleOCR and organizer, returns final Markdown.
5. Multiple organized chunks for one `ocrFileKey`: returns one merged Markdown string, ordered by `chunkIndex`, with no chunk array exposed to the main-agent context.
6. OCR rule version changed: skips PaddleOCR for saved raw chunks, reruns organizer for every chunk, replaces final merged Markdown, and returns only current-rule Markdown.
7. Chunk Markdown headers differ: final same-file-key Markdown uses union headers and leaves missing cells blank.
8. Another conversation with the same `sourcePdfKey` reuses global PDF chunk artifacts and does not split/upload PDF chunks again.

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false
```

Expected: fail because orchestrator does not exist.

**Step 3: Implement minimal orchestrator**

Core shape:

```ts
export async function runOcrPreprocessingPipeline(input: RunOcrPreprocessingPipelineInput) {
  const sourcePdfKey = resolveSourcePdfKey(input.file);
  const expectedChunks = await input.chunks.resolveExpectedChunks({ sourcePdfKey, file: input.file });
  const artifacts = await input.artifacts.ensurePdfChunkArtifacts({ sourcePdfKey, chunks: expectedChunks });
  const state = await input.memory.readOcrPreprocessingState(...);

  if (state.finalMergedMarkdown) {
    input.events.emitOcrMarkdownReady(...);
    return { status: 'ready', markdown: state.finalMergedMarkdown };
  }

  for (const chunk of expectedChunks) {
    const raw = await ensureRawChunk(...);
    const organized = await ensureOrganizedChunk(...);
    chunkMarkdowns.push(organized.markdown);
  }

  const merged = mergeChunkMarkdownForFileKey({
    ocrFileKey,
    ocrRuleVersion,
    chunks: chunkMarkdowns,
  });
  await input.memory.captureOcrPreprocessingMergedMarkdown(...);
  return { status: 'completed', markdown: merged };
}
```

Use DB state checks before every side effect.

Add a merge helper test case like:

```ts
const merged = mergeChunkMarkdownForFileKey({
  ocrFileKey: 'file:file-100',
  ocrRuleVersion: 'rules-v2',
  chunks: [
    {
      chunkIndex: 1,
      markdown: [
        '| 品名 | 數量 |',
        '|---|---:|',
        '| 鐵板 | 2 |',
      ].join('\n'),
    },
    {
      chunkIndex: 2,
      markdown: [
        '| 品名 | 材質 | 備註 |',
        '|---|---|---|',
        '| 白鐵管 | 304 | 急件 |',
      ].join('\n'),
    },
  ],
});

expect(merged).toContain('| 品名 | 數量 | 材質 | 備註 |');
expect(merged).toContain('| 鐵板 | 2 |  |  |');
expect(merged).toContain('| 白鐵管 |  | 304 | 急件 |');
```

**Step 4: Run test to verify pass**

Run focused Jest command. Expected: pass.

### Task 9: Add Steel Native OCR Preprocessing Events

**Files:**
- Modify: `packages/api/src/steel/native/events.ts`
- Test: `packages/api/src/steel/native/events.spec.ts`

**Step 1: Write failing event tests**

Assert event messages for:

- `paddleocr_preflight data saved as 5 chunks`
- `subagent process ocr 3/5 ocr preflight data`
- `ocr markdown saved`

**Step 2: Run test to verify failure**

```bash
cd packages/api && rtk npx jest src/steel/native/events.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing"
```

Expected: fail.

**Step 3: Implement event builders**

Add source if needed:

```ts
| 'ocr_preprocessing'
```

Keep event shape compatible with existing `parse_status` / `memory_saved` consumers.

**Step 4: Run test to verify pass**

Run focused Jest command. Expected: pass.

### Task 10: Replace Raw Preflight Injection in AgentClient

**Files:**
- Modify: `api/server/services/ToolService.js`
- Modify: `api/server/controllers/agents/client.js`
- Modify: `api/server/controllers/agents/__tests__/client.test.js`
- Modify: `api/server/services/__tests__/ToolService.spec.js`

**Step 1: Write failing API-layer tests**

In `ToolService.spec.js`, test:

- preflight result includes organized OCR Markdown, not raw `result`
- final merged Markdown in DB causes no PaddleOCR tool call
- incomplete DB state resumes missing chunks only
- same original PDF `sourcePdfKey` in another conversation reuses existing chunk artifacts and does not split/upload chunks again

In `client.test.js`, test:

- `buildDefaultSteelGlobalAgentContext()` receives organized OCR Markdown
- `currentPaddleOcrResults` raw payload is absent

**Step 2: Run tests to verify failure**

```bash
cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR"
cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|Steel context"
```

Expected: fail.

**Step 3: Implement API integration**

Keep `/api` changes thin:

- `ToolService.js` calls the TypeScript preprocessing orchestrator through `@librechat/api`.
- The preflight return shape carries `currentOcrMarkdownResults`, not raw `currentPaddleOcrResults`.
- `client.js` passes `currentOcrMarkdownResults` into Steel native context.

**Step 4: Run tests to verify pass**

Run both focused Jest commands. Expected: pass.

### Task 11: Wire Open Responses Path

**Files:**
- Modify: `api/server/controllers/agents/responses.js`
- Modify: `api/server/controllers/agents/__tests__/responses.unit.spec.js`
- Modify: `packages/api/src/steel/native/context.ts`
- Modify: `packages/api/src/steel/native/context.spec.ts`
- Modify: `packages/api/src/steel/runtime/context.ts`
- Modify: `packages/api/src/steel/runtime/context.spec.ts`

**Step 1: Write failing tests**

Assert Open Responses:

- waits for OCR preprocessing before `buildDefaultSteelGlobalAgentContext()`
- passes one merged organized OCR Markdown string per file key
- does not serialize raw `paddleocr_preflight` raw result into runtime context
- does not serialize per-chunk Markdown arrays into runtime context

**Step 2: Run tests to verify failure**

```bash
cd api && rtk npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR"
cd packages/api && rtk npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR"
```

Expected: fail.

**Step 3: Implement context field**

Add a clear field such as:

```ts
attachments.currentOcrMarkdownResults
```

Each item should contain:

- `ocrFileKey`
- `fileId`
- `filename`
- `ocrSource: "ocr_preprocessing_merge"`
- `content`
- chunk metadata summary

There must be one item per `ocrFileKey`. Its `content` is the merged Markdown for all completed chunks of that file key.

**Step 4: Run tests to verify pass**

Run focused commands. Expected: pass.

### Task 12: Add Production Organizer Runner

**Files:**
- Create or modify thin API-layer runner under `api/server/services/`
- Modify: `api/server/services/__tests__/ToolService.spec.js`
- Keep reusable prompt/context code in `packages/api/src/steel/ocr/organizer.ts`

**Step 1: Write failing integration-seam test**

Test that the runner builds an internal organizer request with:

- OCR organizer instructions
- OCR rules only
- chunk raw text only
- no full Steel runtime context

**Step 2: Run test to verify failure**

```bash
cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "organizer"
```

Expected: fail.

**Step 3: Implement runner**

Use the same provider/model credentials already available for the main request, but create a separate minimal call. Do not use the graph-managed `subagent` tool, because that tool runs after the main agent prompt is built; this preprocessing runner must finish before the main Steel agent starts.

**Step 4: Run test to verify pass**

Run focused command. Expected: pass.

### Task 13: Add End-to-End Resume Regression

**Files:**
- Test: `api/server/services/__tests__/ToolService.spec.js`
- Test: `packages/api/src/steel/ocr/preprocess.spec.ts`

**Step 1: Write resume scenario**

Simulate:

- 5 expected chunks
- raw chunks 1-5 already saved
- organized chunks 1-2 already saved
- request abort happened before chunks 3-5

Expected:

- no PaddleOCR calls
- organizer calls chunks 3, 4, 5 only
- final merged Markdown saved
- next request skips all preprocessing
- a different conversation with the same original PDF `sourcePdfKey` skips PDF chunk split/upload and starts from existing artifact URLs

**Step 2: Run test to verify behavior**

```bash
cd packages/api && rtk npx jest src/steel/ocr/preprocess.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "resume"
cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "resume"
```

Expected: pass.

### Task 14: Run Focused Verification

**Files:** none

**Step 1: Run package tests**

```bash
cd packages/api && rtk npx jest src/steel/memory/service.spec.ts src/steel/ocr/chunks.spec.ts src/steel/ocr/organizer.spec.ts src/steel/ocr/preprocess.spec.ts src/steel/native/events.spec.ts src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --runInBand --watch=false --coverage=false
```

Expected: pass.

**Step 2: Run API tests**

```bash
cd api && rtk npx jest server/services/__tests__/ToolService.spec.js server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --watch=false --coverage=false --testNamePattern "OCR preprocessing|PaddleOCR|Steel context|resume"
```

Expected: pass.

**Step 3: Run data-schema tests**

```bash
cd packages/data-schemas && rtk npx jest src/schema/steel.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "OCR PDF chunk artifact|Steel Mongo schemas"
```

Expected: pass.

**Step 4: Run hygiene check**

```bash
rtk git diff --check
```

Expected: no output.

### Task 15: Run Large-PDF Pressure Test

**Files:**
- Modify only if needed: `packages/api/src/steel/vision/paddleocr.d-pdf-ocr.manual.spec.ts`
- Optional create: `packages/api/src/steel/vision/paddleocr.large-pdf-preprocess.manual.spec.ts`

**Step 1: Add manual pressure test**

Use environment-gated manual test:

```bash
STEEL_PADDLEOCR_MCP_LARGE_PDF_PREPROCESS_TEST=true
```

The test should verify:

- 300-page synthetic or fixture PDF becomes 6 chunks by default
- raw chunks save once
- organizer chunks save once
- resubmit skips all completed work
- second conversation using the same original S3 file key skips PDF split/upload
- main Steel context receives final merged OCR Markdown

**Step 2: Run pressure test only when credentials are available**

```bash
cd packages/api && rtk npx jest src/steel/vision/paddleocr.large-pdf-preprocess.manual.spec.ts --runInBand --watch=false --coverage=false
```

Expected: pass when `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN` is configured; skip otherwise.

## Implementation Notes

- Avoid broad context injection while testing. The first slice intentionally inlines the final merged OCR Markdown, but raw chunks must never enter main-agent context.
- Keep retry behavior idempotent. Before every call to PaddleOCR or organizer, re-check DB state for that exact chunk identity.
- Keep `/api` edits thin. Most domain logic belongs in `packages/api/src/steel/ocr` and `packages/api/src/steel/memory/service.ts`.
- Do not run Prettier unless explicitly requested.
- Do not commit unless the user explicitly asks for a commit.
