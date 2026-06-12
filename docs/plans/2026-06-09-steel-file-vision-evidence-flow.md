# Steel File Vision Evidence Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and test the Steel quote-conversation evidence flow for PDF, image, scanned drawing, and spreadsheet attachments. Each conversation/order has one user-verifiable `file_analysis_data` workspace that can contain rows from multiple source files; each row records its file/page/region source so the user can compare extracted tables against the PDF/image, correct them across chat turns, and then explicitly create or update the single quote workbook.

**Architecture:** Keep file/image/PDF/spreadsheet attachments as quote evidence, not formal Admin import data. Before any drawing OCR task, seed `docs/rules/OCR規則.txt` into reviewed `steel.agent_rules` as an `inference_order_rule` scoped to drawing/file OCR. When a turn includes image/PDF/scanned drawing evidence, the backend conditionally loads the active OCR agent rule from `steel.agent_rules` and appends it after `fileAnalysis.instructions` before provider generation; provider adapters must not hard-code OCR rules. The backend stores original attachments through the existing LibreChat file storage strategy, classifies and bounds the file refs, and keeps original files available for visual/semantic cross-checks. Table OCR accuracy is validated through PaddleOCR MCP (`PaddleOCR-VL-1.6` / `paddleocr_vl`) rather than OpenAI OAuth built-in OCR. AI patches the single conversation-scoped `file_analysis_data` workspace through flexible columns and row-level source refs. When the user confirms the extracted table or asks to create the quote table, backend projects the reviewed `file_analysis_data` rows into the single quote workbook and writes low-confidence drawing facts to workbook `manual_review` and `interpretation_notes`. `docs/reference/example/c.pdf` is the current OCR correctness fixture with expected JSON and diffable field-accuracy reporting; the fixture schema is not the runtime `file_analysis_data` schema.

**Tech Stack:** TypeScript, Jest, Zod, existing `openai-oauth-provider` Steel adapter, existing LibreChat file storage services, Mongo workbook repository, existing Steel `patch_quote_workbook` semantic projection. Do not add local OCR/raster/spreadsheet parsing dependencies in this slice unless a later correction strategy explicitly selects that fallback.

---

## Scope

Build Phase 6C only:

- Accept quote-conversation attachments for image, PDF, scanned drawing, and spreadsheet evidence.
- Store original quote evidence files through the existing LibreChat file
  storage strategy and Mongo `File` record before AI analysis.
- Seed reviewed OCR rules from `docs/rules/OCR規則.txt` into `steel.agent_rules` before live drawing OCR tests.
- Require drawing OCR flows to load reviewed OCR agent rules from `steel.agent_rules` before extracting rows.
- Use PaddleOCR MCP as the primary table OCR engine for PDF/image table
  extraction; OpenAI OAuth file analysis may assist with visual/semantic
  cross-checks but must not be the primary OCR source.
- Persist one `file_analysis_data` workspace per conversation/order. It can
  contain rows from many PDF/image files; each row carries source file/page/
  region metadata so users can compare AI-read tables with the original
  PDF/image and correct them later.
- Keep original PDF/image file refs available for later re-reading. AI must not
  rely only on a previous extraction result when the user asks to re-interpret
  an image or PDF.
- Extract drawing/table facts such as plate name, part number, dimensions, quantity, bolt size, and bolt totals.
- Capture holes, slots, bends, cut marks, dimensions, OCR uncertainty, and table/drawing mismatches as evidence.
- After user confirmation or explicit request to create quote rows, project
  `file_analysis_data` into quote workbook rows and write uncertain facts into
  `manual_review` and `interpretation_notes`.
- Add an OCR correctness test fixture for `docs/reference/example/c.pdf`.

Non-goals:

- No Admin ERP XLSX import.
- No Admin source versions, merge rows, or formal database writes from PDF/image/spreadsheet quote attachments.
- No backend pricing calculator.
- No customer export work.
- No provider-state, OAuth-only retention, or official OpenAI Files API
  dependency for re-reading files in this phase.
- No local OCR, PDF rasterization, or spreadsheet parser as the default
  interpretation path. If the fixture fails, keep the mismatch report and
  discuss the correction strategy before adding preprocessing or fallback logic.

## Existing Code To Reuse

- Attachment request DTO: `packages/data-provider/src/steel/ai.ts`
- Steel chat route and `fileAnalysis.instructions` injection: `packages/api/src/steel/handlers.ts`
- Provider file serialization: `packages/api/src/steel/ai/provider.ts`
- Provider fixture helpers: `packages/api/src/steel/ai/fixtures.ts`
- Existing LibreChat file storage: `api/server/services/Files/process.js`,
  `api/server/services/Files/Local/crud.js`, `api/server/services/Files/strategies.js`,
  and Mongo `File` records from `packages/data-schemas/src/schema/file.ts`
- Reviewed OCR rule source: `docs/rules/OCR規則.txt`
- Agent rule storage and retrieval: `steel.agent_rules`,
  `packages/api/src/steel/repositories/rules.ts`, and existing runtime rule
  loading in `packages/api/src/steel/ai/provider.ts`
- Semantic workbook projection: `packages/api/src/steel/workbook/semantic.ts`
- Workbook patch persistence and validation: `packages/api/src/steel/workbook/service.ts`
- Phase 6C decision source: `tasks/v8.3/phase-6-production-hardening.md`

## OCR Rules DB Flow

The OCR rules are conditional Agent Rules, not quote rule packets, and not
provider constants. `lookup_quote_rules` remains for material, processing,
price, formula, and quote-default rules. Drawing OCR process policy belongs in
`steel.agent_rules` with the same classification model as the default agent
prompt, tool-flow, inference-order, output-policy, and workbook-output rules.

Seed `docs/rules/OCR規則.txt` into `steel.agent_rules` before live OCR
validation:

```json
{
  "slug": "steel-drawing-ocr-policy",
  "version": 1,
  "ruleType": "inference_order_rule",
  "title": "圖面表格局部判讀流程",
  "locale": "zh-TW",
  "ruleSections": ["file_ocr", "drawing_ocr", "vision_evidence"],
  "sheetId": null,
  "selectors": {
    "sourceKinds": ["image", "pdf", "scanned_pdf"],
    "requiresDrawingOcr": true,
    "tableTypes": ["material_table", "part_table", "bolt_table", "cutting_table"]
  },
  "prompt": "<contents of docs/rules/OCR規則.txt>",
  "toolPolicy": {
    "requiredBefore": ["drawing_evidence_extraction"],
    "mustMarkLowConfidence": true
  },
  "outputPolicy": {
    "targetSheets": ["manual_review", "interpretation_notes"],
    "forbidFormalAdminImport": true,
    "forbidConfirmedTotalsFromOcrOnly": true
  },
  "priority": 35,
  "confidence": "high",
  "active": true,
  "reviewState": "reviewed",
  "sourceRefs": [
    {
      "channel": "repo_docs",
      "factType": "agent_rule",
      "sourceFile": "docs/rules/OCR規則.txt",
      "locator": "圖面表格局部判讀流程",
      "canonicalKey": "drawing_ocr_local_table_reading",
      "sha256": "<local file sha256>"
    }
  ]
}
```

When `classifyEvidenceAttachments()` finds image/PDF/scanned drawing evidence,
the backend must query `steel.agent_rules` before provider generation:

- `review_state = 'reviewed'`
- `active = true`
- `rule_sections && ARRAY['drawing_ocr', 'file_ocr', 'vision_evidence']`
- `rule_type IN ('inference_order_rule', 'tool_flow_rule', 'output_policy_rule')`
- selector match for the attachment `sourceKinds`

Append the reviewed OCR rule prompt after `fileAnalysis.instructions` and before
the user message/provider generation. The provider prompt can reference the rule
source and sha256, but it must not duplicate the full OCR rules as hard-coded
provider-adapter constants.

If no active reviewed OCR agent rule is found for a visual OCR task, fail before
provider generation with a typed manual-review/provider error. Do not let
ungoverned OCR proceed and do not fall back to `lookup_quote_rules` for this
process policy.

## Expected OCR Fixture

Create `packages/api/src/steel/vision/fixtures/c.expected.json`:

```json
{
  "fixtureId": "steel_drawing_c_plate_schedule_v1",
  "sourceFile": "docs/reference/example/c.pdf",
  "rows": [
    {
      "name": "柱底板",
      "partNo": "BP1",
      "spec": "650×650×28t",
      "quantity": 14,
      "boltSize": "M30",
      "boltTotalExpression": "14×14=196",
      "boltTotal": 196
    },
    {
      "name": "柱底板",
      "partNo": "BP2",
      "spec": "500×500×20t",
      "quantity": 3,
      "boltSize": "M24",
      "boltTotalExpression": "3×12=36",
      "boltTotal": 36
    },
    {
      "name": "連接板",
      "partNo": "PL1",
      "spec": "367×323×12t",
      "quantity": 23,
      "boltSize": "M30",
      "boltTotalExpression": "23×6=138",
      "boltTotal": 138
    },
    {
      "name": "連接板",
      "partNo": "PL2",
      "spec": "230×175×12t",
      "quantity": 38,
      "boltSize": "M22",
      "boltTotalExpression": "38×6=228",
      "boltTotal": 228
    },
    {
      "name": "連接板",
      "partNo": "PL3",
      "spec": "362×358×10t",
      "quantity": 3,
      "boltSize": "M22",
      "boltTotalExpression": "3×6=18",
      "boltTotal": 18
    },
    {
      "name": "連接板",
      "partNo": "PL4",
      "spec": "230×175×10t",
      "quantity": 26,
      "boltSize": "M22",
      "boltTotalExpression": "26×6=156",
      "boltTotal": 156
    },
    {
      "name": "連接板",
      "partNo": "PL5",
      "spec": "362×354×10t",
      "quantity": 1,
      "boltSize": "M22",
      "boltTotalExpression": "1×6=6",
      "boltTotal": 6
    },
    {
      "name": "連接板",
      "partNo": "PL6",
      "spec": "362×324×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "連接板",
      "partNo": "PL7",
      "spec": "362×368×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "連接板",
      "partNo": "PL8",
      "spec": "382×419×16t",
      "quantity": 12,
      "boltSize": "M24",
      "boltTotalExpression": "12×8=96",
      "boltTotal": 96
    },
    {
      "name": "連接板",
      "partNo": "PL9",
      "spec": "363×358×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "連接板",
      "partNo": "PL10",
      "spec": "363×358×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "連接板",
      "partNo": "PL11",
      "spec": "382×401×16t",
      "quantity": 4,
      "boltSize": "M24",
      "boltTotalExpression": "4×8=32",
      "boltTotal": 32
    },
    {
      "name": "連接板",
      "partNo": "PL12",
      "spec": "362×354×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "連接板",
      "partNo": "PL13",
      "spec": "382×445×16t",
      "quantity": 1,
      "boltSize": "M24",
      "boltTotalExpression": "1×8=8",
      "boltTotal": 8
    },
    {
      "name": "連接板",
      "partNo": "PL14",
      "spec": "382×499×16t",
      "quantity": 1,
      "boltSize": "M24",
      "boltTotalExpression": "1×8=8",
      "boltTotal": 8
    },
    {
      "name": "連接板",
      "partNo": "PL15",
      "spec": "407×279×10t",
      "quantity": 4,
      "boltSize": "M22",
      "boltTotalExpression": "4×6=24",
      "boltTotal": 24
    },
    {
      "name": "連接板",
      "partNo": "PL16",
      "spec": "155×140×10t",
      "quantity": 6,
      "boltSize": "M20",
      "boltTotalExpression": "6×4=24",
      "boltTotal": 24
    },
    {
      "name": "連接板",
      "partNo": "PL17",
      "spec": "382×649×20t",
      "quantity": 1,
      "boltSize": "M24",
      "boltTotalExpression": "1×14=14",
      "boltTotal": 14
    },
    {
      "name": "連接板",
      "partNo": "PL18",
      "spec": "550×190×20t",
      "quantity": 1,
      "boltSize": "M24",
      "boltTotalExpression": "1×14=14",
      "boltTotal": 14
    },
    {
      "name": "連接板",
      "partNo": "PL19",
      "spec": "323×294×12t",
      "quantity": 10,
      "boltSize": "M22",
      "boltTotalExpression": "10×6=60",
      "boltTotal": 60
    },
    {
      "name": "連接板",
      "partNo": "PL20",
      "spec": "358×289×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "連接板",
      "partNo": "PL21",
      "spec": "358×289×10t",
      "quantity": 1,
      "boltSize": "M22",
      "boltTotalExpression": "1×6=6",
      "boltTotal": 6
    },
    {
      "name": "連接板",
      "partNo": "PL22",
      "spec": "358×289×10t",
      "quantity": 1,
      "boltSize": "M22",
      "boltTotalExpression": "1×6=6",
      "boltTotal": 6
    },
    {
      "name": "新增連接板",
      "partNo": "PL7A",
      "spec": "362×324×10t",
      "quantity": 2,
      "boltSize": "M22",
      "boltTotalExpression": "2×6=12",
      "boltTotal": 12
    },
    {
      "name": "新增連接板",
      "partNo": "PL14A",
      "spec": "382×445×16t",
      "quantity": 1,
      "boltSize": "M24",
      "boltTotalExpression": "1×8=8",
      "boltTotal": 8
    }
  ]
}
```

## Data Contracts

Create `packages/data-provider/src/steel/vision.ts`:

```ts
import { z } from 'zod';

export const steelFileAnalysisSourceRefSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1),
  page: z.number().int().positive().optional(),
  regionLabel: z.string().min(1).optional(),
  orientation: z.enum(['0', '90', '180', '270']).optional(),
});

export const steelDrawingEvidenceRowSchema = z.object({
  name: z.string().min(1),
  partNo: z.string().min(1),
  spec: z.string().min(1),
  quantity: z.number().int().positive(),
  boltSize: z.string().regex(/^M\d+$/),
  boltTotalExpression: z.string().min(1),
  boltTotal: z.number().int().nonnegative(),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  sourceRef: steelFileAnalysisSourceRefSchema.optional(),
  reviewStatus: z.enum(['pending_review', 'confirmed', 'corrected']).default('pending_review'),
  rowWarnings: z.array(z.string()).default([]),
});

export const steelDrawingEvidenceResultSchema = z.object({
  fixtureId: z.string().optional(),
  sourceFile: z.string().min(1).optional(),
  rows: z.array(steelDrawingEvidenceRowSchema),
  warnings: z.array(z.string()).default([]),
});

export const steelFileAnalysisDataSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  workbookId: z.string().min(1).optional(),
  sourceFiles: z.array(
    z.object({
      fileId: z.string().min(1),
      filename: z.string().min(1),
      mediaType: z.string().min(1),
      fileSource: z.enum(['local', 's3', 'cloudfront', 'azure_blob', 'firebase']).optional(),
      storageRegion: z.string().min(1).optional(),
      pageCount: z.number().int().positive().optional(),
    }),
  ),
  sheets: z.object({
    file_analysis_data: z.object({
      columns: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })),
      rows: z.array(
        z.object({
          id: z.string().min(1),
          sourceRef: steelFileAnalysisSourceRefSchema,
          cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          confidence: z.enum(['high', 'medium', 'low']).default('medium'),
          reviewStatus: z
            .enum(['pending_review', 'confirmed', 'corrected'])
            .default('pending_review'),
          rowWarnings: z.array(z.string()).default([]),
        }),
      ),
    }),
    manual_review: z.object({
      columns: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })),
      rows: z.array(
        z.object({
          id: z.string().min(1),
          sourceRef: steelFileAnalysisSourceRefSchema.optional(),
          cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          confidence: z.enum(['high', 'medium', 'low']).default('low'),
          reviewStatus: z
            .enum(['pending_review', 'confirmed', 'corrected'])
            .default('pending_review'),
        }),
      ),
    }),
    interpretation_notes: z.object({
      columns: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })),
      rows: z.array(
        z.object({
          id: z.string().min(1),
          sourceRef: steelFileAnalysisSourceRefSchema.optional(),
          cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          confidence: z.enum(['high', 'medium', 'low']).default('medium'),
        }),
      ),
    }),
  }),
  workbookProjectionStatus: z
    .enum(['not_requested', 'requested', 'projected', 'blocked'])
    .default('not_requested'),
});
```

`steelDrawingEvidenceResultSchema` remains a fixture/evaluation shape for
`docs/reference/example/c.pdf`; it is not the runtime schema for AI extraction.
Runtime analysis rows use flexible sheet columns and source refs.

Export it from `packages/data-provider/src/steel/index.ts`.

Add a separate AI-callable tool for the analysis workspace:

```ts
export const patchFileAnalysisDataToolInputSchema = z.object({
  fileAnalysisDataId: z.string().min(1).optional(),
  sourceFiles: steelFileAnalysisDataSchema.shape.sourceFiles.optional(),
  patches: z.array(
    z.object({
      sheetId: z.enum(['file_analysis_data', 'manual_review', 'interpretation_notes']),
      upsertColumns: z
        .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
        .default([]),
      upsertRows: z.array(
        z.object({
          id: z.string().min(1).optional(),
          sourceRef: steelFileAnalysisSourceRefSchema.optional(),
          cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          confidence: z.enum(['high', 'medium', 'low']).optional(),
          reviewStatus: z.enum(['pending_review', 'confirmed', 'corrected']).optional(),
          rowWarnings: z.array(z.string()).optional(),
        }),
      ),
    }),
  ),
});
```

## Task 0: Seed OCR Agent Rule And Conditional Loader

**Files:**

- Create: `packages/api/scripts/sync-steel-ocr-rules.cjs`
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Test: `packages/api/src/steel/ai/provider.spec.ts`
- Test: `packages/api/src/steel/handlers.spec.ts`

**Step 1: Write failing tests**

Assert:

- Drawing/image/PDF evidence loads reviewed active OCR rules from
  `steel.agent_rules`.
- Missing OCR agent rules fail before provider generation when visual evidence
  needs drawing OCR.
- The composed provider prompt includes the OCR rule prompt, source file, and
  sha256 provenance.
- Non-visual turns do not load OCR-specific rules.

**Step 2: Add the sync script**

Create a DB sync command that reads `docs/rules/OCR規則.txt`, computes its
sha256, and upserts the active reviewed `steel.agent_rules` row:

```bash
npm --workspace packages/api run steel:sync-ocr-rules -- --dry-run
npm --workspace packages/api run steel:sync-ocr-rules -- --apply
```

The script must use `.env` `STEEL_POSTGRES_URL`, target Supabase cloud Postgres,
and read back the row after apply. It must not change schema and must not write
to `steel.instruction_packets`.

**Step 3: Implement conditional loading**

Extend the existing `steel.agent_rules` runtime-rule path so visual evidence can
request OCR-specific sections:

- `file_ocr`
- `drawing_ocr`
- `vision_evidence`

Filter by selector after the SQL rule-section search when needed. Append the
OCR rule after `fileAnalysis.instructions` and before user/provider content.

**Step 4: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand
```

Expected: PASS.

## Task 1: Fixture Schema And Normalized Comparison

**Files:**

- Create: `packages/api/src/steel/vision/schema.ts`
- Create: `packages/api/src/steel/vision/compare.ts`
- Create: `packages/api/src/steel/vision/fixtures/c.expected.json`
- Test: `packages/api/src/steel/vision/compare.spec.ts`

**Step 1: Write the failing tests**

Test that:

- `c.expected.json` parses.
- There are exactly 26 rows.
- `partNo` values are unique.
- `boltTotalExpression` evaluates to `boltTotal`.
- Diff output reports field accuracy and row-level mismatches.

```ts
import expected from './fixtures/c.expected.json';
import { compareDrawingEvidenceRows } from './compare';
import { steelDrawingEvidenceResultSchema } from './schema';

it('validates the c.pdf expected drawing schedule fixture', () => {
  const parsed = steelDrawingEvidenceResultSchema.parse(expected);
  expect(parsed.rows).toHaveLength(26);
  expect(new Set(parsed.rows.map((row) => row.partNo)).size).toBe(26);
});

it('compares extracted rows against the expected c.pdf fixture', () => {
  const actual = steelDrawingEvidenceResultSchema.parse(expected);
  const result = compareDrawingEvidenceRows({ expected, actual });
  expect(result.fieldAccuracy).toBe(1);
  expect(result.mismatches).toEqual([]);
});
```

**Step 2: Run red test**

Run:

```bash
cd packages/api && npx jest src/steel/vision/compare.spec.ts --runInBand
```

Expected: FAIL because `vision/schema.ts` and fixture do not exist.

**Step 3: Implement minimal schema and comparison**

Implement exact normalization:

- Convert `x`, `X`, `＊`, `*` to `×` in specs and totals.
- Trim whitespace.
- Preserve Traditional Chinese names.
- Compare `name`, `partNo`, `spec`, `quantity`, `boltSize`, `boltTotalExpression`, and `boltTotal`.

**Step 4: Run green test**

Run:

```bash
cd packages/api && npx jest src/steel/vision/compare.spec.ts --runInBand
```

Expected: PASS.

## Task 2: Attachment Persistence, Classification, And Evidence Boundary

**Files:**

- Create: `packages/api/src/steel/vision/attachments.ts`
- Test: `packages/api/src/steel/vision/attachments.spec.ts`
- Modify: `api/server/routes/files/files.js` or add a thin Steel upload wrapper
  that reuses the existing LibreChat file services.
- Modify: `packages/api/src/steel/handlers.ts`

**Step 1: Write failing tests**

Cover:

- Uploaded PDF/image/XLSX quote evidence creates a Mongo `File` record and uses
  the configured LibreChat `fileStrategy` storage.
- `image/png`, `image/jpeg`, and `application/pdf` are visual evidence.
- XLSX attachments are spreadsheet evidence.
- Evidence attachments are never marked as Admin import sources.
- Unsupported files produce typed provider/manual-review errors, not formal source versions.
- Chat messages can reference persisted `file_id`s; inline `dataBase64` remains
  only a compatibility/test path, not the durable Phase 6C source of truth.

**Step 2: Implement classifier**

Return:

```ts
type SteelEvidenceAttachmentKind = 'image' | 'pdf' | 'spreadsheet' | 'unsupported';

interface SteelEvidenceAttachment {
  fileId: string;
  filename?: string;
  mediaType: string;
  kind: SteelEvidenceAttachmentKind;
  data?: Uint8Array;
  fileRef?: {
    source: 'local' | 's3' | 'cloudfront' | 'azure_blob' | 'firebase';
    filepath: string;
    storageKey?: string;
    storageRegion?: string;
  };
  pageCount?: number;
  sourceChannel: 'quote_conversation_evidence';
}
```

**Step 3: Resolve file refs into provider payloads**

For persisted files, the chat route receives file refs such as
`messages[].files[].fileId`, loads the Mongo `File` record with owner/conversation
checks, reads bytes through the configured storage strategy, and builds the
`openai_oauth_responses` file part. Do not expose storage paths or raw provider
payloads to the browser.

**Step 4: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/vision/attachments.spec.ts src/steel/handlers.spec.ts --runInBand
```

Expected: PASS.

## Task 3: Drawing Evidence Prompt Builder

**Files:**

- Create: `packages/api/src/steel/vision/prompt.ts`
- Test: `packages/api/src/steel/vision/prompt.spec.ts`
- Modify: `docs/steel-openai-oauth-responses-setup.md`

**Step 1: Write failing tests**

Assert prompt text includes:

- Preserve Traditional Chinese exactly.
- Treat images/PDF drawings as quote evidence.
- Include the reviewed OCR agent rule loaded from `steel.agent_rules`.
- Create `file_analysis_data` first, organized by file/page/region/table rows,
  for user comparison against the original PDF/image.
- Keep original file refs available for later re-reading when the user asks for
  another interpretation pass.
- Extract table rows before interpreting small drawing labels when a schedule table exists.
- Extract holes/bolt counts, slots, bends, cut marks, and dimensions.
- Mark low confidence instead of inventing values.
- Do not use previous `file_analysis_data` as the only evidence when the user
  asks to re-read a PDF/image.
- Do not create Admin source versions or formal data writes.

**Step 2: Implement prompt builder**

Build a compact instruction block that receives the reviewed OCR agent-rule body
from the database and can be appended after `fileAnalysis.instructions`. Do not
duplicate the full `OCR規則.txt` body in code or hard-code it inside provider
adapters.

**Step 3: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/vision/prompt.spec.ts --runInBand
```

Expected: PASS.

## Task 4: Provider Extraction Service

**Files:**

- Create: `packages/api/src/steel/vision/service.ts`
- Test: `packages/api/src/steel/vision/service.spec.ts`

**Purpose**

Provide a narrow service seam for asking the AI to interpret original
PDF/image/scanned drawing evidence with reviewed OCR rules. This task does not
define fixed extraction fields, does not require a fixed structured result, does
not persist `file_analysis_data`, and does not project anything into the quote
workbook. Those responsibilities stay in Task 5 and Task 6.

**Step 1: Write failing mocked-provider test**

Use an injected mocked provider. Assert:

- The service requires a reviewed OCR rule instruction before provider calls.
- The provider receives the DB-loaded OCR rules plus the current user request.
- The provider receives the original resolved file parts.
- When the user requests re-reading, the provider call still includes the
  original files and does not rely only on previous analysis context.
- Unsupported vision capability returns `provider_vision_input_unsupported`.
- No workbook data mutates during extraction.
- The service returns the provider text/raw interpretation as an analysis
  candidate for Task 5 to persist later.

**Step 2: Implement service**

Expose:

```ts
interface ExtractSteelDrawingEvidenceInput {
  model: string;
  files: SteelOAuthChatFile[];
  userInstruction: string;
  ocrAgentRuleInstruction: string;
  previousAnalysisText?: string;
  rereadOriginalFiles?: boolean;
}
```

The first implementation can call an injected provider wrapper around the same
provider path used by Steel chat. It only composes the prompt from Supabase OCR
rules and the user request, sends the original file parts, and returns the AI
interpretation candidate.

**Step 3: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/vision/service.spec.ts --runInBand
```

Expected: PASS.

## Task 5: File Analysis Data Review Dataset

**Files:**

- Create: `packages/api/src/steel/vision/analysis.ts`
- Test: `packages/api/src/steel/vision/analysis.spec.ts`
- Modify: `packages/data-provider/src/steel/vision.ts`
- Modify: `packages/api/src/steel/handlers.ts`
- Test: `packages/api/src/steel/handlers.spec.ts`

**Step 1: Write failing dataset tests**

Assert:

- One conversation/order has one `file_analysis_data` workspace.
- Multiple PDF/image files can contribute rows to the same workspace.
- Rows retain flexible cells plus source file id, filename, page, region label,
  orientation, confidence, warnings, and review status.
- Corrected rows supersede previous extracted row values without deleting the
  original source refs.
- The dataset remains separate from quote workbook sheets.
- `patch_file_analysis_data` can upsert flexible columns and rows into
  `file_analysis_data`, `manual_review`, and `interpretation_notes`.

Example result shape:

```ts
{
  id: 'fad_1',
  conversationId: 'conv_1',
  workbookId: 'workbook_1',
  sourceFiles: [
    { fileId: 'file_1', filename: 'c.png', mediaType: 'image/png' },
    { fileId: 'file_2', filename: 'detail.pdf', mediaType: 'application/pdf' },
  ],
  sheets: {
    file_analysis_data: {
      columns: [
        { key: 'partNo', label: '件號' },
        { key: 'spec', label: '規格' },
        { key: 'quantity', label: '數量' },
      ],
      rows: [
        {
          id: 'row_1',
          sourceRef: {
            fileId: 'file_1',
            filename: 'c.png',
            mediaType: 'image/png',
            page: 1,
            regionLabel: '螺栓統計表',
            orientation: '0',
          },
          cells: { partNo: 'BP1', spec: '650×650×28t', quantity: 14 },
          confidence: 'medium',
          reviewStatus: 'pending_review',
          rowWarnings: [],
        },
      ],
    },
    manual_review: { columns: [], rows: [] },
    interpretation_notes: { columns: [], rows: [] },
  },
  workbookProjectionStatus: 'not_requested',
}
```

**Step 2: Implement minimal persistence seam**

Use the existing Mongo/workbook-style repository pattern or a narrow Steel
repository so the route can return the dataset to the UI. The first slice can
store compact extracted JSON and file refs; raw provider payloads remain out of
the user-visible dataset. Upsert by conversation/order scope so repeated file
analysis calls patch the same `file_analysis_data` workspace instead of
creating one dataset per file.

**Step 3: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/vision/analysis.spec.ts src/steel/handlers.spec.ts --runInBand
```

Expected: PASS.

## Task 6: Confirmed File Analysis Projection To Quote Workbook

**Files:**

- Modify: `packages/api/src/steel/workbook/semantic.ts`
- Test: `packages/api/src/steel/workbook/semantic.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Test: `packages/api/src/steel/ai/provider.spec.ts`

**Step 1: Write failing projection tests**

When the user confirms `file_analysis_data` or asks to create quote rows from
the extracted table, allow semantic input such as:

```ts
{
  fileAnalysisDataId: 'fad_1',
  confirmedDrawingEvidence: [
    {
      name: '柱底板',
      partNo: 'BP1',
      spec: '650×650×28t',
      quantity: 14,
      boltSize: 'M30',
      boltTotalExpression: '14×14=196',
      boltTotal: 196,
      confidence: 'medium',
      sourceRef: { fileId: 'file_1', filename: 'c.png', mediaType: 'image/png', page: 1, regionLabel: '螺栓統計表' }
    }
  ]
}
```

Expected operations after user confirmation:

- Create/update quote workbook rows needed for the confirmed table.
- Add `manual_review` rows for low-confidence dimensions, holes, slots, bends,
  cut marks, formulas, and rows not cross-checked with drawings.
- Add `interpretation_notes` rows with concise source and correction notes.
- Do not write confirmed prices or totals unless pricing was separately
  calculated and confirmed.
- No formal source table mutation.

**Step 2: Implement projection**

Project confirmed evidence rows to quote workbook semantic rows, plus:

- `manual_review.issue_type`
- `manual_review.estimated_value`
- `manual_review.low_confidence_reason`
- `manual_review.inferred_evidence`
- `manual_review.confirmation_needed`
- `interpretation_notes.item`
- `interpretation_notes.content`
- `interpretation_notes.confidence`
- `interpretation_notes.evidence`

**Step 3: Update provider tool schema**

Allow `patch_quote_workbook` semantic input to reference confirmed
`file_analysis_data`. Provider prompt must say unconfirmed extraction stays in
`file_analysis_data`; workbook rows are created only after user confirmation or
explicit request.

**Step 4: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/workbook/semantic.spec.ts src/steel/ai/provider.spec.ts --runInBand
```

Expected: PASS.

## Task 7: Chat Route Integration

**Files:**

- Modify: `packages/api/src/steel/handlers.ts`
- Test: `packages/api/src/steel/handlers.spec.ts`

**Step 1: Write failing route tests**

Cases:

- Image/PDF attachments get `fileAnalysis.instructions` plus the reviewed OCR
  agent rule loaded from `steel.agent_rules`.
- Missing OCR agent rules for visual evidence return typed manual-review/provider
  errors before provider generation.
- Successful drawing evidence creates or updates `file_analysis_data`, not quote
  workbook rows by default.
- Confirmed `file_analysis_data`, or an explicit user request to create quote
  rows from it, can produce workbook patch rows.
- A re-read request resolves the original LibreChat/Steel file ref and sends the
  file bytes to `openai_oauth_responses` again.
- Unsupported file/vision/XLSX capability returns a typed manual-review error or explicit provider error; it does not pretend extraction succeeded.
- Quote evidence attachments never call Admin source/import services.

**Step 2: Implement integration**

Use a persisted-file request shape:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "請判讀附件圖面，孔洞與螺栓數進人工複核",
      "files": [
        {
          "fileId": "file_1",
          "filename": "c.png",
          "mediaType": "image/png"
        }
      ]
    }
  ],
  "workbookId": "wb_1",
  "workbookVersion": 3
}
```

The old browser-safe `dataBase64` DTO can stay for focused smoke tests, but the
Phase 6C product path should upload first and then reference `fileId` so later
turns can re-read the file.

**Step 3: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand
```

Expected: PASS.

## Task 8: Direct PDF/Image/Spreadsheet Provider Evidence Paths

**Files:**

- Create: `packages/api/src/steel/vision/files.ts`
- Test: `packages/api/src/steel/vision/pdf.spec.ts`
- Test: `packages/api/src/steel/vision/spreadsheet.spec.ts`

**Step 1: Write failing tests**

PDF:

- Provider-supported PDF passes through directly as file evidence.
- Scanned/image PDF is still sent directly to AI when provider capability is
  supported.
- Backend may read bounded metadata such as filename, media type, byte size, and
  page count, but it does not locally OCR or rasterize the PDF by default.
- Unsupported PDF capability produces typed manual-review/provider error.

Spreadsheet:

- XLSX quote attachment passes through directly when provider XLSX capability is supported.
- Spreadsheet evidence remains quote evidence, not Admin ERP import.
- Unsupported XLSX capability produces typed manual-review/provider error; do
  not silently parse it as an Admin import or local fallback table.

**Step 2: Implement bounded helpers**

Use existing provider capability gates and bounded metadata helpers. Do not add a
local OCR/rasterization/spreadsheet parser as the default interpretation path in
this phase. Table OCR is verified through PaddleOCR MCP, not OpenAI OAuth
built-in OCR.

**Step 3: Verify**

Run:

```bash
cd packages/api && npx jest src/steel/vision/pdf.spec.ts src/steel/vision/spreadsheet.spec.ts --runInBand
```

Expected: PASS.

## Task 9: PaddleOCR MCP c.pdf OCR Correctness Manual Smoke

**Files:**

- Create: `packages/api/src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts`
- Reuse: `docs/reference/example/c.pdf`
- Reuse: `packages/api/src/steel/vision/fixtures/c.expected.json`

**Step 1: Write manual live test**

The test:

- Loads `docs/reference/example/c.pdf` by absolute path.
- Starts project MCP server `PaddleOCR-VL-1.6` with `uvx --from paddleocr-mcp
paddleocr_mcp` and `.env` key `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN`.
- Calls MCP tool `paddleocr_vl` with `file_type = pdf`, `output_mode =
detailed`, and `return_images = false`.
- Verifies the OCR table data is equivalent to `c.expected.json`; MCP Markdown
  or JSON field names do not need to match internal fixture field names exactly.
- Reports missing rows with candidate OCR segments for that part number.
- Verifies no token material appears in the captured MCP response.

Critical fields:

- `partNo`
- `spec`
- `quantity`
- `boltSize`
- `boltTotal`

Acceptance:

- Every expected row has an OCR segment containing the same part number, Chinese
  name, spec, quantity, bolt size, and bolt total or formula after normalization.
- The live test is gated by `STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST=true` and skips
  by default in normal Jest runs.
- If any field fails, record the PaddleOCR output mismatch report and stop for a
  correction strategy discussion before changing thresholds.

**Step 2: Run manual smoke**

Run only after PaddleOCR AI Studio auth is available:

```bash
DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'
```

Expected: PASS. If it fails, keep the report and discuss the correction
strategy from PaddleOCR output evidence. Do not lower the `c.pdf` acceptance
threshold to hide OCR errors.

## Task 10: Frontend Upload UX Smoke

**Files:**

- Modify: `client/src/routes/SteelOAuthChat.tsx`
- Modify: `client/src/features/steel/chat`
- Test: `client/src/features/steel/**/*.spec.tsx`

**Step 1: Write failing UI test**

Assert:

- The user can attach an image/PDF/XLSX quote evidence file and send it with the message.
- After AI analysis, the UI can show `file_analysis_data` rows grouped by file
  and page.
- The user can compare extracted rows against the PDF/image, edit/correct rows,
  and ask AI to re-read the original file.
- Creating/updating the quote workbook is a separate user action/request.

**Step 2: Implement minimal UI**

Reuse existing LibreChat upload patterns if available. For `/steel/oauth-chat`, keep this small:

- File picker.
- Attachment chips with filename and remove button.
- Send disabled while file bytes are loading.
- Error if file is too large or unsupported.
- File/page analysis table view for `file_analysis_data`.
- Row review status and correction affordance.
- Explicit "create quote workbook rows from this analysis" action or chat intent.

**Step 3: Verify**

Run:

```bash
rtk npm run test:client -- --runTestsByPath client/src/features/steel
rtk npm run build:client-package
```

Expected: PASS.

## Task 11: Documentation And Phase Gate

**Files:**

- Modify: `tasks/v8.3/phase-6-production-hardening.md`
- Modify: `tasks/v8.3/checkpoints.md`
- Modify: `docs/steel-openai-oauth-responses-setup.md`
- Modify: `tasks/todo.md`

**Step 1: Update docs**

Document:

- Quote attachments are evidence only.
- `file_analysis_data` is a single conversation/order workspace separate from
  the quote workbook. It can contain rows from multiple files; each row is
  marked by source file/page/region so users can verify extracted tables before
  workbook creation.
- Original LibreChat/Steel file refs must remain available when the user asks AI
  to re-read a PDF/image; previous extracted rows are not enough.
- `docs/rules/OCR規則.txt` is synced into reviewed active
  `steel.agent_rules`, not `steel.instruction_packets`.
- Visual OCR tasks must load OCR agent rules before provider generation.
- `c.pdf` is the active PaddleOCR MCP OCR correctness fixture.
- Confirmed `file_analysis_data` can create quote workbook rows; uncertain OCR
  findings go to `manual_review` and `interpretation_notes`.
- PDF/image table OCR uses PaddleOCR MCP as the primary source. OpenAI OAuth
  file handling remains visual/semantic assistance only, not the primary table
  OCR path.
- Unsupported capability paths return typed errors or manual-review output.
- No Admin source/import mutation happens from quote attachments.

**Step 2: Run verification**

Run:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(vision|ai|workbook|tools)/.*\\.spec\\.ts$"
rtk npm run build:api
git diff --check
```

Expected: PASS. `build:api` may still print known non-Steel Rollup TypeScript warnings but must exit `0`.

## File Retention And Provider References

Recommended retention design:

- Steel/LibreChat stores the original quote evidence file through the existing
  configured `fileStrategy` and Mongo `File` record. Store only metadata needed
  for routing and audit in the quote/evidence records: file id, filename, media
  type, byte size, page count when known, owner/conversation scope, created
  time, retention state, storage source/path metadata, and provider run refs.
  With the local strategy, files live under `appConfig.paths.uploads` in a
  user-scoped path such as `/uploads/<userId>/<file_id>__<filename>`; S3,
  CloudFront, Azure Blob, and Firebase use the same Mongo `File` record shape
  with strategy-specific `storageKey` / `storageRegion` metadata.
- `file_analysis_data` stores extracted/corrected rows and source refs back to
  the internal file/page/region. It does not store raw provider payloads as
  user-visible data.
- `openai_oauth_responses` is the fixed Phase 6C driver. It keeps
  `responsesState: false` in this project and must be treated as stateless
  full-history. Provider response ids are trace metadata only, not the durable
  source of truth.
- Do not use official OpenAI Files API, official OpenAI `file_id`, or official
  Responses conversation state for Phase 6C. Those are outside the fixed
  `openai_oauth_responses` path.
- Re-reading a PDF/image must rebuild the provider payload from the internal
  LibreChat/Steel file ref and send the bytes to `openai_oauth_responses` again.
  Do not re-interpret only from previous `file_analysis_data` rows.

## Implementation Order

1. Task 0: Seed OCR agent rule and conditional loader.
2. Task 1: Fixture schema and exact comparison.
3. Task 2: Attachment classification and evidence boundary.
4. Task 3: Drawing evidence prompt builder.
5. Task 4: Provider extraction service with mocked provider.
6. Task 5: File analysis data review dataset.
7. Task 6: Confirmed file analysis projection to quote workbook.
8. Task 7: Chat route integration.
9. Task 8: Direct PDF/image/spreadsheet provider evidence paths.
10. Task 9: PaddleOCR MCP `c.pdf` manual OCR correctness smoke.
11. Task 10: Frontend upload UX.
12. Task 11: Docs and final gate.

This order proves the OCR table fixture, file-analysis review dataset, and
confirmed workbook projection before broadening the UI.

## Completion Criteria

- `docs/rules/OCR規則.txt` is synced to reviewed active
  `steel.agent_rules` with matching sha256 source refs.
- Conditional loader tests prove visual OCR tasks include OCR agent rules and
  fail before provider generation when the reviewed rule is missing.
- `docs/reference/example/c.pdf` expected JSON fixture exists and parses.
- Mocked provider tests prove drawing evidence can patch the single
  conversation-scoped `file_analysis_data` workspace with row-level source
  file/page/region metadata.
- Manual live PaddleOCR MCP test proves `c.pdf` extracts all 26 rows with exact
  critical values after normalization.
- OCR mismatch reports are kept and discussed before any threshold changes.
- Confirmed `file_analysis_data` can create or update quote workbook rows, with
  low-confidence facts written to review/note sheets.
- Workbook projection never writes confirmed prices or totals from OCR alone.
- Re-reading a PDF/image resolves the internal LibreChat/Steel file ref and
  resends bytes to `openai_oauth_responses`; it does not infer only from
  previous extracted rows.
- PDF/image/spreadsheet quote attachments cannot create Admin source versions, merge rows, or formal data writes.
- PDF/image/spreadsheet quote attachments are sent directly to AI when provider
  capability is supported; local OCR/raster/spreadsheet parsing is not the
  default interpretation path.
- Unsupported provider capabilities return typed errors or explicit low-confidence/manual-review output.
- Targeted Jest suites and `build:api` pass.
