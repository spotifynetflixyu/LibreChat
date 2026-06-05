# Steel Semantic Workbook Patch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a compact AI-callable workbook patch tool that accepts structured quote data and deterministically projects it into all Steel workbook sheets.

**Architecture:** AI still owns quote judgment: customer selection, product candidate adoption, formula/rule choice, price confidence, and missing-evidence notes. The backend owns workbook projection only: a semantic quote patch is expanded into existing validated `set_cell` operations for `系統訂單`, `報價明細`, `總結`, `人工複核`, `價格來源`, `判讀備註`, and `給客戶用`. Reusing the existing workbook patch service keeps persistence, validation, highlights, and UI behavior unchanged while avoiding large multi-call cell patches.

**Tech Stack:** TypeScript, Jest, AI SDK v3 provider tool loop, existing Steel workbook DTOs in `packages/data-provider`.

---

### Task 1: Semantic Patch Projection Helper

**Files:**

- Create: `packages/api/src/steel/workbook/semantic.ts`
- Test: `packages/api/src/steel/workbook/semantic.spec.ts`

**Step 1: Write the failing test**

Add a test that sends one quote line with `lineId: "line_1"`, `itemSpec`, `unitPrice`, `subtotal`, customer info, source summary, review note, and interpretation note.

Expected generated operations include:

- `quote_details.line_1.material_unit_price`
- `quote_details.line_1.subtotal`
- `system_order.order_1.item_spec`
- `system_order.order_1.unit_price`
- `summary.summary_total_amount.value`
- `manual_review.review_1.confirmation_needed`
- `price_sources.source_1.adopted_product_price_item`
- `interpretation_notes.note_1.content`
- `customer_quote.customer_1.item_spec`
- `customer_quote.customer_1.unit_price`
- `customer_quote.customer_1.subtotal`

Add a second test where only the unit price/subtotal changes for the same `lineId`; the helper must emit all affected workbook cells again, not only the changed source field.

**Step 2: Run test to verify RED**

Run:

```bash
cd packages/api && npx jest src/steel/workbook/semantic.spec.ts --runInBand
```

Expected: FAIL because `semantic.ts` does not exist.

**Step 3: Implement minimal projection**

Create a small typed builder that:

- Accepts `customer`, `summary`, `quoteLines`, `priceSources`, `manualReviews`, and `interpretationNotes`.
- Uses stable row ids from semantic ids: `line_1`, `order_1`, `source_1`, `review_1`, `note_1`, `customer_1`.
- Emits only meaningful non-empty values.
- Caps the generated operation list to the existing 100-operation provider limit by keeping each line projection concise.
- Writes customer-visible rows without internal tier/source/candidate/debug fields.

**Step 4: Run test to verify GREEN**

Run:

```bash
cd packages/api && npx jest src/steel/workbook/semantic.spec.ts --runInBand
```

Expected: PASS.

### Task 2: Provider Tool Integration

**Files:**

- Modify: `packages/api/src/steel/ai/provider.ts`
- Test: `packages/api/src/steel/ai/provider.spec.ts`

**Step 1: Write failing provider tests**

Add coverage that:

- The system prompt and tool list expose `patch_quote_workbook`.
- A model `patch_quote_workbook` call is expanded to the same `response.workbookPatch.operations` shape handlers already consume.
- A one-field repricing follow-up using `patch_quote_workbook` updates `報價明細`, `系統訂單`, `總結`, `價格來源`, and `給客戶用` in one tool call.

**Step 2: Run provider RED**

Run:

```bash
cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="semantic workbook"
```

Expected: FAIL because the tool is not registered.

**Step 3: Implement provider support**

Update provider to:

- Add `patch_quote_workbook` as the preferred quote-output tool for Steel quote turns.
- Parse semantic tool calls, project them into cell operations, and return those projected operations as `workbookPatch`.
- Return tool result text telling the model that the semantic patch was projected and it should answer with the quote/new `小計`, not call another workbook patch unless new information is needed.
- Treat projected operations as satisfying existing workbook completion checks.

**Step 4: Run provider GREEN**

Run:

```bash
cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand
```

Expected: PASS.

### Task 3: Verification

**Files:**

- Modify: `tasks/todo.md`
- Modify: `tasks/lessons.md`

**Step 1: Run focused verification**

Run:

```bash
cd packages/api && npx jest src/steel/workbook/semantic.spec.ts src/steel/ai/provider.spec.ts --runInBand
npm --workspace packages/api run build
git diff --check
```

Expected: PASS, with only pre-existing non-Steel build warnings if any.

**Step 2: Restart dev server**

Restart the running backend watcher so `/steel/oauth-chat` loads the new built provider. Verify:

```bash
curl -I http://localhost:3080/api/config
curl -I http://localhost:3090/steel/oauth-chat
```

Expected: HTTP 200 from both.

**Step 3: Review and document**

Update `tasks/todo.md` review evidence with test/build results and any known residual risk.
