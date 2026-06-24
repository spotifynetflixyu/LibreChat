# Steel Price Lookup Schema Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify `search_price_candidates` lookup parameters so AI sends clear category/material/thickness/keyword inputs while backend handles text splitting and related cutting lookup.

**Architecture:** Keep the existing `steel.prices` schema and import data unchanged. Change only the tool/API contract and repository query builder: top-level input is always `{ queries }`; each query carries its own `mode` and `limit`. Lookup queries accept `category`, optional `material`, optional `thicknessMm` string array with OR semantics, and optional `keyword`; `specs` and `includeRelatedCutting` are removed from the AI-visible contract. Backend maps long-material categories to related `切工/切割` rows automatically and treats `category: "孔"` as a keyword-only lookup where the valid keyword is material-family text such as `鐵板`.

**Tech Stack:** TypeScript, Zod schemas, Jest, Supabase Postgres via existing `steel.prices`, runtime rule sync script.

---

### Task 1: Update Tool Contract Tests

**Files:**
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/repositories/prices.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`

**Step 1: Write failing schema tests**

Add tests proving lookup accepts:

```ts
{
  queries: [{ category: '鐵板/鋼板', material: 'OT 黑鐵', thicknessMm: ['15'], limit: 30 }]
}
```

and rejects legacy lookup-only parameters:

```ts
{
  queries: [{ category: '鐵板/鋼板', specs: ['雷射切割'] }],
  includeRelatedCutting: true
}
```

Also add a hole-specific test proving `category: '孔'` accepts only `keyword: '鐵板'` and rejects `thicknessMm`.

**Step 2: Run RED**

Run:

```bash
cd packages/api && npx jest src/steel/tools/registry.spec.ts --runInBand -t "search_price_candidates"
```

Expected: fail because `thicknessMm` is unknown and legacy fields still parse.

### Task 2: Update Schema and Registry

**Files:**
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`

**Step 1: Replace lookup query fields**

Change `priceCandidateQuerySchema` to:

```ts
{
  category: PriceCategory;
  material?: MaterialKind;
  thicknessMm?: string[];
  keyword?: string;
  limit?: number;
}
```

Use a union/refinement so `category: '孔'` allows `keyword` and rejects `material` / `thicknessMm`.
Category discovery is also a query object:

```ts
{ mode: 'category_discovery'; keyword: string; limit?: number }
```

**Step 2: Remove `includeRelatedCutting` from public schema**

Delete the lookup input field and update registry text to say related cutting rows are automatically included for long-material categories.

**Step 3: Run GREEN for schema tests**

Run the registry focused test again.

### Task 3: Update Repository Query Semantics

**Files:**
- Modify: `packages/api/src/steel/repositories/prices.ts`
- Modify: `packages/api/src/steel/repositories/prices.spec.ts`

**Step 1: Rename query model**

Replace `thicknesses?: readonly string[]` with `thicknessMm?: readonly string[]` and remove `specs`.

**Step 2: Normalize keyword search**

Use backend splitting for lookup keywords:

- Normalize `*`, `＊`, and `×` to `x`.
- Extract `15mm`, `15m/m`, or `15.0mm` into `source_thickness = '15.0'` when no `thicknessMm` is provided.
- Treat multiple `thicknessMm` values as OR filters against `source_thickness`.
- Treat `limit` as per-query, defaulting to 30 for each query.
- Split remaining text by whitespace into AND terms.
- Each term should match `product_name`, `spec_key`, `erp_item_code`, `source_spec`, or `subcategory` where relevant.

**Step 3: Auto include cutting**

Remove `includeRelatedCutting` input and always add related cutting filters when a query category maps to cutting subcategories:

```ts
H型鋼 -> H型鋼, 工字鐵/H型鋼
工字鐵/I字鐵 -> 工字鐵/H型鋼
圓管/鋼管 | 方管 | 扁方管 -> 管
角鐵/角鋼 -> 角鐵
槽鐵 -> 槽鐵
平鐵/扁鐵 -> 平鐵/扁鐵
```

**Step 4: Run repository tests**

Run:

```bash
cd packages/api && npx jest src/steel/repositories/prices.spec.ts --runInBand
```

### Task 4: Update Executor and Provider Coalescing

**Files:**
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`

**Step 1: Remove `includeRelatedCutting` plumbing**

Delete executor/provider references to the removed field.

**Step 2: Keep batching/coalescing stable**

Update same-round price coalescing equality to compare only the remaining lookup fields.

**Step 3: Run tool/provider tests**

Run:

```bash
cd packages/api && npx jest src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --runInBand -t "search_price_candidates|price"
```

### Task 5: Update Runtime Rules

**Files:**
- Modify: `docs/rules/agent規則.txt`
- Modify: `docs/rules/鋼材規則/鐵板.txt`
- Create: `docs/rules/鋼材規則/孔.txt`

**Step 1: Update generic tool contract**

Document that lookup queries use `category`, optional `material`, optional `thicknessMm`, and optional `keyword`; no `specs` and no `includeRelatedCutting`.

**Step 2: Update plate rules**

Document PL first lookup:

```json
{ "category": "鐵板/鋼板", "material": "OT 黑鐵", "thicknessMm": ["15"] }
```

**Step 3: Add hole rules**

Document:

```json
{ "category": "孔", "keyword": "鐵板" }
```

and forbid adding `thicknessMm` / `material` / hole diameter to the lookup query.

**Step 4: Sync runtime rules**

Run:

```bash
node packages/api/scripts/sync-steel-rules.cjs --dry-run
node packages/api/scripts/sync-steel-rules.cjs --apply
```

### Task 6: Verification

**Files:**
- No new files.

**Step 1: Run focused tests**

```bash
cd packages/api && npx jest src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/tools/registry.spec.ts src/steel/ai/provider.spec.ts --runInBand
```

**Step 2: Run lint/build**

```bash
cd packages/api && npx eslint src/steel/repositories/prices.ts src/steel/repositories/prices.spec.ts src/steel/tools/schemas.ts src/steel/tools/registry.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.ts src/steel/ai/provider.spec.ts --quiet --rule 'prettier/prettier: off' --rule 'i18next/no-literal-string: off'
npm --workspace packages/api run build
git diff --check
```

**Step 3: Restart backend**

Restart the running 3080 backend so `/steel/oauth-chat` uses the rebuilt API dist, then verify `/health`.
