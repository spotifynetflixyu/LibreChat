# Steel Workbook Fill Instruction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Steel OpenAI Responses workbook patch prompt teach the model how to map reviewed tool results into the current AI-facing workbook patch target while preserving the seven-sheet public workbook shape.

**Architecture:** Keep workbook filling AI-led. Provider prompt supplies the workbook-fill contract and backend provider completion returns missing sheet/cell targets for `系統訂單`, `人工複核`, and `報價單`; backend code projects AI semantic quote data into workbook rows. The public workbook still keeps seven fixed sheets for export/storage compatibility, but the current `patch_quote_workbook` completion loop does not require `報價明細`, `總結`, `價格來源`, or `判讀備註`.

**Tech Stack:** TypeScript provider prompt/tests in `packages/api`; Markdown docs under `docs/` and `tasks/`.

---

### Task 1: Provider Prompt Regression

**Files:**

- Test: `packages/api/src/steel/ai/provider.spec.ts`

**Step 1: Write the failing test**

Add expectations to the workbook patch prompt coverage that the system prompt includes:

- `價格先於重量`
- unknown price/amount must be `未確認`, not `0`
- `系統訂單` material and processing rows are separate
- `系統訂單`.`型號` is filled through semantic `systemOrder.modelCode` from the
  adopted `產品價格.xlsx` / `search_price_candidates` product-price row `型號`
- `報價明細` `小計` is fee sum and becomes `未確認` if required prices are unknown
- `總結` separates confirmed amount from low-confidence estimates
- `報價單` excludes customer tier, source refs, search keywords, candidates, and AI/internal notes
- `calculation_results` wins over quote item interpretation when present

**Step 2: Run the test to verify RED**

Run:

```bash
npm --workspace packages/api test -- --runInBand --watch=false src/steel/ai/provider.spec.ts -t "requires a provisional workbook patch"
```

Expected: FAIL on missing prompt substrings.

### Task 2: Provider Workbook Fill Contract

**Files:**

- Modify: `packages/api/src/steel/ai/provider.ts`

**Step 1: Implement minimal prompt update**

Add a compact workbook-fill paragraph to `getWorkbookPatchInstruction()` using the three AI-facing sheet names and the public seven-sheet compatibility note from `docs/reference/訂單參考_轉檔.xlsx`.
Include the system-order model rule: the model must send
`systemOrder.modelCode` from the adopted product-price row `型號`; oral material
names and catalog keys are not valid `系統訂單`.`型號` values.

**Step 2: Run GREEN**

Run:

```bash
npm --workspace packages/api test -- --runInBand --watch=false src/steel/ai/provider.spec.ts
```

Expected: PASS.

### Task 3: Docs And Verification

**Files:**

- Modify: `docs/steel-catalog-family-data-contract.md`
- Modify: `tasks/lessons.md`
- Modify: `tasks/todo.md`

**Step 1: Document the contract**

Record that workbook filling is based on `訂單參考_轉檔.xlsx`, uses reviewed tool results, never invents missing facts, keeps `報價單` free of internal data, and does not re-expand the AI-facing patch completion loop to seven sheets.

**Step 2: Verify**

Run:

```bash
npm --workspace packages/api test -- --runInBand --watch=false src/steel/ai/provider.spec.ts
npm --workspace packages/api run build
npx prettier --check packages/api/src/steel/ai/provider.ts packages/api/src/steel/ai/provider.spec.ts docs/steel-catalog-family-data-contract.md docs/plans/2026-06-05-steel-workbook-fill-instruction.md tasks/todo.md tasks/lessons.md
git diff --check
```

Expected: tests and checks pass. API build may still print existing non-Steel Rollup TypeScript warnings.
