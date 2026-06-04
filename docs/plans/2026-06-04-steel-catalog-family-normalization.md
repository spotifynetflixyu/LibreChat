# Steel AI-Owned Catalog Family Selection Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the AI decide which reviewed `catalogFamilies` key matches oral
customer wording, then call backend tools with that explicit key. Backend code
must not contain a separate oral-alias matcher that silently decides the key.

**Architecture:** `steel.catalog_families` remains the reviewed vocabulary and
source-backed alias/reference table. Runtime exposes that vocabulary through a
data-only `lookup_catalog_families` tool. The tool returns bounded candidate
rows for AI review; the AI chooses a canonical `catalogFamilies` key or asks the
user to confirm when confidence is low. `search_price_candidates` then queries
explicit keys only and validates unknown keys through existing
schemas/repository filters.

**Non-goal:** Do not implement backend fuzzy matching such as `H鋼 -> h_beam`
inside repository/tool code. Those examples belong in AI-visible vocabulary,
instructions, source refs, and tests that prove the backend requires explicit
keys rather than inventing them.

**Tech Stack:** TypeScript in `packages/api`, Jest focused tests, existing
Supabase/Postgres repository client.

---

### Task 1: RED Guardrail Tests

**Files:**

- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.spec.ts` if argument-shape
  coverage is needed
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`

**Steps:**

1. Add a test proving `lookup_catalog_families` returns candidate vocabulary
   rows and marks selection as AI-owned.
2. Add a test proving `search_price_candidates` does not query
   `steel.catalog_families` to auto-resolve oral text.
3. Add a test proving `search_price_candidates` accepts AI-selected
   `catalogFamilies: ['h_beam']` and queries price rows by `catalog_family`.
4. Add a test proving raw oral text without a derived candidate/key either
   remains a bounded product/spec search or is rejected by schema/tool
   guardrails, depending on the final runtime contract.
5. Add provider prompt/tool-list tests proving AI is instructed to call
   `lookup_catalog_families` for reviewed vocabulary context, then pass explicit
   keys to price/default/formula tools.
6. Run:
   `cd packages/api && npx jest src/steel/tools/execute.spec.ts --runInBand --coverage=false`
7. Expected: fail only for the new vocabulary-context behavior that is not yet
   encoded.

### Task 2: AI-Visible Vocabulary Context

**Files:**

- Create: `packages/api/src/steel/repositories/families.ts`
- Modify: `packages/api/src/steel/repositories/index.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Do not add a backend matcher that returns a single decided key from oral text.

**Steps:**

1. Add repository lookup for active reviewed `steel.catalog_families` rows by
   explicit `keys` or AI-extracted `searchText`.
2. Provide the AI with reviewed fields needed for judgment:
   `key`, `displayNameZh`, `aliases`, `priceCategories`, `sourceRefs`, and any
   low-confidence notes from defaults/instruction packets.
3. Keep returned candidates as data for the AI, not a backend-selected
   resolution. If multiple catalog families can match, return bounded options
   and require the AI to ask the user when ambiguous.
4. Update prompt/tool instructions so AI follows this sequence:
   oral text -> reviewed vocabulary/context -> chosen `catalogFamilies` key ->
   `search_price_candidates`.

### Task 3: Search Tool Contract

**Files:**

- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts` only if a stricter raw-text
  contract is needed.

**Steps:**

1. Preserve `search_price_candidates` as a price-row query tool.
2. Accept explicit `catalogFamilies` selected by the AI.
3. Do not read `steel.catalog_families` or infer keys from `productName`,
   `originalText`, or `candidateQueries` inside this tool.
4. Keep raw customer text as evidence for audit and candidate generation, not
   as the canonical product/category key.
5. Keep `lookup_catalog_families` output field names neutral, such as
   `catalogFamilyCandidates` and `selectionPolicy`; do not expose
   `resolvedCatalogFamilies`.

### Task 4: Verification

**Commands:**

```bash
cd packages/api
npx jest src/steel/tools/execute.spec.ts src/steel/repositories/prices.spec.ts --runInBand --coverage=false
cd ../..
npm run build:api
git diff --check
```

Expected result: tests and build pass; no schema migration is needed. Grep must
show no backend helper named like `searchSteelCatalogFamilyMatches`,
`resolveCatalogFamilies`, or `resolvedCatalogFamilies`.
