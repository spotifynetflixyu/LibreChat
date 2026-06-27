# Steel Direct MCP OCR Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `run_file_ocr` as an AI-visible/executable Steel tool while preserving direct PaddleOCR MCP OCR helpers and assistant OCR Markdown auto-save to database.

**Architecture:** Keep PaddleOCR MCP access in `packages/api/src/steel/vision/ocr.ts` for direct/manual OCR execution. Remove the `run_file_ocr` provider tool from schemas, registry, runtime tool policy, native tool merge, ToolService special file resolution, and AI-facing rules. Preserve `read_markdown(scope: "ocr")` and `captureAssistantFinalMarkdown()` as the current database-backed OCR Markdown recovery path.

**Tech Stack:** TypeScript Jest in `packages/api`, legacy Jest for `/api`, Steel Mongo working-order memory, unified Steel rules sync through `packages/api/scripts/sync-steel-rules.cjs`.

---

### Task 1: Lock Tool Removal Tests

**Files:**
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/runtime/context.spec.ts`
- Modify: `packages/api/src/steel/native/tools.spec.ts`
- Modify: `packages/api/src/steel/native/context.spec.ts`

**Steps:**
1. Update registry expectations so the provider surface is only `search_customers`, `search_price_candidates`, and `read_markdown`.
2. Assert `run_file_ocr` is absent from `steelToolArgsSchemas`, `getSteelToolDefinitions()`, and `getExecutableSteelToolDefinition()`.
3. Update runtime/native context expectations so `aiVisibleTools` does not contain `run_file_ocr`.
4. Run the targeted tests and confirm they fail against the current implementation.

### Task 2: Remove Tool Schema, Registry, and Dispatch

**Files:**
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/runtime/context.ts`
- Modify: `packages/api/src/steel/native/context.ts`
- Modify: `api/server/services/ToolService.js`

**Steps:**
1. Delete `RunFileOcrInput` from provider tool schemas.
2. Delete the `run_file_ocr` registry entry and provider tool name.
3. Delete the `run_file_ocr` dispatch branch from `executeSteelTool`.
4. Remove ToolService request-scoped OCR file resolution used only by `run_file_ocr`.
5. Rename native OCR execution metadata to direct MCP semantics.

### Task 3: Preserve Direct PaddleOCR MCP Helper

**Files:**
- Modify: `packages/api/src/steel/vision/ocr.ts`
- Test: `packages/api/src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts`

**Steps:**
1. Move the OCR input type into `vision/ocr.ts` so direct PaddleOCR MCP tests do not depend on deleted tool schemas.
2. Keep the `docs/reference/example/c.pdf` manual test using direct `paddleocr_vl`.
3. Do not add a new AI-visible tool wrapper.

### Task 4: Remove AI-Facing `run_file_ocr` Rules

**Files:**
- Modify: `docs/rules/agent規則.txt`
- Modify: `docs/rules/其他規則/OCR規則.txt`
- Modify: `docs/steel-native-librechat-master-framework.md`
- Modify as needed: `docs/plans/2026-06-24-steel-global-native-librechat-integration.md`

**Steps:**
1. Replace instructions to call `run_file_ocr` with direct PaddleOCR MCP / native OCR handling language.
2. Keep the OCR confirmation gate and markdown table output rules.
3. Preserve `read_markdown(scope: "ocr")` for token-compression recovery.
4. Run `node packages/api/scripts/sync-steel-rules.cjs --dry-run`; run `--apply` only if `STEEL_POSTGRES_URL` is available and dry-run succeeds.

### Task 5: Verify Autosave and c.pdf Path

**Files:**
- Test: `packages/api/src/steel/memory/service.spec.ts`
- Test: `packages/api/src/steel/handlers.spec.ts`
- Test: `packages/api/src/steel/tools/execute.spec.ts`
- Test: `packages/api/src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts`

**Steps:**
1. Keep assistant final Markdown capture tests green, including OCR extract saves from assistant Markdown.
2. Keep `read_markdown(scope: "ocr")` tests green.
3. Run the direct `c.pdf` PaddleOCR MCP manual test when the AI Studio token is configured.
4. Record pass/fail evidence in `tasks/todo.md`.
