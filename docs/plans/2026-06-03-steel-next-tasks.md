# Steel Next Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the next Steel runtime slices: provisional workbook preview, Phase 2/4B baseline verification, C 型鋼 vertical runtime coverage, and source-schema mapping code.

**Architecture:** Keep AI-led orchestration as the runtime frame. Backend tools validate source-backed candidates, workbook patches remain typed `patch_workbook` operations, and source-schema mapping is a small tested backend module rather than prompt prose.

**Tech Stack:** TypeScript in `packages/api`, Jest, existing Steel tool registry/executor, existing workbook service, Supabase schema grep/build checks, and reference XLSX headers as mapping inputs.

---

### Task 1: Provisional Workbook Patch

**Files:**

- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`
- Modify if needed: `packages/api/src/steel/handlers.spec.ts`

**Steps:**

1. Add a failing provider test proving quick price prompts with workbook context instruct the model to call `patch_workbook` for provisional preview rows.
2. Update workbook patch instruction so provisional quote patches write `quote_details`, `price_sources`, and `interpretation_notes`, while leaving summary/customer confirmed totals blank.
3. Run focused provider/handler tests.

### Task 2: Phase 2/4B Baseline Verification

**Files:**

- Modify: `tasks/todo.md`
- Read-only verification: `supabase/schema.sql`, `supabase/migration`, `packages/api/src/steel`

**Steps:**

1. Run focused repository/tool/rule-proposal tests.
2. Run schema grep for Phase 2/4B required surfaces.
3. Run `npm run build:api` and `git diff --check`.
4. Record pass/fail and remaining gaps in `tasks/todo.md`.

### Task 3: C 型鋼 Vertical Runtime Coverage

**Files:**

- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify only if RED requires it: `packages/api/src/steel/tools/*`, `packages/api/src/steel/repositories/*`

**Steps:**

1. Add a failing runtime test for a C 型鋼 order context that uses one batched instruction lookup, `lookup_defaults`, and `lookup_formula`.
2. Prove the returned default marks C 型鋼 cutting and hole as no-charge/true-zero, while material price remains sourced separately.
3. Implement only missing glue required by the test.

### Task 4: Source-Schema Mapping Code

**Files:**

- Create: `packages/api/src/steel/schema/mapping.ts`
- Create: `packages/api/src/steel/schema/mapping.spec.ts`
- Modify if needed: `packages/api/src/steel/schema/index.ts`

**Steps:**

1. Add a failing test for Chinese reference headers from `產品價格.xlsx`, `系統訂單.xlsx`, `公式編號.xlsx`, `切工價錢.xlsx`, and customer data.
2. Implement canonical English mapping helpers and prompt/tool mapping serialization.
3. Keep mappings focused on canonical-key resolution; do not add review workflow metadata.

### Final Verification

Run:

```bash
cd packages/api && npx jest src/steel --runInBand
npm run build:api
git diff --check
```

Run `/steel/oauth-chat` smoke only if provider/workbook runtime behavior changes need browser proof.
