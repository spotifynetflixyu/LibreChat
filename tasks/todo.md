# Active: Simplify Steel Live Quote Pricing Smoke Changes

Goal: simplify this round's live pricing smoke changes, including the manual
provider test and the documented tool-use verification, without changing public
APIs or broadening the task scope.

Plan:

- [x] Collect the current diff and nearby Steel provider/tool context.
- [x] Review the diff from code reuse, code quality, and efficiency angles.
- [x] Apply only local, low-risk simplifications that keep the live smoke
  behavior intact.
- [x] Re-run focused checks and record the review result.

Review - 2026-06-23:

- Simplified the new live smoke spec so skipped default Jest runs no longer
  read repo `.env`; `.env` is loaded only when
  `STEEL_OPENAI_OAUTH_PRICING_LIVE_TEST=true` is already set.
- Replaced manual `unknown` tool-argument casting for
  `includeRelatedCutting` with `steelToolArgsSchemas.search_price_candidates`
  `safeParse`, so the tool-use assertion follows the real tool contract.
- Removed captured `onToolStatus` state from the spec because captured
  `executeSteelTool` calls/results already prove the tool flow and are enough
  for the auth-leak check.
- Parsed response numbers once and reused the parsed array for the expected
  subtotal checks.
- Intentionally skipped extracting handler runtime-rule dependency helpers
  because that would broaden this simplify pass into handler structure changes.
- Tried adding an `AbortController` timeout around the live provider call, but
  removed it after it coincided with repeated `Streaming request failed`
  provider errors; preserving live-smoke stability is higher value here.
- Post-simplify live reruns are currently blocked by the OAuth provider:
  both the pricing live smoke and the smaller
  `provider.real-auth.manual.spec.ts` fail at `sendSteelOAuthChat`
  `doGenerate` with `Streaming request failed`, before pricing assertions or
  tool-flow assertions run.
- Focused local verification passed: `git diff --check`, untracked-file
  whitespace check for the new spec, and default-off Jest skip behavior. Full
  `packages/api` TypeScript still fails on existing unrelated diagnostics, with
  no `provider.pricing-live` diagnostics in the log.

# Previous Active: Steel Live Quote Pricing Smoke

Goal: run a real OAuth/Codex provider smoke to verify AI can retrieve effective
product price rows, effective cutting rows, and produce a quote containing
material/cutting subtotals for plate, H beam, and H beam cutting. If the live
model misses data or calculation flow, first adjust reviewed prompt/rule text,
then retest; adjust tool descriptions only if prompt rules are insufficient.

Plan:

- [x] Confirm deterministic DB/tool availability for target plate, H beam, and
  H beam cutting rows.
- [x] Add a gated live manual spec that records tool calls, candidate groups,
  and final quote text without exposing auth material.
- [x] Run the live spec against real `openai_oauth_responses` and cloud
  Supabase.
- [x] If AI misses effective price/cutting data or quote subtotals, diagnose
  from tool-call arguments and results before changing prompts.
- [x] Prefer updating reviewed rules in `docs/rules/鋼材規則/` and syncing
  `steel.rules`; only then consider tool description/schema wording.
- [x] Re-run focused tests, DB/tool smoke, live smoke, and `git diff --check`.

Review - 2026-06-23:

- Deterministic DB/tool smoke confirmed available target rows:
  `DNB70060` / `6.0m/mOT板雷射切割` B=38.5/kg,
  `EHS201010` / `H型鋼200*100*5.5/8*10M(209)` B=28.4/kg,
  and `H型鋼 200*100 切工` B=125/刀.
- Added gated manual live spec
  `packages/api/src/steel/ai/provider.pricing-live.manual.spec.ts`.
- Live OAuth/Codex run passed with real `openai_oauth_responses` and cloud
  Supabase:
  `NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_PRICING_LIVE_TEST=true ...`
  ran in about 60 seconds and passed 1/1 test.
- The live run verified AI called `search_price_candidates`, used
  `includeRelatedCutting=true`, received effective candidates for plate,
  H 型鋼 product, and H 型鋼 cutting, and final output contained plate,
  H material, and H cutting subtotals close to expected values:
  plate about 145.07, H material about 5,935.6, H cutting 125.
- No prompt/rule/tool wording change was needed after this live run.

# Previous Active: Steel Rules Folder Source and Runtime Context Ordering

Goal: treat `docs/rules/鋼材規則/` as the canonical Steel rule source,
sync those files to unified `steel.rules`, and keep provider runtime context
ordered with default rules first: agent, all steel rules, output rules, then
conditional other rules.

Plan:

- [x] Confirm old `docs/rules/鋼材規則.txt` and `docs/rules/OCR規則.txt` are no
  longer the canonical repo rule sources.
- [x] Update `sync-steel-rules.cjs` so it reads `docs/rules/鋼材規則/*.txt` and
  `docs/rules/其他規則/OCR規則.txt`.
- [x] Apply rule sync to cloud Supabase and remove stale active reviewed rows
  sourced from the deleted old rule files.
- [x] Split runtime rule loaders so `agent`, `steel`, `output`, and `other`
  rules are loaded as separate DB-backed groups.
- [x] Serialize runtime context with `rules` first and with rule group order
  `agentRules -> steelGlobalRules -> outputRules -> otherGlobalRules`.
- [x] Keep `other` rules conditional; OCR rules are included only when current
  files or active evidence require OCR context.
- [x] Verify DB readback, focused Jest, and `git diff --check`.

Review - 2026-06-23:

- `steel.rules` active reviewed readback now contains 7 rows:
  `agent=1`, `steel=4`, `output=1`, `other=1`.
- Steel rule rows now source from `docs/rules/鋼材規則/C型鋼.txt`,
  `H型鋼.txt`, `鐵板.txt`, and `長管-切工.txt`.
- Old active reviewed source refs for `docs/rules/鋼材規則.txt` and
  `docs/rules/OCR規則.txt` read back as zero rows.
- Runtime context now has the rules block first, with rule keys ordered as
  `agentRules`, `steelGlobalRules`, `outputRules`, `otherGlobalRules`.
- Follow-up correction: top-level serialized runtime context order is now
  `rules`, `toolPolicy`, `outputSheets`, `conversation`, `attachments` so the
  stable tool contract stays ahead of volatile workbook/conversation/file data.
- Follow-up verification: runtime dependencies now load all active reviewed
  `agent`, `steel`, and `output` rows without section filters; only `other`
  rules remain conditional.
- Follow-up correction: OCR rules now remain included when any active history
  turn had PDF/image files, even if the current turn is text-only. Current
  files, prior active file evidence, and current-turn files still also trigger
  OCR rules.
- Focused Jest passed for rule repository, runtime context, handler, and
  provider tests.

# Previous Active: Steel Cutting Price v3 Subcategory Integration

Goal: import the updated cutting workbook
`/Users/neven/Downloads/產品價格_分類檔案_v3/產品價格_20_切工／切割.xlsm`,
store its new `次類別` and `規格` fields in `steel.prices`, and make one
`search_price_candidates` call able to return both material/product price rows
and related cutting price rows for quote calculation.

Observed source facts:

- `整理後資料` has 97 effective cutting rows.
- Headers now include `類別`, `次類別`, `規格`, `單位`, `價格狀態`,
  `停用/缺貨註記`, `原始列號`, `型號`, `品名規格`, A/B/C/F prices and ratios.
- All effective rows have `類別='切工/切割'` and `單位='刀'`.
- `次類別` values are `H型鋼`, `工字鐵/H型鋼`, `管`, `角鐵`, `槽鐵`,
  `平鐵/扁鐵`.

Integration design:

- [x] Add nullable `subcategory` and `source_subcategory_label` columns to
  `steel.prices`; keep cutting rows in the unified prices table.
- [x] Import cutting rows as `price_kind='cutting'`,
  `category='切工/切割'`, `subcategory=<次類別>`, `source_spec=<規格>`.
- [x] Keep `規格` as string and normalize obvious steel spec separators with the
  same spec key normalizer; preserve inch/range text where needed.
- [x] Extend `search_price_candidates` lookup input with
  `includeRelatedCutting?: boolean`.
- [x] When `includeRelatedCutting=true`, one backend lookup should include
  matching product/material rows plus related cutting rows by category mapping:
  `H型鋼 -> H型鋼, 工字鐵/H型鋼`; `工字鐵/I字鐵 -> 工字鐵/H型鋼`;
  pipe/tube categories -> `管`; `角鐵/角鋼 -> 角鐵`;
  `槽鐵 -> 槽鐵`; `平鐵/扁鐵 -> 平鐵/扁鐵`.
- [x] Update tool output to expose `subcategory` and `sourceSubcategoryLabel`
  so AI can select cutting rows explicitly.
- [x] Update `docs/rules/鋼材規則/長管-切工.txt` so AI uses one
  `search_price_candidates` call with `includeRelatedCutting=true` when product
  and cutting price are both needed.
- [x] Sync rules to `steel.rules` if rule docs change.
- [x] Apply migration to cloud Supabase, update `supabase/schema.sql`, import
  cutting rows, and read back counts.
- [x] Verify with focused Jest, direct DB smoke, direct tool smoke, and
  `git diff --check`.

Review - 2026-06-23:

- Added `subcategory` and `source_subcategory_label` to unified
  `steel.prices` in both schema snapshot and migration
  `20260623115453_steel_prices_subcategory.sql`; cloud Supabase was updated
  directly through `STEEL_POSTGRES_URL` because this checkout is not linked to a
  Supabase project ref for CLI migration apply.
- Re-imported `/Users/neven/Downloads/產品價格_分類檔案_v3/產品價格_20_切工／切割.xlsm`
  with `--replace-workbook`. The workbook contributes 97 cutting rows, all with
  `subcategory` and `source_spec`.
- Direct DB readback shows total `steel.prices=6464`, active `6147`, and the
  new cutting workbook row distribution: `H型鋼=19`, `工字鐵/H型鋼=31`,
  `管=13`, `角鐵=12`, `槽鐵=12`, `平鐵/扁鐵=10`.
- `steel.rules` now has 19 active reviewed rows, including
  `steel_quote_rules_long_material_cutting` sourced from
  `docs/rules/鋼材規則/長管-切工.txt`.
- Direct tool smoke for `category='H型鋼'`, `specs=['200*100']`,
  `includeRelatedCutting=true` returned 11 candidates in one call:
  10 H 型鋼 product rows and 1 `切工/切割` / `H型鋼` cutting row with A/B/C/F
  prices.
- Focused Jest passed for importer, price repository, tool executor, tool
  registry, and provider batching. Full `packages/api` TypeScript still fails
  on existing unrelated agents/config/redis and older Steel spec typing issues;
  the tsc log has no errors under this task's touched Steel paths.

# Previous Active: Steel Product Price v3 Plate Correction Reload

Goal: re-update Steel product price data after the corrected
`產品價格_03_鐵板／鋼板.xlsm` moved the listed `雷切割型` ERP rows into the plate
workbook. These rows must be treated as `鐵板/鋼板` product rows, not
`切工/切割` cutting rows.

Correction rows:

- `B4NA900010`, `B4NA900012`, `B4NA900015`
- `B4NH900010`, `B4NH900012`, `B4NH900015`
- `B4NS900010`, `B4NS900012`, `B4NS900015`, `B4NS900020`, `B4NS900030`
- `B4NT900030`, `B4NT900045`, `B4NT900060`
- `B4XS900030`

Plan:

- [x] Read current cloud rows for the listed ERP codes and confirm they are
  currently imported as `price_kind='cutting'`, `category='切工/切割'`.
- [x] Read the corrected workbook and confirm the listed rows are present in
  `產品價格_03_鐵板／鋼板.xlsm`.
- [x] Add importer correction so these listed ERP codes import as
  `price_kind='product'`, `category='鐵板/鋼板'`, even if the source row's `類別`
  still says `切工/切割`.
- [x] Add regression coverage for one corrected row.
- [x] Dry-run import and verify summary/counts.
- [x] Apply the corrected import to cloud `steel.prices`.
- [x] Verify all listed ERP codes read back as `product` / `鐵板/鋼板` with
  A/B/C/F tier prices.
- [x] Run focused Jest and `git diff --check`.
- [x] Correction follow-up: `source_category_label` for the listed ERP codes
  must also be `鐵板/鋼板`, not the stale row-level `切工/切割`.

Review - 2026-06-23:

- Current cloud data before correction had all 15 listed ERP codes as
  `price_kind='cutting'`, `category='切工/切割'`, sourced from
  `產品價格_20_切工／切割.xlsm`.
- Corrected workbook read confirmed the rows exist in
  `產品價格_03_鐵板／鋼板.xlsm` at rows 442-456, though row-level `類別` still says
  `切工/切割`.
- Importer now has a targeted 2026-06-23 correction list so those rows import as
  `price_kind='product'`, `category='鐵板/鋼板'`.
- Applied single-workbook safe update mode: only the 15 listed ERP codes were
  deleted/reinserted; cloud `steel.prices` total remains `6433`.
- Cloud readback shows all 15 listed ERP codes are now
  `price_kind='product'`, `category='鐵板/鋼板'`.
- Follow-up correction: user clarified `source_category_label` must also be
  normalized to `鐵板/鋼板` for these corrected rows.
- Re-applied the same 15-code safe update after importer correction. Cloud
  readback now groups all 15 rows under `price_kind='product'`,
  `category='鐵板/鋼板'`, `source_category_label='鐵板/鋼板'`, and all 15 still
  have A/B/C/F tier prices.
- Follow-up correction: remove any metadata annotation of the stale raw
  row-level category. These rows should only retain the corrected `鐵板/鋼板`
  category labels.
- Re-applied the same 15-code safe update after removing correction metadata.
  Cloud readback shows `with_category_correction=0`,
  `with_stale_category_text=0`, and all 15 rows remain
  `product` / `鐵板/鋼板` with A/B/C/F tier prices.

# Previous Active: Steel Unified Prices/Rules Supabase Schema Plan

Goal: design the new Steel Supabase schema and runtime contract before any
migration, destructive delete, or data import. The current target architecture
keeps only `customers` and `formula_versions` as existing business tables, then
adds one unified `prices` table for product/cutting/hole prices and one unified
`rules` table for all runtime rules.

Latest user-locked decisions:

- [x] `prices` contains all price categories, including product prices, cutting
  prices, and hole prices.
- [x] `rules` contains all rules.
- [x] Split rule tables are obsolete. Do not preserve runtime dependencies on
  `agent_rules`, `quote_rules`, `customer_rules`, `catalog_family_rules`,
  `material_rules`, or similar split tables.
- [x] Split price tables are obsolete. Do not restore `steel.price_items` as
  the runtime product-price table.
- [x] `customer_tier` is the product price level code. Runtime tier selection
  maps to product price A/B/C/F with uppercase string codes `A`, `B`, `C`, `F`;
  `B` is the default when no customer tier is known.
- [x] Do not recreate `customer_tiers` as a separate runtime table. The tier
  mapping is an application/database check constraint contract:
  `A`, `B`, `C`, `F`. Do not convert these to numeric IDs or lowercase codes.
- [x] `search_price_candidates` must return all A/B/C/F prices for matching
  rows. If a later lookup updates the customer tier, the quote recalculates from
  the already returned tier prices; it must not repeat `search_price_candidates`
  only to change price tier.
- [x] Global default rules are split by `rule_kind`: `agent`, `output`,
  `steel`, and `other`. `other` covers OCR and similar supporting policy.
- [x] Global `agent`, `output`, and `steel` rules are included at the top of
  every send-API context in stable order to improve provider KV-cache reuse.

Supabase schema target:

```sql
-- Price tier codes are an application contract, not row-level price rows.
-- A/B/C/F are stored as uppercase text codes. Runtime default is B.

CREATE TABLE steel.customers (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  erp_customer_code TEXT,
  display_name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  customer_tier TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_tier_check
    CHECK (customer_tier IS NULL OR customer_tier IN ('A', 'B', 'C', 'F')),
  CONSTRAINT customers_status_check
    CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT customers_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT customers_source_refs_check
    CHECK (jsonb_typeof(source_refs) = 'array')
);

CREATE TABLE steel.formula_versions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL,
  version_seq INTEGER NOT NULL,
  display_name TEXT,
  source_expression TEXT,
  formula_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_formula JSONB,
  allowed_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  review_state TEXT NOT NULL DEFAULT 'reviewed',
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT formula_versions_code_version_unique UNIQUE (code, version_seq)
);

CREATE TABLE steel.prices (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  price_kind TEXT NOT NULL,
  source_dataset TEXT NOT NULL,
  source_row_key TEXT NOT NULL,
  erp_item_code TEXT,
  product_name TEXT NOT NULL,
  spec_key TEXT NOT NULL,
  category TEXT NOT NULL,
  material TEXT,
  source_category_label TEXT,
  source_material_label TEXT,
  source_thickness TEXT,
  source_spec TEXT,
  unit TEXT NOT NULL DEFAULT 'piece',
  currency TEXT NOT NULL DEFAULT 'TWD',
  unit_price_a NUMERIC(14, 4),
  unit_price_b NUMERIC(14, 4),
  unit_price_c NUMERIC(14, 4),
  unit_price_f NUMERIC(14, 4),
  ratio_a NUMERIC(14, 4),
  ratio_b NUMERIC(14, 4),
  ratio_c NUMERIC(14, 4),
  ratio_f NUMERIC(14, 4),
  product_price_unit_weight NUMERIC(14, 5),
  product_price_unit_weight_unit TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  value_state TEXT NOT NULL DEFAULT 'confirmed',
  review_state TEXT NOT NULL DEFAULT 'reviewed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prices_kind_check
    CHECK (price_kind IN ('product', 'cutting', 'hole')),
  CONSTRAINT prices_value_state_check
    CHECK (value_state IN ('unknown', 'confirmed', 'true_zero', 'estimate')),
  CONSTRAINT prices_review_state_check
    CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  CONSTRAINT prices_unit_prices_nonnegative_check CHECK (
    (unit_price_a IS NULL OR unit_price_a >= 0)
    AND (unit_price_b IS NULL OR unit_price_b >= 0)
    AND (unit_price_c IS NULL OR unit_price_c >= 0)
    AND (unit_price_f IS NULL OR unit_price_f >= 0)
  ),
  CONSTRAINT prices_confirmed_has_price_check CHECK (
    value_state = 'unknown'
    OR unit_price_a IS NOT NULL
    OR unit_price_b IS NOT NULL
    OR unit_price_c IS NOT NULL
    OR unit_price_f IS NOT NULL
  ),
  CONSTRAINT prices_unknown_has_no_price_check CHECK (
    value_state <> 'unknown'
    OR (
      unit_price_a IS NULL
      AND unit_price_b IS NULL
      AND unit_price_c IS NULL
      AND unit_price_f IS NULL
    )
  ),
  CONSTRAINT prices_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT prices_source_refs_check
    CHECK (jsonb_typeof(source_refs) = 'array'),
  CONSTRAINT prices_source_row_unique UNIQUE (source_dataset, source_row_key)
);

CREATE TABLE steel.rules (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  rule_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-TW',
  rule_sections TEXT[] NOT NULL DEFAULT '{}'::text[],
  selectors JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt TEXT NOT NULL,
  tool_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  review_state TEXT NOT NULL DEFAULT 'reviewed',
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ,
  created_by TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rules_kind_check
    CHECK (rule_kind IN ('agent', 'output', 'steel', 'other')),
  CONSTRAINT rules_review_state_check
    CHECK (review_state IN ('draft', 'needs_review', 'reviewed', 'rejected')),
  CONSTRAINT rules_selectors_check
    CHECK (jsonb_typeof(selectors) = 'object'),
  CONSTRAINT rules_tool_policy_check
    CHECK (jsonb_typeof(tool_policy) = 'object'),
  CONSTRAINT rules_output_policy_check
    CHECK (jsonb_typeof(output_policy) = 'object'),
  CONSTRAINT rules_source_refs_check
    CHECK (jsonb_typeof(source_refs) = 'array'),
  CONSTRAINT rules_slug_version_unique UNIQUE (slug, version)
);
```

Indexes and extensions:

- Ensure `pg_trgm` exists before text-search indexes.
- `customers`: unique index on `erp_customer_code` where not null; trigram
  indexes on `display_name`, `legal_name`, and `tax_id` if customer search still
  needs fuzzy matching.
- `prices`: btree indexes on `(price_kind, category)`,
  `(price_kind, category, material)`, `(review_state, active)`;
  trigram indexes on `spec_key`, `product_name`, `source_thickness`,
  `source_spec`; unique `(source_dataset, source_row_key)`.
- `rules`: btree indexes on `(rule_kind, active, review_state, priority)` and
  unique `(slug, version)`.

Migration plan:

- [x] Create migration with `npx supabase migration new steel_unified_prices_rules_schema`.
- [x] In migration, preserve existing `customers` and `formula_versions`
  data where present.
- [x] Rename or migrate old `customers.customer_tier_id` to
  `customers.customer_tier` if present. Drop any foreign key to a deleted
  `customer_tiers` table; keep the column as nullable uppercase text with check
  `IN ('A','B','C','F')`.
- [x] Add SQL comments documenting `customers.customer_tier`:
  `A/B/C/F uppercase text code; runtime default is B when tier is unknown`.
- [x] Create `steel.prices` and `steel.rules` if missing.
- [x] Drop obsolete split tables if they still exist:
  `price_items`, `price_history`, `price_rule_conditions`, `customer_tiers`,
  `customer_aliases`, `agent_rules`, `quote_rules`, `customer_rules`,
  `catalog_family_rules`, `material_rules`, `instruction_packets`,
  `lesson_memory_entries`, `source_chunks`, `source_embeddings`,
  `weight_specs`, `orders`, `order_items`, `import_rule_notes`.
- [x] Update `supabase/schema.sql` to the unified current snapshot in the same
  change.
- [x] Verify migration with direct cloud readback of tables, columns,
  constraints, and indexes before import.

`search_price_candidates` API design:

```ts
type SearchPriceCandidatesInput =
  | {
      mode?: 'lookup';
      queries: PriceCandidateQuery[];
      limit?: number;
    }
  | {
      mode: 'category_discovery';
      keyword: string;
      limit?: number;
    };

interface PriceCandidateQuery {
  category: PriceCategory;
  material?: MaterialKind;
  thicknesses?: string[];
  specs?: string[];
  keyword?: string;
}
```

Query semantics:

- Lookup mode requires `queries[].category`.
- `category` and `material` values are the normalized visible enum values, e.g.
  `扁方管`, `鐵板/鋼板`, `OT 黑鐵`, `2B 白鐵霧面`; no English/snake-case API
  values.
- Per query object: AND semantics across category/material/thickness/spec/keyword.
- Across `queries`: OR semantics.
- `thicknesses` targets `prices.source_thickness`. Pure integer query tokens
  normalize to one decimal string, e.g. `2` -> `2.0`; numeric thickness
  filters use exact match so `6.0` does not match `16.0`. Non-numeric thickness
  text can still use contains matching.
- `specs` are string contains filters against `prices.source_spec` /
  `spec_key`.
- `keyword` searches product-name/spec-key text.
- Category unknown path: use `mode: 'category_discovery'` with `keyword`; do
  not guess category.

Tier behavior:

- `search_price_candidates` does not accept or return `customerTier` props.
- `search_price_candidates` returns every candidate with
  `tierPrices: { A, B, C, F }`.
- Quote calculation chooses the effective tier separately from customer context,
  defaulting to `B` when no customer tier is known.
- If customer tier becomes known or changes after a price result is already in
  context, backend should recompute the selected price from `tierPrices`; do not call
  `search_price_candidates` again solely for tier change.

Provider/context rules:

- Before every `sendSteelOAuthChat`, load active reviewed global rules from
  `steel.rules` in stable order:
  1. `rule_kind = 'agent'`
  2. `rule_kind = 'output'`
  3. `rule_kind = 'steel'`
  4. `rule_kind = 'other'` only when applicable, e.g. OCR/file turns
- Rule SQL should filter `active = true`, `review_state = 'reviewed'`, and
  `invalidated_at IS NULL`, then order by fixed kind rank, `priority ASC`,
  `slug ASC`, `version DESC`.
- Put the stable global rule block at the top of context before per-turn memory,
  active output sheet context, user messages, and tool results.
- Update `docs/rules/agent規則.txt` and synced DB `rules` rows to state the new
  `search_price_candidates` contract, tier default, tier-reprice behavior, and
  category-discovery rule.

Implementation checkpoints:

- [x] Checkpoint A: schema migration and `supabase/schema.sql` unified snapshot.
- [x] Checkpoint B: parser/import dry-run from v3 ZIP, no DB writes.
- [x] Checkpoint C: `prices` import apply, readback grouped by
  `price_kind/category/material/value_state`.
- [x] Checkpoint D: `rules` seed/sync and fixed context assembly readback.
- [x] Checkpoint E: focused Jest for parser, repository query semantics, tool
  schema, provider tier-reprice behavior, and context rule ordering.
- [x] Checkpoint F: direct tool smoke for category discovery, lookup, B default,
  and tier reprice without re-search.

Review - 2026-06-23:

- Applied cloud migration to the unified Steel schema and synced
  `supabase/schema.sql` plus
  `supabase/migration/20260623093400_steel_unified_prices_rules_schema.sql`.
- Imported v3 price ZIP into `steel.prices` after cleanup normalization:
  cloud readback shows `prices=6433`.
- Synced unified rules into `steel.rules`: cloud readback shows `rules=18`
  with `agent=1`, `output=1`, `steel=15`, `other=1`.
- Verified sample `DNB70060` stores one row with `category='鐵板/鋼板'`,
  `material='OT 黑鐵'`, `source_thickness='6.0'`, and all
  `unit_price_a/b/c/f` values.
- Focused Jest passed: 9 suites, 64 tests.
- Full `tsc --noEmit --project packages/api/tsconfig.json` still fails on
  pre-existing non-target areas (`agents`, app config endpoint typing, Redis
  client typing, older Steel history/memory/manual OCR specs). No errors remain
  in this task's touched Steel paths after filtering `/tmp/steel-tsc.log`.

Only this top `# Active` section is current. Later `# Active` / `## Active`
sections are historical task records unless explicitly promoted again.

# Superseded: Steel Product Price v3 Category Import Plan

Status update - 2026-06-23 schema correction:

- User clarified the target database architecture has changed:
  - all rules should be unified into one table,
  - all prices, including product price, cutting price, and hole price, should
    be unified into one price table,
  - obsolete split tables should be deleted.
- Stop the previous `steel.price_items` / split rule-table implementation path.
- Live DB introspection through current `.env` `STEEL_POSTGRES_URL` currently
  shows no `steel.price_items`, but also does not show an obvious unified price
  table. It still shows split rule tables such as `catalog_family_rules`,
  `customer_rules`, `quote_rules`, `material_rules`, and
  `price_rule_conditions`.
- Blocking requirement before destructive migration/import: confirm the actual
  unified rules table name and unified price table name/columns, or create a
  new migration that establishes those unified tables and explicitly drops the
  obsolete split tables.

Goal: replace the existing Steel product-price database with the v3 classified
product-price ZIP, collapse `A/B/C/F` tier prices into one row per product,
normalize source category/material labels before import, and redesign
`search_price_candidates` around multi-condition category/material queries.

Current data facts from
`/Users/neven/Downloads/產品價格_分類檔案_v3-20260623T075539Z-3-001.zip`:

- ZIP contains 21 `.xlsm` workbooks. Each workbook has `整理後資料`, `分類統計`,
  and `分類規則`.
- `整理後資料` has 6,436 non-empty product rows before tier expansion.
- Rows should stay one product row each. Do not expand `售價A/B/C/F` into four
  `steel.price_items` rows.
- Store normalized `category` from source `類別`.
- Store normalized fixed-enum `material` from source `材質`.
- Store `厚度` and `規格` as strings. If a source value is a pure integer
  number/string, normalize it to one decimal-place string before DB import,
  for example `1`, `2`, `3`, `4` become `1.0`, `2.0`, `3.0`, `4.0`.
  Query those string fields with contains-style keyword matching.
- Important parser caveat: some `規格` cells such as `5/8` and `3/4` are stored
  by Excel as date-like values. The importer must recover those as fraction
  specs, not persist dates like `2026-05-08`.
- `無售價/0價` means unknown/missing price unless a future reviewed rule marks
  a row as true zero. Do not treat blank or `0` tier prices as free prices.
- 317 rows are marked stopped/out-of-stock. Preserve the source flag and set
  runtime active status accordingly.

Source normalization before DB import:

- `No1 白鐵3t以上含` -> `No1 白鐵`
- `鋁/鋁合金` -> `鋁`
- `其他加工` -> `加工`
- `不適用` -> `無`
- `PVC` -> `塑膠`
- `PC` -> `塑膠`

Locked decisions:

- [x] Clear old `steel.price_items` data before importing the v3 dataset.
- [x] `category` is the normalized spreadsheet `類別` value.
- [x] `search_price_candidates` lookup mode requires category and uses fixed
  enum values.
- [x] `PriceCategory` enum values are the normalized user/data-visible category
  strings, for example `C型鋼`, `扁方管`, and `加工`. Do not introduce separate
  English or snake-case values for the runtime/API contract.
- [x] `material` uses a fixed enum when supplied. `MaterialKind` enum values are
  the normalized user/data-visible material strings, for example `OT 黑鐵`,
  `2B 白鐵霧面`, and `無`.
- [x] One `steel.price_items` row represents one product with `A/B/C/F` prices
  together.
- [x] Existing runtime still defaults unknown customer tier to B for effective
  quote price selection.
- [x] This remains an Admin/data maintenance import. Do not re-enable the old
  file-backed runtime reference importer.
- [x] `其他加工` is not a canonical DB/import category after cleanup. Use
  `加工` as the canonical DB/API enum value. Do not expose an extra English
  value for it.
- [x] `厚度` and `規格` are string columns. Pure integer values normalize to
  one-decimal strings before import; decimal values, ranges, fractions, and
  mixed dimension text remain string values without forced numeric conversion.

Recommended approach:

- Superseded: the earlier approach targeted `steel.price_items`. Do not proceed
  with that table path after the unified-table correction.
- Revised approach: make the next migration target the confirmed unified price
  table. That table must be able to store price kind (`product`, `cutting`,
  `hole`), normalized category/material enum values, string thickness/spec
  facets, A/B/C/F tier prices and ratios where applicable, product/source
  identity, and source refs.
- The unified rules table must be the only runtime rule lookup source after the
  migration. Existing code paths that still query split rules tables need to be
  routed to the unified rules table or left untouched only if they are known
  dead code.
- Use one schema migration to reshape product-price storage for v3:
  add `category`, `material`, source spec/thickness fields, and `A/B/C/F`
  tier-price columns; replace tier-expanded identity with one-row-per-product
  identity.
- Keep `customerTierId` in the tool input as quote context only. Repository SQL
  should not filter `price_items` by row-level `customer_tier_id` anymore; it
  should select the effective `unitPrice` from the row's A/B/C/F columns based
  on the requested or default tier.
- Replace the old flat `candidateQueries` contract with condition groups:
  each query object filters by required `category`, optional `material`,
  optional `thicknesses`, optional `specs`, and optional product-name
  `keyword`.
- Category/material enum values in API input/output must be the exact normalized
  Chinese/user-visible strings from the source data after cleanup. Prefer
  `as const` string arrays / literal unions or equivalent zod enums whose values
  are the visible strings. Do not make callers send `c_type`,
  `ot_black_iron`, `PROCESSING`, or other invented English values.
- Importer and query normalization should use the same string-normalization
  rules for `厚度` and `規格`: integer numeric tokens become one-decimal strings
  before storing or matching, while range/fraction/dimension text stays textual.
- Apply AND semantics inside one query object and OR semantics across query
  objects. Example:

  ```json
  {
    "queries": [
      { "category": "C型鋼", "material": "OT 黑鐵", "thicknesses": ["2.3"] },
      { "category": "方管", "material": "錏/鍍鋅", "specs": ["75", "6M"] }
    ],
    "customerTierId": 2,
    "limit": 100
  }
  ```

- Category-discovery path: when category is unknown, the AI should call the
  same tool with keyword discovery instead of guessing. The tool returns
  candidate category/material counts and examples, then the next price lookup
  must use enum category values.

Rejected approaches:

- Do not keep the current A/B/C/F row expansion. It contradicts the required
  one-product-one-row contract and keeps the old `customer_tier_id` identity.
- Do not store new category/material/spec/thickness only in `metadata`. Tool
  filtering needs indexed, typed columns.
- Do not infer category through the existing large `catalog_family` layer for
  this import. The user-visible category is the normalized spreadsheet `類別`.

API design:

- Lookup input is object-shaped for provider compatibility:

  ```ts
  type SearchPriceCandidatesInput =
    | {
        mode?: 'lookup';
        queries: PriceCandidateQuery[];
        customerTierId?: number;
        limit?: number;
      }
    | {
        mode: 'category_discovery';
        keyword: string;
        limit?: number;
      };

  interface PriceCandidateQuery {
    category: PriceCategory;
    material?: MaterialKind;
    thicknesses?: string[];
    specs?: string[];
    keyword?: string;
  }
  ```

- Query behavior:
  - `category`: required in lookup mode; SQL equality / enum value.
  - `material`: optional; SQL equality / enum value.
  - `thicknesses`: optional string array; default is no thickness filter.
    When supplied, match ANY token by contains against stored thickness string.
  - `specs`: optional string array; match ANY token by contains against stored
    spec string, for dimensions, length, inches, OD, or similar facets.
  - `keyword`: optional; contains query against `product_name` / 品名規格.
  - Cross-field semantics are AND; multi-query array semantics are OR.
  - Result output includes normalized enum values, original source labels in
    metadata, all A/B/C/F prices and ratios, and the selected effective
    `unitPrice`. Since enum values are already user-visible strings, separate
    display labels are optional compatibility fields, not a second value system.

Canonical category enum values:

```ts
export const PriceCategories = [
  'C型鋼',
  'H型鋼',
  '鐵板/鋼板',
  '圓鐵/圓鋼',
  '角鐵/角鋼',
  '孔',
  '平鐵/扁鐵',
  '槽鐵',
  '工字鐵/I字鐵',
  '方鋼/方鐵',
  '圓管/鋼管',
  '方管',
  '扁方管',
  '樓層板',
  '浪板/收邊',
  '網材',
  '門窗/捲門/配件',
  '五金/零件/耗材',
  '折工',
  '切工/切割',
  '非鋼材/其他材料',
  '鐵軌',
  'T型鋼',
  '加工',
] as const;

export type PriceCategory = (typeof PriceCategories)[number];
```

Canonical material enum values:

```ts
export const MaterialKinds = [
  'OT 黑鐵',
  'ST 白鐵',
  '2B 白鐵霧面',
  'BA 白鐵亮面',
  'HL 白鐵沙面',
  'No1 白鐵',
  '錏/鍍鋅',
  '錏',
  '鋁鋅',
  '彩色/烤漆',
  '中碳鋼',
  '鋁',
  '非鋼材',
  '塑膠',
  '玻璃',
  '無',
  '待確認',
] as const;

export type MaterialKind = (typeof MaterialKinds)[number];
```

Planned files:

- Modify: `supabase/schema.sql`
- Create: `supabase/migration/<generated>_steel_product_price_v3_category.sql`
- Create: `packages/api/src/steel/prices/category.ts`
- Create: `packages/api/src/steel/prices/import.ts`
- Create: `packages/api/src/steel/prices/import.spec.ts`
- Create: `packages/api/scripts/import-steel-product-prices-v3.cjs`
- Modify: `packages/api/src/steel/repositories/prices.ts`
- Modify: `packages/api/src/steel/repositories/prices.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`
- Modify: `packages/api/src/steel/tools/sanitize.ts`
- Modify: `packages/api/src/steel/tools/sanitize.spec.ts`
- Modify: `docs/rules/agent規則.txt`
- Modify: `docs/steel-catalog-family-data-contract.md`

Checkpoint 0 - Plan Approval:

- [x] User clarified cleanup rules, one-row tier storage, and multi-condition
  search API.
- [x] User corrected enum contract: category/material enum values must be the
  visible normalized values such as `OT 黑鐵`, `2B 白鐵霧面`, and `扁方管`,
  not separate English values.
- [x] User corrected dimension storage: `厚度` and `規格` are strings, and pure
  integer values must import as one-decimal strings such as `1.0`.
- [x] User corrected database architecture: rules are unified to one table and
  prices are unified to one table for product/cutting/hole.
- [ ] Confirm actual unified rules table name and unified price table
  name/columns, because current `STEEL_POSTGRES_URL` introspection does not
  show the unified price table.
- [ ] Confirm destructive operation scope under the unified architecture:
  clear only unified price rows for v3 product-price import, and do not clear
  customers, formulas, workbook memory, source chunks/embeddings, or unrelated
  retained tables.

Task 1 - Write Product Price v3 Parser Tests:

- [ ] Add fixture workbook/rows that cover normal `厚度`, `規格`, `厚度(mm)`,
  date-like fractions (`5/8`, `3/4`), `待確認`, stopped rows, and tier prices.
- [ ] Add fixture rows for cleanup rules:
  `No1 白鐵3t以上含`, `鋁/鋁合金`, `其他加工`, `不適用`, `PVC`, and `PC`.
- [ ] Verify parser returns one canonical product row with `tierPrices` and
  `tierRatios`, not four rows.
- [ ] Verify parser returns normalized enum values and original source labels
  separately.
- [ ] Verify source refs include workbook name/index, sheet `整理後資料`, and
  original row number.

Task 2 - Add Product Price v3 Constants and Parser:

- [ ] Add fixed `PriceCategory` values as normalized visible string literals.
- [ ] Add fixed `MaterialKind` values as normalized visible string literals.
- [ ] Add source-label cleanup maps before enum conversion.
- [ ] Normalize units to existing runtime unit conventions without losing the
  source unit in metadata.
- [ ] Generate `spec_key` from ERP code, product name, category, material, spec,
  and thickness facets so current keyword search still works.

Task 3 - Add Supabase Schema Migration:

- [ ] Run `npx supabase migration new steel_product_price_v3_category`.
- [ ] Target the confirmed unified price table, not `steel.price_items`.
- [ ] Add one-row-per-product columns to the unified price table: `category`,
  `material`, `source_category_label`, `source_material_label`, `source_spec`,
  `source_thickness`, `unit_price_a`, `unit_price_b`, `unit_price_c`,
  `unit_price_f`, `ratio_a`, `ratio_b`, `ratio_c`, `ratio_f`. Do not add
  separate label columns for normalized `category` / `material`; those columns
  already store the visible enum values.
- [ ] Drop or replace the old misleading ERP+tier unique index with one-product
  identity, using `erp_item_code` when present and a stable source key fallback.
- [ ] Add indexes for `category`, `(category, material)`, `source_thickness`,
  `source_spec`, `product_name`, and spec-key lookup.
- [ ] Update `supabase/schema.sql` in the same change.

Task 4 - Update Repository and Tool Contract:

- [ ] Replace flat `candidateQueries` with lookup `queries` and category
  discovery mode.
- [ ] Make `queries[].category` required in lookup mode.
- [ ] Add optional `queries[].material`, `queries[].thicknesses`,
  `queries[].specs`, and `queries[].keyword`.
- [ ] Update price repository SQL to query the unified price table, OR multiple
  query objects, require category in each lookup object, optionally filter
  material, match thicknesses / specs / keyword by contains, and return
  all A/B/C/F price columns.
- [ ] Return all tier prices in tool output without `customerTier`,
  `effectiveTier`, or tier-selected `unitPrice` props.
- [ ] Update provider coalescing so batched `search_price_candidates` calls only
  merge compatible lookup queries and never merge category discovery calls with
  price lookup calls.

Task 5 - Add Admin Import Script:

- [ ] Add script for explicit v3 ZIP import using `STEEL_POSTGRES_URL`.
- [ ] Default to dry-run: parse ZIP, print row counts, enum counts, stopped row
  counts, missing-code/name errors, duplicate keys, and planned DB changes.
- [ ] Dry-run must show pre/post cleanup counts for each source normalization
  rule.
- [ ] In apply mode, run one transaction: clear v3-target product-price rows in
  the unified price table, insert v3 rows, and read back counts grouped by
  price kind/category/material/value state.
- [ ] Do not read from `docs/reference` or make runtime depend on local files.

Task 6 - Update Rules and Docs:

- [ ] Update `docs/rules/agent規則.txt` so AI must provide enum `category` for
  price lookup calls whenever category is known.
- [ ] Add rule: if category is unknown, use keyword category discovery first and
  do not hard-guess category.
- [ ] Add rule: category and material must use listed enum values exactly; those
  enum values are the visible strings such as `扁方管` and `OT 黑鐵`, not legacy
  keys or invented aliases.
- [ ] Keep generic tool-contract wording in `agent規則`; put material/category
  examples only where they belong.
- [ ] Update data-contract docs to describe v3 one-row tier prices and source
  `category`.
- [ ] If `agent規則.txt` changes, run Supabase rule sync dry-run, apply, and DB
  readback before completion.

Task 7 - Verification:

- [ ] Focused Jest: parser cleanup, repository query semantics, tool
  schema/registry/execute/sanitize, provider coalescing.
- [ ] `git diff --check`.
- [ ] `npm --workspace packages/api run build`.
- [ ] Supabase migration/apply verification on cloud Steel Postgres.
- [ ] Import dry-run against the provided ZIP.
- [ ] Import apply against cloud DB only after approval.
- [ ] Direct DB readback: total rows, unique product rows, category/material
  counts, tier-price availability counts, sample rows for C型鋼/H型鋼/鐵板.
- [ ] Live or direct tool smoke: `search_price_candidates` rejects missing
  category in lookup mode, category discovery returns candidates, lookup filters
  by multi-condition category/material/spec/thickness/keyword, returns one row
  with all A/B/C/F prices, and uses B as default effective price.

Review:

- Plan created on 2026-06-23 after inspecting the v3 ZIP and current Steel
  price lookup code.
- Awaiting user approval before implementation and before any destructive DB
  clear/import step.

# Previous: Steel Provider-Prepared Full Context Orchestration Plan

> Implementation note: runtime implementation, Supabase rule sync, focused
> regression checks, and direct live OAuth/provider harness smoke have been
> executed task-by-task. Browser Activity visual smoke is the remaining optional
> UI check.

Goal: move Steel OAuth chat from AI-driven rule/memory lookup loops to a
provider-prepared context model. Before `sendSteelOAuthChat`, backend assembles
Agent rules, all reviewed Steel global rules, conditional OCR/file rules, and
full active output sheet data. AI-visible tools are reduced to live external
data needs only. Workbook sheet merging is backend-only: when AI output lacks
one of the four active sheets, backend simply uses that sheet from the previous
active output form.

Architecture:

- `prepareChatContext` remains responsible for conversation history,
  edit/rerun, queued steer, and active-turn boundaries.
- Add `prepareSteelRuntimeContext` before provider invocation. It loads rules
  and full active output sheet state, then serializes that context into the
  provider prompt.
- `sendSteelOAuthChat` becomes provider serialization/execution only. It no
  longer loads DB agent rules, no longer receives `workingMemorySummary`, and
  no longer exposes rule/memory lookup tools to the model.
- Existing Steel rule classifications stay in DB as admin/organization metadata,
  but runtime AI receives the full reviewed global rule set at once instead of
  calling `lookup_quote_rules` by category.
- AI sheet output is sheet-level patch/replace. AI does not need any special
  marker; generated sheets replace the corresponding active sheet, and backend
  uses the previous active sheet only when an entire sheet is missing from AI
  output.
- Runtime naming uses `Output Sheet Memory` and `Runtime Output Sheet Context`
  instead of the older `Working Order Memory` naming, so the concept clearly
  points at the output form/sheets.

Locked Decisions:

- [x] Context assembly happens before `sendSteelOAuthChat`.
- [x] Context includes Agent rules, Steel global rules, output/source-priority
  rules, conditional OCR/file rules, and full active output sheet data.
- [x] Runtime output sheet context is full active output sheet data, not compact
  summary.
- [x] Full active output sheet context includes only four active sheets:
  `system_order`, `customer_data`, `manual_review`, and `customer_quote`.
- [x] OCR rules belong under `otherGlobalRules` and are included only when the
  current turn or active evidence has files requiring OCR/file interpretation.
- [x] `read_working_order_items` is removed from AI-visible runtime tools.
- [x] `lookup_quote_rules` is removed from AI-visible runtime tools.
- [x] All reviewed active DB Steel rules are loaded in one backend context pass;
  category-scoped lookup is not a model tool.
- [x] AI does not need to explicitly mark omitted sheets or output merge
  metadata. Backend uses the previous active version for any active sheet
  missing from AI output. When AI does output a sheet, that sheet is a full
  replacement; prior rows omitted from that emitted sheet are cleared/deleted.
- [x] If AI updates `customer_quote` and the customer price tier changes or
  affects pricing, output rules must require synchronized updates to both
  `system_order` and `customer_quote`. This rule belongs in
  `docs/rules/輸出規則.txt`, synced DB `steel.agent_rules` workbook/output rules,
  and direction checks.
- [x] If customer tier is uncertain, output rules default quote pricing to
  價格B instead of blocking quote generation.
- [x] Any update to `docs/rules/agent規則.txt` or `docs/rules/輸出規則.txt` must
  be followed by Supabase rule sync and DB readback before that task is
  considered complete.

Target Runtime Context Shape:

```ts
interface SteelRuntimeContext {
  conversation: {
    conversationId?: string;
    requestId: string;
    activeHistory: SteelOAuthChatMessage[];
    currentUserTurn?: SteelOAuthChatMessage;
    edit?: {
      editMessageId: string;
      supersededAfterTurnIndex: number;
    };
  };
  rules: {
    agentRules: SteelAgentRule[];
    steelGlobalRules: {
      instructionPackets: SteelInstructionPacket[];
      quoteDefaults: SteelQuoteDefault[];
      quoteRules: SteelQuoteRule[];
      groupedBy: Record<string, string[]>;
    };
    otherGlobalRules: {
      ocrRules?: SteelAgentRule[];
      fileRules: SteelAgentRule[];
      sourcePriorityRules: SteelAgentRule[];
      markdownOutputRules: SteelAgentRule[];
      workbookOutputRules: SteelAgentRule[];
    };
  };
  outputSheets: {
    activeOnly: true;
    conversationId?: string;
    sheetIds: ['system_order', 'customer_data', 'manual_review', 'customer_quote'];
    previousOutputSheets: FullActiveSteelOutputSheets;
    derivedIndex: {
      lineItems: FullOrderLine[];
      customers: FullCustomerFact[];
      adoptedPrices: FullPriceEvidence[];
      calculations: FullCalculationFact[];
      ocrExtracts: FullOcrExtract[];
      unresolvedItems: FullManualReviewItem[];
    };
  };
  attachments: {
    currentTurnFiles: SteelOAuthChatFile[];
    priorActiveFileEvidence: FullOcrExtract[];
    includeOcrRules: boolean;
  };
  toolPolicy: {
    aiVisibleTools: ['search_customers', 'search_price_candidates', 'run_file_ocr'];
    removedTools: ['lookup_quote_rules', 'read_working_order_items'];
  };
}
```

Planned Files:

- Create: `packages/api/src/steel/runtime/context.ts`
- Create: `packages/api/src/steel/runtime/context.spec.ts`
- Modify: `packages/api/src/steel/handlers.ts`
- Modify: `packages/api/src/steel/handlers.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/repositories/instructions.ts`
- Modify: `packages/api/src/steel/repositories/defaults.ts`
- Modify: `packages/api/src/steel/repositories/rules.ts`
- Modify: `packages/api/src/steel/memory/service.ts`
- Modify: `packages/api/src/steel/memory/service.spec.ts`
- Modify: `docs/rules/輸出規則.txt`
- Modify: `docs/rules/agent規則.txt`
- Modify: `docs/rules/鋼材規則.txt`
- Modify: `docs/rules/OCR規則.txt`
- Modify: `packages/api/scripts/sync-steel-rules.cjs`
- Modify: `tmp/chat-round-test/current-direction-check.ts`
- Modify: `CONTEXT.md`
- Create: `docs/adr/0003-provider-prepared-steel-context.md`

No Supabase schema migration is expected for this plan. If implementation
discovers a Steel Postgres schema change is required, update both
`supabase/schema.sql` and a new `supabase/migration/*.sql` file created through
`npx supabase migration new <change_name>`.

## Checkpoint 0 - Plan Approval

- [x] User reviewed this plan and approved scope before implementation.
- [x] AI-visible tools for this slice remain only `search_customers`,
  `search_price_candidates`, and `run_file_ocr`.
- [x] Full active output sheet context includes only the four active sheets:
  `system_order`, `customer_data`, `manual_review`, and `customer_quote`.
  Hidden/internal seven-sheet compatibility sheets are not included in provider
  context for this redesign.

## Task 1 - Add Runtime Context Contract Tests

Files:

- Create: `packages/api/src/steel/runtime/context.spec.ts`
- Create: `packages/api/src/steel/runtime/context.ts`

Steps:

- [x] Add RED test: `prepareSteelRuntimeContext` loads agent rules before
  provider call and returns them in `rules.agentRules`.
- [x] Add RED test: `prepareSteelRuntimeContext` loads all reviewed active
  `steel.instruction_packets`, `steel.quote_defaults`, and `steel.quote_rules`
  without user/category keywords.
- [x] Add RED test: context contains full active output sheet rows, not only
  result counts or entry summaries.
- [x] Add RED test: output sheet context uses the `Output Sheet Memory` /
  `Runtime Output Sheet Context` naming and exposes only the four active output
  sheets.
- [x] Add RED test: OCR rules are absent when there are no current files or
  active file/OCR evidence, and present under `otherGlobalRules` when file
  context exists.
- [x] Add RED test: serialized output rules contain the customer-tier cascade
  requirement: customer tier changes that affect `customer_quote` require
  synchronized `system_order` and `customer_quote` output.
- [x] Add RED test: serialized output rules state uncertain customer tier uses
  價格B by default.
- [x] Add RED test: serialized output rules state emitted sheets overwrite
  previous rows, while wholly omitted sheets carry forward.
- [x] Add RED test: tool policy contains only `search_customers`,
  `search_price_candidates`, and `run_file_ocr`.
- [x] Run:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --runInBand --runTestsByPath`
  Expected: FAIL because the runtime context module does not exist.

## Task 2 - Add Full Reviewed Rule Loaders

Files:

- Modify: `packages/api/src/steel/repositories/instructions.ts`
- Modify: `packages/api/src/steel/repositories/defaults.ts`
- Modify: `packages/api/src/steel/repositories/rules.ts`
- Test: `packages/api/src/steel/runtime/context.spec.ts`

Steps:

- [x] Add repository functions for all reviewed active rule data, for example:
  `listReviewedSteelInstructionPackets`, `listReviewedSteelQuoteDefaults`, and
  `listReviewedSteelQuoteRules`.
- [x] Do not use `keywords`, catalog family, product family, or charge filters
  in these all-rule loaders.
- [x] Avoid the existing `getLimit(..., maxLimit = 100)` truncation problem for
  all-rule context. Either use a no-limit reviewed-active query with stable
  ordering, or introduce a clearly named high backend-only max limit.
- [x] Preserve existing search functions for admin/debug compatibility until
  downstream tests have migrated.
- [x] Run:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --runInBand --runTestsByPath`
  Expected: rule loader tests PASS after implementation.

## Task 3 - Build Full Active Output Sheet Context

Files:

- Modify: `packages/api/src/steel/memory/service.ts`
- Modify: `packages/api/src/steel/memory/service.spec.ts`
- Modify: `packages/api/src/steel/runtime/context.ts`
- Test: `packages/api/src/steel/runtime/context.spec.ts`

Steps:

- [x] Add a backend-only reader path that returns full active Output Sheet
  Memory for a conversation. It must include all active `working_order_row`,
  `customer_fact`, `price_evidence`, `calculation_fact`, `ocr_extract`, and
  unresolved/manual-review records.
- [x] Do not reuse the current compact `formatWorkingOrderMemorySummary` as the
  provider context source.
- [x] Ensure superseded turns and superseded memory are excluded from this full
  active context.
- [x] Define `previousOutputSheets` from active persisted Output Sheet Memory,
  limited to `system_order`, `customer_data`, `manual_review`, and
  `customer_quote`. If only row/evidence memory exists today, build the full
  four-sheet output form from active memory documents with stable sheet IDs.
- [x] Run:
  `cd packages/api && npx jest src/steel/memory/service.spec.ts src/steel/runtime/context.spec.ts --runInBand`
  Expected: PASS with full context and superseded-memory exclusion.

## Task 4 - Implement Output Sheet Patch/Replace Contract

Files:

- Modify: `packages/api/src/steel/memory/service.ts`
- Modify: `packages/api/src/steel/memory/service.spec.ts`
- Modify: `packages/api/src/steel/runtime/context.ts`
- Test: `packages/api/src/steel/runtime/context.spec.ts`

Steps:

- [x] Add type/test fixtures for `FullActiveSteelOutputSheets`, `GeneratedSheet`,
  and backend sheet merge output.
- [x] Add RED test: when AI output contains only `customer_quote`, the next
  active output form keeps previous `system_order`, `customer_data`, and
  `manual_review`.
- [x] Add RED prompt/direction test: when output rules describe a customer tier
  change that affects pricing, AI must be instructed to output updated
  `system_order` and `customer_quote` sheets together.
- [x] Add RED prompt/direction test: when customer tier is uncertain, AI must
  use 價格B instead of stopping the quote.
- [x] Add RED test: an entire sheet not present in AI output does not clear
  that sheet.
- [x] Add RED test: when AI emits a sheet, previous rows omitted from that
  emitted sheet are cleared/deleted because emitted sheets are overwrite
  snapshots, not row merges.
- [x] Implement a simple backend merge helper in the output-sheet context
  layer: for each of the four active sheets, use the generated sheet as a full
  replacement when present; otherwise use the previous active sheet.
- [x] Run:
  `cd packages/api && npx jest src/steel/memory/service.spec.ts src/steel/runtime/context.spec.ts --runInBand`
  Expected: PASS.

## Task 5 - Move Context Assembly Before Provider Call

Files:

- Modify: `packages/api/src/steel/handlers.ts`
- Modify: `packages/api/src/steel/handlers.spec.ts`
- Modify: `packages/api/src/steel/runtime/context.ts`
- Test: `packages/api/src/steel/handlers.spec.ts`

Steps:

- [x] Keep `prepareChatContext` focused on history/edit/rerun/queued steer.
- [x] Call `prepareSteelRuntimeContext` after `prepareChatContext` and before
  `sendChat`.
- [x] Pass the assembled runtime context into provider options.
- [x] Remove `workingMemorySummary` from handler/provider option plumbing.
- [x] Add RED test: `sendChat` receives a `steelRuntimeContext` containing
  full active output sheet data and rule sets.
- [x] Add RED test: edit/rerun still rolls back active history and active
  output sheet context to the correct checkpoint.
- [x] Run:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/runtime/context.spec.ts --runInBand`
  Expected: PASS.

## Task 6 - Simplify Provider Responsibility

Files:

- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`
- Test: `packages/api/src/steel/ai/provider.spec.ts`

Steps:

- [x] Replace provider-side DB agent-rule loading with serialized
  `steelRuntimeContext`.
- [x] Remove `workingMemorySummary` injection from provider prompt assembly.
- [x] Add prompt serialization for:
  - Agent rules.
  - All Steel global rules.
  - Source/output global rules.
  - OCR/file rules only when current turn files or active file evidence exist.
  - Full active output sheet data.
  - Customer-tier cascade output rules.
- [x] Do not serialize workbook merge behavior for the AI. Backend
  missing-sheet carry-forward stays implementation logic.
- [x] Keep provider-side `responsesState: false`.
- [x] Keep true text streaming through `doStream` when available.
- [x] Run:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --runTestsByPath`
  Expected: PASS, and provider tests should not mock DB rule loading inside
  `sendSteelOAuthChat`.

## Task 7 - Remove AI-Visible Rule/Memory Tools

Files:

- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`
- Modify: `packages/api/src/steel/handlers.spec.ts`

Steps:

- [x] Split provider-visible tools from backend/internal helpers if needed.
  Provider-visible tools must be only:
  `search_customers`, `search_price_candidates`, `run_file_ocr`.
- [x] Remove `lookup_quote_rules` from provider-visible tool definitions.
- [x] Remove `read_working_order_items` from provider-visible tool definitions.
- [x] Update tests that currently expect those tools in `getSteelToolDefinitions`.
- [x] If `executeSteelTool` still supports legacy/internal rule reads during
  migration, name that surface clearly and prevent it from reaching provider
  tool serialization.
- [x] Run:
  `cd packages/api && npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand`
  Expected: PASS, with no provider-visible `lookup_quote_rules` or
  `read_working_order_items`.

## Task 8 - Update Agent/Rule Prompt Sources And Sync

Files:

- Modify: `docs/rules/輸出規則.txt`
- Modify: `docs/rules/agent規則.txt`
- Modify: `docs/rules/鋼材規則.txt`
- Modify: `docs/rules/OCR規則.txt`
- Modify: `packages/api/scripts/sync-steel-rules.cjs`
- Modify: `tmp/chat-round-test/current-direction-check.ts`

Steps:

- [x] Add `docs/rules/輸出規則.txt` as the reviewed local source for output
  sheet requirements, including the customer-tier cascade rule: if customer
  tier changes and affects quote pricing, AI must regenerate both
  `system_order` and `customer_quote`.
- [x] Move detailed output requirements out of `docs/rules/agent規則.txt` and
  into `docs/rules/輸出規則.txt`.
- [x] Update `docs/rules/agent規則.txt` visible tool list to remove
  `lookup_quote_rules` and `read_working_order_items`.
- [x] Update `docs/rules/agent規則.txt` to state that reviewed Steel rules and
  full active output sheet data are already present in context.
- [x] Update `docs/rules/鋼材規則.txt` from tool-output wording to global
  context wording.
- [x] Update OCR rule sync/serialization so OCR rules belong to
  `otherGlobalRules` and are included only when the current turn or active
  evidence has file context.
- [x] Update sync script payload so `docs/rules/輸出規則.txt` writes reviewed DB
  `steel.agent_rules` workbook/output rules, with rule sections plus
  selectors/output-policy metadata for `system_order` and `customer_quote`.
- [x] Update sync script payload/tool policy so Supabase `toolPolicy` exposes
  only the remaining AI-visible tools.
- [x] Add a direction/sync guard: if `docs/rules/agent規則.txt` or
  `docs/rules/輸出規則.txt` changes, run Supabase sync dry-run, apply, and DB
  readback in the same implementation slice.
- [x] Add direction check assertions:
  - Provider-visible tools exclude `lookup_quote_rules`.
  - Provider-visible tools exclude `read_working_order_items`.
  - Agent rule text does not instruct AI to call removed tools.
  - Context contract includes full active output sheet data and all reviewed
    rules.
  - OCR rules are conditional on file context.
  - Output rules include the customer-tier cascade requirement for
    `system_order` and `customer_quote`.
- [x] Run:
  `npx tsx tmp/chat-round-test/current-direction-check.ts`
  Expected: PASS.
- [x] After any `agent規則.txt` or `輸出規則.txt` update, run rule sync dry-run
  and apply using the existing project script. Record Supabase DB readback hash
  for both Agent rules and output rules in Review.

## Task 9 - Focused Regression Verification

Commands:

- [x] `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/memory/service.spec.ts --runInBand`
- [x] `npx tsx tmp/chat-round-test/current-direction-check.ts`
- [x] `git diff --check`
- [x] `cd packages/api && npm run build`

Expected:

- Runtime context tests prove rules and full output sheet data are assembled
  before provider execution.
- Provider/tool tests prove removed tools are not provider-visible.
- Memory tests prove sheets not present in AI output carry forward.
- Direction checks prove OCR rules are conditional and customer-tier changes
  require synchronized `system_order` / `customer_quote` output rules.
- Build passes or reports only pre-existing unrelated warnings.

## Task 10 - Manual / Live Smoke After Approval

Only run after focused tests pass and the user confirms live OAuth usage.

- [x] Confirm backend/frontend are not needed for the direct live provider
  harness smoke.
- [x] Run one live provider harness quote follow-up for the `/steel/oauth-chat`
  orchestration path where prior active output form data is available from
  Output Sheet Memory.
- [x] Run one customer-tier change follow-up and confirm AI outputs synchronized
  `system_order` and `customer_quote` sheets instead of only changing
  `customer_quote`.
- [x] Confirm provider/tool event log exposes only provider-visible tools and no
  removed rule/memory lookup tools.
- [x] Confirm final assistant Markdown is saved.
- [x] Confirm Mongo Output Sheet Memory readback keeps active sheet state after
  follow-up turns.
- [x] Record timings with generation/tool split.
- [ ] Browser Activity panel visual smoke was not run in this slice because no
  backend/frontend dev server was running; direct provider event logs covered
  the provider/tool surface.

Review:

- Task 10 completed as a direct live OAuth/provider harness smoke on
  2026-06-22. The harness uses Mongo history/memory, Supabase/Postgres reviewed
  rules, `openai_oauth_responses`, and provider-prepared
  `steelRuntimeContext`; it does not start the browser UI or visually inspect
  Activity.
- Main live smoke conversation:
  `task10_context_smoke_1782133498`; command wrote
  `tmp/chat-round-test/task10-live-summary.json`,
  `tmp/chat-round-test/task10-live-events.jsonl`,
  `tmp/chat-round-test/task10-live-timing.json`, and
  `tmp/chat-round-test/task10-live-timing.md`. Round 1 used two
  `search_price_candidates` calls with `customerTierId = 2`; Round 2 used no
  tools. Both rounds exposed only `search_customers`,
  `search_price_candidates`, and `run_file_ocr`; `badToolCalls` and
  `badProviderTools` were empty.
- Main live timing totals:
  total 356106 ms; provider total 343082 ms; provider generation 338974 ms;
  provider tool execution 4102 ms; harness overhead 13024 ms. This confirms
  latency is dominated by generation/context, not tool execution.
- Customer-tier follow-up reused the same live conversation and wrote
  `tmp/chat-round-test/task10-tier-summary.json`,
  `tmp/chat-round-test/task10-tier-events.jsonl`,
  `tmp/chat-round-test/task10-tier-timing.json`, and
  `tmp/chat-round-test/task10-tier-timing.md`. It called
  `search_price_candidates` once with `customerTierId = 1` and the final answer
  explicitly included both `system_order` and `customer_quote`.
- Customer-tier follow-up timing:
  total 164029 ms; provider total 156705 ms; provider generation 156057 ms;
  provider tool execution 637 ms; harness overhead 7324 ms.
- Final Mongo Output Sheet Memory readback for
  `task10_context_smoke_1782133498`: `system_order` 71 rows,
  `customer_data` 0 rows, `manual_review` 15 rows, and `customer_quote` 23
  rows. Final Markdown capture was partial but saved active rows/facts:
  main Round 1 saved 71 `working_order_row` and 12 `calculation_fact`;
  main Round 2 saved 71 `working_order_row` and 11 `calculation_fact`;
  tier follow-up saved 71 `working_order_row` and 15 `calculation_fact`.
- Live harness was updated to build `prepareSteelRuntimeContext` before
  `sendSteelOAuthChat`, pass full Output Sheet Memory through
  `createMongooseSteelOutputSheetMemoryReader`, and accept
  `CHAT_ROUND1_PATH` / `CHAT_ROUND2_PATH` overrides for focused follow-ups.

## Task 11 - Compact Workbook Context A/B Experiment

Goal: compare current full active workbook context against a compact active
workbook context plus keyword-only row lookup tool, to measure token and latency
reduction without losing quote correctness.

Locked decisions:

- [x] Keep reviewed Agent/Steel/OCR/global rules loaded in context for this
  experiment; only compact active workbook/order data first.
- [x] Add `STEEL_RUNTIME_CONTEXT_MODE=full|compact_workbook` so baseline and
  experiment can be compared with the same live harness prompts.
- [x] In compact mode, provider prompt includes compact active workbook indexes
  and counts, not every full row/cell in `previousOutputSheets`.
- [x] Add provider-visible `read_active_workbook` only for compact mode. AI
  may use it when it suspects compact workbook context is truncated or needs
  exact row/cell data.
- [x] `read_active_workbook` must search by keyword/semantic text only, not
  spreadsheet coordinates or column letters.
- [x] `read_active_workbook` returns matching rows as complete `rowData`, not
  snippets or matched columns only.
- [x] If too many rows match, backend limits row count but still returns
  complete data for each returned row.

Planned files:

- Modify: `packages/api/src/steel/runtime/context.ts`
- Modify: `packages/api/src/steel/runtime/context.spec.ts`
- Modify: `packages/api/src/steel/tools/schemas.ts`
- Modify: `packages/api/src/steel/tools/registry.ts`
- Modify: `packages/api/src/steel/tools/registry.spec.ts`
- Modify: `packages/api/src/steel/tools/execute.ts`
- Modify: `packages/api/src/steel/tools/execute.spec.ts`
- Modify: `packages/api/src/steel/handlers.ts`
- Modify: `packages/api/src/steel/handlers.spec.ts`
- Modify: `packages/api/src/steel/ai/provider.ts`
- Modify: `packages/api/src/steel/ai/provider.spec.ts`
- Modify: `docs/rules/agent規則.txt`
- Modify: `packages/api/scripts/sync-steel-rules.cjs`
- Modify: `tmp/chat-round-test/current-direction-check.ts`
- Modify: `tmp/chat-round-test/live-latency-diagnosis.ts`

Steps:

- [x] Add RED runtime context tests for `mode: compact_workbook`: serialized
  context has compact workbook counts/indexes and omits full
  `previousOutputSheets.*.rows`.
- [x] Add RED tool schema/registry tests: provider-visible tools include
  `read_active_workbook`; schema requires `query`, forbids coordinate-only
  lookup keys, and allows optional `sheetIds`, `limit`, `reason`.
- [x] Add RED execute tests: `read_active_workbook` searches active output
  sheet rows by normalized keyword and returns complete `rowData` for each
  match with `matchedFields`.
- [x] Implement compact context mode and keyword row lookup reader with minimal
  code.
- [x] Thread `STEEL_RUNTIME_CONTEXT_MODE` through handler/provider options and
  live harness summaries.
- [x] Update agent rule source and sync metadata so the AI knows
  `read_active_workbook` is only for compact mode / suspected truncation /
  exact row needs.
- [x] Run Supabase sync dry-run, apply, and direct DB readback if agent rule
  text or toolPolicy changes.
- [x] Run focused Jest for runtime context, tools, provider, handlers, memory.
- [x] Run `current-direction-check.ts`, `git diff --check`, and API build.
- [x] Run live A/B smoke with the same prompts in full and compact modes, then
  record token/time deltas.

Expected comparison metrics:

- Baseline full mode keeps current behavior.
- Compact mode should reduce input tokens by at least 50% and total duration by
  at least 30% in the same live prompt set.
- Customer-tier follow-up must still output synchronized `system_order` and
  `customer_quote`.
- Tool calls must not become excessive; `read_active_workbook` should be used
  only when exact row data is needed.

Review:

- Task 11 started on 2026-06-22 after user approved the compact workbook +
  keyword read tool A/B experiment.
- Task 11 implementation completed on 2026-06-22:
  `STEEL_RUNTIME_CONTEXT_MODE=full|compact_workbook` now controls provider
  runtime context shape; compact mode serializes compact active workbook
  indexes/counts and exposes `read_active_workbook`; full mode keeps the
  existing three provider-visible tools.
- `read_active_workbook` is keyword-only and rejects coordinate/row/column
  lookup requests. Matching rows return full `rowData` plus `matchedFields`,
  `rowId`, `rowIndex`, `sheetId`, and `score`.
- Task 11 Supabase sync/readback:
  `node packages/api/scripts/sync-steel-rules.cjs --dry-run` passed;
  `node packages/api/scripts/sync-steel-rules.cjs --apply` passed; direct DB
  readback confirmed `steel-default-agent-instruction.tool_policy` and
  `steel-workbook-output-policy.tool_policy` include
  `read_active_workbook`.
- Latest DB readback hashes for Task 11:
  `steel-default-agent-instruction` from `docs/rules/agent規則.txt` has SHA
  `36ce9303c444588a0dcce250a1e7efd5babdf4d9a2d0fb54b1b54cc354fee675`;
  `steel-workbook-output-policy` from `docs/rules/輸出規則.txt` remains
  `91ca32b6c85caa81800ffbf7b76af3eb20c39d4a0b305a940ca04bc7428f6f08`;
  `steel-drawing-ocr-policy` from `docs/rules/OCR規則.txt` remains
  `d78cdb27810a2e37be4ea799d536a40dcfdf919bc7e6db8fa968b7d01e18f5dc`;
  Steel quote rules from `docs/rules/鋼材規則.txt` remain
  `1adbb4616f1c24fa22d14a1799b584d9d1c3841efa79d2b5b1fbc5f4a6f0d1a8`.
- Task 11 RED/GREEN verification:
  - RED `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand --runTestsByPath` initially failed because compact context had no `contextMode`, compact provider tools did not include `read_active_workbook`, and the executor returned `ok:false` for the new tool.
  - GREEN same command passed 3 suites / 25 tests.
  - `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand --runTestsByPath` passed 2 suites / 27 tests after wiring the handler/provider mode path.
  - `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/memory/service.spec.ts --runInBand --runTestsByPath` passed 6 suites / 62 tests.
  - `npx tsx tmp/chat-round-test/current-direction-check.ts` passed.
  - `git diff --check` passed.
  - `npm --workspace packages/api run build` exited 0. New Steel TypeScript
    warnings found during the first build were fixed; remaining build warnings
    are pre-existing non-Steel warnings in `src/agents/resources.ts`,
    `src/app/config.ts`, `src/cache/cacheFactory.ts`,
    `src/endpoints/config/*`, `src/middleware/remoteAgentAuth.ts`, and
    `src/middleware/share.ts`.
- Task 11 live full-mode baseline:
  conversation `task11_full_ab_1782135827`, 2 rounds, total 557,673 ms;
  provider generation 540,619 ms; provider tool time 1,835 ms; total input
  tokens 302,497; output tokens 20,754; tool calls were 2
  `search_price_candidates`; final Markdown capture saved 71
  `working_order_row` rows each round.
- Task 11 live compact-mode A/B:
  conversation `task11_compact_ab_1782136398`, 2 rounds, total 330,278 ms;
  provider generation 313,756 ms; provider tool time 3,248 ms; total input
  tokens 289,758; output tokens 13,975; tool calls were 2
  `search_price_candidates`; `read_active_workbook` was exposed but not called;
  final Markdown capture saved 71 `working_order_row` rows each round.
- Compact vs full result: total two-round duration improved by 227,395 ms
  (-40.8%) and provider generation improved by 226,863 ms (-42.0%), so the
  latency target was met. Total input tokens improved only by 12,739 (-4.2%),
  so the overall 50% token target was not met. The useful token reduction
  appeared in round 2: input tokens dropped from 118,953 to 75,181 (-36.8%).
- Round 1 compact mode was faster despite higher input tokens
  (183,544 -> 214,577, +16.9%) because the final response was shorter
  (12,757 -> 7,564 output tokens) and generation ended sooner. Do not attribute
  round-1 speedup solely to workbook compaction.
- Customer-tier follow-up in compact mode:
  same conversation `task11_compact_ab_1782136398`, 1 follow-up round, total
  161,622 ms; provider generation 153,186 ms; provider tool time 553 ms;
  input tokens 180,422; output tokens 7,651; 1 `search_price_candidates` call
  at `customerTierId: 1`; no `read_active_workbook` call. The assistant output
  explicitly updated `system_order` and `customer_quote` for price tier A and
  final Markdown capture saved 71 `working_order_row` rows.
- Task 9 completed on 2026-06-22:
  focused Jest passed 6 suites / 57 tests; `current-direction-check.ts` passed
  all checks; `git diff --check` passed; `npm --workspace packages/api run build`
  exited 0. Build output still reports existing non-Steel Rollup/TypeScript
  warnings in `src/agents/resources.ts`, `src/app/config.ts`,
  `src/cache/cacheFactory.ts`, `src/endpoints/config/*`,
  `src/middleware/remoteAgentAuth.ts`, and `src/middleware/share.ts`.
- Task 7 completed on 2026-06-22: provider-visible Steel tools are now only
  `search_customers`, `search_price_candidates`, and `run_file_ocr`.
  `lookup_quote_rules` and `read_working_order_items` remain only in the
  clearly named internal executable tool registry for legacy/backend execution,
  not in provider tool serialization.
- Task 7 RED/GREEN verification:
  - RED `cd packages/api && npx jest src/steel/tools/registry.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand --runTestsByPath` failed on the old 5-tool provider registry and stream memory-reader binding.
  - GREEN `cd packages/api && npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand --runTestsByPath` passed 4 suites / 39 tests.
  - Regression `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/repositories/instructions.spec.ts src/steel/repositories/defaults.spec.ts src/steel/repositories/rules.spec.ts src/steel/memory/service.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand --runTestsByPath` passed 9 suites / 63 tests.
  - `git diff --check -- packages/api/src/steel/tools/registry.ts packages/api/src/steel/tools/registry.spec.ts packages/api/src/steel/tools/execute.ts packages/api/src/steel/tools/execute.spec.ts packages/api/src/steel/ai/provider.ts packages/api/src/steel/ai/provider.spec.ts packages/api/src/steel/handlers.ts packages/api/src/steel/handlers.spec.ts` passed.
- Checkpoint corrections applied on 2026-06-22:
  `Working Order Memory` naming was replaced in current docs with
  `Output Sheet Memory` / `Runtime Output Sheet Context`; OCR rules are
  conditional `otherGlobalRules`; customer-tier changes that affect
  `customer_quote` now require synchronized `system_order` and
  `customer_quote` output rules.
- Added `docs/rules/輸出規則.txt` as the local reviewed source for the output
  rule.
- Task 8 completed on 2026-06-22: `agent規則.txt` now states rules and full
  active output sheet data are already in runtime context, `鋼材規則.txt`
  is Steel global rules context instead of tool-output wording, OCR rules are
  marked as conditional `otherGlobalRules.ocrRules`, and sync metadata exposes
  only `search_customers`, `search_price_candidates`, and `run_file_ocr` to
  agent/output toolPolicy.
- Task 8 Supabase sync/readback:
  `node packages/api/scripts/sync-steel-rules.cjs --dry-run` passed;
  `node packages/api/scripts/sync-steel-rules.cjs --apply` passed; direct DB
  readback confirmed `steel.agent_rules.tool_policy`, selectors, outputPolicy,
  and sample `steel.quote_rules.selectors`.
- Latest DB readback hashes:
  `steel-default-agent-instruction` from `docs/rules/agent規則.txt` has SHA
  `b05dfd0c4aacac251d2132a9a245dfa4ad6b7f51538ff49d5d10367f15a51832`;
  `steel-workbook-output-policy` from `docs/rules/輸出規則.txt` has SHA
  `91ca32b6c85caa81800ffbf7b76af3eb20c39d4a0b305a940ca04bc7428f6f08`;
  `steel-drawing-ocr-policy` from `docs/rules/OCR規則.txt` has SHA
  `d78cdb27810a2e37be4ea799d536a40dcfdf919bc7e6db8fa968b7d01e18f5dc`;
  `docs/rules/鋼材規則.txt` quote rules have SHA
  `1adbb4616f1c24fa22d14a1799b584d9d1c3841efa79d2b5b1fbc5f4a6f0d1a8`.
- Direct DB readback confirmed `steel-default-agent-instruction.tool_policy`
  contains only the three provider-visible tools; `steel-drawing-ocr-policy`
  selectors include `otherGlobalRulesKey = ocrRules` and
  `includeWhenFileContext = true`; `steel-workbook-output-policy.output_policy`
  contains `emittedSheetBehavior = replace_previous_active_sheet`,
  `omittedRowsInEmittedSheet = clear_or_delete`,
  `defaultCustomerTierWhenUncertain = B`, and synchronized sheets
  `system_order` / `customer_quote`; sample quote rules now apply to
  `steel_global_rules_context`.
- Task 8 verification:
  `npx tsx tmp/chat-round-test/current-direction-check.ts` passed;
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/memory/service.spec.ts --runInBand --runTestsByPath` passed 6 suites / 57 tests;
  `git diff --check -- docs/rules/agent規則.txt docs/rules/鋼材規則.txt docs/rules/OCR規則.txt docs/rules/輸出規則.txt packages/api/scripts/sync-steel-rules.cjs tmp/chat-round-test/current-direction-check.ts packages/api/src/steel/tools/registry.ts packages/api/src/steel/tools/execute.ts packages/api/src/steel/ai/provider.ts packages/api/src/steel/handlers.ts packages/api/src/steel/tools/registry.spec.ts packages/api/src/steel/ai/provider.spec.ts packages/api/src/steel/handlers.spec.ts tasks/todo.md` passed.
- Future edits to either `agent規則.txt` or `輸出規則.txt` must rerun Supabase
  sync dry-run, apply, and direct DB readback in the same slice.
- Runtime implementation started on 2026-06-22:
  `packages/api/src/steel/runtime/context.ts` now defines the provider-prepared
  runtime context contract, the four active output sheet ids, serialized context
  output, conditional OCR rule inclusion, and reduced AI-visible tool policy.
- Added no-limit reviewed-active repository loaders:
  `listReviewedSteelAgentRules`, `listReviewedSteelInstructionPackets`,
  `listReviewedSteelQuoteDefaults`, and `listReviewedSteelQuoteRules`; existing
  search APIs remain available for admin/debug paths.
- Added `createMongooseSteelOutputSheetMemoryReader`, which builds full active
  `system_order`, `customer_data`, `manual_review`, and `customer_quote` sheets
  from active memory documents while excluding superseded memory and avoiding
  compact summary injection.
- TDD evidence:
  `src/steel/runtime/context.spec.ts` first failed because `./context` did not
  exist; repository loader specs first failed because the new loader functions
  did not exist; memory spec first failed because
  `createMongooseSteelOutputSheetMemoryReader` did not exist.
- Verification after implementation:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/repositories/instructions.spec.ts src/steel/repositories/defaults.spec.ts src/steel/repositories/rules.spec.ts src/steel/memory/service.spec.ts --runInBand --runTestsByPath`
  passed 21 tests across 5 suites.
- Task 4 added `resolveNextSteelOutputSheets`: generated sheets fully replace
  their active sheet, wholly missing sheets carry forward from the previous
  active output form, and emitted empty sheets clear only that sheet. Runtime
  context + memory verification passed:
  `cd packages/api && npx jest src/steel/memory/service.spec.ts src/steel/runtime/context.spec.ts --runInBand --runTestsByPath`
  passed 18 tests across 2 suites.
- Task 5 moved runtime context assembly to handler orchestration. `prepareChatContext`
  now stays on history/edit/queued-steer work, `steelRuntimeContext` is passed
  to provider options before execution, and compact `workingMemorySummary`
  injection was removed from handler plumbing. Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/runtime/context.spec.ts --runInBand --runTestsByPath`
  passed 22 tests across 2 suites.
- Task 6 simplified provider responsibility. `sendSteelOAuthChat` now requires
  provider-prepared `steelRuntimeContext` for Steel runtime policy, serializes
  that context as the system instruction, no longer loads DB agent rules inside
  provider code, and ignores the legacy compact `workingMemorySummary` option.
  Verification passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --runTestsByPath`
  passed 11 tests.
- Batch 4-6 combined verification passed:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/memory/service.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts --runInBand --runTestsByPath`
  passed 43 tests across 4 suites.
- Task 1-6 targeted verification passed after including repository loader specs:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/repositories/instructions.spec.ts src/steel/repositories/defaults.spec.ts src/steel/repositories/rules.spec.ts src/steel/memory/service.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts --runInBand --runTestsByPath`
  passed 49 tests across 7 suites.
- Diff hygiene passed for all files touched in Tasks 1-6 with `git diff --check`.
- `npm --workspace packages/api run build` completed with exit 0. Rollup still
  reports existing non-Steel TypeScript warnings in `src/agents/resources.ts`,
  `src/app/config.ts`, `src/cache/cacheFactory.ts`,
  `src/endpoints/config/*`, `src/middleware/remoteAgentAuth.ts`, and
  `src/middleware/share.ts`.

---

# Previous Active: Steel Working Order Memory Plan

Goal: keep Steel OAuth chat on `responsesState: false` while making the Steel
UX behave like Codex: live public thinking/work text, live text streaming,
queued user steering, database-backed chat history, compact working memory, and
read-only memory tools. The memory is backend-owned: assistant final Markdown
and tool/OCR outputs are parsed/saved automatically, and the AI only reads
memory when it needs more detail.

Live retest - multi-round detailed Markdown tables:

- Current slice - Activity parse status visibility:
  - [x] Add a frontend regression test proving `parse_status` shows its parse
    result and saved memory counts in the Activity panel.
  - [x] Implement the minimal Activity rendering change.
  - [x] Run the targeted frontend test and `git diff --check`.

Review:

- `parse_status` now renders its concrete parse result badge
  (`Saved` / `Partial` / `Skipped`) in the Activity panel instead of the generic
  `Updated` badge.
- `parse_status` and `memory_saved` Activity rows now show saved memory counts,
  e.g. `working_order_row: 71, customer_fact: 1`, so the last run makes memory
  auto-save visible without persisting Activity.
- Verification passed:
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --runTestsByPath`;
  `git diff --check`.

- Current slice - complete deferred orchestration simplifications:
  - [x] Add shared `spec_key` normalization utility and migrate provider /
    importer / price repository to it.
  - [x] Add shared Markdown table parser and migrate provider prior-table
    candidate extraction, Working Order Memory final-table capture, and live
    harness table counting to it.
  - [x] Add a conservative default provider tool-loop cap while preserving
    explicit `steelToolMaxCalls` override.
  - [x] Push active-history limit down to repository query instead of fetching
    all active turns and slicing in service.
  - [x] Share request parse/preparation between `chat` and `streamChat` without
    changing request/response contracts.
  - [x] Pass already parsed tool args into `dispatchSteelTool` to avoid schema
    parsing twice.
  - [x] Run focused tests, direction check, build, and `git diff --check`.

Review:

- Added shared normalization and Markdown table helpers under
  `packages/api/src/steel/normalization` and `packages/api/src/steel/markdown`.
  Provider, memory capture, price repository, importer, and live harness now use
  the shared helpers instead of separate local parsers/normalizers.
- Provider tool loops now default to an internal max-call budget when
  `steelToolMaxCalls` is not supplied; explicit overrides still win.
- `executeSteelTool` validates once through the registry and passes parsed args
  into `dispatchSteelTool`, avoiding duplicate schema parses.
- Conversation history window selection now pushes `maxTurns` down to the
  Mongo query and returns prompt-ordered active turns.
- `chat` and `streamChat` now share request parsing and provider base-option
  construction while preserving separate stream event behavior.
- Verification passed:
  `cd packages/api && npx jest src/steel/normalization/spec.spec.ts src/steel/markdown/table.spec.ts src/steel/ai/provider.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/history/service.spec.ts src/steel/history/repository.spec.ts src/steel/memory/service.spec.ts src/steel/repositories/prices.spec.ts src/steel/handlers.spec.ts --runInBand`.
- Direction/build/diff verification passed:
  `npx tsx tmp/chat-round-test/current-direction-check.ts`;
  `git diff --check`;
  `cd packages/api && npm run build`. API build exited 0 and still prints
  existing Rollup TypeScript warnings around endpoint config typing and
  `src/cache/cacheFactory.ts:47` Redis client typing.
- Live table verifier passed after shared parser migration:
  `npx tsx tmp/chat-round-test/verify-live-table-price-evidence.ts` found 20
  active price evidence rows; both active assistant turns had 71-row first
  Markdown tables, exact `項次` / `型號` / `品名規格` columns, and
  `working_order_row: 71` auto-save counts. It reported warnings only for four
  intentional `未確認` rows without active price evidence.
- Follow-up correction: do not import or test against `docs/reference`; those
  files are development viewing/design references only, and Steel quote data is
  database-backed through reviewed DB/Admin flows. The old file-backed
  reference importer and CLI are now disabled instead of trying to read
  `docs/reference` or synthetic document fixtures. Verification:
  `cd packages/api && npx jest src/steel/importer/reference.spec.ts
  src/steel/importer/cli.spec.ts --runInBand`.

- Current slice - simplify Steel orchestration flow:
  - [x] Review Steel OAuth orchestration path for code reuse, code quality, and
    efficiency without changing public API contracts.
  - [x] Apply only local simplifications that reduce duplicated prompt/tool/
    memory orchestration logic. Applied: deleted provider's dead OCR-specific
    instruction branch, passed request-close `abortSignal` into provider calls,
    captured non-stream provider `onToolStatus` OCR results into Working Order
    Memory, and made memory count/find queries concurrent.
  - [x] Keep runtime instruction source on Supabase agent rules only.
  - [x] Run focused provider/handler/tool tests, direction checks, and
    `git diff --check`. Verification:
    `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/memory/service.spec.ts --runInBand`;
    `npx tsx tmp/chat-round-test/current-direction-check.ts`;
    `git diff --check`;
    `cd packages/api && npm run build`.
  - [x] Deferred bigger simplifications: shared spec-key normalization,
    Markdown table parser reuse, request parse helper shared by `chat` /
    `streamChat`, default tool-loop cap, history query limit pushdown, and
    parsed-args handoff inside `executeSteelTool`.

- Current slice - Supabase agent rule as only runtime instruction source:
  - [x] Write a failing provider spec proving Steel system prompt does not
    append provider-owned orchestration text when Supabase agent rules are
    present. Red run:
    `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --runTestsByPath`
    failed because system prompt appended provider static instruction text after
    `DB_AGENT_RULE_SENTINEL`.
  - [x] Remove `steelMinimalOrchestrationInstruction` and any dead constants
    from provider code.
  - [x] Keep `docs/rules/agent規則.txt` as the development/sync source for
    Supabase `steel-default-agent-instruction`.
  - [x] Update direction checks and lessons so future changes do not reintroduce
    duplicated provider agent rules.
  - [x] Run focused provider/direction verification and `git diff --check`.
    Green verification:
    `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --runTestsByPath`;
    `npx tsx tmp/chat-round-test/current-direction-check.ts`;
    `git diff --check`.

- First rerun conversation `debug_table_retest_1781758361` completed two rounds.
  Both rounds had Markdown tables, but neither round satisfied the detailed
  line-item contract: round 1 had 7 tables and round 2 had 6 tables, but the
  complete assistant final text did not contain `RBL1`, `PC12`, or row 71. The
  model produced thickness/price/hole/total summary tables instead of a
  per-item detail table.
- Tightened the contract in `docs/rules/agent規則.txt`,
  `packages/api/src/steel/ai/provider.ts`, and
  `tmp/chat-round-test/live-latency-diagnosis.ts`: for multi-item quote,
  update, or repricing turns, the first final Markdown table must be active
  line-item detail; summary tables cannot replace it.
- Added `tmp/chat-round-test/current-direction-check.ts` coverage for the
  first-table line-item rule. It failed before the rule change and passed after
  the rule/provider/harness update.
- Synced reviewed agent rule to Supabase. Active
  `steel-default-agent-instruction` SHA is
  `3cb560b851319a77fcbb5189d6309e41557c5f6390c2f7aaa467a4c9bc2587a5`.
- Second strict rerun conversation `debug_table_retest_strict_1781758721`:
  round 1 succeeded with 5 Markdown tables. The first two tables use the same
  line-item schema and contain 36 + 35 data rows, covering all 71 items,
  including `RBL1`, `PC12`, and row 71. This validates round 1 detailed table
  behavior after the stricter prompt.
- The strict rerun could not validate round 2 because the provider returned
  `AI_APICallError: The usage limit has been reached` before producing a round
  2 assistant final response.
- Follow-up strict low-effort rerun conversation
  `debug_table_retest_strict_low_1781768818` completed both rounds. Mongo
  readback confirmed round 1 has 3 Markdown tables with the first table holding
  71 line-item rows and containing `RBL1`, `PC12`, and row 71. Round 2 has 4
  Markdown tables with the first table holding 71 line-item rows and containing
  `RBL1`, `PC12`, row 71, `DNB70060`, and `DNB70160`.
- Follow-up table identity verification found the low-effort rerun still failed
  the adopted price identity contract. The first detail tables used alias
  columns such as `ERP code` / `採用型號` and product shorthand such as
  `6.0m/mOT板`, so final Markdown capture saved `working_order_row: 0`; live
  verifier showed `型號` / `品名規格` were not exact canonical columns and
  product names did not copy saved `price_evidence.productName`.
- Tightened the output contract again: the first line-item table must include
  exact `項次`, `型號`, and `品名規格` columns. When adopting a price row,
  `型號` must copy source `erpItemCode` / ERP code and `品名規格` must copy
  source `productName` / product name; user shorthand belongs in
  `原始規格`, `原價格品名`, `來源`, or notes.
- Added `tmp/chat-round-test/verify-live-table-price-evidence.ts`, which reads
  assistant final Markdown and active `price_evidence` from Mongo, parses the
  first line-item table, and verifies `項次` / `型號` / `品名規格`, memory
  auto-save, and price-row `productName` identity.
- Reran live conversation `debug_table_identity_1781776381` after the identity
  rule update. Both rounds saved `working_order_row: 71` and the verifier
  passed, but round 1 still selected `切清` / `四方切` rows because
  `lookup_quote_rules` had returned `ruleCount: 0` in the prior run.
- Added backend lookup keyword expansion for plate-like `lookup_quote_rules`
  inputs. Keywords containing `PL...`, `OT板`, `黑鐵板`, DNB-like plate clues,
  or plate cutting terms expand to `plate`, `ot_plate`, `black_plate`, `板材`,
  and `鐵板`, so reviewed plate rules are retrievable from natural AI query
  text.
- Reran live conversation `debug_table_rules_1781776947` after the rule-lookup
  expansion. Round 1 `lookup_quote_rules` returned `ruleCount: 5` /
  `rule_evidence: 5`; round 1 and round 2 both saved `working_order_row: 71`.
  The first detail table in both rounds used exact `項次`, `型號`, `品名規格`
  columns and copied saved tool `productName` for all adopted price rows.
  Round 1 adopted OT板雷射切割 rows such as `DNB70060`,
  `DNB70140`, `DNB70160`, and `DNB70200`; round 2 updated the same line-item
  table with the user-provided B-tier prices. Both rounds also output an
  `人工複核事項` table for missing 4.0mm price, hole prices, and slot price.
- Added per-round timing reporting to the live harness. Future runs now store
  exact `timingSteps` on each turn and write `timingReport` into
  `live-latency-summary.json`, plus standalone
  `tmp/chat-round-test/live-latency-timing.json` and
  `tmp/chat-round-test/live-latency-timing.md`. The report includes each chat
  round's total wall time, provider total/generation/tool time, provider
  sub-round timing, executed tool-call timing, memory capture timing, final
  Markdown capture timing, memory read timing, and harness overhead.
- Ran the timing report against the latest existing live summary. Current
  totals for `debug_table_rules_1781776947`: round 1 total 163.55s, provider
  156.52s, generation 151.16s, tools 3.56s, harness overhead 7.02s; round 2
  total 141.48s, provider 136.89s, generation 134.34s, tools 0s, harness
  overhead 4.59s.
- Verification passed:
  `npx tsx tmp/chat-round-test/timing-report.spec.ts`;
  `npx tsx tmp/chat-round-test/timing-report.ts`;
  `CHAT_ROUND_DRY_RUN=1 CHAT_ROUND_SUMMARY_PATH=tmp/chat-round-test/dry-run-timing-summary.json CHAT_ROUND_EVENTS_PATH=tmp/chat-round-test/dry-run-timing-events.jsonl CHAT_ROUND_TIMING_JSON_PATH=tmp/chat-round-test/dry-run-timing.json CHAT_ROUND_TIMING_MARKDOWN_PATH=tmp/chat-round-test/dry-run-timing.md npx tsx tmp/chat-round-test/live-latency-diagnosis.ts`;
  `npx tsx tmp/chat-round-test/current-direction-check.ts`;
  `npx tsx tmp/chat-round-test/verify-live-table-price-evidence.ts`;
  `cd packages/api && npx jest src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/tools/registry.spec.ts src/steel/normalization/search.spec.ts src/steel/ai/provider.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/tools/registry.spec.ts src/steel/normalization/search.spec.ts src/steel/ai/provider.spec.ts src/steel/memory/service.spec.ts --runInBand`;
  live `lookup_quote_rules` Supabase smoke for `PL6×80` / `6.0m/mOT板`;
  strict live harness with `STEEL_OPENAI_REASONING_EFFORT=low
  CHAT_ROUND_CONVERSATION_ID=debug_table_rules_1781776947 CHAT_ROUND_LIMIT=2
  CHAT_ROUND_TIMEOUT_MS=720000 npx tsx
  tmp/chat-round-test/live-latency-diagnosis.ts`;
  strict live harness with `STEEL_OPENAI_REASONING_EFFORT=low
  CHAT_ROUND_CONVERSATION_ID=debug_table_retest_strict_low_1781768818
  CHAT_ROUND_LIMIT=2 CHAT_ROUND_TIMEOUT_MS=720000 npx tsx
  tmp/chat-round-test/live-latency-diagnosis.ts`; Mongo readback table-row
  verifier; `git diff --check`.

Design decisions:

- Do not restore old Workbook/File Analysis persistence, right-panel UI, REST
  routes, or cell patch workflow.
- Do not add an AI-visible save tool. There is no `save_working_order_items`;
  backend auto-parses and saves after the assistant final response.
- Add only read-side memory access for the AI, initially
  `read_working_order_items`, so follow-up turns can fetch prior rows by item
  number, ERP code, spec/product text, file/page, or paginated table slices.
- Keep OpenAI/OAuth provider stateless: no `previous_response_id`, no
  `responsesState: true`.
- Preserve prompt cache: static system/rule/tool instructions stay first;
  dynamic working memory is injected after static instructions and before
  visible chat history.
- Working memory is scoped to `conversationId`. It is not a Supabase price cache
  and does not short-circuit tool execution by itself.
- Persist full structured memory server-side, but inject only a compact summary
  plus relevant rows into the prompt. A 100-line order should not force a 100
  row prompt dump.
- Markdown parsing is best-effort and non-blocking. Backend should never ask the
  AI to retry only because a final Markdown table did not match canonical
  headers; save whatever can be identified and let the user-visible reply
  complete.
- Stream public thinking text/activity like Codex while the turn is running.
  This means user-visible work summaries, tool call start/result/error events,
  memory read/save events, OCR progress, and lookup summaries. Do not expose
  hidden chain-of-thought; only expose safe public reasoning summaries and
  operational events.
- Use provider `doStream` for true live text/reasoning delta streaming when the
  OAuth provider exposes it. The current `doGenerate` path is acceptable only as
  a fallback because it buffers text until the generation finishes.
- Support queued user steer while a turn is running. Steering should not require
  aborting by default; backend applies queued user input at the next safe
  orchestration boundary.
- Persist chat history in the database by `conversationId`. Browser-local
  `messages` are not enough because refresh/navigation loses them and the
  backend cannot build a reliable history window from URL state alone.
- Match Codex message edit behavior: editing a user message overwrites the
  visible message content and prompt input for that message. Do not create a
  user-visible branch or follow-up turn just because a message was edited.
- When a user edits an earlier message, mark all later user/assistant turns as
  superseded for the active transcript and prompt history. Rebuild from the
  edited message and generate a new assistant response after it.
- Editing and rerunning a user message must also roll Working Order Memory back
  to the checkpoint before that user message. Memory entries produced by later
  superseded turns are excluded from active memory summary and read tools so old
  tables/prices/OCR interpretation cannot pollute the rerun.
- If a queued steer exists when a user edits/reruns an earlier message, queued
  steers tied to the superseded run or superseded later turns are marked
  superseded/canceled and are not applied to the edited rerun. The user can
  submit a new steer against the new active run.

Markdown contracts:

- The system-order Markdown table follows
  `docs/reference/系統訂單.xlsx` sheet `老公公轉出`.
- Canonical system-order columns:
  `公司編號`, `項次`, `倉庫編號`, `型號`, `品名規格`, `材質編號`, `廠別編號`,
  `單位`, `數量`, `單重`, `總數`, `單價`, `計價基準`, `公式編號`, `厚度`,
  `寬度`, `長度`, `類別`, `交貨日期`, `備註`.
- `型號` and `品名規格` should preserve the adopted product-price identity,
  matching price data fields such as `erpItemCode`, `productName`, and
  `specKey` when a price row was selected.
- `計價基準` records the adopted customer price tier context used for pricing
  (`customerTierId` / tier code / tier display value, according to available
  source data), not an unreliable unit/category filter.
- Customer data is first-class working memory. Store compact customer facts from
  `search_customers` and assistant Markdown, including customer id/code, display
  name, selected tier, candidate tiers, contact/address fields if present, and
  source refs.
- OCR has no fixed table schema. The AI decides how to interpret OCR content;
  backend saves all sanitized OCR text/table blocks with source metadata:
  upload/file id, filename, media type, image index when relevant, page number
  for PDFs, and OCR provider.

Architecture:

- Add a small Steel conversation-memory layer in Mongo/data-schemas. This is a
  working-memory store, not a workbook/file-analysis state module and not a UI
  preview data source.
- Add a Steel conversation-history layer in Mongo/data-schemas for canonical
  chat turns. This persists user messages, assistant final summary text/
  Markdown, attachments/source refs, queued steer messages, and final response
  metadata by `conversationId`. Thinking/tool/activity events are not persisted;
  they exist only as browser last-run UI state.
- Store memory entries by `conversationId`, `requestId`, `turnIndex`,
  `memoryKind`, `sourceKind`, timestamps, source refs, active/superseded state,
  compact summary, and bounded sanitized payload.
- Maintain memory checkpoints at chat-turn boundaries so message edit/rerun can
  restore the active Working Order Memory to the state before the edited user
  message. This is a logical rollback: old entries may remain for trace, but
  active summary and `read_working_order_items` exclude superseded memory.
- Memory kinds:
  - `working_order_row`: parsed system-order rows from assistant Markdown.
  - `customer_fact`: selected/candidate customer information and tier context.
  - `price_evidence`: selected price rows and candidate rows from
    `search_price_candidates`.
  - `rule_evidence`: useful quote rule summaries from `lookup_quote_rules`.
  - `ocr_extract`: all sanitized OCR text/table blocks from `run_file_ocr`.
  - `calculation_fact`: totals, formulas, assumptions, and manual-review flags
    adopted by the assistant final answer.
- Source kinds:
  - `assistant_final_markdown`
  - `tool_result`
  - `ocr_result`
  - `user_input`
- Final Markdown parse policy:
  1. If a final answer contains a full system-order table with canonical
     headers, replace the active working-order snapshot for that conversation.
  2. If a final answer contains a row-change table with `項次` plus changed
     fields, merge those rows into the active snapshot.
  3. If a table has recognizable aliases such as item/code/name/spec/quantity/
     total headers, normalize the recognized fields into partial memory facts
     and mark the table `partial`.
  4. If a table cannot be classified safely, save it as an unclassified
     Markdown/OCR evidence block and do not mutate the active order snapshot.
  5. Parsing failure is recorded as `memory_parse_skipped` or
     `memory_parse_partial`; it is not an AI retry trigger.
- Tool/OCR capture policy:
  1. After each `search_customers`, save compact customer candidates and the
     unique/adopted tier if available.
  2. After each `search_price_candidates`, save selected/candidate price rows
     with `customerTierId`, `erpItemCode`, `productName`, `specKey`, `unitPrice`,
     and source refs.
  3. After each `run_file_ocr`, save every sanitized page/image block; do not
     require fixed OCR columns.

History policy:

- The backend owns canonical history. On every request with `conversationId`,
  load persisted chat turns from the database, merge the new user input, and
  persist the new user turn before provider execution.
- Frontend-supplied `messages` remain accepted for backward compatibility and
  new/unsaved turns, but they are not the only source of truth.
- Prompt construction order:
  1. static system instructions, rules, and tool definitions
  2. compact working memory summary
  3. selected persisted chat history window
  4. current user input and current attachments
- The history window should be token-budgeted and relevance-aware. Keep recent
  turns, user corrections, final assistant Markdown summaries, and explicit
  decisions; avoid stuffing every large Markdown table when structured memory
  already stores those rows.
- Assistant Markdown remains in chat history as user-visible record and fallback
  evidence. Working memory is the structured index used for precise row/code/
  query reads.
- Persist message ids, content/table hashes, and user-message revision metadata
  so backend does not parse/save the same assistant Markdown table repeatedly
  and can rebuild prompt context from the latest edited user text.
- History-window selection must exclude superseded turns by default. Superseded
  turns may remain in the database for trace/idempotency, but they are not part
  of active prompt context or active chat replay.
- Working-memory summary selection must use the same active boundary as
  conversation history. After edit/rerun, memory generated by superseded later
  turns is not injected and is not returned by default memory reads.

Codex-like message UX policy:

- The chat transcript shows only user messages and the assistant's final
  summary/quote text. It must not embed public thinking, tool logs, OCR logs,
  memory events, raw tool output, or hidden reasoning inside chat bubbles.
- During a running turn, visible assistant answer text streams into the
  in-progress assistant message. Public thinking/status/tool activity streams
  only into the Thinking/Activity tab.
- After the turn finishes, the assistant chat message contains only the final
  normalized answer text/Markdown. The Thinking/Activity tab keeps the last run
  activity trace separately.
- The Thinking/Activity tab is last-run scoped. Loading or scrolling older chat
  history should not replay old thinking/tool logs as chat content.
- Persisted conversation history stores final message text and source/attachment
  refs. It does not store thinking/tool/OCR/memory/parse activity events.

Chat editing/copy policy:

- Markdown tables in assistant messages must be selectable and copyable like
  ChatGPT. Provide a table-level copy action that copies Markdown source, not
  only rendered cell text.
- Assistant responses need a copy action that copies the final response
  Markdown/text without Thinking/Activity events.
- User messages need edit behavior like Codex: editing a prior user message
  overwrites the visible message text and reruns from that edited message as
  the current prompt source.
- After a user message edit, all later messages in that active conversation
  tail are marked superseded and removed from active replay/prompt selection.
  The edited message becomes the latest active prompt boundary, then the new
  assistant response is generated after it.
- Working Order Memory is rolled back to the checkpoint before the edited user
  message before rerun starts. Superseded rows/customer facts/price evidence/OCR
  extracts/calculation facts remain traceable but are not active memory.
- Edited user messages must rebuild prompt context from persisted history,
  working memory summary, and the latest edited message text; they must not
  depend on browser-local message state.
- If backend keeps old message text for audit/idempotency, it is hidden
  revision metadata, not a visible conversation branch and not prompt input.

Provider flow:

1. Handler resolves `conversationId`.
2. Persist the current user turn to conversation history.
3. Emit public activity: loading persisted history and working memory.
4. Load selected chat history and compact memory summary for that conversation.
5. Compose prompt as static instructions/rules/tools, then `Steel working
   memory`, then selected persisted chat history, then current user input.
6. AI answers through `doStream` when available. Public reasoning/status deltas,
   text deltas, tool-call deltas, and backend activity events are streamed as
   they happen. It does not call a memory save tool.
7. If the user asks "第 12 項", "CCG075", "75x45 那支", or "沿用整張表重新總計",
   AI calls `read_working_order_items` with explicit read arguments.
8. Backend executes normal tools and read-only memory tools, emitting public
   events for tool call, arguments summary, row/result counts, source refs, and
   errors.
9. If queued user steer exists, apply it before the next provider round when a
   tool round completes or when the current provider generation returns tool
   calls. If visible final answer text has started streaming, do not mutate the
   in-progress assistant message; persist the steer as the next user turn and
   immediately start/facilitate a follow-up request after the current turn
   finishes.
10. After tool calls, backend auto-saves compact tool/OCR evidence and emits
   public `memory_saved` counts.
11. After the final assistant response, persist the assistant turn, then backend
   auto-parses Markdown tables as a
   post-response capture step and updates working-order/customer/calculation
   memory when confidence is sufficient. Parse misses do not block the response
   or start another AI round.

Public thinking/activity stream:

- The chat UI should show a public, synchronous work log similar to Codex:
  short reasoning summaries, tool calls, OCR progress, customer lookup, price
  lookup, memory reads, memory saves, parse status, and finalization.
- Text output should stream as deltas into the visible assistant message, not
  only appear after the provider finishes. The final assistant message persisted
  to DB is the concatenation of streamed deltas plus any final normalized text.
- Reasoning output should stream only when it is provider-supplied public
  reasoning summary/status text. Hidden chain-of-thought must stay hidden.
- Public thinking/status/tool events are not appended to assistant message
  content. They are rendered only in the Thinking/Activity tab for the latest
  run.
- Thinking/Activity events are not stored in database history. Refreshing the
  page may restore final chat messages and Working Order Memory, but not old
  last-run activity.
- Event payloads should be safe and compact. Show tool name, status, sanitized
  argument summary, row counts, page/file refs, selected tier, selected price
  count, and elapsed time. Do not stream raw database rows, raw OCR payloads, or
  hidden chain-of-thought.
- Required event kinds:
  - `thinking`: public reasoning/status text.
  - `tool_call`: tool name and sanitized arguments summary.
  - `tool_result`: result count and source refs.
  - `tool_error`: safe error summary.
  - `memory_loaded`: injected summary counts.
  - `memory_read`: read query and result count.
  - `memory_saved`: saved memory counts by kind.
  - `ocr_progress`: file/page/image progress.
  - `parse_status`: Markdown parse saved/partial/skipped.
  - `text_delta`: assistant visible text delta.
  - `steer_queued`: user steer accepted while a turn is running.
  - `steer_applied`: queued steer inserted into a provider round.
  - `steer_deferred`: queued steer will run as a follow-up turn.
  - `steer_superseded`: queued steer was canceled because message edit/rerun
    superseded its target run or context.
- Tool visibility examples:
  - `search_customers`: keyword summary, candidate count, selected tier if any.
  - `search_price_candidates`: candidate query count, tier used, returned row
    count, selected/adopted row count if known.
  - `run_file_ocr`: filename, page/image progress, extracted block count.
  - `read_working_order_items`: lookup type, matched row count, whether summary
    or paginated rows were returned.

Queued steer policy:

- While `isSending` is true, the input box should allow a steer message instead
  of only disabling send. The UI labels this as steering the current run.
- A steer is persisted as a user message with `source=queued_steer`, timestamp,
  and target in-flight request id.
- Backend applies queued steer only at safe boundaries:
  - before the next provider round after tool results are appended
  - before a provider round that follows memory/tool reads
  - as an immediate follow-up turn if final answer text has already started
    streaming
- A queued steer does not rewrite or interrupt the current final assistant
  message once `text_delta` has begun. This matches Codex-like UX: the current
  answer finishes, then the steer becomes the next turn.
- Multiple queued steers should preserve order. If the user edits/replaces a
  steer before it is applied, store a supersession record instead of silently
  losing the earlier text.
- If the user edits a prior chat message while one or more steers are queued,
  queued steers targeting the now-superseded run/context are marked superseded
  or canceled. They are excluded from the edited rerun and from active prompt
  history; they remain hidden trace metadata only if retained.
- A rerun created by message edit starts with no inherited queued steer unless
  the user submits a new steer after the rerun starts.
- Activity must show whether steer was queued, applied in-run, deferred to a
  follow-up, superseded by edit/rerun, or rejected because the request already
  closed.

AI-visible memory behavior:

- Initial prompt injection should fit about 1000-1200 tokens:
  current customer/tier, order row count, totals, unresolved items, last updated
  time, and a small set of high-relevance rows.
- The prompt tells AI to use `read_working_order_items` when it needs details
  not present in the compact summary.
- `read_working_order_items` supports:
  - `summary`: row count, totals, current customer/tier, unresolved items.
  - `rowNo`: exact `項次` / row number lookup.
  - `erpItemCode`: exact `型號` / ERP code lookup.
  - `query`: contains search over `品名規格`, `specKey`, product name, and notes.
  - `source`: OCR/file lookup by filename, image index, and page.
  - `page`: paginated row slices for large orders.
- For "沿用整張表重新總計", backend may read all rows internally for summary or
  calculation support, but the AI receives only the summary, changed rows, and
  unresolved rows unless it explicitly pages through more.
- Explicit refresh wording such as `重新查`, `重新 OCR`, `重新計算`, or conflicting
  user data keeps normal tools available; working memory is context, not a hard
  cache.

Implementation tasks:

Ad-hoc verification - live detailed quote response retest:

- [x] Run a fresh two-round live chat harness after the detailed table/tool
      rule sync.
- [x] Verify from events that AI actually called price lookup tools.
- [x] Verify from full assistant text that it outputs Markdown tables and an
      explicit manual-review list.
- [x] Record the result and gaps.

Review:

- Ran fresh live harness with conversation
  `debug_detail_retest_1781757105`.
- Round 1 called `lookup_quote_rules` and `search_price_candidates`, but the
  price lookup returned `priceCandidateCount: 0` for exact strings such as
  `6.0m/mOT板`, `16.0m/mOT板`, and hole-processing queries. This means the AI
  did try to查價, but did not successfully adopt reviewed price rows in round 1.
- Round 1 output 4 Markdown tables. The first table had 71 item rows with
  columns for page, part number, OT price name, spec, quantity, holes, material
  unit price, hole unit price, subtotal, and confidence/notes. Prices remained
  `未確認`.
- Round 1 included an explicit manual confirmation table headed
  `目前需人工確認` with 4 rows.
- Round 2 did not call tools; it used the user's supplied price table from the
  prompt. It output 5 Markdown tables, adopted DNB rows for 6/10/12/14/16/20mm,
  and listed manual review rows for 4.0mm and hole-processing prices. It still
  did not emit a regenerated 71-row priced detail table after applying the
  supplied prices.
- Follow-up fix: `search_price_candidates` now normalizes every
  `candidateQueries` keyword to the same `spec_key` format used by imported
  `steel.price_items.spec_key` before contains search. This makes
  `6.0m/mOT板` search as `6.0m_mOT板`, so it can match live rows such as
  `DNB70060_6.0m_mOT板雷射切割`.
- Verification: focused Jest for price repository, tool execution, registry,
  normalization, and provider specs passed; live `executeSteelTool` probe for
  `candidateQueries: ['6.0m/mOT板']`, `customerTierId: 2` returned 7 candidates
  and included B-tier `DNB70060` at 38.5; `git diff --check` passed.
- Verification evidence:
  `CHAT_ROUND_CONVERSATION_ID=debug_detail_retest_1781757105 CHAT_ROUND_LIMIT=2 CHAT_ROUND_TIMEOUT_MS=720000 npx tsx tmp/chat-round-test/live-latency-diagnosis.ts`;
  Mongo readback of assistant turns confirmed round 1 `itemRows: 71`,
  round 1 `markdownTables: 4`, round 2 `markdownTables: 5`, and both turns
  contained manual-review / unconfirmed sections.

Ad-hoc implementation - detailed quote Markdown agent rule:

- [x] Add a general Agent Instruction rule that multi-item quote answers must
      include detailed per-item Markdown rows, not only grouped summaries.
- [x] Remove conflicting minimal-provider wording that biases final quote
      output toward concise summaries.
- [x] Add `read_working_order_items` to the Agent Instruction visible tool list
      and Supabase sync `toolPolicy.availableTools`.
- [x] Sync reviewed Supabase Steel rules and verify readback / focused checks.

Review:

- Updated `docs/rules/agent規則.txt` so multi-item quote answers must begin with
  detailed per-item Markdown rows; grouped thickness/category/price-name
  summaries can only be follow-up summary tables.
- Added `read_working_order_items` to the visible Agent Instruction tool list
  and to `packages/api/scripts/sync-steel-rules.cjs` `toolPolicy.availableTools`.
  The rule now describes it as read-only Working Order Memory access; there is
  still no save tool.
- Updated the provider fallback wording from concise Markdown tables to
  detailed Markdown tables, and extended the local direction check so future
  rule sync cannot omit the memory read tool while registry/provider expose it.
- Verification passed:
  `npx tsx tmp/chat-round-test/current-direction-check.ts`;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand`;
  `node packages/api/scripts/sync-steel-rules.cjs --dry-run`;
  `node packages/api/scripts/sync-steel-rules.cjs --apply`;
  direct DB readback confirmed prompt contains `read_working_order_items` and
  `逐項 Markdown 明細表`, with `tool_policy.availableTools` including
  `read_working_order_items`.

Ad-hoc verification - `tmp/chat-round-test` direction check:

- [x] Add a local `tmp/chat-round-test` direction-check harness for the current
      Working Order Memory / Markdown-table plan, because the older
      `live-latency-diagnosis.ts` harness still targets removed workbook patch
      behavior.
- [x] Run the harness and focused Steel tests to verify implementation direction
      and Markdown table output evidence.
- [x] Record the result and any remaining gap for manual testing.

Review:

- Added `tmp/chat-round-test/current-direction-check.ts`, which writes
  `tmp/chat-round-test/current-direction-check.json` and
  `tmp/chat-round-test/current-direction-check.md`.
- Direction check result: 12 pass, 0 fail, 1 warn. The warning is intentional:
  the older `tmp/chat-round-test/live-latency-diagnosis.ts` still references
  legacy workbook harness tokens (`createSteelWorkbookService`,
  `workbookContextText`, `workbookPatchTool`), so it is not the correct current
  Working Order Memory / Markdown-table verification entrypoint.
- The check confirms the current implementation direction is present:
  `responsesState: false`, read-only `read_working_order_items`, no
  implementation `save_working_order_items`, DB-backed history wiring, active
  Working Order Memory summary injection, automatic final Markdown/tool/OCR
  capture, browser request contract without workbook ids, and frontend
  Markdown table render/copy/edit behavior.
- The generated Markdown report includes a sample final Markdown table output.
- Verification passed:
  `npx tsx tmp/chat-round-test/current-direction-check.ts`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/memory/service.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts --runInBand`.

Ad-hoc implementation - migrate `tmp/chat-round-test/live-latency-diagnosis.ts`:

- [x] Add a RED direction gate proving the live harness still used the legacy
      workbook path before migration.
- [x] Rewrite `live-latency-diagnosis.ts` as a Working Order Memory live
      harness.
- [x] Verify the harness in dry-run mode and re-run focused Steel tests.

Review:

- Replaced the old live latency harness with a Working Order Memory harness
  while keeping the same entrypoint and output files:
  `tmp/chat-round-test/live-latency-diagnosis.ts`,
  `tmp/chat-round-test/live-latency-summary.json`, and
  `tmp/chat-round-test/live-latency-events.jsonl`.
- The new harness simulates the current backend flow directly: it appends user
  turns to Mongo-backed conversation history, loads active Working Order Memory
  into `workingMemorySummary`, executes business tools with a
  conversation-scoped `read_working_order_items` reader, captures successful
  tool/OCR results into memory, appends the assistant final turn, and runs
  `captureAssistantFinalMarkdown`.
- Activity remains local JSONL only for the harness; no activity/tool log is
  persisted as Steel conversation history.
- The harness supports `CHAT_ROUND_DRY_RUN=1` for fast contract checks and live
  mode for real OAuth/provider runs. Useful live command:
  `CHAT_ROUND_LIMIT=1 CHAT_ROUND_TIMEOUT_MS=720000 npx tsx tmp/chat-round-test/live-latency-diagnosis.ts`.
- Verification passed:
  `CHAT_ROUND_DRY_RUN=1 npx tsx tmp/chat-round-test/live-latency-diagnosis.ts`;
  `npx tsx tmp/chat-round-test/current-direction-check.ts`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/memory/service.spec.ts src/steel/history/service.spec.ts src/steel/history/repository.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand`;
  `git diff --check`.

Ad-hoc verification - real handler Markdown autosave smoke:

- [x] Add a handler smoke test using real Mongo-backed Steel conversation
      history and Working Order Memory services.
- [x] Verify the smoke directly reads Working Order Memory after the handler
      returns a final Markdown table.
- [x] Run focused handler/memory verification and record evidence.

Review:

- Added a real stream-handler smoke in `packages/api/src/steel/handlers.spec.ts`
  that uses `MongoMemoryServer`, Mongo-backed Steel conversation history, and
  the real Working Order Memory writer/reader.
- The smoke stubs only the provider final response, then verifies the handler
  emits `parse_status: saved` / `memory_saved` and directly reads the saved
  normalized row from Working Order Memory: `rowNo`, `erpItemCode`,
  `productName`, `quantity`, and `unitPrice`.
- Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/memory/service.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/history/service.spec.ts src/steel/history/repository.spec.ts src/steel/memory/service.spec.ts --runInBand`;
  `git diff --check`.

Completion slice order:

- [x] Finish Steel conversation-turn metadata and idempotent history behavior.
- [x] Finish Working Order Memory capture for tool/OCR outputs with bounded
      payloads and source refs.
- [x] Finish streaming provider tool-loop regression coverage.
- [x] Finish queued steer persistence/apply/defer behavior across backend and
      frontend.
- [x] Finish Codex-style copy/edit chat UI behavior.
- [x] Run focused verification and document user test steps.

- [x] Current slice: add RED handler/provider coverage for DB-backed history,
      active Working Order Memory prompt injection, and memory-reader tool
      binding.
- [x] Current slice: wire Steel chat handlers so `conversationId` requests
      persist/load active DB turns, inject compact active memory, and avoid
      relying only on browser-local `messages`.
- [x] Current slice: bind `createMongooseSteelWorkingOrderMemoryReader` into
      default Steel stream tool execution by `conversationId`.
- [x] Current slice: run focused verification and record evidence before moving
      to final Markdown parser/auto-save.
- [ ] Add RED data-schemas tests for persisted Steel conversation history:
      user turns, assistant final-summary turns, queued steer messages,
      attachment refs, table hashes, final response metadata, user-message
      revision metadata, superseded-turn metadata, latest-visible content
      semantics, and indexes by `{ conversationId, createdAt }`.
- [x] Add RED history-window tests proving backend loads DB history by
      `conversationId`, merges the current user turn, and builds prompt order as
      static instructions -> working memory summary -> selected persisted chat
      history -> current input.
- [x] Add RED message-edit tests proving editing an earlier user message updates
      that message's visible text, marks later turns superseded, excludes those
      turns from prompt/history-window selection, and reruns from the edited
      message.
- [x] Add RED parser tests for final assistant Markdown:
      full system-order table, row-change table, customer-info table,
      alias/partial table, unclassified table, malformed table, and no-retry
      parse-miss behavior.
- [ ] Add RED memory repository tests for conversation-scoped entries, active
      working-order snapshot replacement, row merge by `項次`, and bounded OCR
      payload storage with file/page/image refs.
- [x] Add RED memory rollback tests proving edit/rerun restores the active
      memory checkpoint before the edited user message and excludes memory from
      superseded later turns in summaries and `read_working_order_items`.
- [x] Add data-schemas types and Mongo model/indexes for the lightweight Steel
      conversation-memory store.
- [x] Add data-schemas types and Mongo model/indexes for Steel chat history,
      user-message revisions, and queued steer records.
- [x] Do not add run-scoped activity persistence. Keep Thinking/Activity events
      in client state only and exclude them from conversation-history schemas.
- [ ] Implement Steel conversation-history repository/service with append,
      idempotent message persistence, table/content hash dedupe, and
      token-budgeted history-window selection. Message edit must update the
      latest visible user content used by history-window selection without
      exposing a branch in the chat UI; later turns must be marked superseded
      and excluded from active prompt/replay.
- [x] Implement Markdown table parsing in `packages/api/src/steel/memory/`
      without depending on old workbook/file-analysis modules.
- [ ] Implement memory repository/service with append, snapshot replace/merge,
      summary build, relevance search, paginated row reads, turn-boundary
      checkpoints, and logical rollback/exclusion for superseded memory.
- [x] Add read-only `read_working_order_items` tool and prove no
      `save_working_order_items` tool is registered or exposed.
- [x] Wire memory summary loading in Steel handlers before provider prompt
      construction, using the active conversation boundary after message edits.
- [x] Wire persisted history loading/saving in Steel handlers so the backend no
      longer depends only on browser-local `messages`.
- [x] Wire prompt order tests proving static system/rules/tools come before
      working memory, and working memory comes before chat history.
- [x] Replace the primary Steel provider stream path with OAuth `doStream`
      support: emit live `text_delta`, safe public reasoning deltas, tool-call
      deltas, finish metadata, and aggregate the final assistant text for DB
      persistence. Keep `doGenerate` as fallback.
- [x] Add provider tests proving tool-result orchestration still calls a new
      provider round after tool execution while streaming text/reasoning events
      in order.
- [x] Wire automatic tool/OCR evidence capture around business tool execution.
- [x] Wire automatic final Markdown parse/save after the assistant response.
- [x] Wire final Markdown parse as best-effort post-processing: bounded time,
      no provider retry, no user-visible failure when parsing is skipped or
      partial.
- [ ] Add public activity streaming tests proving tool calls, tool results,
      memory read/save, OCR progress, parse status, and safe thinking summaries
      are emitted in order while the turn is running.
- [x] Add queued steer tests: UI accepts steer while sending, backend persists
      it, applies it at the next safe provider boundary, emits
      `steer_queued`/`steer_applied`, and defers to a follow-up turn when final
      text already completed.
- [ ] Add queued-steer/edit collision tests proving queued steers tied to a
      superseded run are marked superseded/canceled, excluded from the edited
      rerun prompt, and surfaced only as last-run Activity state while the
      collision is happening.

## Current Slice Review - 2026-06-18

- Implemented `conversationId`-scoped prompt preparation in Steel handlers:
  active DB history is loaded, the current user turn is persisted, compact
  active Working Order Memory is injected, and stale browser-local prior
  messages are not used as the only prompt source.
- Added provider prompt-order coverage proving static system/rules stay first,
  Working Order Memory is inserted next, then active DB history, then the
  current user input.
- Bound the default stream tool executor to a conversation-scoped
  `read_working_order_items` memory reader, with memory-only reads avoiding the
  Postgres lookup client path.
- Added best-effort final assistant Markdown capture for recognizable
  `項次`/`型號`/`品名規格` tables. Captured rows replace the active
  `working_order_row` snapshot while older active rows become superseded trace.
- Verification passed:
  `npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/history/service.spec.ts src/steel/history/repository.spec.ts src/steel/memory/service.spec.ts --runInBand`;
  `git diff --check`; `npm --workspace packages/api run build`.
- Build still reports the known existing Redis `KeyvRedis` TypeScript warning
  at `packages/api/src/cache/cacheFactory.ts:47`, but exits 0.

- [x] Update Steel chat UI Activity/work log so public thinking text and tool
      activity render synchronously, with sanitized details and elapsed time.
- [x] Update Steel chat UI so visible assistant text streams incrementally and
      the input can submit queued steer while a request is running.
- [ ] Add UI tests proving final chat messages contain only final summary/
      quote Markdown, while thinking/tool/activity events appear only in the
      Thinking/Activity tab for the last run.
- [ ] Add UI tests proving Thinking/Activity events disappear on reload/history
      load while final chat messages and Working Order Memory remain available.
- [x] Add UI support and tests for copying full assistant response Markdown,
      copying rendered Markdown tables as Markdown source, and editing user
      messages Codex-style: overwrite visible text, rerun from the edited
      message, hide superseded later turns from the active transcript, and do
      not show a branch/follow-up artifact.
- [ ] Add backend integration tests proving an edited message rerun cannot read
      working-order rows, customer facts, price evidence, OCR extracts, or
      calculation facts that came only from superseded assistant/tool turns.
- [ ] Update `docs/rules/agent規則.txt` and synced Supabase rules so AI knows:
      final Markdown is the user-visible order, backend saves it automatically,
      and AI should only read memory when follow-up detail is needed.
- [x] Update client-only Activity stream with `memory_loaded`, `memory_read`,
      and `memory_saved` events that expose counts/source refs, not raw DB/OCR
      rows, and are never persisted as conversation history.
- [ ] Run focused parser/memory/tool/provider/handler tests, shared package
      builds if contracts change, API type/build check, Supabase rule
      dry-run/apply/readback, and `git diff --check`.

Review:

- Completion slice finished. Added idempotent Steel conversation-turn upsert by
  `conversationId`/`messageId`, final response metadata, queued steer metadata,
  and active-history edit/rerun behavior that updates the edited user message
  instead of creating a visible branch.
- Tool and OCR results are now automatically captured into Working Order Memory
  as bounded `customer_fact`, `price_evidence`, `rule_evidence`, and
  `ocr_extract` entries with source refs. AI still only gets
  `read_working_order_items`; no save tool was added.
- Provider streaming now has regression coverage for a streamed tool-call round
  followed by a second streamed text round. Frontend renders assistant text
  deltas into the answer bubble while keeping Activity events separate.
- Queued steers submitted during a running response are accepted in the UI,
  shown as last-run Activity, then deferred into a follow-up request with
  `messageSource: queued_steer`. Backend persists that queued source and emits
  `steer_applied` for the follow-up request.
- Codex-style chat controls are implemented and covered: assistant copy copies
  final Markdown without Activity text, rendered tables copy Markdown source,
  and editing a prior user message overwrites visible text and reruns from that
  message with `editMessageId`.
- Verification passed:
  `cd packages/data-provider && npm run build`;
  `cd packages/data-schemas && npm run build`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts --runInBand`;
  `cd packages/data-schemas && npx jest src/schema/steel.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/history/service.spec.ts src/steel/history/repository.spec.ts src/steel/memory/service.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand`;
  `cd packages/api && npm run build`;
  `git diff --check`.
- `cd client && npm run typecheck` still fails on repo-wide pre-existing
  frontend errors outside this Steel route. After fixing the one new
  `SteelOAuthChat.tsx` narrowing error, filtering the typecheck output for
  `SteelOAuthChat` / `src/routes/Steel` produced no matches.
- Supabase rule dry-run/apply/readback was not run because this completion
  slice did not change Steel Supabase rules or Postgres schema.

- Second implementation slice completed. Provider streaming now uses OAuth
  `doStream` when text-delta callbacks are available and keeps `doGenerate` as
  fallback; frontend renders assistant text deltas into a single in-progress
  assistant message without duplicating final text.
- Added last-run Activity event contracts and UI rendering for
  `memory_loaded`, `memory_read`, `memory_saved`, `parse_status`, and
  `steer_queued` events. Activity remains frontend state only and is not added
  to Mongo conversation history.
- Expanded final Markdown capture: full system-order tables replace active row
  snapshots, row-change tables merge by `項次`, customer/calculation tables save
  compact facts, unclassified tables are retained as partial calculation
  evidence, and malformed tables are skipped without retrying the provider.
- Added queued-steer frontend behavior while a request is running: text-only
  steers clear the composer and show `Queued steer accepted` in Activity. The
  backend channel that persists/applies steers at a provider boundary remains
  pending.
- Verification passed:
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/history/service.spec.ts src/steel/history/repository.spec.ts src/steel/memory/service.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand`;
  `cd packages/data-provider && npm run build`;
  `cd packages/data-schemas && npm run build`;
  `cd packages/data-schemas && npx jest src/schema/steel.spec.ts --runInBand`;
  `cd packages/api && npm run build`;
  `git diff --check`.
- `cd client && npm run typecheck` still fails on repo-wide pre-existing
  workspace type-resolution issues, mostly `Cannot find module
  'librechat-data-provider'`, plus unrelated frontend type errors outside the
  Steel route.

- First implementation slice completed. Added Steel conversation turn and
  Working Order Memory Mongo schemas/models; no run-scoped activity persistence
  was added.
- Added history service/repository coverage for Codex-style user-message edit:
  visible text is replaced, later turns are superseded, queued-steer turns in
  that later tail are excluded from active history, and Working Order Memory is
  logically rolled back from the edited turn boundary.
- Added read-only `read_working_order_items` tool schema/registry/executor
  support and a Mongo-backed active-memory reader for `summary`, `rowNo`,
  `erpItemCode`, `query`, `source`, and `page` modes. Verified that no
  `save_working_order_items` tool is exposed.
- Still pending: handler prompt construction and DB history persistence wiring,
  final Markdown parser/auto-save, automatic tool/OCR evidence capture,
  streaming `doStream`, queued steer UI/backend flow, and frontend copy/edit
  behavior.

# Active: Steel Price Tier and Table Spec-Key Continuity

Goal: make `search_price_candidates` preserve known customer tier pricing and
carry prior Markdown table item anchors into spec-key lookup candidates.

- [x] Add RED provider coverage proving a unique customer tier discovered by
      `search_customers` is applied to later `search_price_candidates` calls
      that omit `customerTierId`.
- [x] Add RED provider coverage proving prior Markdown tables with item code
      and product-name columns generate spec-key-like `candidateQueries`
      anchors for subsequent price lookup.
- [x] Implement the smallest provider-side runtime context to enrich price
      lookup arguments before tool execution while preserving explicit AI
      `customerTierId`.
- [x] Update AI-facing rule text and Supabase rule sync so the model is told to
      use known customer tier and table code/name anchors.
- [x] Run focused provider/tool tests, rule sync dry-run/apply/readback,
      package build checks as needed, and `git diff --check`.

Review:

- Added provider runtime context that records a unique tier id returned by
  `search_customers`; later `search_price_candidates` calls that omit
  `customerTierId` are enriched with that known tier, while explicit AI tier
  arguments still win.
- Added prior Markdown table anchoring: rows with code/model and product-name
  headers produce normalized `code_productName` candidate queries so follow-up
  price lookups continue to search the same table items through `spec_key`.
- Updated provider/tool descriptions and `docs/rules/agent規則.txt`; synced
  Supabase agent rules with `node packages/api/scripts/sync-steel-rules.cjs
  --dry-run` and `--apply`. Direct DB readback confirmed known-tier policy,
  table spec-key anchor policy, B-tier fallback, and the four-tool policy.
- Verified with
  `npx jest src/steel/ai/provider.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/repositories/prices.spec.ts --runInBand`.
- `git diff --check` passed. `npx tsc -p tsconfig.build.json --noEmit
  --pretty false --skipLibCheck` still reports only the existing Redis
  `KeyvRedis` type mismatch in `src/cache/cacheFactory.ts:47`.

# Active: Steel Workbook/File Analysis Persistence Removal

Goal: remove the remaining legacy Steel workbook and file-analysis persistence
layers after the chat flow moved to AI-produced Markdown tables.

- [x] Add RED checks proving Steel shared exports no longer expose workbook or
      file-analysis persistence contracts, and backend model exports no longer
      expose workbook/file-analysis Mongo models.
- [x] Remove workbook/file-analysis Mongo schemas, TypeScript document types,
      repository/service modules, API data-service helpers, and stale tests.
- [x] Keep non-persistence concepts that are still valid: chat file upload/OCR
      runtime, admin `fileAnalysis.instructions`, and importer Excel reference
      parsing.
- [x] Run focused data-provider/data-schemas/API/client tests, shared package
      builds, API build, and `git diff --check`.

Review:

- Removed legacy workbook/file-analysis persistence contracts from
  data-provider exports and data-schemas Mongo models, including workbook patch,
  selected workbook refs, file-analysis data, and workbook-derived memory
  fields.
- Removed API workbook/file-analysis repository/service/export modules, client
  preview modules, route/data-service helpers, and stale rule sync payloads.
  Steel chat now keeps OCR/runtime file handling but final quote/file-analysis
  output is Markdown in the assistant response.
- Removed hidden workbook orchestration vocabulary from source-schema mapping
  usage and `lookup_quote_rules` legacy formula sanitization; remaining
  `patch_quote_workbook`, `patch_file_analysis_data`,
  `lookup_catalog_families`, and `workbook_patch` references are negative
  tests or explicit rule guardrails.
- Synced `docs/rules/agent規則.txt` / `docs/rules/OCR規則.txt` to Supabase with
  `node packages/api/scripts/sync-steel-rules.cjs --apply`; direct DB readback
  confirmed `steel-default-agent-instruction` contains the B-tier default and
  exposes only `search_customers`, `lookup_quote_rules`,
  `search_price_candidates`, and `run_file_ocr`.
- Verified focused API/data-provider/data-schemas/client Jest suites,
  `packages/data-schemas` build, and `npm run build:data-provider`. API rollup
  emitted `created dist` with only the known Redis `KeyvRedis` type warning but
  did not return to the prompt, so it was interrupted; direct
  `npx tsc -p tsconfig.build.json --noEmit --pretty false --skipLibCheck`
  reports only that same pre-existing Redis type error.

# Active: Steel `search_price_candidates` B-Tier Default

Goal: keep Steel price lookup broad, but constrain customer price tiers so
missing customer context defaults to B tier and does not return duplicate A/B/C/F
price levels for the same item.

- [x] Add RED registry/tool coverage proving `search_price_candidates` accepts
      optional `customerTierId` and defaults missing tier context to B tier.
- [x] Keep unit/category/review/active filters removed from price lookup SQL.
- [x] Update the provider prompt and tool description so AI may pass a known
      customer tier, while backend defaults unknown tier to B.
- [x] Run focused tool/registry/provider checks and diff hygiene.

Review:

- `search_price_candidates` now accepts optional `customerTierId`; executor
  defaults missing tier context to B tier id `2` before calling
  `searchSteelPriceItems`.
- Price SQL applies only the customer-tier scope `(customer_tier_id = ? OR
  customer_tier_id IS NULL)` plus the AI keyword search and limit. It still
  does not apply unit/category/review/active filters for this minimal
  orchestration path.
- Same-round provider batching now compares effective customer tier, so B-tier
  default queries are not incorrectly merged with explicitly tiered queries.
- Verified with
  `npx jest src/steel/ai/provider.spec.ts src/steel/tools/execute.spec.ts src/steel/tools/registry.spec.ts src/steel/repositories/prices.spec.ts --runInBand`,
  `npm run build:api`, and `git diff --check`. `build:api` still reports the
  pre-existing Redis `KeyvRedis` type warning in `src/cache/cacheFactory.ts`.

# Active: Steel Minimal AI-Led Orchestration

Goal: reduce Steel `/steel/oauth-chat` to one AI-led tool loop where AI chooses
when to OCR, lookup rules/customers/prices, and final output is Markdown tables
instead of workbook/file-analysis state.

- [x] Add RED provider/tool coverage proving the AI-visible tool surface is only
      `run_file_ocr`, `lookup_quote_rules`, `search_customers`, and
      `search_price_candidates`.
- [x] Add RED OCR coverage proving `run_file_ocr` can OCR a whole PDF in one
      PaddleOCR MCP call and no longer requires per-page OCR handling.
- [x] Add RED registry/execute/repository coverage proving
      `lookup_catalog_families` is unavailable and catalog-family modules are no
      longer called.
- [x] Add RED lookup coverage proving `lookup_quote_rules` and
      `search_customers` use AI-provided keyword arrays / search text to perform
      contains-style database lookup, matching the simplified
      `search_price_candidates` contract.
- [x] Add RED price coverage proving `search_price_candidates` returns database
      candidates without unit-based, category-based, or post-query filters.
- [x] Remove handler OCR pre-processing and let `run_file_ocr` be invoked by AI
      inside the normal provider tool loop.
- [x] Remove Workbook/File Analysis chat contracts, right-panel UI, client data
      loading/saving, REST route registrations, and stale tests; keep only chat
      plus Activity/thinking.
- [x] Update prompt/rule wording to say AI should produce final Markdown tables
      for quote and file-analysis output, and should use PaddleOCR MCP via
      `run_file_ocr` when OCR is needed.
- [x] Run focused provider/tool/repository/handler/client tests,
      `npm run build:data-provider` if shared contracts change, and
      `git diff --check`.

Review:

- Tool surface is now `lookup_quote_rules`, `search_customers`,
  `search_price_candidates`, and `run_file_ocr`; `lookup_catalog_families`,
  workbook patch, and file-analysis patch are no longer exposed through the
  Steel chat provider loop. The runtime catalog-family repository/export/helper
  module was removed; importer catalog-family source data remains for admin
  data import only.
- `run_file_ocr` sends PDFs to PaddleOCR MCP once as `file_type: pdf`; images
  still use PaddleOCR for text/table extraction, with geometry-only judgments
  left to visual reasoning.
- `search_price_candidates` executes with AI-provided keywords and passes
  `unfiltered: true`; customer tier is the exception and now defaults to B tier
  when AI does not provide a known `customerTierId`.
- Workbook/File Analysis right-panel UI, REST route registration, data-service
  helpers, and chat request workbook fields were removed; the right panel is
  now Activity only.
- Verified with focused API/data-provider/client Jest tests,
  `npm run build:data-provider`, `npm run build:api`, and `git diff --check`.
  `build:api` still reports the pre-existing Redis `KeyvRedis` type warning in
  `src/cache/cacheFactory.ts`.

# Active: Steel `search_price_candidates` Spec-Key-Only Candidate Queries

Goal: simplify Steel price lookup so `search_price_candidates` only accepts
`candidateQueries`, and every candidate term from `productNames` or
`erpItemCodes` is normalized to spec_key format and searched against
`steel.price_items.spec_key`.

- [x] Add RED schema/registry coverage proving top-level `productNames` and
      `erpItemCodes` are rejected and `candidateQueries` is required.
- [x] Add RED repository/tool coverage proving candidate `productNames` and
      `erpItemCodes` both generate `spec_key ILIKE` predicates, not
      `product_name` or `erp_item_code` predicates.
- [x] Update schema descriptions, registry description, and validation messages
      to explain the new spec-key-only contract.
- [x] Remove direct top-level price search execution and unify execution around
      `candidateQueries`.
- [x] Update repository search input/SQL to treat discovery terms as spec-key
      terms only.
- [x] Update affected focused specs and run registry/repository/tool tests.

Review:

- `search_price_candidates` provider/tool schema now requires `candidateQueries`
  and rejects top-level `productNames`, `erpItemCodes`, and legacy direct price
  search keys.
- Provider price instructions and same-round coalescing now only describe and
  preserve `candidateQueries`; no compatibility wrapper promotes old top-level
  fields into candidates.
- Price repository discovery now sends every candidate product-name/spec term
  and ERP code/prefix through `steel.price_items.spec_key ILIKE`; it no longer
  emits `product_name ILIKE`, `erp_item_code ILIKE`, or
  `steel.product_name_aliases` joins for reviewed price discovery.
- Raw-only user text is still rejected before SQL, while mixed candidate lists
  can retain derived terms and report rejected raw candidates.
- Follow-up correction: AI-facing `search_price_candidates` now exposes
  `candidateQueries` as a plain string array, not nested candidate objects.
  Provider prompt, tool registry description, schema description, and runtime
  rule files now say every candidate query string is matched against
  `steel.price_items.spec_key` with contains semantics.
- Follow-up correction: execution now performs one backend price lookup for all
  candidate query strings instead of looping once per query string.
- Synced runtime rules with
  `rtk node packages/api/scripts/sync-steel-rules.cjs --dry-run` and
  `rtk node packages/api/scripts/sync-steel-rules.cjs --apply`. Readback
  confirmed `steel.agent_rules.slug = steel-default-agent-instruction`
  `sha256 = 3f59d229233a7aa8cc67a47e80b50c0e79f3bde3a958e518c33ba41394fff0fc`
  and `docs/rules/鋼材規則.txt` quote-rule
  `sha256 = 9a9732289d6b7bcc738e6cf24286a48fc7611ccc252cca84963bf34ac0cd2b60`.
- Verification:
  `rtk npx jest src/steel/tools/execute.spec.ts --runInBand` passed;
  `rtk npx jest src/steel/tools/registry.spec.ts src/steel/repositories/prices.spec.ts src/steel/normalization/search.spec.ts --runInBand` passed;
  `rtk npx jest src/steel/ai/provider.spec.ts -t "search_price_candidates|price" --runInBand` passed.
  Follow-up verification:
  `rtk npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/repositories/prices.spec.ts src/steel/ai/provider.spec.ts --runInBand` passed.
- Filtered touched-file typecheck:
  `rtk npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rtk rg "packages/api/src/steel/(tools/(schemas|execute|registry)|repositories/prices|normalization/search|ai/provider)"`
  produced no matching errors.

# Active: Steel OAuth Chat Workbook/File Analysis Forced Loop Removal

Goal: remove the high-latency `/steel/oauth-chat` forced loops by deleting
`patch_quote_workbook`, deleting provider-facing `patch_file_analysis_data`,
moving OCR/table extraction into pre-main-model context preparation, and
removing the code-enforced reviewed-price lookup gate, while keeping the
ordinary AI-led business tool loop available.

- [x] Add RED coverage proving `/steel/oauth-chat` no longer registers
      workbook/file-analysis patch function tools.
- [x] Add RED coverage proving price requests are not forced through
      `toolChoice: required`, required lookup reminders, or final hard-fail
      checks before answering.
- [x] Remove workbook patch and `patch_file_analysis_data` loops from the
      provider and route handler chat path.
- [x] Add or reuse a server-side OCR context-preparation seam so uploaded
      visual evidence can be processed before the main model call and supplied
      as text/Markdown context without `patch_file_analysis_data`.
- [x] Keep optional business tool execution AI-led: if AI calls
      `search_price_candidates`, execute it and return the data to AI without a
      backend-enforced price-loop gate.
- [x] Update shared/client contracts so chat responses no longer expect
      workbook/file-analysis patch payloads from the chat provider and
      assistant messages can render Markdown tables.
- [x] Run focused provider/handler/client tests plus diff hygiene and record
      review evidence.

Review:

- Removed provider-facing `patch_quote_workbook`, `patch_file_analysis_data`,
  `run_file_ocr`, and `run_visual_inspection` tool-loop handling from
  `packages/api/src/steel/ai/provider.ts`; provider now keeps only AI-led
  Steel business tools.
- Removed backend-enforced reviewed-price lookup gating: no required
  `search_price_candidates` reminder, no `toolChoice: required`, and no final
  hard fail when AI answers without that lookup.
- Simplified `/steel/oauth-chat` handler paths so chat/stream responses return
  provider text directly with `conversationId`; no chat-time workbook patch or
  file-analysis patch persistence remains.
- Added server-side OCR context preparation in the handler using the existing
  drawing-evidence extraction service: attached visual evidence is first read
  by a no-tool provider call, then supplied to the main Steel agent as text
  context; if extraction fails, chat falls back to original files.
- Updated shared chat response/stream schemas to remove chat-provider
  `workbookPatch`, `fileAnalysisPatch`, `fileAnalysisData`, and
  `file_analysis_data` stream events.
- Updated the Steel chat UI so assistant Markdown tables render as actual
  tables and chat responses no longer update workbook/file-analysis panels
  from provider patch payloads.
- Verification:
  `rtk npx jest src/steel/ai/provider.spec.ts -t "answers price turns without workbook/file-analysis tools or required price-loop gating" --runInBand`
  passed; `rtk npx jest src/steel/vision/service.spec.ts --runInBand`
  passed; `rtk git diff --check -- ...` passed.
- `rtk npx tsc --noEmit --pretty false --skipLibCheck` still fails broadly on
  existing/now-stale Steel specs that assert removed workbook/file-analysis
  patch behavior; filtered output showed no errors for the touched runtime
  files after the fixes.
- Follow-up cleanup removed stale workbook/file-analysis chat patch specs:
  `provider.spec.ts`, `handlers.spec.ts`, `SteelOAuthChat.spec.tsx`, and
  `packages/data-provider/src/steel/ai.spec.ts` now assert the new text/table
  chat contract and the absence of provider-facing patch payloads.
- Deleted obsolete `provider.catalog-oral.manual.spec.ts`, which was a manual
  live smoke for the removed `patch_quote_workbook` workflow.
- Removed workbook-specific timing fields from provider/shared/client
  contracts: `workbookCompletionDurationMs`, `workbookPatchOperationCount`,
  `workbookCompletionRequired`, `workbookCompletionComplete`,
  `missingWorkbookSheetCount`, and `missingWorkbookCellCount`.
- Rebuilt `packages/data-provider` so `packages/api` consumes the updated
  shared timing/response types.
- Follow-up verification:
  `rtk npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/vision/service.spec.ts --runInBand`
  passed; `rtk npx jest src/steel/ai.spec.ts --runInBand` passed;
  `rtk npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand` passed;
  `rtk npm run build:data-provider` passed.
- Full `packages/api` typecheck still has unrelated pre-existing failures in
  Redis cache typing, workbook/tool/vision specs, export spec Buffer typing,
  and PaddleOCR manual specs. A filtered typecheck for the touched provider,
  handler, service, and route spec files showed no remaining errors.

# Active: Steel DNB Price Lookup Zero-Candidate Diagnosis

Goal: explain why Round 2 `search_price_candidates` returned zero candidates
for exact ERP codes such as `DNB70060` and `DNB70160`, even though the database
contains those codes, and identify the smallest reliable fix path.

- [x] Reproduce the Round 2 `search_price_candidates` call at the direct tool
      seam without running the full OAuth chat loop.
- [x] Query the live Steel Postgres price rows for `DNB70060` and `DNB70160`
      and compare them against tool filters such as customer tier, review
      state, active status, unit, and product names.
- [x] Inspect how `candidateQueries`, top-level `erpItemCodes`, generated
      search terms, and repository SQL interact.
- [x] Report the direct failure cause, whether token compression is involved,
      and concrete improvement options.

Review:

- Added a direct diagnosis harness at
  `tmp/chat-round-test/price-search-dnb-diagnosis.ts` and captured evidence in
  `tmp/chat-round-test/price-search-dnb-diagnosis.json`.
- Live DB contains reviewed/active `DNB70060` and `DNB70160` rows for A/B/C/F
  tiers. For B tier, `DNB70060` is `6.0m/mOT板雷射切割` at 38.5 and
  `DNB70160` is `16.0m/mOT板雷射切割` at 37.5.
- The rows are not filtered out by customer tier, review state, or active
  status. Direct `search_price_candidates` with only exact
  `erpItemCodes: ['DNB70060', 'DNB70160']`, `customerTierId: 2`,
  `reviewState: reviewed`, and `includeInactive: false` returned 2 candidates
  in 281ms.
- Direct `search_price_candidates` with the broader Round 2 top-level DNB code
  list returned 20 B-tier candidates in 334ms.
- Direct repository product-name search for `6.0m/mOT板雷射切割` /
  `16.0m/mOT板雷射切割` returns matching DNB rows, but all returned rows have
  `unit: piece`.
- Tool-level laser product-name search returns 0 candidates because
  `filterPlateLaserPriceCandidates` treats OT / black-iron laser product names
  as laser plate searches and keeps only `unit === 'kg'`.
- Tool-level `candidateQueries` mode ignores top-level `productNames` and
  `erpItemCodes`; it only searches the normalized per-candidate
  `query.productNames` / `query.erpItemCodes`. Therefore Round 2's top-level
  exact DNB codes did not rescue the candidate query search.
- If exact DNB codes are placed inside `candidateQueries.erpItemCodes`, the
  same tool path returns the expected 2 B-tier candidates, confirming the
  database and exact-code SQL match are healthy.
- No new evidence points to token compression or context loss. The DNB markers
  were present in the previous live prompt captures; this failure is caused by
  tool input handling and post-query filtering.
- Follow-up correction: current `search_price_candidates` accepts only
  `candidateQueries: string[]`, not nested candidate objects or top-level
  `erpItemCodes`. The live DB still has reviewed/active B-tier `DNB70060`, but
  raw `6.0m/mOT板` previously missed because the stored `spec_key` is
  `DNB70060_6.0m_mOT板雷射切割`. The repository now normalizes each keyword to
  spec_key format and searches only `steel.price_items.spec_key` with contains
  semantics.
- Synced reviewed agent rule after adding the normalized spec_key tool
  instruction. Readback confirmed active `steel-default-agent-instruction` SHA
  `c620fe62efa7a73721dd807715fc008f30fbf6f811d68b20a8a6fe4015101d20`.

# Active: Steel OAuth Chat Multi-Round Live Latency Diagnosis

Goal: run a real multi-round `/steel/oauth-chat` test using
`tmp/chat-round-test/round1.txt` and `tmp/chat-round-test/round2.txt`, identify
why the visible chat can wait 2-10+ minutes or terminate even when individual
tool execution is fast, and verify whether token/context compression causes
missing data or failure.

- [x] Confirm the live test entrypoint, auth prerequisites, provider/model
      path, and existing timing instrumentation.
- [x] Run round 1 and round 2 against the live local path with request timing,
      stream/provider events, tool timings, and termination evidence captured.
- [x] Compare tool execution time against total provider round time and
      workbook-completion/tool-loop time.
- [x] Inspect context/token compression behavior and whether compressed context
      drops workbook/file-analysis/tool result data.
- [x] Report the root cause, improvement options, and verification evidence.

Review:

- Added a debug harness at `tmp/chat-round-test/live-latency-diagnosis.ts`
  and captured evidence in `tmp/chat-round-test/live-latency-events.jsonl` and
  `tmp/chat-round-test/live-latency-summary.json`.
- Live env path was `STEEL_OPENAI_PROVIDER=OAUTH`, model `gpt-5.5`,
  `STEEL_OPENAI_REASONING_EFFORT=high`, with `STEEL_POSTGRES_URL` present.
- Round 1 completed in 296.6s. Provider generation consumed 284.45s, tool
  execution consumed 9.635s, workbook-completion checks consumed 1ms, and the
  response reported 204,932 input tokens / 14,362 output tokens. The slowest
  provider generation round took 191.24s after prompt growth to 150,924 chars.
- Round 1 tool calls were fast: `lookup_catalog_families` 1.935s,
  first `search_price_candidates` 2.801s, `lookup_quote_rules` 2.571s, second
  `search_price_candidates` 2.324s. The long visible wait happened between
  tool events while awaiting `openai(model).doGenerate(...)`.
- Round 1 required extra workbook-completion provider turns because the first
  accepted patch was missing `system_order`, `manual_review`, `customer_quote`,
  `system_order.model_code`, `system_order.item_spec`,
  `manual_review.confirmation_needed`, `customer_quote.item_spec`, and
  `customer_quote.subtotal`. After that, AI produced a 59-operation workbook
  patch and one final answer round.
- Round 2 failed after the 720s harness timeout with
  `AbortError: This operation was aborted`. It completed six provider
  generation rounds before abort; two provider rounds alone took 342.95s and
  301.063s, while all completed backend tools together took only 4.932s.
- Round 2 marker checks stayed present in every captured prompt: `RBL1`,
  `PA35`, `PB18`, `PC12`, `DNB70060`, `DNB70160`, `B1NB900016`,
  `黑鐵板6.0m以上單價`, and `1,784`. No evidence points to token compression
  dropping the supplied round1/round2 data.
- Static inspection found no local Steel token/context compression path. The
  OAuth provider is called with `responsesState: false`; Steel reconstructs
  full prompt context and appends tool-call/tool-result messages each round.
- The root cause is provider/tool-loop orchestration: `doGenerate` drains the
  full provider response before returning; workbook-completion and required
  reviewed-price lookup can force repeated provider rounds; prompt/tool-result
  growth and high reasoning effort make individual model rounds take minutes.
- Secondary root cause in round 2: after the user provided price rows, AI first
  emitted a large `patch_quote_workbook` before required price lookup, then
  searched with product names / ERP codes that returned zero candidates. The
  required lookup loop continued and eventually hit the timeout.
- Improvement targets: stream provider deltas or per-round progress instead of
  waiting for final `doGenerate`; cap/timeout provider rounds with actionable
  partial-state errors; reduce reasoning effort for lookup/workbook turns;
  shrink prompt/tool-result context and avoid replaying full transcript when
  workbook state already carries the facts; fix price search matching for
  exact ERP codes such as `DNB70060` / `DNB70160` and no-result exit behavior;
  expose per-round prompt size, generated tool names, and tool result counts in
  Activity before final `done`.

# Active: Steel Plate OT Laser Cutting Pricing Rules

Goal: add Steel plate pricing rules so unspecified plate material defaults to
OT black iron, plate pricing always uses square theoretical weight kg, and
plate price lookup/adoption uses laser-cut product names rather than square-cut
or piece pricing.

- [x] Confirm rule design before implementation.
- [x] Add RED coverage for PL oral specs such as `PL6*80` and `PL16*96`,
      expecting OT laser-cut product-name candidates and kg theoretical-weight
      pricing behavior.
- [x] Update Steel rule docs and provider/tool guidance so generic plate names
      default to OT, use `黑鐵板 雷射切割` / `OT板雷射切割`, and reject
      `四方切` / `piece` pricing for plates.
- [x] Sync reviewed Supabase Steel rules with dry-run and apply readback.
- [x] Run focused provider/tool/workbook tests, builds where relevant, and
      `git diff --check` without Prettier.

Review:

- Added `docs/plans/2026-06-15-steel-plate-ot-laser-pricing-rules.md` and
  implemented the approved direct-execution option in this session.
- Added RED/GREEN normalization coverage proving raw `PL6*80` derives
  `6.0m/mOT板雷射切割`, `OT板雷射切割`, and `黑鐵板 雷射切割` candidates,
  without `四方切`.
- Added RED/GREEN tool execution coverage proving `PL16*96` candidate queries
  search `16.0m/mOT板雷射切割` instead of raw PL text, reject square-cut plate
  searches before SQL, and omit per-piece plate price rows from laser-cut plate
  searches.
- Implemented PL oral plate expansion in `generateSteelPriceSearchTerms` and
  kg-only filtering for laser-cut OT / black-iron plate search results in
  `search_price_candidates`.
- Updated `docs/rules/鋼材規則.txt`, `docs/rules/agent規則.txt`, and the
  provider price lookup instruction so unspecified plate material defaults to
  OT, PL thickness maps to OT laser-cut productNames, and plate pricing uses
  square theoretical weight kg rather than piece or square-cut rows.
- Synced reviewed Supabase rules with `sync-steel-rules.cjs --dry-run` and
  `--apply`. Readback confirmed agent SHA
  `9b5da206681ef400dad2e7eee1965905246a46d8d3ada8ddfb4971dbadfc71c5` and
  quote-rule SHA
  `222bd0a47c516b0baa703c5bc62707a3ddf4c0faf393776f8df2f061689c7db6`.
- Verification passed:
  `cd packages/api && npx jest src/steel/normalization/search.spec.ts src/steel/tools/execute.spec.ts src/steel/tools/registry.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand`;
  `npm --workspace packages/api run build`;
  `git diff --check`.
- Build note: API build exits 0 and creates `dist`, while still printing the
  existing unrelated Redis `src/cache/cacheFactory.ts` Rollup TypeScript
  warning.

# Active: Steel Surface Product Name Aliases

Goal: add reviewed database aliases for oral Chinese steel material/surface
names so `search_price_candidates` can expand them to product-name markers
`ST`, `OT`, `HL`, `2B`, `BA`, and `NO1`, with `NO1` available for `白鐵`
only when explicit thickness evidence is at least 3mm, including `3t`,
`3.0m/m`, or plate-size product text such as `STNO1 3.0*4'*8'(73.5)`.

- [x] Add RED repository coverage for surface-marker alias matching and
      min-thickness alias gating.
- [x] Add the reviewed `steel.product_name_aliases` migration rows for
      白鐵/黑鐵/白鐵沙面/白鐵霧面/白鐵亮面.
- [x] Update `search_price_candidates` repository matching so surface marker
      aliases use token-style marker matching and `metadata.minThicknessMm`.
- [x] Update Steel rule docs and sync reviewed Supabase rules.
- [x] Apply/read back cloud Supabase aliases, run focused tests, live lookup
      smoke, build/diff hygiene, and write review evidence.

Review:

- Added RED/GREEN repository coverage for surface-marker aliases, `NO1`
  `metadata.minThicknessMm`, and user-corrected NO1 thickness evidence forms:
  `3t`, `3.0m/mSTNO1雷射切割`, and `STNO1 3.0*4'*8'(73.5)`.
- Added reviewed alias data migration
  `supabase/migration/20260615084737_steel_surface_product_name_aliases.sql`
  for 白鐵 -> ST, 黑鐵 -> OT, 白鐵沙面 -> HL, 白鐵霧面 -> 2B,
  白鐵亮面 -> BA, and 白鐵 -> NO1 with `minThicknessMm = 3`.
- Updated `searchSteelPriceItems` so surface-marker aliases use regex marker
  matching instead of plain substring matching. `NO1` also matches `STNO1` /
  `ST NO1`, and min-thickness alias rows are active only when parsed thickness
  evidence meets the metadata threshold.
- Updated `docs/rules/鋼材規則.txt` and synced reviewed Supabase rules with
  `sync-steel-rules.cjs --dry-run` and `--apply`; `steel.quote_rules` readback
  confirmed STNO1 examples and SHA
  `168bf281aa1180736c967fdd43ca554f28dc4173c2e072d91d0649a738755189`.
- Cloud Supabase readback confirmed 6 reviewed/active alias rows and the NO1
  gate. Live repository smoke returned BA rows for `白鐵亮面`, STNO1 rows for
  `白鐵 + 3.0m/mSTNO1雷射切割`, and no NO1 auto-expansion for `白鐵 + 2.0m/m`.
- Verification: `jest src/steel/repositories/prices.spec.ts -- --runInBand`
  passed 18/18; focused `execute.spec.ts` search-price tests passed 3/3;
  `npm --workspace packages/api run build` exited 0 with existing unrelated TS
  warnings, including active `customer_data` worktree warnings; `git diff
  --check` passed.

# Active: Steel Workbook Customer Data Tab And Search Record

Goal: add an internal workbook/UI `客戶資料` tab and workbook patch rules so
customer/vendor name searches are recorded in the workbook, while quote
calculation uses B tier first when multiple candidate tiers include B.

- [x] Locate current workbook sheet-id contracts, semantic patch projection,
      provider completion targets, and UI visible/export sheet filters.
- [x] Add RED coverage for the `客戶資料` sheet contract, UI visibility/export
      defaults, and semantic customer-search record projection.
- [x] Implement the smallest shared workbook/schema/template/UI change for a
      `customer_data` sheet with 客戶編號、廠商名稱、等級、確認狀態、備註.
- [x] Update workbook/provider rules so user-provided customer/vendor names
      trigger customer search, write candidate records to `客戶資料`, and prefer
      B tier for provisional calculations when B is one of multiple candidates.
- [x] Run focused workbook/provider/frontend tests, build/type checks where
      appropriate, and changed-file hygiene without Prettier.

Review:

- Added required workbook sheet `customer_data` / `客戶資料` across shared
  data-provider contracts, Mongo schema enums, workbook template, semantic
  workbook projection, and the Steel workbook UI/export visible-sheet filter.
- `客戶資料` rows carry `客戶編號`, `廠商名稱`, `等級`, `確認狀態`, and `備註`.
  Semantic workbook patches can now project `customerData` records generated
  from customer/vendor search candidates.
- Updated provider rules so customer/vendor names trigger `search_customers`
  recording, and provisional quote calculation prefers B tier when multiple
  customer/tier candidates include B while keeping all candidates pending
  confirmation.
- Updated `docs/rules/agent規則.txt` and `docs/rules/workbook規則.txt`, then
  synced reviewed Supabase rule rows with `sync-steel-rules.cjs --dry-run` and
  `--apply`. Readback confirmed agent SHA
  `f406f98dcaa10772328129be20d641033a1684da776f93b3ed78a4c5a3c7ce99` and
  workbook SHA
  `c1f4ea1ce48bfd04b35ffbe57f3de12da7765fd502cdcd614f14b61b34a385c5`.
- Fixed the shared `SteelProviderChatResponse` declaration so generated
  `data-provider` `.d.ts` files use the same `customer_data`-aware workbook
  patch response type as the runtime schema.
- Verification passed:
  `npm --workspace packages/data-provider exec jest src/steel/ai.spec.ts src/steel/workbooks.spec.ts -- --runInBand`;
  `npm --workspace packages/data-provider run build`;
  `cd packages/api && npx jest src/steel/workbook/semantic.spec.ts src/steel/workbook/service.spec.ts src/steel/workbook/repository.spec.ts src/steel/exports/service.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand`;
  `npm --workspace packages/api run build`;
  `npm --workspace packages/data-schemas exec jest src/schema/steel.spec.ts -- --runInBand`;
  `npm --workspace packages/data-schemas run build`;
  `npm --workspace client exec jest src/routes/SteelOAuthChat.spec.tsx -- --runInBand --coverage=false --testNamePattern="visible workbook tabs|downloads the current workbook"`;
  `git diff --check`.
- Build/typecheck notes: API build exits 0 and no longer prints the Steel
  `customer_data` handler warning, but still prints existing unrelated
  non-Steel Rollup TypeScript warnings. Full `npm --workspace client run
  typecheck` still fails on existing non-Steel frontend errors; after fixing
  this task's `Preview.tsx` issue, filtered typecheck output for
  `src/features/steel` / `src/routes/SteelOAuthChat` is empty.

# Active: Steel Customer Quote Total Row Must Stay Last

Goal: when workbook `報價單` / `customer_quote` lines are added after a total
row already exists, keep `報價總額` as the final table row and update its 小計
to the correct sum of all quote line subtotals.

- [x] Locate the projection/apply seam that lets new customer quote rows appear
      after `customer_total`.
- [x] Add RED regression coverage using the reported shape: rows 1, 2,
      `報價總額`, then newly added row 3, expecting row 3 before `報價總額` and
      total 137783.86.
- [x] Implement the smallest workbook fix that preserves explicit
      AI-authored `customerQuoteTotal` semantics while normalizing persisted row
      order/value.
- [x] Run focused workbook/provider tests and changed-file hygiene without
      Prettier.

Review:

- Root cause: workbook patch apply creates missing rows with `sheet.rows.push`.
  If `customer_total` already exists, a later `customer_3` row is appended after
  the total row.
- Added workbook service normalization after accepted patch operations. When a
  `customer_total` / `報價總額` row exists, the service keeps it last and
  recomputes its subtotal from current `customer_quote` line subtotals. If any
  line subtotal is not numeric, the total becomes `未確認`.
- Added RED/GREEN regression coverage for the reported PL rows: the initial
  sheet has rows 1, 2, stale `customer_total`, then adding row 3 now persists
  row order `customer_1`, `customer_2`, `customer_3`, `customer_total` and total
  `137783.86`.
- Verification passed:
  `cd packages/api && npx jest src/steel/workbook/service.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="applies provider workbook patch|provider delete_row workbook patch|returns subtotal info"`;
  `git diff --check`;
  `npm --workspace packages/api run build`.
- Build note: package build exits 0 and creates `dist`, while still printing the
  existing non-Steel Redis `cacheFactory.ts` Rollup TypeScript warning.

# Active: Steel Correction Follow-Up Must Not Re-OCR Existing PDF

Goal: when a user follows up with confirmed/corrected OCR facts for an already
processed PDF, update `file_analysis_data` and workbook state from the user's
message without calling `run_file_ocr` again unless the user explicitly asks to
OCR/re-read the file.

- [x] Locate the provider/tool-loop seam that allows or forces OCR after a
      persisted `file_analysis_data` patch already exists.
- [x] Add RED regression coverage for a second-turn correction such as
      `S3 / C4 為 S3, PL15*277, 長度 5280, 更新資料` proving `run_file_ocr`
      is not called.
- [x] Implement the smallest guard that preserves first-turn/multi-page OCR
      auto-continuation, but blocks implicit re-OCR on correction-only turns.
- [x] Run focused Steel provider/handler tests and changed-file hygiene without
      Prettier.

Review:

- Root cause: provider OCR gating used visual evidence files from all message
  history, so a historical `PL.pdf` attachment still exposed `run_file_ocr` on a
  later correction-only turn.
- Provider now enables `run_file_ocr` only when the latest user turn contains a
  new visual file or the latest user text explicitly requests OCR/re-read/resume.
  Historical visual file parts are omitted from the provider prompt when OCR is
  not enabled, while `patch_file_analysis_data` remains available when saved
  `file_analysis_data` context exists.
- Added provider regression coverage for `S3 / C4 為S3, PL15*277, 長度 5280,
  更新資料`: `patch_file_analysis_data` remains available, `run_file_ocr` and
  `run_visual_inspection` are not exposed, historical file parts are not sent,
  and the OCR executor is not called.
- Verification passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="latest saved file_analysis_data|manual correction"`;
  `git diff --check`;
  `npm --workspace packages/api run build`.
- Build note: package build exits 0 and creates `dist`, while still printing the
  existing non-Steel Redis `cacheFactory.ts` Rollup TypeScript warning.

# Steel Core Quote Runtime Implementation Queue

## Active: Steel Price Search Product Name Alias And Workbook Adoption

Goal: fix `search_price_candidates` so raw family wording like `C型鋼` never
fails the whole tool call when other OR facets can still find reviewed price
rows, and add admin-editable product-name alias rules so `C型鋼` can expand to
reviewed names such as `錏輕型鋼` before database search.

- [x] Add RED tool/repository coverage proving `C型鋼` productNames no longer
      throws and still searches other product-name / ERP-code facets.
- [x] Add RED workbook regression proving an AI-adopted C75 candidate
      (`錏輕型鋼 75*2.3`) projects into workbook-visible sheets instead of
      disappearing.
- [x] Add a `steel.product_name_aliases` table for admin-maintained lookup
      rewrites, update `supabase/schema.sql`, and create the migration with
      Supabase CLI.
- [x] Wire alias expansion into `search_price_candidates` without hard-coded
      product-category bans in code.
- [x] Run focused tests and changed-file hygiene without Prettier.

Review:

- Removed the schema-level hard rejection that failed
  `search_price_candidates` when `productNames` included C 型鋼 family wording.
- Added `steel.product_name_aliases` as an admin-maintained many-to-one alias
  table. Seeded `C`, `C型鋼`, `C鋼`, and `輕型鋼` to target reviewed product
  name `錏輕型鋼`.
- Repository price discovery now treats each product-name term as direct
  product-name text OR an active reviewed alias-table source, while preserving
  ERP-code OR search.
- Updated the C 型鋼 quote rule wording so `C` / `C型鋼` are recoverable alias
  evidence, not invalid productNames.
- Added workbook coverage proving a confirmed C75 `CCG07523 / 錏輕型鋼 75*2.3`
  semantic line projects into `系統訂單`, `人工複核`, and `報價單`.
- Added workbook service coverage proving those projected C75 operations create
  missing rows (`order_3`, `customer_3`, `review_3`) instead of only updating
  already-existing rows.
- Applied the additive migration to cloud Supabase through `.env`
  `STEEL_POSTGRES_URL`. Readback returned `c_type_alias_count = 4` with sources
  `C`, `C型鋼`, `C鋼`, `輕型鋼`.
- Target-synced only the C 型鋼 quote rule to cloud Supabase; readback confirmed
  many-to-one wording and source-list wording.
- Live cloud `search_price_candidates` smoke with `productNames: ["C", "75*2.3"]`
  and `erpItemCodes: ["CCG075"]` returned `CCG07523 / 錏輕型鋼 75*2.3`,
  `unit = kg`, `unitPrice = 26.8`, `productPriceUnitWeight = 3.25`.
- Verification passed:
  `cd packages/api && npx jest src/steel/tools/execute.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/registry.spec.ts src/steel/normalization/search.spec.ts src/steel/workbook/semantic.spec.ts src/steel/ai/provider.spec.ts --runInBand --testNamePattern="C 型鋼|bare C|product-name aliases|OR discovery|invalid search_price_candidates|price request|workbook|semantic workbook"`;
  `cd packages/api && npx jest src/steel/workbook/service.spec.ts --runInBand --testNamePattern="C75 semantic patch|creates the target row"`;
  `git diff --check`;
  `npm --workspace packages/api run build`.
- Build note: package build exits 0 and creates `dist`, while still printing the
  existing non-Steel Redis `cacheFactory.ts` Rollup TypeScript warning.

## Active: Steel Workbook UI Three Visible Tabs

Goal: keep the Steel workbook UI focused on the three user-facing tabs:
`系統訂單`, `人工複核`, and `報價單`, even when the persisted workbook still
contains seven sheets for backend/export compatibility.

- [x] Add focused frontend coverage that a seven-sheet workbook renders only
      the three visible UI tabs.
- [x] Filter the workbook preview tabs/table/export-checkbox list to
      `system_order`, `manual_review`, and `customer_quote`.
- [x] Default UI-triggered workbook export sheet selection to the same three
      visible sheets.
- [x] Run focused Steel route tests and changed-file hygiene without Prettier.

Review:

- Added frontend coverage proving a persisted seven-sheet workbook renders only
  `系統訂單`, `人工複核`, and `報價單` in the workbook UI.
- `SteelWorkbookPreview` now filters visible tabs/tables/export checkboxes to
  the three UI sheets while preserving the underlying workbook object.
- `SteelOAuthChat` now initializes UI export selections from the same visible
  sheet helper, so hidden workbook sheets are not selected by default from the
  UI.
- Verification passed:
  `npm --workspace client exec jest src/routes/SteelOAuthChat.spec.tsx -- --runInBand --coverage=false`;
  `git diff --check`.

## Active: Steel Activity Public Work Log UI

Goal: rename the Steel right-panel `Thinking` tab to short `Activity` wording and
show the public work records already streamed by the Codex/OpenAI-style API so
users can tell the provider is still working and developers can audit whether
the AI followed the expected quote workflow.

- [x] Add RED frontend coverage for the `Activity` tab name and Codex-style
      public work log entries.
- [x] Render all stream-visible public events as compact activity items:
      progress, reasoning summaries, lookups, tools, and errors.
- [x] Keep provider timing/workbook-completion measurements visible inside the
      Activity panel.
- [x] Run focused frontend tests and changed-file hygiene without Prettier.
- [x] Record review notes and update lessons for Activity visibility.

Review:

- The Steel right-panel progress tab is now labeled `Activity` and the panel is
  labeled `Activity panel` with `Public work log` copy, avoiding raw
  chain-of-thought framing.
- Stream-visible public events are rendered as compact activity items with
  event kind and status: progress, reasoning summaries, lookup/tool status, and
  errors. The current-run event list is no longer truncated to 12 items.
- Provider timings remain visible in the Activity panel after the public work
  log, including workbook-completion measurements from the latest response.
- Verification passed:
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false --testNamePattern="Activity|provider timings|last run"`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false`;
  `git diff --check`.
- `npm --workspace client run typecheck` still exits 2 on existing global client
  type errors outside this Steel route, including a11y, Agents, Artifacts, Chat
  attachment types, MCP, Sources, and utility tests.

## Active: Steel Workbook Completion Progress Visibility

Goal: make the quote-workbook completion loop visible in the Steel Thinking tab
so users do not see only one `patch_quote_workbook completed` event and assume
the AI is stuck while it is actually filling missing `系統訂單`, `人工複核`, or
`報價單` fields.

- [x] Add RED provider stream coverage proving an incomplete semantic workbook
      patch emits workbook-completion progress before the next AI completion
      round.
- [x] Emit compact `patch_quote_workbook` status events from provider
      workbook-completion checks using the existing stream event contract.
- [x] Verify the existing Thinking timeline renders those status events without
      adding a new UI schema.
- [x] Run focused provider/frontend tests and changed-file hygiene without
      Prettier.
- [x] Record review notes and update lessons for completion-loop visibility.

Review:

- Provider now emits a `patch_quote_workbook` status event when workbook
  completion is required but still incomplete. The message includes missing
  sheet/cell targets and says the provider is asking AI to fill derivable
  workbook fields before the final answer.
- Stream handler now passes provider-side `patch_quote_workbook` status events
  into NDJSON, so the existing Thinking timeline shows the completion loop
  without a new frontend schema.
- Verification passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="requires semantic workbook coverage"`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="streams Steel chat progress"`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false --testNamePattern="Thinking|progress|provider timings"`;
  `git diff --check`.
- `npm --workspace packages/api run build` printed the existing non-Steel Redis
  Rollup TypeScript warning and `created dist`, but the Rollup process remained
  alive with no further output and was interrupted instead of being counted as a
  passing build.

## Active: Steel Thinking Timings And Workbook Docs Cleanup

Goal: expose provider timing measurements in the Steel Thinking tab and clean
current docs so `patch_quote_workbook` is described as a three-sheet AI patch
target: `系統訂單`, `人工複核`, and `報價單`.

- [x] Add RED frontend coverage proving the Thinking tab renders provider
      `timings` from the latest Steel response.
- [x] Implement a compact Thinking timing summary for total, generation, tool,
      workbook-completion, and per-round timing data.
- [x] Rewrite current Steel docs that still describe semantic workbook patch
      completion as seven sheets or label `customer_quote` as `給客戶用`.
- [x] Run focused frontend tests and changed-file hygiene without Prettier.
- [x] Record review notes and update lessons for timing visibility/docs cleanup.

Review:

- Steel Thinking now renders `lastResponse.timings` under `Provider timings`,
  including total, generation, tool, workbook-completion, round count, per-round
  durations, tool call counts, workbook operation counts, prompt message counts,
  and missing workbook sheet/cell counts.
- Added RED/GREEN coverage in `client/src/routes/SteelOAuthChat.spec.tsx`; the
  focused Steel route spec passes with 26/26 tests.
- Cleaned current Steel docs and v8.3 planning docs so the public workbook is
  still seven sheets, while AI-facing `patch_quote_workbook` completion targets
  only `系統訂單`, `人工複核`, and `報價單` (`customer_quote`). Stale `給客戶用`
  wording is removed from the scoped docs.
- Verification: `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx
  --runInBand --coverage=false` passed, and `git diff --check` passed.
  `npm --workspace client run typecheck` still exits 2 on existing non-Steel
  type errors; rerun output has no `src/routes/SteelOAuthChat` hits after the
  local file-type cleanup.

## Active: Steel Three-Sheet Workbook Patch Completion

Goal: make `patch_quote_workbook` faster by limiting its AI-facing workbook
completion target to three sheets: `系統訂單`, `人工複核`, and `報價單`
(`customer_quote`, formerly `給客戶用`), then measure provider round/tool timing
so future delays are visible.

- [x] Add RED provider coverage proving a complete semantic patch only needs the
      three target sheets and no longer waits for `報價明細`, `總結`, `價格來源`,
      or `判讀備註` completion cells.
- [x] Add RED provider coverage that exposes per-round generation/tool timing for
      workbook patch runs.
- [x] Limit semantic workbook patch projection/completion feedback to the three
      target sheets while keeping backend workbook validation/apply paths intact.
- [x] Rename the `customer_quote` display label from `給客戶用` to `報價單`.
- [x] Run focused provider/workbook tests, build checks, and diff hygiene without
      Prettier.
- [x] Record review notes and update lessons for the new three-sheet contract.

Review:

- `patch_quote_workbook` completion now targets only `system_order`,
  `manual_review`, and `customer_quote` (`報價單`). It no longer asks AI to fill
  `quote_details`, `summary`, `price_sources`, or `interpretation_notes` before
  answering.
- Semantic workbook projection now emits patch operations only for the three
  target sheets plus explicit deletes. The public seven-sheet workbook schema is
  unchanged, so existing workbook persistence/export shape remains compatible.
- Provider responses now include structured `timings` with total/per-round
  generation, tool, and workbook-completion durations plus missing sheet/cell
  counts. This makes future quote-workbook latency visible without relying on
  ad hoc logs.
- `customer_quote` keeps its stable sheet id but displays as `報價單`.
- Verification passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/workbook/semantic.spec.ts src/steel/workbook/service.spec.ts src/steel/workbook/repository.spec.ts --runInBand`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts src/steel/workbooks.spec.ts --runInBand`;
  `npm --workspace packages/api run build` with the existing non-Steel Redis
  Rollup TypeScript warning; `npm run build:data-provider`; focused
  `client/src/routes/SteelOAuthChat.spec.tsx` tests for workbook tabs/file
  analysis/image OCR; and `git diff --check`.

## Active: Steel Oral Alias And Cutting Reasoning Design

Goal: make Steel quote flow handle colloquial names such as `3*3鍍鋅方管`
and `3分圓鐵` more like the user's ChatGPT reference by improving the runtime
prompt. The AI should autonomously derive product-name/spec candidates,
preserve adopted model codes, and show traceable 6M stock/cutting
calculations.

- [x] Inspect current price-search, rule, and workbook semantic seams.
- [x] Identify whether workbook schema can carry stock/cutting reasoning.
- [x] Confirm implementation approach with the user before touching production
      code.
- [x] Update runtime prompt docs so AI, not backend deterministic logic,
      generates product-name/spec candidates and 6M stock/cutting calculations.
- [x] Sync reviewed Steel rules if rule text changes.
- [x] Run focused rule sync and changed-file hygiene without Prettier.
- [x] Record review notes and update lessons for this correction.
- [x] Add `erp_item_code` prefix search support to `search_price_candidates`.
- [x] Keep price search broad with OR-style matching across `productNames` and
      `erpItemCodes` so AI can inspect related formal rows instead of receiving
      an empty result too early.
- [x] Keep new broad discovery fields limited to `productNames` and
      `erpItemCodes`: `productNames` searches product-name text and may contain
      product names or partial spec text; `erpItemCodes` searches model/code
      text and may contain exact codes or prefixes.
- [x] Delete `specKeyContains` from the AI price-discovery code path; AI should
      generate multiple formal product-name search strings that include likely
      spec formats inside `productNames`.
- [x] Run live provider smoke for mixed square-pipe, round-iron, C75, and PVC
      request; confirm 方管/圓鐵 have data while PVC is no-data.
- [ ] Add focused workbook regression for no-data search results being represented
      with confidence/missing-data notes instead of disappearing from the quote.

Design notes:

- Current gap: C 型鋼 already has strong oral-name and compact spec guidance,
  but 方管 / 圓鐵 do not have equivalent bounded alias/spec rules. Search must
  be driven by reviewed product-price product names and spec text such as
  `錏方管` + `75*2.0` or `圓鐵` + `9m/m(3/8)(3.3)`; model codes such as
  `GDH3020` and `EQB0090` are not product-name search terms, but exact codes or
  code prefixes may be searched through `erpItemCodes`.
- Workbook semantic fields already support the needed evidence:
  `rawMaterialLength`, `rawMaterialPieceCount`,
  `finishedCountPerRawMaterial`, `remainderLengthOrWeight`, `cuttingFee`,
  `systemOrder.modelCode`, and source/interpretation/manual-review rows.
- User correction: do not add a backend/rule-layer deterministic candidate
  expansion or 6M cutting calculator. Put the behavior in runtime prompt
  instructions. AI autonomously generates product-name/spec candidates such as
  `錏方管` + `75*2.0` or `圓鐵` + `9m/m(3/8)(3.3)`, batches them through
  `search_price_candidates`, then uses the adopted reviewed row for model code,
  unit price, unit, source, and workbook/system-order output.
- Runtime prompt update: `docs/rules/agent規則.txt` now tells AI to generate
  product-name/spec candidates itself, batch them with `candidateQueries`, and
  keep code/prefix lookup in `erpItemCodes` instead of `productNames`.
  `docs/rules/鋼材規則.txt` now tells AI to calculate long-material 6M
  allocation/cutting evidence itself and write the formula into workbook-visible
  fields/notes.
- Grill decision: **Price Code Prefix** / `價格代號前綴` is a domain term. After
  AI finds a product-name candidate, `search_price_candidates` must also support
  broader `erp_item_code` prefix lookup so rows such as `BNG008408`,
  `BNH0054018`, `CCS07520`, `DNB70016`, or `DNB40120` can be returned for AI
  spec judgment even when their formal product names do not repeat the Chinese
  family name.
- Search behavior should be OR-oriented for discovery: `productNames` may carry
  product names and spec fragments, while `erpItemCodes` may carry exact codes
  and price code prefixes. AI then judges which returned row actually matches
  the requested specification.
- Confirmed AI flow: use Chinese product-name data first to find related product
  family rows and price code prefixes, then query related formal spec rows by
  those prefixes, then let AI compare the customer's requested spec against the
  returned formal product names/prices before quoting.
- Boundary: price code prefix expansion is optional. Some product families have
  no useful prefix or already return a matching reviewed row from Chinese
  product-name/spec search, so AI may quote directly without forcing another
  prefix lookup.
- Confirmed tool behavior: keep `search_price_candidates` discovery inputs
  simple. `productNames` means fields to search in product-name text, including
  product names or partial spec text. `erpItemCodes` means fields to search in
  model/code text, including exact item codes or prefixes. If both appear in one
  tool call, backend lookup should OR across them to return all related reviewed
  rows for AI judgment rather than over-filtering and returning no data.
- Confirmed spec behavior: formal price row product names often include the
  relevant spec, so `specKeyContains` should be removed from the AI discovery
  path. AI should generate several likely product-name/spec text forms inside
  `productNames`, for example `75*2.3`, `1.2*4'*10'(35.84)`,
  `1.2*4'*8'(28.5)`, `4.5*5尺*10尺 (46*101.6)`, or
  `150*75*5/7*6M(84)`.
- Confirmed C 型鋼 default: when the customer says C 型鋼 / C 鋼 / 輕型鋼 without
  material, AI should search and quote from `錏輕型鋼` candidates by default, not
  黑鐵輕型鋼.
- Confirmed quote behavior: final workbook/quote output must include the data
  AI used, confidence level, and missing-data notes. If a requested item has no
  returned data, it should still be represented as low-confidence / no-data
  evidence or manual review rather than omitted.
- Supabase sync applied through `packages/api/scripts/sync-steel-rules.cjs`:
  `steel-default-agent-instruction` hash
  `59be0121ab0d2d280d16b3241064ac691aa28f1c564b45a6c2ae2ca806c7c5be`;
  `docs/rules/鋼材規則.txt` quote-rule hash
  `782acbab6c54c84cfb791ec2b10a0a9a0a9afe810baf9d909acc5b33472a530f`.
- Implementation update: `search_price_candidates` schema rejects `specKey` and
  `specKeyContains`, rejects `catalogFamilies`, accepts `erpItemCodes`, coalesces
  same-round direct calls into `candidateQueries`, and repository search ORs
  product-name text with ERP item-code text.
- Prompt update keeps the no-data quote policy: requested items with no returned
  price data must still appear as low-confidence / no-data evidence or manual
  review, but a focused workbook regression remains as follow-up.
- Verification passed:
  `cd packages/api && npx jest src/steel/normalization/search.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --runInBand`;
  `cd packages/api && node scripts/sync-steel-rules.cjs --dry-run`;
  `cd packages/api && node scripts/sync-steel-rules.cjs --apply`;
  `npm --workspace packages/api run build` with the existing non-Steel Redis
  TypeScript warning; `git diff --check`.
- Live mixed oral materials smoke:
  `STEEL_OPENAI_OAUTH_MIXED_ORAL_MATERIALS_TEST=true ... provider.catalog-oral.manual.spec.ts`
  passed against real OpenAI OAuth provider and Supabase. The passing run
  confirmed `GDH3020` / `錏方管 75*2.0` and `EQB0090` /
  `圓鐵 9m/m(3/8)(3.3)` in `search_price_candidates` results, while the final
  response marked `PVC90度彎頭` as no-data / unconfirmed.
- Live smoke fixes made during verification: runtime prompt now keeps oral
  square-pipe / round-iron lookup anchored on product-name/spec text and uses
  `GDH` / `EQB` only as ERP-code prefixes; price repository ordering now ranks
  rows matching more search facets first; batched candidate query results are
  interleaved before tool-output sanitization so one broad line cannot consume
  all 20 visible candidates.
- Follow-up correction: `agent規則.txt` keeps only generic tool-facet guidance:
  Chinese names and specification text go in `productNames`, while English /
  numeric ERP codes and code prefixes go in `erpItemCodes`. Concrete Steel
  material examples such as `GDH`, `EQB`, and C 型鋼 default 錏輕型鋼 now live in
  `docs/rules/鋼材規則.txt`.
- Search truncation note: the AI-facing schema allows `limit` up to 100,
  repositories default/max to 100/100, internal rule/default selection defaults
  to 100, and sanitized tool output caps arrays/source refs at 100 items before
  entering model context. Candidate-query interleaving still keeps multiple
  requested items visible inside that output cap.

## Active: Steel Price Search Batching And Workbook Row Deletion

Goal: make Steel runtime price lookup use one batched `search_price_candidates`
call for related candidate keywords, and make workbook row deletion persist when
the user asks to remove unconfirmed system-order rows.

- [x] Add RED provider coverage for same-round `search_price_candidates`
      calls being coalesced into one backend tool execution when filters are
      compatible.
- [x] Add RED workbook contract/service coverage for a `delete_row`
      operation that removes an existing row and records the accepted patch.
- [x] Add RED semantic workbook coverage that `patch_quote_workbook` can
      project explicit `deleteRows`, while omitted quote lines do not imply
      deletion.
- [x] Implement compatible same-round price-search coalescing without changing
      the reviewed Supabase search semantics.
- [x] Add `delete_row` support through data-provider schemas, data-schemas
      persistence types/schemas, semantic projection, and workbook service
      application.
- [x] Adjust provider tool descriptions/results so AI can request deletion and
      sees projected delete counts/row ids.
- [x] Run focused tests/build checks and changed-file hygiene without Prettier.
- [x] Record review notes and update lessons for this correction.
- [x] Remove the delete-only/system-order exception that skipped full workbook
      completion after user correction, and verify the next AI round still gets
      workbook completion feedback quickly.

Review:

- Root cause q1: `search_price_candidates` already accepted multiple
  `productNames` / `candidateQueries`, but the provider executed sibling
  same-round search calls one by one. Compatible sibling price searches now
  coalesce into one backend executor call with batched `candidateQueries`.
- Root cause q2: workbook patches only supported `set_cell`, so AI could claim
  rows were deleted while backend had no row-delete operation to persist.
  `delete_row` is now supported in shared workbook schemas, provider patch
  proposals, Mongo patch history schema, semantic `deleteRows` projection, and
  workbook service application.
- Correction: delete-only/system-order workbook patches must still use the full
  quote-workbook completion loop. Speed should come from the next AI round
  receiving workbook/tool feedback promptly, not from accepting an incomplete
  patch as final.
- Correction verification: the new provider regression first failed because a
  delete-only patch stopped after one model round; after removing the exception,
  it passes and confirms the next round receives `complete: false` workbook
  feedback before the final complete patch.
- Verification passed:
  `packages/data-provider` focused Jest
  `src/steel/workbooks.spec.ts src/steel/ai.spec.ts`; `packages/api` focused
  Jest
  `src/steel/workbook/semantic.spec.ts src/steel/workbook/service.spec.ts src/steel/ai/provider.spec.ts`;
  handler delete-row regression
  `src/steel/handlers.spec.ts -t "applies provider delete_row"`;
  `npm run build:data-provider`; `packages/data-schemas npm run build`;
  `packages/api npm run build`; and `git diff --check`.
- Caveat: full `packages/api/src/steel/handlers.spec.ts` still has unrelated
  existing file-analysis expectation failures around fixed source columns; the
  delete-row handler regression passes in isolation.

## Active: Remove Rules Contract Tests

Goal: remove tests that directly check human-authored Steel rules contract text
or prompt wording.

- [x] Find tests that inspect rule docs, rule prompt bodies, or wording-only
      rule contracts.
- [x] Delete those rules contract checks while keeping runtime/schema/tool-flow
      tests.
- [x] Run targeted tests and changed-file hygiene without Prettier.
- [x] Update lessons for this correction.

Review:

- Deleted the direct OCR rule contract checks from
  `packages/api/src/steel/vision/ocr.spec.ts`; the spec no longer reads
  `docs/rules/OCR規則.txt` or asserts human-authored rule wording.
- Searched Steel frontend/backend test files for `readOcrRules`,
  `hasAnyConcept`, `hasAllConcepts`, `docs/rules`, `OCR規則`, `agent規則`,
  `workbook規則`, and `鋼材規則`; no remaining direct rule-doc wording tests
  were found.
- Kept runtime/schema/tool-flow tests in place, including data-provider public
  contracts and Supabase-backed runtime rule fixture paths.
- Verification: `src/steel/vision/ocr.spec.ts` passed after the removal, and
  changed-file `git diff --check` passed. No Prettier was run.

## Active: Steel OCR Formula Mismatch Correction Rule

Goal: add OCR correction guidance for inconsistent multiplication formulas so
AI trusts the formula operands over the OCR-rendered result.

- [x] Update `docs/rules/OCR規則.txt` so examples like `1×12=6` and `1×2=4`
      are corrected to formula-derived results.
- [x] Sync the updated OCR rule to Supabase `steel.agent_rules`.
- [x] Run changed-file hygiene without Prettier.
- [x] Record the result and update lessons for this correction.

Review:

- Updated `docs/rules/OCR規則.txt` to treat multiplication formula/result
  mismatch as an OCR correction case: if OCR shows `1×12=6`, use the formula
  operands and correct it to `1×12=12`; if OCR shows `1×2=4`, correct it to
  `1×2=2`.
- Removed the extra OCR contract spec added during the first pass after user
  correction: OCR contract-only rule text updates should not add dedicated test
  logic.
- Synced the OCR rule to Supabase `steel.agent_rules`; readback hash:
  `83d7f10f6ab44fddd972d3685cb3854ca802252bfcbcf7443413a137f8b3c5f8`.
- Verification: `sync-steel-ocr-rules.cjs --dry-run` and `--apply` passed;
  `git diff --check` passed for touched files. No Prettier and no extra OCR
  contract tests were added.

## Active: Steel OCR Rule Fixed Columns And Terminated Errors

Goal: update OCR rules for `1/t` thickness corrections, guarantee
`file_analysis_data` rows expose filename/page marker columns, and replace bare
`terminated` stream errors with actionable provider-termination detail.

- [x] Update OCR rule source for thickness-tail `1` versus `t`
      disambiguation without dedicated OCR contract test logic.
- [x] Add RED file-analysis service coverage that `file_analysis_data` patches
      always include fixed filename and page marker columns/cells.
- [x] Add RED stream coverage that a provider `terminated` error is summarized
      with an explicit provider-termination reason, not just `terminated`.
- [x] Update OCR rules and backend normalization with minimal blast radius.
- [x] Run focused API/data-provider tests, build checks, and changed-file
      hygiene without Prettier.
- [x] Record review notes and lessons for this correction.

Review:

- Updated `docs/rules/OCR規則.txt` so thickness-like OCR tails such as
  `341×500×101` are checked against surrounding material-table context and
  corrected to `341×500×10t` when `t` is the likely thickness marker.
- Changed `file_analysis_data` from fully AI-defined columns to fixed source
  columns plus AI-defined material columns: `檔案名` and `標記頁數` are always
  first, while spec/quantity/process/note columns remain AI-controlled.
- Added backend normalization in the file-analysis service so persisted rows
  receive `source_filename` and `source_page` cells from `sourceRef`, even when
  AI omits those columns.
- Added `provider_terminated` as a Steel provider error category. Bare
  `terminated` stream failures now become an actionable provider-termination
  summary instead of a one-word error.
- Synced the OCR rule to Supabase `steel.agent_rules`; readback hash:
  `ff7d8f342b05d8ecef0a7aba870735499a53835f70b2a3ce11fea8759f5b14b2`.
- Verification: RED file-analysis fixed-column and provider-terminated tests
  failed before implementation; GREEN file-analysis focused specs, handler
  focused stream specs, and data-provider Steel AI spec passed;
  `npm run build:data-provider` passed, and
  `packages/api` build passed with the existing Redis `cacheFactory.ts` Rollup
  TypeScript warning. `git diff --check` passed for touched files.

## Active: Steel OCR Patch Completion Status

Goal: when `patch_file_analysis_data` progress reaches the PDF `pageCount`,
stop reporting an OCR continuation and let the model produce the final summary.

- [x] Add RED provider coverage that final-page file-analysis patch status is
      not reported as `preparing OCR continuation`.
- [x] Keep pending-page behavior unchanged: after page 1 of a multi-page PDF,
      backend still forces the next `run_file_ocr`.
- [x] Update provider status emission so continuation wording appears only when
      `getPendingFileAnalysisPdfPage` finds another page.
- [x] Run focused provider/handler tests and changed-file checks without
      Prettier.
- [x] Record the result and update lessons for this correction.

Review:

- Root cause: provider emitted `patch_file_analysis_data received; preparing
  OCR continuation` for every accepted file-analysis patch, before separating
  final-page completion from pending-page continuation.
- Added RED provider coverage for a 2-page PDF: page 1 still reports
  continuation and forces page 2, while page 2 reports OCR complete and prepares
  the final summary instead of another continuation.
- Updated provider status emission to reuse the tracked
  `getPendingFileAnalysisPdfPage` result after patch progress is recorded.
  Pending pages keep the continuation message; no pending PDF page now reports
  `OCR complete; preparing summary`; non-PDF visual patches report
  `preparing summary`.
- Verification: RED focused provider test failed on the old final-page
  continuation message; GREEN `src/steel/ai/provider.spec.ts` passed 27 tests;
  handler file-analysis/OCR stream focused tests passed 6 tests;
  `packages/api` build passed with the existing Redis `cacheFactory.ts` Rollup
  TypeScript warning; `git diff --check` passed for touched files.

## Active: Steel OCR Rule Scope And Table Cell Clamping

Goal: narrow OCR `patch_file_analysis_data` rules to quote-relevant material
data only, remove workbook guidance from OCR rules, and keep workbook /
file-analysis table cells readable without long text stretching row height.

- [x] Add failing regression coverage for OCR rule scope and table cell clamp
      classes.
- [x] Update `docs/rules/OCR規則.txt` so file analysis patches only store
      material/spec/note/quote-relevant data and avoid project/person/date/place
      metadata.
- [x] Remove quote workbook instructions from OCR rules.
- [x] Update workbook and file-analysis table cells to use stable column widths
      and clamp display text to at most two lines.
- [x] Update `tasks/lessons.md` with the new agent formatting and OCR scope
      corrections.
- [x] Run focused tests and changed-file checks without Prettier.

Review:

- Narrowed `docs/rules/OCR規則.txt` so `patch_file_analysis_data` stores only
  quote-relevant material/spec/size/quantity/process/price data plus concise
  notes/review items, and explicitly excludes project names, engineering names,
  dates, places, people, owners, addresses, and other non-quote metadata.
- Removed OCR-rule references to workbook patching and synced the updated
  `steel-drawing-ocr-policy` row to `steel.agent_rules`; readback hash:
  `c8cabab9631e450a6211ee354e177e91ce387261e957b6dcd6e0c6f09f9b7a10`.
- Updated workbook and file-analysis table display cells to use stable max
  widths and `line-clamp-2`, so long text is capped at two lines while hover
  `title` preserves the full value.
- Verification passed:
  `cd packages/api && npx jest src/steel/vision/ocr.spec.ts --runInBand --silent --no-coverage`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `npm run build:client`; and OCR rule sync dry-run/apply.
  Client build still emits existing large chunk / PWA glob warnings.

## Active: Steel Conversation-Scoped Update Routes

Goal: make all Steel save/update payloads resolve the target workbook or
`file_analysis_data` through backend-owned `conversationId`, and disable the
old id-based update routes so the frontend cannot choose a different workspace.

- [x] Add failing regression coverage for conversation-scoped workbook and
      file-analysis manual patch routes.
- [x] Disable old id-based workbook/file-analysis update routes.
- [x] Update shared endpoints, request schemas, and data-service helpers to use
      `conversationId` as the update key.
- [x] Update backend handlers/services to resolve or create the unique
      conversation-bound workbook/file analysis before patching.
- [x] Update frontend manual save/update payloads to stop using workbook or
      file-analysis ids as update keys.
- [x] Run focused tests, builds, and changed-file hygiene checks.

Review:

- Disabled old id-based update handlers:
  `PATCH /api/steel/workbooks/:workbookId` and
  `PATCH /api/steel/file-analysis/:fileAnalysisDataId` now return `410`.
- Added conversation-scoped update routes:
  `PATCH /api/steel/workbooks/by-conversation/:conversationId` and
  `PATCH /api/steel/file-analysis/by-conversation/:conversationId`.
- Removed top-level `workbookId` from the public workbook patch request body and
  removed body `conversationId` from manual file-analysis patch payloads; the
  route conversation id is the update key.
- Added `patchByConversationMetaId()` to the workbook service so the backend
  resolves or creates the unique active workbook before applying a patch.
- Frontend manual file-analysis saves now call the data-service with
  `conversationId`, not `fileAnalysisData.id`, and no longer include body
  `conversationId`.
- Verification passed:
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts src/steel/vision.spec.ts src/steel/workbooks.spec.ts --runInBand --silent --no-coverage`;
  `cd packages/api && npx jest src/steel/workbook/service.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/vision/analysis.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `npm run build:data-provider`; `cd packages/api && npm run build`; and
  `npm run build:client`.
  `packages/api` build still emits the pre-existing Redis `cacheFactory.ts`
  type warning; client build still emits existing large chunk / PWA glob
  warnings.

## Active: Steel File Analysis Mongo Schema And Index Cleanup

Goal: remove `file_analysis_data.workbookId` from the persisted data contract so
file analysis is linked to the active workbook only through backend-owned
`conversationId`, then verify Steel Mongo collections have indexes matching
their repository query paths.

- [x] Add failing regression coverage proving `file_analysis_data` no longer
      exposes or persists `workbookId`.
- [x] Remove `workbookId` from file-analysis shared schemas, Mongo schema,
      service inputs, handler persistence, context payloads, and frontend manual
      patch payloads.
- [x] Audit Steel Mongo repository query paths against declared Mongoose
      indexes.
- [x] Add or adjust index tests for the query paths that should be indexed.
- [x] Run focused tests, builds, and changed-file hygiene checks.

Review:

- Removed `workbookId` from the shared `SteelFileAnalysisData` and manual patch
  schemas, the Mongo `steel_file_analysis_data` schema/document type, file
  analysis service patch inputs, AI file-analysis context payloads, and the
  frontend manual save payload.
- Kept top-level chat/workbook `workbookId` behavior only as workspace
  continuation metadata; it is no longer stored inside `file_analysis_data`.
- Mongo repository query audit:
  `steel_file_analysis_data` reads/upserts by `conversationId`;
  `steel_workbooks` reads/upserts by `workbookId` and reads active workbooks by
  `conversationMetaId + status`; `steel_workbook_patches` history reads are
  covered by workbook/version compound indexes; current audit/rule proposal
  repositories are append-only.
- Live Mongo database `test` was checked and corrected:
  12 `steel_file_analysis_data` documents had `workbookId` unset; unique
  `fileAnalysisDataId_1` and `conversationId_1` indexes were created; missing
  `steel_workbook_patches` compound indexes
  `workbookId_1_afterVersion_-1` and `workbookId_1_beforeVersion_1` were
  created. Follow-up readback confirmed `withWorkbookId: 0`.
- Verification passed:
  `cd packages/data-schemas && npx jest src/schema/steel.spec.ts --runInBand --silent --no-coverage`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts src/steel/vision.spec.ts src/steel/workbooks.spec.ts --runInBand --silent --no-coverage`;
  `cd packages/api && npx jest src/steel/vision/analysis.spec.ts src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/workbook/service.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `npm run build:data-provider`; `cd packages/data-schemas && npm run build`;
  `cd packages/api && npm run build`; and `npm run build:client`.
  `packages/api` build still emits the pre-existing Redis `cacheFactory.ts`
  type warning; client build still emits existing bundle/PWA/chunk warnings.

## Active: Steel Workbook Reopen Context Fix

Goal: ensure persisted Steel workbooks follow the same backend-owned
`conversationId` workspace as `file_analysis_data`, so reopened chats can render
the saved workbook and later AI turns can continue from the same DB state.

- [x] Confirm backend AI context already resolves workbook data by
      `conversationId` through `readByConversationMetaId()`.
- [x] Add a read-by-conversation backend route for persisted workbooks.
- [x] Add data-provider endpoint/service types for nullable workbook reload by
      conversation id.
- [x] Reload persisted workbook data on Steel OAuth Chat mount when the URL has
      `conversationId`.
- [x] Verify the next chat turn sends the same `conversationId` without
      frontend-owned `workbookId` / `workbookVersion`.

Review:

- Backend AI context was already correct for workbook continuation:
  `getChatWorkbookContextText()` reads the active workbook by
  `conversationId -> conversationMetaId` when frontend workbook ids are absent.
- Missing piece: reopened frontend sessions could reload `file_analysis_data`
  but not the paired workbook, so the UI could look empty even though backend AI
  context could still read DB workbook state.
- Fixed by adding `GET /api/steel/workbooks/by-conversation/:conversationId`,
  shared data-provider typing/service support, and a frontend mount-time reload
  effect that restores the workbook only when a persisted conversation workspace
  exists.
- Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/workbook/service.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts src/steel/vision.spec.ts src/steel/workbooks.spec.ts --runInBand --silent --no-coverage`;
  `npm run build:data-provider`; `cd packages/api && npm run build`;
  `npm run build:client`; and changed-file `git diff --check`.
  `packages/api` build still emits the pre-existing Redis `cacheFactory.ts`
  type warning; client build still emits existing bundle/PWA/chunk warnings.

## Active: Steel File Analysis Reopen Context Fix

Goal: ensure persisted OCR `file_analysis_data` survives reopening a Steel chat
and is loaded by the backend into the next AI request context.

- [x] Add a read-by-conversation backend route for persisted
      `file_analysis_data`.
- [x] Add data-provider endpoint/service types for loading analysis by
      conversation id.
- [x] Make the Steel OAuth Chat URL carry the backend `conversationId` after a
      real workspace exists, and reload persisted File Analysis data from that
      id on mount.
- [x] Verify the next chat turn sends the same `conversationId`, so backend
      context injection can read DB state before calling AI.
- [x] Run focused tests, builds, and changed-file hygiene checks.

Review:

- Database persistence was already handled by `fileAnalysisService.patch()` via
  the Mongo repository during streamed and final patches.
- Backend AI context injection was already present through
  `addFileAnalysisContextToMessages()`, which reads
  `fileAnalysisService.readByConversationId(conversationId)` and appends the
  latest `file_analysis_data` as system context before provider generation.
- Missing piece: after a browser reload, the frontend had no durable way to
  recover the backend-created `conversationId`, so it could not request the
  same workspace or send the same id on the next turn.
- Fixed by adding `GET /api/steel/file-analysis/by-conversation/:conversationId`,
  storing the backend conversation id in the Steel chat URL query, loading
  persisted File Analysis data on mount, and verifying the next AI turn sends
  that id for backend context loading.
- Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/workbook/service.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts src/steel/vision.spec.ts --runInBand --silent --no-coverage`;
  `npm run build:data-provider`; `cd packages/api && npm run build`;
  `npm run build:client`; and changed-file `git diff --check`.
  `packages/api` build still emits the pre-existing Redis `cacheFactory.ts`
  type warning; client build still emits existing bundle/PWA glob warnings.

## Active: Steel File Analysis Stream Visibility Fix

Goal: fix multi-page OCR stream behavior where `patch_file_analysis_data
received; preparing OCR continuation` appears, but the frontend still has no
visible `file_analysis_data` until the whole AI turn finishes.

- [x] Reproduce the missing data path with a stream handler regression: a
      persisted `file_analysis_data` event must appear before the next
      `run_file_ocr started` event.
- [x] Add the public stream contract for a `file_analysis_data` NDJSON event.
- [x] Persist streamed `patch_file_analysis_data` tool payloads immediately,
      emit the updated workspace to the frontend, and avoid double-applying the
      cumulative final patch.
- [x] Update the frontend to render streamed file analysis data immediately
      and select the File Analysis tab before final assistant text arrives.
- [x] Run focused tests, builds, and changed-file hygiene checks.

Review:

- Root cause: `patch_file_analysis_data received; preparing OCR continuation`
  was only provider-loop status. The handler did not persist the parsed patch
  or emit a data-bearing event until `sendChat()` returned the final result, so
  the model could continue to page 2 while the UI still had no rows.
- Fixed by letting provider `onToolStatus` carry the parsed
  `fileAnalysisPatch`, awaiting the stream handler's persistence callback
  before OCR continuation, and emitting a first-class
  `type: "file_analysis_data"` stream event with the updated workspace.
- Frontend now treats `file_analysis_data` as state, not as timeline text:
  it updates `fileAnalysisData`, keeps the returned conversation id, opens the
  File Analysis tab, and still waits for the final `done` response for chat
  text.
- Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/workbook/service.spec.ts --runInBand`;
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts --runInBand --silent --no-coverage`;
  `npm run build:data-provider`; `cd packages/api && npm run build`;
  `npm run build:client`; and changed-file `git diff --check`.
  `packages/api` build still emits the pre-existing Redis `cacheFactory.ts`
  type warning; client build still emits existing bundle/PWA glob warnings.

## Active: Steel File Analysis Patch ConversationId Fix

Goal: fix the `/steel/oauth-chat` stream path where `patch_file_analysis_data`
is acknowledged by the provider but persistence fails with
`conversationId is required to persist file_analysis_data`, leaving the File
Analysis panel empty while OCR continues.

- [x] Trace how `/steel/oauth-chat` creates/sends `conversationId` for stream
      requests and how handlers persist `file_analysis_data`.
- [x] Add failing regressions proving backend resolves workbook/file analysis
      by conversation id, creates ids only on first real patch, and frontend
      reuses the returned conversation id without owning workbook ids.
- [x] Implement backend-owned conversation workspace resolution so OCR patches
      and workbook patches update the same conversation-scoped workbook and
      `file_analysis_data`.
- [x] Verify File Analysis data is returned/streamed when
      `patch_file_analysis_data` succeeds.
- [x] Run focused tests, build/type checks, and changed-file hygiene checks.

Review:

- Root cause: stream persistence still required the request body to carry
  `conversationId`; when the model produced `patch_file_analysis_data` before
  the frontend had any workbook/context ids, handler persistence rejected the
  patch and the File Analysis panel stayed empty.
- Backend now owns the conversation workspace. A chat turn can start without
  frontend workbook ids; the handler resolves an active workbook by
  `conversationMetaId`, lazily creates one only when a real
  `file_analysis_data` or workbook patch must persist, and returns the
  backend-created `conversationId` / `workbookId`.
- Frontend no longer creates an empty workbook on mount or new chat. It sends
  no workbook ids on the first turn, stores only the returned conversation id,
  and reuses that id on later turns while displaying workbook data only after a
  backend workbook patch returns.
- Verification passed:
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --silent --no-coverage`;
  `cd packages/api && npx jest src/steel/workbook/service.spec.ts src/steel/handlers.spec.ts --runInBand`;
  `npm run build:data-provider`; `npm run build:client`;
  `cd packages/api && npm run build`; and changed-file `git diff --check`.
  `packages/api` build still emits the pre-existing Redis `cacheFactory.ts`
  type warning; client build still emits existing bundle/PWA glob warnings.

## Active: Steel OCR PDF Page Count And Post-OCR Continuation Fix

Goal: fix the observed `/steel/oauth-chat` OCR behavior where `d.pdf` is treated
as one page because the model does not see backend PDF page-count metadata, and
make the post-OCR continuation observable instead of appearing stuck after
`run_file_ocr completed`.

- [x] Add a focused provider regression test proving the first OCR prompt
      includes backend-known PDF `pageCount` metadata.
- [x] Add a focused provider regression test proving multi-page OCR patches
      accumulate all page patches in one chat turn.
- [x] Merge backend-resolved PDF page counts back into the prompt-visible
      attachment inventory and continue pending pages from backend progress.
- [x] Surface provider-side `patch_file_analysis_data` acknowledgement in the
      stream so users see progress after OCR output returns.
- [x] Run focused provider/handler/OCR tests plus changed-file hygiene checks.

Review:

- Root cause: provider resolved PDF page counts for internal progress tracking
  but built the initial prompt from the original message files, so the model
  saw only `filename` and `mediaType` and could claim it did not know total
  pages.
- Fixed prompt inventory so backend-known PDF metadata is visible as
  `pageCount=<n>; pages=1-<n>`.
- Fixed provider patch aggregation so multi-page OCR in one chat turn returns
  all `patch_file_analysis_data` patches instead of only the last page patch.
- Reduced the post-OCR silent gap by streaming
  `patch_file_analysis_data waiting for AI to convert OCR result`, then
  `patch_file_analysis_data received; preparing OCR continuation`, before the
  later persistence status.
- Verification passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/vision/ocr.spec.ts --runInBand`;
  `cd packages/api && npm run build`; and changed-file `git diff --check`.
  Build exited 0 with the pre-existing Redis `cacheFactory.ts` type warning.

Scope boundary: Admin review UI is paused. The pause applies to visible Admin
screens only. Continue sequencing backend/data/tool work for quote runtime,
calculation, rule proposal review APIs, approval/publish flows, and reviewed
quote defaults retrieval when each slice is ready. Do not build Admin screens
until the user explicitly reopens UI scope.

## Active: Steel v8.3 Phase 6C File/PDF/OCR/Drawing Evidence Flow Plan

Goal: write an implementation and test plan for quote-conversation evidence
attachments: PDF, images, scanned drawings, and spreadsheet evidence. The first
OCR correctness fixture is `docs/reference/example/c.pdf`, with expected plate
schedule rows captured as JSON for comparison. Evidence first becomes
one conversation-scoped `file_analysis_data` workspace; rows are marked with
source file/page/region so the user can verify or correct extracted tables
against each PDF/image, then confirmed analysis can create rows in the single
quote workbook plus `manual_review` and `interpretation_notes`. It must not
create Admin import source versions or formal database writes.

- [x] Strengthen Supabase workbook rules so quote workbook product rows must
      record whether their order/source evidence came from `file_analysis_data`
      or direct user conversation, including the source row id/sourceKey/page
      when `file_analysis_data` exists.
- [x] Sync the strengthened workbook rule into reviewed Supabase
      `steel.agent_rules`.
- [x] Add a unified Supabase sync path for every tracked Steel rule file under
      `docs/rules`: agent, workbook, OCR, and quote-rule policy.
- [x] Remove rule-text content tests so runtime tests use Supabase-backed rules
      or Supabase-shaped fixtures instead of reading `docs/rules/*.txt`.
- [x] Split `docs/rules/鋼材規則.txt` Supabase quote rules by catalog key so one
      `lookup_quote_rules` call can return rules for multiple products.
- [x] Delete the whole/company-level `docs/rules/鋼材規則.txt` quote rule so only
      catalog-key-specific rules remain.

- [x] Inspect existing Phase 6C plan, file-analysis config boundary, Steel chat
      attachment path, provider file serialization tests, and semantic workbook
      projection.
- [x] Save the detailed implementation plan under `docs/plans/`.
- [x] Incorporate the OCR rules DB flow: `docs/rules/OCR規則.txt` syncs into
      reviewed active `steel.agent_rules` and visual OCR turns load that rule
      before provider generation.
- [x] Incorporate the user-confirmed `file_analysis_data` flow: AI can create
      a verifiable extracted table first, later turns can re-read original
      files, and confirmed analysis can create/update quote workbook rows.
- [x] Incorporate the fixed provider boundary: uploaded evidence is stored
      through LibreChat file storage and Mongo `File` records, then resent as
      bytes/file parts to `openai_oauth_responses`; no official OpenAI Files API
      or provider-state retention is used for Phase 6C.
- [x] Implement Phase 6C Task 0 first slice: sync `docs/rules/OCR規則.txt`
      into `steel.agent_rules`, load reviewed OCR rules for visual
      `openai_oauth_responses` turns, and fail before provider generation when
      visual OCR lacks reviewed rules.
- [x] Implement Phase 6C Task 1 first slice: add `c.png` expected JSON fixture,
      drawing evidence Zod schema, normalized row comparison, field accuracy,
      and mismatch reporting.
- [x] Implement Phase 6C Task 2 first slice: add quote evidence attachment
      classifier for image/PDF/spreadsheet/unsupported files and distinguish
      durable Mongo `File` records from inline smoke/backcompat file payloads.
- [x] Continue Phase 6C Task 2: add injected resolver for
      `fileId -> Mongo File record -> storage bytes -> openai_oauth_responses`
      file part, with owner/conversation access checks before storage reads.
- [x] Wire durable `files[].fileId` through `/steel/oauth-chat`: handler accepts
      persisted file refs, resolves them through the injected resolver, and the
      `/api` route thin wrapper reads bytes through LibreChat `getFiles` plus
      configured storage `getDownloadStream`.
- [x] Apply user correction: remove Steel helper npm scripts from
      `packages/api/package.json`; run one-off Steel scripts directly with
      `node packages/api/scripts/<script>.cjs`.
- [x] Verify touched-file hygiene with tracked `git diff --check` plus new-plan
      trailing-whitespace/newline checks.
- [x] Apply user correction: `buildDrawingEvidencePrompt` now treats Supabase
      OCR rules as the source of truth and only composes DB-loaded rules plus
      the current user request.
- [x] Implement Phase 6C Task 4 provider extraction service: call AI with
      original provider file parts and DB-loaded OCR rules, return an analysis
      candidate only, and leave `file_analysis_data` persistence plus workbook
      projection to later tasks.
- [x] Apply user correction: one conversation/order has one
      `file_analysis_data` workspace, and multiple uploaded file rows are
      distinguished by source file/page/region metadata.
- [x] Implement Phase 6C Task 5 foundation: shared flexible
      `file_analysis_data` schemas, single-workspace patch service,
      Mongo collection/repository, and `patch_file_analysis_data` provider tool.
- [x] Implement Phase 6C Task 5b: persist provider `fileAnalysisPatch` in the
      chat handler and return the updated conversation-scoped workspace.
- [x] Implement Phase 6C Task 5c: add a right-panel File Analysis tab that
      mirrors workbook sheet-tab table UX for `file_analysis_data`.
- [x] Update `docs/rules/OCR規則.txt` so reviewed OCR rules instruct AI to
      use `patch_file_analysis_data` for unconfirmed file/PDF/image
      interpretation and summarize the current patch.
- [x] Implement manual `file_analysis_data` correction flow: users can edit
      cells, add rows, delete rows with a left-side small icon button, save
      only the editable `file_analysis_data` sheet through a manual patch API,
      and the next Steel chat turn receives the latest saved file analysis
      workspace as AI context.
- [x] Add an end-to-end smoke for image upload OCR flow: user uploads an image,
      AI patches `file_analysis_data`, user manually corrects it, saves through
      the manual patch API, and the next chat turn reads the corrected saved
      file-analysis workspace.
- [x] Record that the gated live OAuth c.pdf OCR full-accuracy attempt failed
      against `docs/reference/example/c.pdf` and is superseded by the
      PaddleOCR MCP c.pdf accuracy test.
- [x] Switch Steel OCR policy to PaddleOCR MCP: update
      `docs/rules/OCR規則.txt` to make PaddleOCR MCP the required OCR engine
      for PDF/image/table OCR instead of OpenAI OAuth built-in OCR.
- [x] Add project MCP configuration for `PaddleOCR-VL-1.6` using
      `paddleocr-mcp` and `.env` key `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN`.
- [x] Replace the gated live c.pdf OCR accuracy test with a PaddleOCR MCP live
      test that validates table row data against `c.expected.json`; matching
      only requires equivalent OCR table values, not identical field names.
- [x] Verify normal tests skip the live PaddleOCR call by default, and record
      the exact live-test command/token prerequisite.
- [x] Simplify `docs/rules/OCR規則.txt` into the approved PaddleOCR MCP
      process contract: one image/page per task, patch after each page, report
      progress, resume without reprocessing completed pages, no OpenAI OCR
      fallback, and support manual table corrections without rerunning OCR.
- [x] Strengthen `patch_file_analysis_data` data contracts so source/page/image
      refs carry OCR engine/status/progress metadata and source-key upserts can
      update a reprocessed page/image instead of duplicating rows.
- [x] Verify the focused schema/service/provider behavior and sync the updated
      OCR rule source to reviewed active `steel.agent_rules`.
- [x] Add a gated PaddleOCR MCP multi-page PDF smoke for
      `docs/reference/example/d.pdf` that rasterizes and processes one page at a
      time, patching progress semantics instead of sending the full PDF in one
      call.
- [x] Update the OCR policy so user messages `繼續` and `go` both mean resume
      pending OCR work unless the user explicitly says to reprocess.
- [x] Fix uploaded PDF/image OCR execution: expose `run_file_ocr` as a Steel
      tool for visual evidence turns, execute it through the backend PaddleOCR
      MCP wrapper against current uploaded file bytes, feed OCR results back
      into the provider loop before `patch_file_analysis_data`, and sync the
      updated agent/OCR rules into reviewed Supabase `steel.agent_rules`.
- [x] Fix multi-page PDF OCR auto-continuation when the model tries to answer
      after page 1 even though `file_analysis_data` source refs show more PDF
      pages are pending.
- [x] Update Steel rules so drawing-derived 柱底板 / 連接板 / 加勁板 default to
      black iron plate pricing when dimensions and thickness are available,
      using theoretical rectangular plate weight instead of blocking the quote
      on material confirmation.
- [x] Extract 鋼軌 / 方鋼 / 圓鋼 handbook rows from
      `docs/reference/龍頂鋼鐵手冊__文字版.docx`, calculate density from
      section area and kg/m, and record the reviewed density table in Steel
      agent/quote rules.
- [x] Sync the updated density and theoretical-weight rules into reviewed
      Supabase Steel rules and read back the updated rows.
- [x] Fix multi-page PDF OCR continuation when page 1 is patched without
      `sourceFiles.pageCount`: provider must initialize page progress from PDF
      attachment page count, not from single-page OCR output, so `d.pdf`
      continues to page 2 automatically.
- [x] Correct Steel plate default pricing wording: drawing-derived plate parts
      must use 黑板 as the default `search_price_candidates` primary query and
      adopted product candidate, not 黑鐵/黑鐵板.
- [x] Correct Steel plate product-name rules: SS400 and 黑皮板 are not product
      names; plate price lookup must use the reviewed product names provided by
      the user, including 鐵板, 黑鐵板, 黑板, 錏鐵板/錏板, and 白鐵板/白鐵.
- [x] Delete Steel rules tests: rules are text/database contracts and should be
      verified by Supabase sync/readback or runtime smoke, not committed rule
      specs.
- [x] Diagnose and speed up Supabase-backed Steel lookup/search tools by
      measuring query plans, query counts, indexes, and tool-loop batching.
- [x] Fix `run_file_ocr` multi-page PDF failures where page 1 can succeed but
      page 2 fails with `Cannot transfer object of unsupported type`.

Review:

- Active investigation: Steel lookup/search tools feel slow from the UI. Need
  separate database query latency from AI tool-loop latency before changing
  indexes or batching logic.
- Root cause found: warm Supabase cloud round trips are roughly 240-300 ms per
  query, while measured SQL execution for representative price lookups is
  sub-3 ms after filtering. The visible slowness was mostly tool/repository
  query count, especially `search_price_candidates` looping once per
  `productName`, with missing trigram indexes as the scaling risk for
  `%...%` searches.
- Fixed `search_price_candidates` direct `productNames` lookup so shared
  filters are sent as one SQL OR query instead of one query per product name.
  The live plate lookup case dropped from the earlier 5 SQL calls / about
  1467 ms to 1 SQL call / about 298 ms.
- Fixed `candidateQueries` price lookup so each candidate query batches its
  product-name alternatives into one SQL query and still carries
  `customerTierId`; the live C-type candidate case now uses 1 SQL call / about
  249 ms and returns only the requested tier/global candidates.
- Preserved product-name-derived size filters while batching, so candidates
  like `錏成型角鐵 L30x30` and `鍍鋅角鐵 L40x40` stay bounded by their own
  `spec_key ILIKE` terms inside the OR branches.
- Added and applied Supabase `pg_trgm` search support: `pg_trgm` extension plus
  GIN trigram indexes on `steel.price_items.product_name`,
  `steel.price_items.spec_key`, `steel.customers.display_name`,
  `steel.customers.legal_name`, and `steel.customer_aliases.alias`; readback
  confirmed all five indexes exist on the cloud database.
- `EXPLAIN ANALYZE` evidence: batched plate price lookup executed in about
  2.9 ms using the existing `price_items_catalog_family_lookup_idx`; C-type
  `%100x2.3%` lookup executed in about 0.4 ms using
  `price_items_spec_key_trgm_idx`.
- Rejected a naive `lookup_quote_rules` parallel-query change after live
  timing: it made the tool slower in this environment by opening cold extra
  Supabase connections. Further lookup-rule acceleration should use a single
  SQL/CTE shape or short-lived server cache, not blind `Promise.all`.
- Remaining bottleneck: `lookup_catalog_families` still performs 2 Supabase
  queries and measured about 512 ms for `白鐵`; this is expected from two cloud
  round trips and is a good next target if UI still feels slow.
- Verification passed: cloud index readback, live tool timing, `EXPLAIN
  ANALYZE`, `packages/api` focused Jest for price repository/tool behavior,
  `packages/api` build, `git diff --check`, backend restart, and
  `localhost:3080/api/config` plus `localhost:3090/api/config` both returned
  HTTP 200.
- Root cause for latest `run_file_ocr` failure: pdfjs can transfer/detach the
  `Uint8Array` passed into `getDocument`. The handler/provider reused the same
  uploaded PDF bytes across page 1 and page 2, so page 1 OCR could complete and
  page 2 immediately failed with `Cannot transfer object of unsupported type`.
- Fixed `getSteelFileBytes` so OCR receives a fresh byte copy for every
  page-count/page-render operation, preserving the original uploaded file bytes
  for later pages and resume processing.
- Live verification passed against `docs/reference/example/d.pdf`: direct
  `runSteelFileOcr` processed page 1 and page 2 sequentially from the same
  source bytes, both `ok: true`.
- Regression verification passed: `ocr.spec.ts`, focused provider OCR
  auto-continuation tests, `packages/api` build, `git diff --check`, backend
  restart, and `localhost:3080/api/config` plus `localhost:3090/api/config`
  both returned HTTP 200.
- User correction: do not write or keep tests whose primary subject is Steel
  rules. Deleted `packages/data-provider/src/steel/rules.spec.ts`,
  `packages/api/src/steel/rules/service.spec.ts`,
  `packages/api/src/steel/repositories/rules.spec.ts`,
  `packages/api/src/steel/repositories/instructions.spec.ts`,
  `packages/api/src/steel/vision/prompt.spec.ts`, rule-loading/prompt-only
  cases from provider/vision specs, rule proposal handler coverage, material
  rule repository coverage, and quote-rule lookup-only cases from
  `packages/api/src/steel/tools/execute.spec.ts`.
  Remaining `lookup_quote_rules` mentions are runtime/chat-flow fixtures or
  stream status values, not tests whose primary subject is rules.
- Latest correction supersedes earlier wording that treated SS400 or 黑皮板 as
  plate product candidates. SS400 is now only a material/spec note, and 黑皮板
  is not a product name.
- Updated `docs/rules/agent規則.txt`, `docs/rules/鋼材規則.txt`, and
  `docs/rules/workbook規則.txt` so plate lookup uses only reviewed product
  names: 鐵板、槽型鐵板、ST 鐵板、2B 鐵板、ST 2B、ST HL、黑鐵板、黑板、
  錏鐵板、錏板、白鐵板、白鐵.
- Updated `packages/api/src/steel/importer/reference.ts` and current Supabase
  `steel.catalog_families` rows so `lookup_catalog_families` can return those
  plate aliases. `black_plate` aliases are 黑板/黑鐵板, `galvanized_plate`
  aliases are 錏鐵板/錏板, and generic `plate` carries the full reviewed
  plate product-name list.
- Added exact alias ranking in `lookupSteelCatalogFamilies` so short searches
  such as 白鐵 return `plate` within the default tool limit, while 黑鐵板 and
  錏鐵板 prefer their specific families before generic `plate`.
- `node packages/api/scripts/sync-steel-rules.cjs --apply` passed and read back
  active reviewed rules with `steel-default-agent-instruction` sha
  `2a99141fc78179871c30312a81c3300aac68902e4d7510fe3a655b3dcba7865f`,
  `steel-workbook-output-policy` sha
  `4dc2d5d809bf792f4f56b7570d4ebec6778411417e9a00d19ab58aafa81677a5`,
  and `docs/rules/鋼材規則.txt` quote-rule sha
  `9f238d4332186f1a098ee7a52a02af0347ffd740381a7d6a4158589186fa7897`.
- Live `executeSteelTool(lookup_catalog_families)` readback passed: 黑鐵板
  returns `black_plate, plate`; 錏鐵板 returns `galvanized_plate, plate`; 白鐵
  returns `plate` within limit 5; SS400 and 黑皮板 return no catalog family.
- Focused repository test passed:
  `cd packages/api && npx jest src/steel/repositories/families.spec.ts --runInBand`.
  The broader importer reference spec is still blocked by the pre-existing
  missing fixture `docs/reference/H型鋼.txt`, so it was not usable as evidence
  for this alias-only change.
- User correction: `docs/rules/*.txt` are already human-authored rule contracts,
  so do not write tests that assert rule substrings. This pass removed the
  transient workbook provenance policy spec and used Supabase sync/readback
  verification instead.
- Strengthened `docs/rules/workbook規則.txt` with the product-row provenance
  contract: workbook product rows can only derive order evidence from
  `file_analysis_data` or direct `user conversation`; when `file_analysis_data`
  is present, generated quote lines must cite row id/sourceKey/file/page in
  `quote_details.decision_evidence`, `price_sources.note`, or
  `interpretation_notes.evidence`; `customer_quote` must not expose internal
  source refs.
- `node packages/api/scripts/sync-steel-workbook-rules.cjs --dry-run` passed
  with source `docs/rules/workbook規則.txt`, slug
  `steel-workbook-output-policy`, and sha256
  `e4766f0ac8a47d5621b52233d9f2098e8a1fc97be2265030801b770058527f59`.
- `node packages/api/scripts/sync-steel-workbook-rules.cjs --apply` passed and
  read back active reviewed `steel.agent_rules.slug =
  steel-workbook-output-policy`; `output_policy` now has
  `requireProductRowEvidenceSource: true`,
  `allowedOrderEvidenceSources: ["file_analysis_data", "user conversation"]`,
  and evidence targets `quote_details.decision_evidence`,
  `price_sources.note`, `interpretation_notes.evidence`.
- User correction: all rules must be updated to Supabase, tests must use
  Supabase rules, and rule text-content tests must be deleted.
- Follow-up correction: "rule text-content tests" also includes `toContain`,
  `expect.stringContaining`, and `toMatch` assertions against Supabase fixture
  prompt text, provider system prompt wording, OCR rule text, workbook rule
  text, and `lookup_quote_rules` returned rule bodies. Tests should assert
  reviewed-row lookup, canonical keys/slugs/source refs, tool calls, schemas,
  patch results, and visible runtime behavior instead.
- Follow-up cleanup: repository and tool tests must also avoid carrying full
  human-authored rule prompt/default text in fixtures. Use neutral sentinel
  values such as `fixture:<key>` when the test is only verifying DB row mapping,
  lookup facets, source refs, or tool result structure.
- Added `node packages/api/scripts/sync-steel-rules.cjs` as the unified rule
  sync. It syncs `docs/rules/agent規則.txt`,
  `docs/rules/workbook規則.txt`, and `docs/rules/OCR規則.txt` into reviewed
  `steel.agent_rules`, and `docs/rules/鋼材規則.txt` into reviewed
  `steel.quote_rules` for `lookup_quote_rules`.
- Deleted `packages/api/src/steel/vision/paddleocr.policy.spec.ts`, which was
  asserting rule file text. Updated the OCR provider rule-loading test so it
  only proves reviewed Supabase `steel.agent_rules` content is injected before
  provider generation.
- `node packages/api/scripts/sync-steel-rules.cjs --dry-run` passed and listed
  all four rule sources with hashes. `node
  packages/api/scripts/sync-steel-rules.cjs --apply` passed and read back
  active reviewed rows:
  `steel-default-agent-instruction`, `steel-workbook-output-policy`,
  `steel-drawing-ocr-policy`, and quote rule canonical key
  `steel_quote_rules_lookup_policy_zh_tw`.
- Fresh verification for this rule cleanup passed:
  `rg` found no `docs/rules` reads or direct rule-file content checks under
  `packages/api/src` / `packages/data-provider/src` test files;
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="loads reviewed OCR rules|loads workbook output rules"`
  passed; `node -c packages/api/scripts/sync-steel-rules.cjs` passed; and
  `git diff --check` passed.
- User correction: rules are Traditional Chinese only, so rule canonical keys
  should not carry extra `zh_tw` suffixes.
- Superseded intermediate state: `sync-steel-rules.cjs` briefly synced one
  common company rule plus catalog-scoped rules, then the user clarified that
  the standalone whole Steel rule should be deleted.
- User correction: delete the standalone whole Steel rule and keep only
  catalog-key-specific `docs/rules/鋼材規則.txt` rules.
- Updated `sync-steel-rules.cjs` so `docs/rules/鋼材規則.txt` no longer creates
  a company/common quote rule. The sync now deletes removed quote rules for
  that source instead of merely setting them inactive.
- User correction: after a user confirms `file_analysis_data` and asks for a
  quote, a response that updates both `fileAnalysisData` and the workbook must
  show the Workbook tab, not leave the right panel on File Analysis.
- Added a focused Steel OAuth chat UI regression test for
  `workbookPatch.workbook + fileAnalysisData` responses and updated
  `/steel/oauth-chat` so workbook patches open/select Workbook while
  file-analysis-only responses still open/select File Analysis.
- Follow-up correction: `workbookPatch.workbook` alone must also open/select
  Workbook. Added a focused regression where the user starts on File Analysis,
  receives only a workbook patch, and the UI switches back to Workbook.
- User correction: when `d.pdf` has two pages, page 1 `patch_file_analysis_data`
  must not end the turn if the user did not press stop. Added provider
  progress tracking for PDF `file_analysis_data` patches: completed/failed/
  skipped page refs are accumulated per file, and a premature final answer is
  rejected while `pageCount` still has pending pages. The next provider round
  is forced to `run_file_ocr` for the pending page.
- Verification for the multi-page continuation fix passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand`;
  `cd packages/api && npm run build`; and `git diff --check`. The build still
  reports the pre-existing Redis `cacheFactory.ts` type warning only. Backend
  was restarted on port 3080 and `http://localhost:3080/api/config` returned
  200.
- User correction: when OCR/file_analysis_data produces 柱底板、連接板 or
  加勁板 rows, material should default to the most likely black iron plate /
  SS400 product for pricing if width, height, thickness, and quantity are
  available. Updated `docs/rules/鋼材規則.txt` plate rules and
  `docs/rules/agent規則.txt` core quote rules so material confirmation becomes
  a provisional note/manual-review item, not a reason to leave the whole price
  未確認.
- Synced the updated rules into Supabase with
  `node packages/api/scripts/sync-steel-rules.cjs --apply`. Readback confirmed
  `steel-default-agent-instruction` sha
  `0aa5ce3306439c47d3c4100461f50f2acca7665928eeab111fab543058e6c4e3` and
  reviewed active plate quote keys `steel_quote_rules_plate`,
  `steel_quote_rules_black_plate`, `steel_quote_rules_galvanized_plate`, and
  `steel_quote_rules_ot_plate` with sha
  `58815b8cf50a503aff8184a46b8873d9460afc418004d70a57441b72df29929f`.
- Follow-up correction: black iron plate density must be available from
  reviewed rules instead of model common knowledge. Updated
  `docs/rules/鋼材規則.txt` so 黑鐵板 / 黑板 / SS400 / 黑皮板 uses density
  coefficient `7.850` and calculates theoretical rectangular weight as
  `length mm × width mm × thickness mm × 7.850 ÷ 1,000,000` kg. Synced to
  Supabase; plate quote rules now have sha
  `b5b4bebc7b8d76dc0f5dcec4c56097d21a678cf23e5f04c3a3f1831082af6edf`.
- Follow-up density-table update: extracted `docs/reference/龍頂鋼鐵手冊__文字版.docx`
  Page 14 鋼軌、Page 21 方鋼、Page 22 圓鋼 rows, calculated density from
  `kg/m × 10 ÷ 斷面積 cm2`, and kept the final rules concise. The reviewed
  density coefficients now use 3 decimals: 黑板/黑鐵板/SS400/黑皮板 `7.850`,
  鋼軌 `7.859`, 方鋼 `7.852`, 圓鋼/圓鐵/圓條 `7.851` g/cm3.
- `node packages/api/scripts/sync-steel-rules.cjs --apply` synced the concise
  density rules to Supabase. Readback showed `steel-default-agent-instruction`
  sha `57c76c2d48a75739c7ccd4de2554323ec2bd1d40193fb6fe59de9f80f3c3d254`,
  `docs/rules/鋼材規則.txt` quote-rule sha
  `1a7923701f5edb11f72417e2f43e0c140f4cb2de34e8a0f596ec8af6c6b99382`,
  and handbook source ref sha
  `969743ba8db435097259c702d13dd5390f21ed190d73f1baa775072aaff707a1`.
- Follow-up OCR continuation fix: page count is now obtained at PDF attachment
  handoff before OCR page tasks, not from `run_file_ocr` output. Provider
  initializes PDF page progress from attachment `pageCount` or by reading the
  uploaded PDF bytes, then merges later `patch_file_analysis_data` rows by
  filename/source ref. Regression coverage proves page 2 is still forced when
  the model patches page 1 without `sourceFiles.pageCount`.
- Follow-up correction: drawing-derived plate parts default to 黑板, not 黑鐵.
  Updated `docs/rules/agent規則.txt` and `docs/rules/鋼材規則.txt` so the first
  `search_price_candidates` query and provisional adopted product candidate use
  黑板. SS400、黑皮板、黑鐵板 remain secondary aliases/material wording only.
  Synced to Supabase; readback confirmed `steel-default-agent-instruction` sha
  `4fd9653fceb929c37fd838e4f38ce402be8b68d63800f594bc0547c6fbc7fb0b` and
  `steel_quote_rules_plate` / `steel_quote_rules_black_plate` sha
  `f6f03b674c2ae4c1f0a2f7778624b21602c0791ddf4389933e85547d211e2998`.
- `node packages/api/scripts/sync-steel-rules.cjs --apply` passed after the
  deletion change. Direct Supabase readback for
  `sourceFile = docs/rules/鋼材規則.txt` returned 14 rows, all
  `scope_type = catalog_family`, with no company-level row.
- Live `executeSteelTool(lookup_quote_rules)` verification with one request for
  `c_type`, `h_beam`, and `angle` still passed after deleting the whole rule:
  returned `steel_quote_rules_c_type`, `steel_quote_rules_h_beam`, and
  `steel_quote_rules_angle`; `hasWholeRule = false`.
- User correction: OCR rule source moved from ignored `docs/reference` to
  tracked `docs/rules/OCR規則.txt`; runtime OCR tests must use the reviewed
  Supabase `steel.agent_rules` row, not local `docs/reference/OCR規則.txt`.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --dry-run` passed after
  switching the sync source to `docs/rules/OCR規則.txt`; sha256
  `2f31b445579261c8f47e70f61682e70ec7f23e55ae6aac322114e14536982610`.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --apply` passed and read
  back active reviewed `steel.agent_rules.slug = steel-drawing-ocr-policy` with
  `source_refs[0].sourceFile = docs/rules/OCR規則.txt` and the same sha256.
- `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="loads reviewed OCR rules"`
  passed, proving visual evidence turns load OCR rules through the Supabase
  `steel.agent_rules` path before provider generation.
- `cd packages/api && npx jest src/steel/vision/paddleocr.d-pdf-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns="node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers"`
  passed as skipped by default, so normal verification does not call live
  PaddleOCR MCP.
- Live multi-page `d.pdf` PaddleOCR MCP smoke passed:
  `DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_PADDLEOCR_MCP_D_PDF_OCR_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/vision/paddleocr.d-pdf-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns="[]"`.
  Result: 1 passed in `225.167 s`; the test loaded the reviewed Supabase OCR
  rule, rendered `docs/reference/example/d.pdf` into two 400 DPI page images
  with minimum edge >= 2000 px, and called `paddleocr_vl` once per page with
  `file_type = image`.
- Actual handler chat-flow smoke passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="d.pdf upload interruption"`.
  Flow: upload real `docs/reference/example/d.pdf` bytes, first provider turn
  patches only page 1 OCR progress, the next user message is `go`, and the
  handler injects saved `interpretation_notes` progress so provider can patch
  page 2 without reprocessing page 1.
- Fixed the resume context gap found by that smoke: the saved
  `file_analysis_data` context injected into later chat turns now includes
  `manual_review` and `interpretation_notes` rows plus source progress fields
  such as `sourceKey`, `imageIndex`, `ocrEngine`, `ocrStatus`, and
  `processedAt`, not only the `file_analysis_data` sheet rows.
- `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="d.pdf upload interruption|injects the latest saved file_analysis_data|smokes image OCR"`
  passed: 3 tests.
- Live Supabase tool probe passed for a saved `file_analysis_data` C 型鋼 row:
  `lookup_quote_rules` returned reviewed packets including
  `c-type-basic-quote-zh-v1`, `product-price-unit-weight-calculation-zh-v1`,
  `price-source-priority-zh-v1`, `formula-code-selection-zh-v1`, and
  `drawing-processing-detection-zh-v1`; `search_price_candidates` returned 4
  reviewed price candidates for `錏輕型鋼 100*2.3` / `CCG10023_錏輕型鋼100x2.3`,
  including numeric unit prices `26`, `26.8`, and `25.5`.
- Added a gated live workbook flow smoke:
  `STEEL_FILE_ANALYSIS_WORKBOOK_LIVE_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/handlers.spec.ts --runInBand --testNamePattern="creates a workbook from file_analysis_data"`.
  It passed in `2816 ms`: saved `file_analysis_data` was injected into
  stream chat, the provider mock called only Supabase-backed
  `lookup_quote_rules` and `search_price_candidates`, then generated a workbook
  patch using the returned reviewed price candidate. The resulting workbook
  contains `quote_details`, `price_sources`, `summary`, and
  `interpretation_notes` rows derived from Supabase tool output, not local
  price fixtures.
- User correction: normal multi-page PDF/image OCR must not pause after each
  page waiting for `go`; after each page/image `run_file_ocr` and immediate
  `patch_file_analysis_data`, the provider should auto-continue the next
  page/image in order unless the user presses stop, the run is interrupted, OCR
  fails, or manual review requires stopping.
- Added provider behavior coverage proving a 5-page PDF sequence continues:
  page 1 OCR -> page 1 patch -> page 2 OCR -> page 2 patch through page 5,
  then final completion text. The test first failed at 9 provider generations
  because the default Steel tool loop limit cut off the final completion round,
  then passed after increasing the default loop budget.
- Synced updated OCR/agent rule policy into Supabase reviewed active
  `steel.agent_rules` with `node packages/api/scripts/sync-steel-rules.cjs
  --apply`; readback showed updated sha values for
  `steel-default-agent-instruction` and `steel-drawing-ocr-policy`.
- User-reported live issue: `run_visual_inspection` failed with
  `Cannot transfer object of unsupported type`, and the UI showed
  `patch_file_analysis_data completed` without visible rows.
- Hardened the nested OpenAI OAuth vision call so `run_visual_inspection`
  sends prepared image bytes as raw base64 string data instead of a binary
  typed-array payload.
- Updated `/steel/oauth-chat` UI behavior so any chat response containing
  `fileAnalysisData` opens the right panel and selects `File Analysis`
  automatically; users no longer have to discover the tab after
  `patch_file_analysis_data completed`.
- Verification for this pass passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand
  --testNamePattern="passes visual inspection images|loads reviewed OCR
  rules|executes file OCR|continues multi-page PDF OCR|exposes
  patch_file_analysis_data"`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand
  --testNamePattern="streams file analysis patch persistence status|persists
  file analysis patch proposals"`; and
  `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand
  --testNamePattern="renders returned file analysis|selects File Analysis
  automatically|smokes image OCR"`.
- User correction: Steel provider must not have a default 60 tool-loop cap
  because real PDFs may have hundreds of pages. `steelToolMaxCalls` is now only
  a caller-provided explicit limit; default visual-evidence/OCR runs continue
  until the provider returns a non-tool final answer or the user aborts/stops.
- Added provider regression coverage with a 31-page PDF sequence requiring 63
  provider generations. It failed under the former default 60 cap and now
  passes without a default cap; the explicit `steelToolMaxCalls: 1` guard test
  still passes.
- User correction: `run_visual_inspection` should not be a fixed post-OCR step.
  It is now described and synced as a gap-filling tool that runs only when OCR,
  table rows, existing `file_analysis_data`, or user-provided data lacks a
  necessary geometry/processing value such as slot continuous edge length needed
  for pricing.
- Synced the updated agent/OCR/vision rules into Supabase reviewed active
  `steel.agent_rules` with `node packages/api/scripts/sync-steel-rules.cjs
  --apply`; readback showed updated sha values for
  `steel-default-agent-instruction`, `steel-drawing-ocr-policy`, and
  `steel-visual-inspection-policy`.
- Fixed the UI upload failure where `d.pdf` was treated as unreadable because
  the model had only `patch_file_analysis_data` and no executable OCR Steel
  tool. Visual PDF/image turns now expose `run_file_ocr` plus
  `patch_file_analysis_data`; `run_file_ocr` is a generic Steel tool name, while
  backend execution still calls PaddleOCR MCP `paddleocr_vl` internally.
- Fixed the follow-up live UI failure where OpenAI rejected uploaded `d.pdf`
  before OCR with `input[1].content[1].file_data` empty bytes. Visual evidence
  turns now omit PDF/image file parts from the OpenAI provider prompt and pass a
  text-only `run_file_ocr files` inventory instead; the actual file bytes stay
  server-side for the `run_file_ocr` executor.
- Fixed the UI observability gap where `run_file_ocr` execution was invisible
  in the chat flow. Streaming chat now wraps the OCR executor and emits
  `run_file_ocr started`, `run_file_ocr completed`, or `run_file_ocr failed`
  events before the later `patch_file_analysis_data` events.
- Added the second-stage visual inspection contract for geometry-only drawing
  judgment. `run_visual_inspection` is now a Steel tool for OpenAI OAuth vision
  after OCR has been patched; it is for holes, slots, continuous slotted-edge
  length, bends, cut corners, notches, and geometry consistency, not OCR. The
  visual inspection rules live in `docs/rules/vision規則.txt` and were synced
  into reviewed Supabase `steel.agent_rules` as
  `steel-visual-inspection-policy`.
- User correction captured in rules: slot/open-groove pricing is based on the
  continuous edge length that needs slotting, not the part's total length and
  not OCR text alone. Ambiguous continuous edge length must be low confidence
  with manual review.
- Updated `docs/rules/agent規則.txt` and `docs/rules/OCR規則.txt`, then synced
  them to Supabase. Readback confirmed reviewed active
  `steel-default-agent-instruction.tool_policy.availableTools` includes
  `run_file_ocr`, and `steel-drawing-ocr-policy.tool_policy.requiredToolOrder`
  is `run_file_ocr` then `patch_file_analysis_data`.
- Verification for the upload OCR fix passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="d.pdf upload interruption|injects the latest saved file_analysis_data|smokes image OCR"`;
  `cd packages/api && npm run build`; and `git diff --check`. The build still
  reports the pre-existing Redis `cacheFactory.ts` type warning, but no OCR
  module warnings remain.
- Follow-up stream visibility verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="streams run_file_ocr|d.pdf upload interruption|injects the latest saved file_analysis_data|smokes image OCR"`.
- Supabase readback confirmed `steel-default-agent-instruction` includes
  `run_visual_inspection`, `steel-drawing-ocr-policy` exposes
  `run_file_ocr`, `run_visual_inspection`, and `patch_file_analysis_data`, and
  `steel-visual-inspection-policy` has required order
  `run_file_ocr -> patch_file_analysis_data -> run_visual_inspection -> patch_file_analysis_data`.
- `cd packages/data-provider && npx jest src/steel/vision.spec.ts --runInBand`
  passed after extending `patch_file_analysis_data` schemas with
  `sourceKey`, `imageIndex`, `ocrEngine`, `ocrStatus`, `processedAt`, and
  source-file OCR progress metadata.
- `cd packages/api && npx jest src/steel/vision/analysis.spec.ts --runInBand`
  passed after adding source-key upsert behavior.
- `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="patch_file_analysis_data"`
  passed for the provider tool loop after updating the
  `patch_file_analysis_data` tool description and progress-summary instruction.
- `npm run build:data-provider` passed and refreshed
  `packages/data-provider/dist` for API imports.
- `npm run build:api` exited `0`; Rollup still reports the existing non-Steel
  Redis `cacheFactory.ts` type warning.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --dry-run` and
  `node packages/api/scripts/sync-steel-ocr-rules.cjs --apply` passed; active
  reviewed `steel.agent_rules.slug = steel-drawing-ocr-policy` now has sha256
  `8de5cd59d217aa5b76071b112d778724bc34b410451d312e6188423493549e1f`.
- Fixed the remaining generic stream HTTP 500 diagnostic gap. Streaming chat
  now catches context-preparation failures before opening the NDJSON stream and
  returns a JSON `errorSummary` in development; the shared data-provider stream
  client now reads non-OK response bodies so the UI shows the backend error
  instead of only `Steel chat stream failed with HTTP 500`.
- Verification for the latest stream 500 fix passed:
  `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand`;
  `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="streams run_file_ocr|d.pdf upload interruption|injects the latest saved file_analysis_data|smokes image OCR"`;
  `cd packages/data-provider && npx jest src/steel/ai.spec.ts --runInBand`;
  `npm run build:data-provider`; `cd packages/api && npm run build`; and
  `git diff --check`. Backend was restarted on port 3080 and
  `http://localhost:3080/api/config` returned 200.
- Follow-up UI evidence showed the response was still
  `Steel chat stream failed with HTTP 500: An unknown error occurred.`, which
  means the request escaped the Steel stream handler and hit Express's global
  ErrorController before any Steel JSON error boundary.
- Added a route-shell guard around `/api/steel/ai/chat/stream` so setup-time
  async rejections from `handlers.streamChat` return Steel JSON with
  `errorSummary` instead of global plain-text unknown. Regression verification
  passed: `cd api && npx jest server/routes/__tests__/steel.spec.js --runInBand`.
- Follow-up evidence still showed the same global unknown response, so the
  error is escaping before the route handler, likely in auth/body-parser or
  another middleware. Added a Steel stream branch to the final
  `ErrorController` so `/api/steel/ai/chat/stream` errors return Steel JSON
  diagnostics even when they occur outside `handlers.streamChat`.
- Verification passed:
  `cd packages/api && npx jest src/middleware/error.spec.ts --runInBand`;
  `cd api && npx jest server/routes/__tests__/steel.spec.js --runInBand`;
  `cd packages/api && npm run build`; and `git diff --check`.
- User chose the immediate 413 fix: raise Express JSON/urlencoded parser
  limits from `3mb` to `50mb` for the main and experimental servers because
  the current Steel UI still sends attachment base64 inside the chat JSON
  payload. Longer-term cleanup remains to send only persisted `fileId` refs.
- Verification for the 50mb limit change: `git diff --check` passed. After
  backend restart, a 4,194,392-byte JSON POST to
  `/api/steel/ai/chat/stream` returned `401 {"message":"No auth token"}`
  instead of `413`, proving the request passed the JSON parser. The broader
  `api/server/index.spec.js` run was stopped after hanging without output;
  the runtime smoke covered this config change directly.
- Historical note: the former rule-text policy test for PaddleOCR MCP config was
  deleted after the user clarified that `docs/rules/*.txt` content should not be
  tested directly. MCP config remains covered by config parsing and live
  PaddleOCR smoke paths when those are explicitly run.
- `cd packages/api && npx jest src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers'`
  passed as skipped by default: 1 skipped test, so normal verification does not
  call PaddleOCR MCP.
- User correction: do not run Prettier in this repo unless explicitly asked.
  Future verification should use manual formatting, `git diff --check`, tests,
  and build/type checks instead.
- Live PaddleOCR MCP c.pdf OCR passed with real `paddleocr_vl`:
  `DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`.
  Result: 1 passed in `110.641 s`; the test matched every expected
  `docs/reference/example/c.pdf` row against `c.expected.json` without requiring
  exact field names.
- Local `.env` now contains `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN`; the token
  value was never printed.
- Updated `docs/steel-supabase-development.md` so project MCP documentation now
  includes both Supabase MCP and PaddleOCR MCP.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --dry-run` passed for the
  PaddleOCR OCR rules and computed sha256
  `49f180451660d5142d60ec3a4f5982675f2cc6d6bfbe633af0465f7ffe34a278`.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --apply` passed and read
  back active reviewed `steel.agent_rules.slug = steel-drawing-ocr-policy` with
  the same sha256.
- Final no-Prettier verification passed:
  `cd packages/api && npx jest src/steel/vision/compare.spec.ts --runInBand`
  passed, `cd packages/api && npx jest src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers'`
  passed as skipped by default, `.mcp.json` parsed with `node -e`, and
  `git diff --check` passed.
- `npm --workspace packages/api run steel:sync-ocr-rules -- --dry-run` passed
  and computed sha256
  `43215f55617de2f71aa8c1f87555d50823ead5c2cb27cdc6378c525246e6be74`.
- `npm --workspace packages/api run steel:sync-ocr-rules -- --apply` passed and
  read back active reviewed `steel.agent_rules` row
  `steel-drawing-ocr-policy` version `1`.
- `cd packages/api && npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/vision/compare.spec.ts src/steel/vision/attachments.spec.ts --runInBand`
  passed: 4 suites, 67 tests.
- `cd packages/api && npx jest src/steel/vision/resolver.spec.ts --runInBand`
  passed: 1 suite, 4 tests.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --apply` passed and read
  back the active reviewed OCR rule row; no npm script was used.
- `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/vision/resolver.spec.ts src/steel/vision/attachments.spec.ts src/steel/vision/compare.spec.ts src/steel/ai/provider.spec.ts --runInBand`
  passed after rebuilding data-provider: 5 suites, 72 tests.
- `npm run build:data-provider` passed.
- `npm run build:api` exited `0`; remaining Rollup TypeScript warnings are
  existing non-Steel endpoint/cache/config warnings.
- `node -c api/server/routes/steel/index.js` passed.
- `rg 'steel:(export-oauth-fixtures|import-reference-data|sync-ocr-rules|prove-office-conversion)' packages/api/package.json package.json`
  returned no matches.
- `npm run build:api` exited `0`; Rollup still prints existing non-Steel
  TypeScript warnings, but the new `src/steel/ai/provider.ts` warning was
  removed before checkpoint.
- `git diff --check` passed.
- `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --testNamePattern="smokes image OCR"`
  passed for the UI smoke: upload `c.png` as `image/png`, receive AI
  `fileAnalysisData`, manually correct `PL1` to `PL7`, save via
  `patchSteelFileAnalysisData`, and submit the next chat turn.
- `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand --testNamePattern="smokes image OCR"`
  passed for the handler smoke: first provider response persists OCR
  `fileAnalysisPatch`, manual endpoint saves corrected `PL7`, and the next
  provider request receives the latest saved `file_analysis_data` context
  without the stale `PL1` OCR value.
- `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand` passed:
  1 suite, 17 tests.
- `cd packages/api && npx jest src/steel/handlers.spec.ts --runInBand` passed:
  1 suite, 31 tests.
- `npx eslint client/src/routes/SteelOAuthChat.tsx client/src/routes/SteelOAuthChat.spec.tsx packages/api/src/steel/handlers.spec.ts`
  passed with no warnings after replacing an existing nested ternary in the
  touched client spec helper.
- `npx prettier --check client/src/routes/SteelOAuthChat.spec.tsx packages/api/src/steel/handlers.spec.ts tasks/todo.md`
  passed, and `git diff --check` passed.
- Historical OAuth attempt: a real OAuth c.pdf OCR manual test sent the local
  PDF bytes through `openai_oauth_responses`, required
  `patch_file_analysis_data`, and checked the full expected row fixture. That
  test has now been removed and replaced by the PaddleOCR MCP c.pdf live test.
- Confirmed `imageDetail: high` is already applied to all Steel `image/*`
  provider file parts in `packages/api/src/steel/ai/provider.ts`, and AI SDK's
  OpenAI Responses converter maps `providerOptions.openai.imageDetail` to the
  OpenAI input image `detail` field.
- `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="image detail"`
  passed: the provider prompt includes `providerOptions.openai.imageDetail =
high` for image file parts.
- The old OAuth c.pdf manual test previously passed as skipped by default; that
  skipped-test entry is no longer the current OCR validation path.
- Live OAuth c.png OCR smoke passed with real provider:
  `DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_C_PNG_OCR_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.c-png-ocr.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`.
  Result: 1 passed in `309.628 s` using real `openai_oauth_responses`; the
  smoke confirmed `fileAnalysisPatch`, Chinese names `柱底板` / `連接板`, and
  at least two recognizable plate rows from `docs/reference/example/c.png`.
- The current live full-accuracy fixture was changed from
  `docs/reference/example/c.png` to the higher-resolution
  `docs/reference/example/c.pdf`. Future failures should be reported with the
  missing rows/candidate extracted cells and recommendations, without tuning OCR
  rules unless the user explicitly reopens that scope.
- Live OAuth c.pdf full-accuracy test failed with real provider:
  `STEEL_C_PDF_OCR_TEST=true STEEL_OPENAI_REASONING_EFFORT=medium ...`.
  Result: provider returned `fileAnalysisPatch` and `rowCount = 26`, but
  `matchedPartNos = []`; extracted candidate rows looked like a different
  BPL/PL schedule than the expected fixture. Duplicates detected by substring
  scan were `PL1`, `PL2`, and `PL7`; no unmatched non-part rows were returned.
  This is now the reason the active live OCR validation uses PaddleOCR MCP
  instead of OpenAI OAuth built-in OCR.
- Removed c.png fixture-specific hard-coded OCR rules from
  `docs/rules/OCR規則.txt`, including BP/PL examples and fixed 26-row
  wording. Supabase `steel.agent_rules.slug = steel-drawing-ocr-policy` was
  synced with sha256
  `6dda05693c2424d65efe1f642e4047b6f4c071ea07cb41c159383be21b188f8c`.
- `cd packages/api && npx jest src/steel/vision/prompt.spec.ts --runInBand`
  passed after simplifying `buildDrawingEvidencePrompt` to DB OCR rules plus
  user request only: 5 tests.
- `cd packages/api && npx jest src/steel/vision/service.spec.ts --runInBand`
  passed for Task 4 provider extraction service: 5 tests.
- `cd packages/api && npx jest src/steel/vision/prompt.spec.ts src/steel/vision/service.spec.ts --runInBand`
  passed: 2 suites, 10 tests.
- `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/vision/attachments.spec.ts src/steel/vision/resolver.spec.ts src/steel/vision/compare.spec.ts src/steel/vision/prompt.spec.ts src/steel/vision/service.spec.ts src/steel/ai/provider.spec.ts --runInBand`
  passed after Task 4: 7 suites, 82 tests.
- `npm run build:api` exited `0` after Task 4; Rollup still prints existing
  non-Steel TypeScript warnings in agents/app/cache/endpoints/middleware files.
- `git diff --check` passed after Task 4.
- `node packages/api/scripts/sync-steel-ocr-rules.cjs --apply` updated
  `steel.agent_rules.slug = steel-drawing-ocr-policy` to local OCR rules sha256
  `c5d34ee9c26497177265bb62d7bebc0e77acf6d848e34c8068e432a35c3c5b83`.
- `cd packages/data-provider && npx jest src/steel/vision.spec.ts --runInBand`
  passed for flexible file-analysis schemas and `patch_file_analysis_data`.
- `cd packages/data-schemas && npx jest src/schema/steel.spec.ts --runInBand`
  passed after adding `steel_file_analysis_data` with unique conversation
  workspace indexing.
- `cd packages/api && npx jest src/steel/vision/analysis.spec.ts --runInBand`
  passed for one-workspace, multi-file row patching and row correction.
- `cd packages/api && npx jest src/steel/ai/provider.spec.ts --runInBand --testNamePattern="patch_file_analysis_data"`
  passed for visual evidence tool exposure, tool result summary instruction,
  and returned `fileAnalysisPatch`.
- `npm run build:data-schemas`, `npm run build:data-provider`, and
  `npm run build:api` exited `0`; API build still prints existing non-Steel
  warnings only.
- `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/vision/analysis.spec.ts src/steel/ai/provider.spec.ts --runInBand`
  passed after Task 5b: 3 suites, 66 tests. This covers provider
  `fileAnalysisPatch` persistence, stream `patch_file_analysis_data` status
  events, file-analysis patch service behavior, and provider tool exposure.
- `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand`
  passed after Task 5c: 14 tests. This covers the new File Analysis right-panel
  tab, empty state, returned `fileAnalysisData` rendering, and existing workbook
  UX regressions.
- `cd packages/data-provider && npx jest src/steel/vision.spec.ts src/steel/ai.spec.ts --runInBand`
  passed after adding `conversationId` and `fileAnalysisData` to the shared chat
  contract: 2 suites, 14 tests.
- `npx eslint client/src/routes/SteelOAuthChat.tsx client/src/features/steel/fileAnalysis/Preview.tsx`
  passed for the touched UI files.
- `npx prettier --check ...` passed for touched Task 5b/5c files, and
  `git diff --check` passed.
- `npm run build:data-provider && npm run build:api` exited `0`; API build still
  prints the existing Redis `cacheFactory.ts` Rollup TypeScript warning.
- `cd client && npm run typecheck` was attempted after package builds, but the
  shell wrapper stayed running without producing output for several minutes; it
  was stopped after confirming no `tsc --noEmit` child process was active.
- `npx eslint client/src/routes/SteelOAuthChat.tsx client/src/features/steel/fileAnalysis/Preview.tsx`
  passed after adding the editable File Analysis table UI.
- `npx prettier --check client/src/features/steel/fileAnalysis/Preview.tsx client/src/routes/SteelOAuthChat.tsx client/src/routes/SteelOAuthChat.spec.tsx packages/api/src/steel/handlers.ts packages/api/src/steel/handlers.spec.ts packages/api/src/steel/vision/analysis.ts packages/data-provider/src/steel/vision.ts packages/data-provider/src/steel/vision.spec.ts packages/data-provider/src/api-endpoints.ts packages/data-provider/src/data-service.ts api/server/routes/steel/index.js tasks/lessons.md`
  passed.
- `cd client && npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand` passed:
  1 suite, 16 tests. This covers manual cell editing, add-row, left-side row
  delete, unsaved state, and saving `file_analysis_data` patches.
- `cd packages/data-provider && npx jest src/steel/vision.spec.ts src/steel/ai.spec.ts --runInBand`
  passed: 2 suites, 15 tests. This covers shared manual patch schema and Steel
  AI contract compatibility.
- `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/vision/analysis.spec.ts src/steel/ai/provider.spec.ts --runInBand`
  passed: 3 suites, 68 tests. This covers manual patch endpoint behavior,
  one-workspace file-analysis persistence, provider tool exposure, and injecting
  the latest saved `file_analysis_data` into the next provider request.
- `npm run build:data-provider && npm run build:api` exited `0`; API build still
  prints the existing Redis `cacheFactory.ts` Rollup TypeScript warning.
- `git diff --check` passed.

## Skipped: Steel v8.3 Phase 5 Admin ERP XLSX Source Management Grill

Goal: pressure-test Phase 5 before implementation. Scope is Admin ERP XLSX
source management only: source metadata, ERP XLSX upload guard, parser preview,
old-data matching, validation, merge review, commit, audit, and the first Admin
table-maintenance path. Customer Export remains out of scope.

- [x] Read Phase 5 plan, source-schema mapping, `CONTEXT.md`, existing Admin
      route shell, current Steel schema, and import/mapping code.
- [x] User explicitly skipped this section before decisions were locked.

## Active: Steel C-Type Price Unit Rule Sync

Goal: prevent C 型鋼口語「一支多少」 from overriding reviewed database price
row units. `search_price_candidates` remains authoritative for productName,
pricing unit, unit price, and unit weight; one piece is only the requested
quantity when the adopted row is kg-priced.

- [x] Add the lesson that user delivery units must not override database price
      row pricing units.
- [x] Update `docs/reference/agent規則.txt` so the mandatory Agent Prompt states
      that `search_price_candidates` database price rows are authoritative.
- [x] Update `docs/reference/鋼材規則.txt` with the C100x50x20x2.3t 6M kg-priced
      C 型鋼 example and forbidden 支-price interpretation.
- [x] Sync the reviewed active `steel.agent_rules` and `steel.quote_rules` rows
      to cloud Supabase.
- [x] Verify DB prompt contents and diff hygiene.

Review evidence:

- Supabase reviewed active `steel.agent_rules.slug =
steel-default-agent-instruction` now matches `docs/reference/agent規則.txt`
  sha256 `470146b0488410890e3d6cc3ff85e30324c24ffe101486421537f4e55cc59e61`.
- Supabase reviewed active `steel.quote_rules.id = 9` now matches
  `docs/reference/鋼材規則.txt` sha256
  `170be3c583a001edc06cfd04f695b06a4ddf86c1b6ff244aaded9e63ef0bd0f5`.
- Supabase reviewed active C 型鋼 pricing rule `steel.quote_rules.id = 3`
  now includes the kg-priced C100x50x20x2.3t 6M example, with
  `單位 Kg`, `單價 26.8`, `小計 643.2`, and the forbidden `單位=支`
  interpretation.
- DB read-back confirmed agent prompt contains `search_price_candidates`,
  `database price row`, and `不可把小計`; quote rules id 3/id 9 contain the
  C 型鋼 kg example and forbidden 支-price case.
- Follow-up fix: repaired hash-only `source_refs` created during prompt sync by
  restoring canonical `channel` / `factType` provenance on
  `steel-default-agent-instruction`, `quote_reference_steel_rules`, and
  `quote_c_type_material_lookup_strategy`. A cloud DB read-back across active
  reviewed `agent_rules`, `quote_rules`, `catalog_family_rules`, and
  `customer_rules` returned `missingRequiredSourceRefFields = 0`.
- Workbook prompt follow-up: `docs/reference/workbook規則.txt` now has a compact
  `Workbook 單位判斷邏輯` section. All workbook material units in
  `quote_details`, `system_order`, `price_sources`, and `customer_quote` must
  match the adopted `search_price_candidates` price row unit; user delivery
  words such as `一支` cannot override it. Supabase
  `steel.agent_rules.slug = steel-workbook-output-policy` was updated to local
  sha256 `36a674b7579276cf2794a5b2a3cf217962689b903024d4cebe774f4e80128616`,
  and source-ref validation still returns `missingRequiredSourceRefFields = 0`.
- Internal-server-error follow-up: source-level live OAuth/Codex natural
  workbook calculation smoke passed after the DB rule updates, but the running
  `/steel/oauth-chat` backend was still using the built `@librechat/api` dist
  loaded at process start. Rebuilt `packages/api` and restarted
  `npm run backend:dev`; 3080 is listening again with the refreshed dist.
- Customer quote privacy follow-up: `docs/reference/workbook規則.txt` now states
  that `customer_quote` must not reveal internal pricing logic, including
  customer tier, price A/B/C, customer price, tier price, cost, margin, or
  wording implying different customers have different prices. The bottom
  `customer_quote` row is now `報價總額`, with quantity/unit/unit price blank and
  the customer-facing total in subtotal. Supabase
  `steel.agent_rules.slug = steel-workbook-output-policy` was updated to local
  sha256 `64e5af6b1ff0b758bf756d8f0bc5705baec85914631578d27985f783092583b6`,
  and source-ref validation still returns `missingRequiredSourceRefFields = 0`.
- Customer quote total-row follow-up: added top-level semantic
  `customerQuoteTotal` so AI can explicitly output the bottom `報價總額` row
  without backend auto-filling it. Projection maps that semantic target to
  `customer_quote.customer_total`, including blank quantity/unit/unit price
  cells. Provider prompts now instruct AI to send `customerQuoteTotal` for the
  customer-facing total row. Focused semantic/provider tests passed. Supabase
  `steel.agent_rules.slug = steel-workbook-output-policy` was updated to local
  sha256 `e7eab4a929bfe658df25450e2287b2b175ad6ff50961da1345cd7c9ec1170c8f`,
  DB read-back confirmed the `customerQuoteTotal` guidance and
  `missingRequiredSourceRefFields = 0`, `packages/api` build passed with
  existing non-Steel TypeScript warnings, and backend dev server restarted on
  3080 with refreshed dist.

## Active: Steel Summary Total Contract Cleanup

Goal: remove the conflicting summary confirmed/provisional amount contract.
Workbook subtotal validation now only checks `summary.totalAmount` against the
sum of numeric `quoteLines[].subtotal`; confidence/provisional status stays on
quote lines, manual review, interpretation notes, or customer quote notes.

- [x] Add RED tests showing old summary amount fields must not drive subtotal
      validation or semantic summary projection.
- [x] Remove summary confirmed/provisional amount fields from semantic schema,
      projection, validator, provider feedback, and provider fixtures.
- [x] Update `docs/reference/agent規則.txt` and
      `docs/reference/workbook規則.txt` to the totalAmount-only contract.
- [x] Sync reviewed active Supabase `steel.agent_rules` prompts and source hashes.
- [x] Verify focused tests, API build, DB prompt contents, diff hygiene, and
      restart the backend dev server.

Review evidence:

- RED tests failed because semantic projection still emitted separate summary
  amount rows and subtotal validation still inspected more than totalAmount.
- Green implementation now rejects only mismatched numeric `summary.totalAmount`;
  semantic workbook projection no longer emits separate summary amount rows.
- Provider subtotal-loop feedback now asks the model to correct only
  `summary.totalAmount`, so it no longer conflicts with provisional/low
  confidence guidance.
- Supabase reviewed active `steel.agent_rules` rows
  `steel-default-agent-instruction` and `steel-workbook-output-policy` were
  updated from `docs/reference`, with refreshed SHA-256 source refs.
- Verification: focused workbook/provider tests passed, API build passed with
  existing non-Steel Rollup TypeScript warnings, DB prompt check returned no old
  summary amount key/label strings, and backend dev server restarted on 3080.

## Active: Steel Phase 4 Staff Workbook Export Implementation

Goal: implement Phase 4 staff workbook export end to end so `/steel/oauth-chat`
can download a persisted Steel workbook as XLSX. This phase streams generated
ExcelJS bytes from memory, allows arbitrary selected workbook sheets, and does
not apply customer masking, dedicated system-order export logic, Supabase
Storage, or durable `steel_excel_exports` records.

- [x] Add RED tests for Excel workbook rendering from persisted workbook JSON.
- [x] Add RED tests for the workbook export API route/handler.
- [x] Add RED tests for `/steel/oauth-chat` export UI wiring.
- [x] Implement ExcelJS renderer/service in `packages/api/src/steel/exports`.
- [x] Implement `POST /api/steel/workbooks/:workbookId/export`.
- [x] Add data-provider/client export helper and `/steel/oauth-chat` download UI.
- [x] Verify focused backend/client tests, API build, client build or targeted
      typecheck, and diff hygiene.

Review evidence:

- Added `steelWorkbookExportRequestSchema`, data-provider endpoint/helper, and
  arraybuffer POST support so `/steel/oauth-chat` can request XLSX bytes through
  the normal authenticated client path.
- Added ExcelJS renderer under `packages/api/src/steel/exports`; it streams
  in-memory XLSX bytes from persisted workbook JSON, supports arbitrary selected
  sheets, and renders missing currency values as `未確認` instead of `0`.
- Added `POST /api/steel/workbooks/:workbookId/export`; it validates workbook
  version before streaming and does not call AI, patch workbook data, refresh
  prices, write Supabase Storage, or create durable export records.
- `/steel/oauth-chat` workbook preview now has per-sheet export checkboxes and a
  `Download XLSX` action using the current workbook version.
- Verification: RED tests failed on missing schema/renderer/handler/UI; GREEN
  focused tests passed for data-provider workbooks, API export/handlers, and
  `SteelOAuthChat`; `npm run build --workspace packages/data-provider` passed;
  `npm run build --workspace packages/api` passed with existing non-Steel
  Rollup TypeScript warnings.

## Active: Steel v8.3 Phase 3 Checkpoint Sync And Phase 4 Grill

Goal: close the completed v8.3 Phase 3 checkpoint evidence without overstating
unfinished UI/API/export work, then pressure-test Phase 4 Excel Export before
implementation starts.

- [x] Sync `tasks/v8.3/checkpoints.md` for completed Phase 2/3 rule,
      workbook, provider, and live-smoke evidence.
- [x] Keep unchecked any Phase 3 UI/API/fallback/file/export items that are not
      backed by current implementation evidence.
- [x] Grill `tasks/v8.3/phase-4-excel-export.md` and batch every unresolved
      export decision with recommended answers.
- [x] Run document hygiene checks after the checkpoint sync.

Review evidence:

- Synced `tasks/v8.3/checkpoints.md` with 2026-06-08 status notes for
  Checkpoint 1, Checkpoint 2, and the fixed OAuth/Codex `/steel/oauth-chat`
  portion of Checkpoint 3.
- Left unchecked the unsupported strict Phase 3 items: missing
  `packages/api/src/steel/workbook/schema.ts`, formal Steel Workspace/mobile
  selected-cell UI, explicit OpenAI API fallback smoke, prompt context-ref
  persistence, and ambiguous multi-field clarification coverage.
- Updated `.env.example` and
  `tasks/v8.3/openai-oauth-provider-real-auth-implementation.md` so active
  runtime examples use `gpt-5.5` instead of stale `gpt-5.4`.
- Focused Jest passed: `cd packages/api && npx jest
src/steel/ai/config.spec.ts src/steel/models.spec.ts
src/steel/access.spec.ts src/steel/conversations/service.spec.ts
src/steel/tools/registry.spec.ts src/steel/workbook/subtotals.spec.ts
--runInBand` passed 25 tests.
- Hygiene passed: `git diff --check`.
- Phase 4 grill follow-up decisions synced after user correction:
  `tasks/v8.3/phase-4-excel-export.md`, `tasks/v8.3/README.md`,
  `tasks/v8.3/checkpoints.md`,
  `tasks/v8.3/phase-0-decisions.md`,
  `docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md`,
  `CONTEXT.md`, and `tasks/lessons.md` now describe Phase 4 as staff workbook
  export from `/steel/oauth-chat`.
- Current Phase 4 export boundary: generate XLSX in memory and stream from the
  API, allow arbitrary selected workbook sheets, do not store generated files in
  Supabase Storage, do not write durable `steel_excel_exports`, do not implement
  customer masking, and do not add a dedicated system-order export action.

## Active: Steel Reference Prompt and Formula Tool Cleanup

Goal: sync the reviewed reference prompts with the approved runtime boundary.
Formula numbering guidance belongs in workbook instructions. Steel category,
pricing, material, processing, allocation, and true-zero guidance belongs in
`lookup_quote_rules` rule prompts. `lookup_formula` should no longer be an
AI-callable runtime tool, and Agent rules should not route formula code lookup
through `lookup_quote_rules`.

- [x] Update `docs/reference/agent規則.txt` and
      `docs/reference/workbook規則.txt` to reflect the current DB-backed
      prompt/tool boundary.
- [x] Remove `lookup_formula` from Steel runtime tool definitions, schemas,
      executor dispatch, and provider loop gating.
- [x] Update seed prompt/tool policy metadata so future DB prompt updates do
      not reintroduce `lookup_formula`.
- [x] Upsert current `docs/reference/agent規則.txt`,
      `docs/reference/workbook規則.txt`, and `docs/reference/鋼材規則.txt`
      prompts to cloud Supabase.
- [ ] Add the missing `docs/reference/鋼材規則.txt` `lookup_quote_rules`
      business rules after the user supplies the omitted rule text.
- [x] Verify focused Steel tool/provider tests, API build, and diff hygiene.

Review evidence:

- Cloud Supabase upsert completed against `.env` `STEEL_POSTGRES_URL`.
- `steel.agent_rules.slug = steel-default-agent-instruction` now matches
  `docs/reference/agent規則.txt`; prompt length `5706`, sha256
  `39a9f56bee90be34767e577fcf5ccb0a0dc3a6a042d9fc89197c086021f6bd6f`.
- `steel.agent_rules.slug = steel-workbook-output-policy` now matches the
  user-updated `docs/reference/workbook規則.txt`; prompt length `9566`,
  sha256 `2d94f4ceba301fb4afe721e01a3811dfd5a46bc82372636ad1b1db1bb98435d4`.
- `steel.quote_rules` company-level row with canonical key
  `quote_reference_steel_rules` now matches `docs/reference/鋼材規則.txt`;
  prompt length `2482`, sha256
  `1c94f145908b3910c52ae77d715aa98b44da5eef1ef886cacbbf08e8ff1a7dc0`.
- DB read-back hash check matched all three local files exactly and confirmed
  none of the three DB prompts contains `lookup_formula`.
- Focused tests passed: `cd packages/api && npx jest
src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
src/steel/ai/provider.spec.ts --runInBand` passed 61 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files,
  but exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Runtime Rule Injection

Goal: every Steel AI round can load the applicable reviewed DB rules through
tools, while mandatory Agent and workbook-output instructions are injected from
`steel.agent_rules`. No code prompt fallback is allowed when required DB rules
cannot be read.

- [x] Confirm today's reviewed Agent/workbook/quote prompt rows are updated in
      cloud Supabase and match local reference file hashes.
- [x] Load mandatory Agent Prompt from `steel.agent_rules` for every Steel
      runtime request.
- [x] Load workbook-output rules from `steel.agent_rules` whenever
      `patch_quote_workbook` is enabled; fail before provider generation if DB
      rules are missing.
- [x] Keep `lookup_catalog_families`, `search_customers`,
      `lookup_quote_rules`, and `search_price_candidates` callable in every
      Steel tool round so AI can fetch catalog, customer, quote, and price
      rules as needed.
- [x] Verify focused provider/tool tests, API build, Supabase read-back, and
      diff hygiene.

Review evidence:

- Added provider RED/GREEN coverage for DB-backed workbook output rules and
  fail-fast behavior when reviewed workbook rules cannot be loaded.
- Provider now loads Agent Prompt rows by reviewed `rule_sections` and
  workbook-output rows by reviewed `rule_type = workbook_output_rule`; no
  static workbook prompt fallback remains in provider code.
- Every Steel tool round now exposes the full business tool set:
  `lookup_quote_rules`, `lookup_catalog_families`, `search_customers`, and
  `search_price_candidates`; `toolChoice` and the quote-rule-before-price
  execution guard still enforce required lookup progress.
- Cloud Supabase read-back matched local reference prompts exactly:
  `agent_rules:steel-default-agent-instruction` length `5706`, sha256
  `39a9f56bee90be34767e577fcf5ccb0a0dc3a6a042d9fc89197c086021f6bd6f`;
  `agent_rules:steel-workbook-output-policy` length `9566`, sha256
  `2d94f4ceba301fb4afe721e01a3811dfd5a46bc82372636ad1b1db1bb98435d4`;
  `quote_rules:quote_reference_steel_rules` length `2482`, sha256
  `1c94f145908b3910c52ae77d715aa98b44da5eef1ef886cacbbf08e8ff1a7dc0`.
  All three DB prompts have `containsLookupFormula=false`.
- Reconfirmed `docs/reference/鋼材規則.txt` maps to exactly one reviewed
  `steel.quote_rules` row: `id=9`, `rule_type=material_rule`,
  `scope_type=company`, `source_refs[0].canonicalKey=quote_reference_steel_rules`.
  Its `prompt` hash and `source_refs[0].sha256` now both equal
  `1c94f145908b3910c52ae77d715aa98b44da5eef1ef886cacbbf08e8ff1a7dc0`.
- Focused tests passed: `cd packages/api && npx jest
src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
src/steel/ai/provider.spec.ts --runInBand` passed 61 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files,
  but exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Workbook Subtotal Validator Extraction

Goal: extract the existing provider subtotal/summary consistency check into a
shared workbook helper for v8.3 Phase 2.6. AI still owns arithmetic; backend
only validates confirmed workbook totals against line subtotals and unknown
amount state.

- [x] Add focused workbook subtotal validator tests.
- [x] Create `packages/api/src/steel/workbook/subtotals.ts`.
- [x] Reuse the shared helper from the Steel provider workbook patch loop.
- [x] Verify provider subtotal mismatch behavior still loops before accepting a
      confirmed workbook total.
- [x] Run backend/app-level verification directly without browser UI smoke.

Review evidence:

- Added `packages/api/src/steel/workbook/subtotals.ts` and
  `subtotals.spec.ts` for numeric amount parsing, summary/line subtotal
  mismatch detection, first-mismatch lookup, and rejection of numeric
  `summary.totalAmount` when any line subtotal is `未確認`.
- Reused the shared subtotal helper from the provider workbook patch loop. The
  provider now returns a tool result asking AI to resend `patch_quote_workbook`
  with `未確認` totals when a line subtotal is unknown.
- Added provider coverage for the unknown-subtotal totalAmount loop.
- Updated `tasks/v8.3/phase-2-data-tools.md` so Phase 2 no longer lists
  `lookup_formula` as an AI-callable runtime tool.
- Direct backend/app verification passed without browser UI smoke:
  `cd packages/api && npx jest
src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
src/steel/workbook/subtotals.spec.ts src/steel/workbook/semantic.spec.ts
src/steel/workbook/service.spec.ts src/steel/ai/provider.spec.ts
src/steel/handlers.spec.ts --runInBand` passed 102 tests, and
  `cd api && npx jest server/routes/__tests__/steel.spec.js --runInBand`
  passed 10 route-shell tests for `/api/steel`.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files,
  but no warning remains in the new subtotal helper.
- Hygiene passed: `git diff --check`.

## Active: Steel OAuth/Codex Live Smoke

Goal: run a real `/steel/oauth-chat` provider smoke through the fixed
OAuth/Codex path without browser UI, proving reviewed DB rule injection,
database-backed quote lookup tools, workbook patching, and backend subtotal
loop feedback all work with the live model.

- [x] Add a focused manual smoke that uses the real OAuth provider and real
      Supabase-backed Steel tools.
- [x] Verify `steel.agent_rules` is loaded from DB before provider generation.
- [x] Verify `lookup_quote_rules` and `search_price_candidates` execute against
      cloud Supabase in the live run.
- [x] Verify a workbook patch with numeric summary total and unknown line
      subtotal is rejected by backend tool feedback, then corrected by the live
      model.
- [x] Run the live smoke and record evidence without exposing auth material.

Review evidence:

- Added manual smoke
  `STEEL_OPENAI_OAUTH_WORKBOOK_DB_SUBTOTAL_LOOP_TEST=true` in
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`.
- Preflight confirmed `.env` provides Steel Postgres and OpenAI OAuth settings,
  `$HOME/.codex/auth.json` exists, cloud Supabase is reachable, reviewed
  `steel.agent_rules=4`, reviewed `steel.quote_rules=9`, active
  `steel.price_items=27024`, and `c_type` quote rules are present.
- The live smoke captures the first provider prompt and asserts it contains the
  DB-loaded Agent Prompt text `你是「鋼鐵公司小助手」`, DB-loaded workbook rule text
  `你是「鋼鐵報價 Workbook 填寫代理」`, workbook structure context, and
  `lookup_quote_rules`.
- The live smoke executes DB-backed `lookup_quote_rules` before
  `search_price_candidates`, verifies the quote-rule result includes unified
  `rules`, and verifies the returned rule context matches `C 型鋼` / `c_type`.
- The live model generated an initial `patch_quote_workbook` with line subtotal
  `未確認` and summary total `999`; backend returned subtotal loop feedback, then
  the live model sent a corrected patch accepted by backend.
- Final accepted workbook patch asserted `quote_details.line_1.subtotal` and
  `summary_total_amount` match within the 643-644 expected range for
  `26.8 * 24 = 643.2`.
- Live command passed:
  `cd packages/api && DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_WORKBOOK_DB_SUBTOTAL_LOOP_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  passed 1 live test in `98.943 s` with 6 other manual cases skipped.
- Regression passed: `cd packages/api && npx jest
src/steel/workbook/subtotals.spec.ts src/steel/ai/provider.spec.ts
--runInBand` passed 37 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files, but
  exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Natural Calculation and Customer Rules Live Smoke

Goal: extend the OAuth/Codex live smoke coverage to prove the live model can
naturally calculate workbook subtotals without a forced bad patch, then prove
`search_customers` injects `customer_rules` into the model loop for
customer-specific quoting behavior.

- [x] Add a natural workbook calculation live smoke that does not force an
      incorrect first patch.
- [x] Verify the first `patch_quote_workbook` call naturally sets line subtotal
      and summary total from DB price evidence.
- [x] Add a customer-rules live smoke for `search_customers`.
- [x] Verify `search_customers` returns the `龍頂蓋廠房` customer rule and the
      next provider prompt contains that rule.
- [x] Verify the customer-specific H 型鋼 cutting rule affects the live answer.

Review evidence:

- Added `STEEL_OPENAI_OAUTH_WORKBOOK_NATURAL_CALC_TEST=true` in
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`.
  The smoke does not force a bad patch; it derives the expected subtotal from
  the actual `search_price_candidates` result, then asserts the first generated
  `patch_quote_workbook` call has matching `quoteLines[0].subtotal` and
  `summary.totalAmount`.
- Natural calculation live command passed:
  `cd packages/api && DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_WORKBOOK_NATURAL_CALC_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  passed 1 live test in `98.974 s` with 8 other manual cases skipped.
- The first natural calculation run showed the live model's first workbook patch
  already had `subtotal=643.2` and `summary.totalAmount=643.2`; the original
  assertion was narrowed because other non-price fields correctly contained
  `未確認` for missing customer details.
- Added `STEEL_OPENAI_OAUTH_CUSTOMER_RULES_TEST=true` in
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`. The smoke
  asserts `search_customers` returns unified `rules`, includes
  `customer_2269_h_beam_cutting_no_charge`, injects that prompt into the next
  provider round, and uses `customerTierId=1` for subsequent price lookup.
- Customer-rules live command passed:
  `cd packages/api && DOTENV_CONFIG_PATH=../../.env NODE_OPTIONS=--experimental-vm-modules STEEL_OPENAI_OAUTH_CUSTOMER_RULES_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  passed 1 live test in `55.252 s` with 8 other manual cases skipped.
- Updated `tasks/v8.3/phase-3-quote-workbook-mvp.md` with OAUTH-06 natural
  workbook calculation, OAUTH-07 customer-specific rules injection, and the
  manual command pattern for these OAuth smoke flags.
- Manual spec default gate passed without live flags:
  `cd packages/api && node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/ai/provider.catalog-oral.manual.spec.ts --runInBand --testPathIgnorePatterns='[]'`
  skipped all 9 manual cases.
- Regression passed: `cd packages/api && npx jest
src/steel/workbook/subtotals.spec.ts src/steel/ai/provider.spec.ts
src/steel/tools/execute.spec.ts --runInBand` passed 65 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files, but
  exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Rule Prompt Seed Data

Goal: seed reviewed Traditional Chinese rule prompts into the cloud Supabase
Steel rule tables so tools can return database-backed guidance for agent flow,
catalog/product-name inference, quote/calculation rules, and customer-specific
specs. This is data-only; no Steel schema shape changes are expected.

- [x] Confirm cloud lookup associations for catalog families, formulas,
      customer tiers, and the customer-specific rule target.
- [x] Create a repeatable migration for Traditional Chinese rule prompt seeds.
- [x] Apply the seed to cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Verify current rule rows and record categorized report evidence.
- [x] Replace the runtime Agent Prompt with the reviewed
      `steel.agent_rules` row and fail fast when the database rule cannot be
      loaded. Do not use a hard-coded Agent Prompt fallback.
- [ ] Apply the full reviewed Agent Prompt seed to cloud Supabase once
      `STEEL_POSTGRES_URL` pooler connectivity is available.

Review evidence:

- `npx supabase migration new steel_rule_prompt_seeds` failed on this
  darwin-arm64 host because the npm package could not find a matching CLI
  binary; fallback `supabase migration new steel_rule_prompt_seeds` succeeded
  with installed CLI `2.103.0`.
- Added data migration
  `supabase/migration/20260608103730_steel_rule_prompt_seeds.sql` with
  idempotent Traditional Chinese seed rules for `steel.agent_rules`,
  `steel.catalog_family_rules`, `steel.quote_rules`, and
  `steel.customer_rules`.
- Applied the seed to cloud Supabase through `.env` `STEEL_POSTGRES_URL`;
  active/reviewed counts are `agent_rules=4`, `catalog_family_rules=4`,
  `quote_rules=8`, and `customer_rules=1`.
- Re-ran the same migration against cloud Supabase; counts stayed unchanged,
  proving the seed is idempotent and does not duplicate rows.
- Association smoke queries matched the intended lookup filters:
  `agent_sections=3`, `lookup_catalog_families:c_type=1`,
  `lookup_quote_rules:c_type/material/C=3`, and
  `search_customers:2269/h_beam/cutting=1`.
- Started Agent Prompt DB-runtime conversion: `steelRuntimePolicy` now must load
  reviewed `steel.agent_rules` before calling the provider; no DB rows or DB
  errors should fail the request instead of falling back to code prompt text.
- Confirmed `docs/reference/instruction.txt` already carries the reviewed Agent
  Prompt version, and updated
  `supabase/migration/20260608103730_steel_rule_prompt_seeds.sql` so
  `steel-default-agent-instruction@1` seeds that full prompt with
  `tool_policy.availableTools` / `preferredOrder`, not `requiredTools`.
- Focused RED/GREEN evidence: `cd packages/api && npx jest
src/steel/ai/provider.spec.ts --runInBand -t "agent_rules|AI-led Steel
runtime policy"` first failed because provider did not query
  `steel.agent_rules`, then passed after DB-backed loading and fail-fast
  behavior were implemented.
- Full provider spec passed: `cd packages/api && npx jest
src/steel/ai/provider.spec.ts --runInBand` passed 28 tests.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/config/cache/share files, but
  exits `0`.
- Hygiene passed: `git diff --check`.
- Cloud DB apply is currently blocked: repeated TCP checks to
  `aws-1-us-east-1.pooler.supabase.com:6543` timed out, and this repo has no
  alternate Steel/Supabase DB URL key besides `STEEL_POSTGRES_URL`.

## Active: Steel Tool Rule Response Unification

Goal: implement the approved Tool output slice so all rule-bearing Steel lookup
tools return a unified `rules: []` array. The array may contain multiple rule
objects scoped to customer, catalog family, product/name, or company-level
context. AI still owns selection and calculation; backend only returns bounded
reviewed rule prompts/options.

- [x] Add RED tests requiring `lookup_catalog_families`, `lookup_quote_rules`,
      and `search_customers` to return `rules` arrays.
- [x] Add Supabase schema/migration support for storing future Admin-managed
      similar product-name inference rules, catalog/category rules, and
      customer-specific rules; implement read/association logic only, not Admin
      UI.
- [x] Define a provider-safe rule object shape with `ruleType`, `scope`,
      `prompt`, priority/confidence, matched facets, and source refs.
- [x] Map catalog-family inference guidance, instruction packets, quote
      defaults, and customer-specific defaults into the unified `rules` array
      while preserving existing legacy fields for compatibility.
- [ ] Verify focused Steel tool tests and diff hygiene. Do not run Prettier
      during this slice.

Review evidence:

- Cloud Supabase schema updated through `.env` `STEEL_POSTGRES_URL` with
  `supabase/migration/20260608173719_steel_tool_rule_response_support.sql`.
- Verified cloud `steel` schema now has `agent_rules`,
  `catalog_family_rules`, `quote_rules`, and `customer_rules`; no
  `workbook_rules` table exists.
- Verified old rejected draft surfaces are absent in cloud:
  `steel.catalog_families.inference_rules = false` and
  `steel.quote_defaults.product_name = false`.
- Verified cloud table comments encode the intended ownership:
  `agent_rules` for process/default Agent Instruction/workbook output flow,
  `catalog_family_rules` for product-name inference,
  `quote_rules` for category/order-format/calculation/price rules, and
  `customer_rules` for customer-specific specs.
- Fresh cloud read probe confirmed only these rule tables exist from this slice:
  `agent_rules`, `catalog_family_rules`, `customer_rules`, and `quote_rules`;
  `workbook_rules` is absent and rejected legacy columns remain absent.
- Cloud `supabase_migrations` schema does not exist on this project, so no
  Supabase CLI repair record was written; schema was applied directly through
  the cloud Postgres URL.
- Implemented DB-backed rule repositories and unified tool outputs:
  `lookup_catalog_families` returns `catalog_family_rules` plus fallback
  catalog-family inference prompts, `lookup_quote_rules` returns stored
  `quote_rules` plus instruction/default rule objects, and `search_customers`
  returns `customer_rules`.
- Updated `CONTEXT.md` with rule purposes, database formats, AI tool retrieval
  paths, and Codex pre-Admin-UI update association logic.
- Focused tests passed:
  `cd packages/api && npx jest src/steel/repositories/families.spec.ts
src/steel/repositories/defaults.spec.ts src/steel/repositories/rules.spec.ts
src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --runInBand`.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in app/endpoint/cache/share files, but
  exits `0`, and no warning remains in the new Steel rule repository code.
- Hygiene passed: `git diff --check`.

## Active: Steel Subtotal Validation Docs Cleanup

Goal: finish the architecture-doc rebaseline after removing the hidden
code-evidence gate. AI on the fixed OAuth/Codex path owns quote arithmetic and
may use provider-side code capability internally, but backend acceptance should
validate source/rule scope, workbook patch shape, and subtotal/summary
consistency instead of requiring disclosed Code Interpreter evidence.

- [x] Remove remaining runtime acceptance wording that requires code/Python or
      Code Interpreter evidence before confirmed workbook totals.
- [x] Replace backend calculator / calculation-state wording with AI calculation
      prompt/context plus backend subtotal validation.
- [x] Sync `tasks/v8.3/phase-2-data-tools.md` so v8.3 can resume from the same
      subtotal-consistency boundary.
- [x] Run stale grep and diff hygiene checks.

Review evidence:

- Updated `tasks/steel-data-rules-architecture` README, schema/model, tool
  calling, checkpoints, material-rule, source-inventory, and scenario docs so AI
  owns calculation on OAuth/Codex and backend validates source/rule scope,
  workbook patches, and subtotal/summary consistency.
- Updated `tasks/v8.3/phase-2-data-tools.md` to replace stock/calculator engine
  implementation milestones with AI calculation context and workbook subtotal
  validator tasks.
- Removed merged legacy tool names from the runtime `steelToolArgsSchemas` key
  set while preserving internal merged-rule/default schemas for
  `lookup_quote_rules`.
- Updated focused tool/provider specs and manual smoke expectations so
  `lookup_defaults` is not an optional runtime call.
- Stale gate grep passed: no old code-evidence/calculator runtime terms remain
  in the active data-rules/v8.3 docs and focused Steel tool/provider code.
- Focused tests passed:
  `cd packages/api && npx jest src/steel/tools/registry.spec.ts
src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --runInBand`.
- Manual smoke spec parse/skip check passed:
  `cd packages/api && npx jest --runTestsByPath
src/steel/ai/provider.catalog-oral.manual.spec.ts
--testPathIgnorePatterns='/node_modules/' --runInBand` skipped 6 env-gated
  live smokes.
- Build passed: `npm --workspace packages/api run build`; Rollup still reports
  existing non-Steel TypeScript warnings in agents/custom endpoint/redis/share
  files, but exits `0`.
- Hygiene passed: `git diff --check`.

## Active: Steel Data-Rules Merged Rule Tool Docs Cleanup

Goal: finish the data-rules architecture package cleanup so runtime docs no
longer expose `lookup_instructions` or `lookup_defaults` as AI-callable MVP
tools. The current runtime surface is the merged `lookup_quote_rules`
contract, where `lookup_quote_rules = lookup_instructions + lookup_defaults`.

- [x] Remove `lookup_instructions` / `lookup_defaults` from
      `tasks/steel-data-rules-architecture` runtime tool lists, scenarios,
      checkpoints, and Agent/Instruction Packet text.
- [x] Update the corresponding `tasks/v8.3/phase-2-data-tools.md` references so
      v8.3 can point back to the same merged lookup contract.
- [x] Run stale grep proving the old names only remain as historical/internal
      composition terms, not runtime tools.

Review evidence:

- Updated `agent-instructions.md`, `instruction-packets.md`,
  `phase-3-material-rules.md`, `phase-4-tool-calling.md`,
  `phase-4a-quote-defaults-architecture.md`,
  `phase-4b-rule-proposal-backend.md`, `phase-6-verification.md`,
  `ai-rule-selection-scenarios.md`, and `README.md` so AI-callable runtime docs
  expose merged `lookup_quote_rules` instead of separate `lookup_instructions`
  / `lookup_defaults`.
- Updated `tasks/v8.3/phase-2-data-tools.md` to the same Allowed MVP runtime
  tools: `lookup_quote_rules`, `search_customers`, `search_price_candidates`,
  and `lookup_formula`.
- Stale grep passed: no `Call lookup_instructions`, `Call lookup_defaults`,
  `remains callable`, `compatibility tool`, or Allowed-list legacy-tool matches
  remain in `tasks/steel-data-rules-architecture` or
  `tasks/v8.3/phase-2-data-tools.md`.
- Remaining `lookup_instructions` / `lookup_defaults` mentions are only the
  explicit composition contract `lookup_quote_rules = lookup_instructions +
lookup_defaults` or internal facet wording.
- Hygiene passed: `git diff --check`.

## Active: Steel AI Subtotal Validation Boundary Rebaseline

Goal: supersede the older backend-canonical calculation and code-evidence gate
design. Steel quote numbers should be calculated by AI on the fixed
OAuth/Codex path, while backend provides reviewed rules/source rows, prompt
context, workbook projection validation, and subtotal/summary consistency checks
instead of trying to prove hosted Code Interpreter execution.

- [x] Update `tasks/steel-data-rules-architecture` docs so they no longer plan
      backend deterministic quote calculators, `quote_calculation_state`, or
      `quote_calculation_item_audits` as required Steel runtime surfaces.
- [x] Update provider/workbook prompt contract so AI calculates quote numbers on
      the OAuth/Codex path and backend validates workbook totals by subtotal
      consistency, not hidden provider-tool disclosure.
- [x] Remove `openai.code_interpreter` enablement, evidence parser, fallback,
      response `calculationEvidence`, and code-evidence loop guard.
- [x] Add provider loop guard: when summary total / confirmed amount disagrees
      with the sum of line `subtotal` values, reject that patch for the round
      and require AI to emit corrected workbook totals.
- [x] Run a live `/steel/oauth-chat` provider-path smoke with real `gpt-5.5`
      and record whether subtotal consistency is maintained on the fixed
      OAuth/Codex path. This smoke used the same OAuth adapter as the route,
      with HTTP/JWT route auth bypassed.
- [x] Remove or quarantine backend pricing decision modules such as
      `packages/api/src/steel/pricing/decision.ts` if no current runtime path
      still needs them for non-calculation validation.
- [x] Verify with grep-focused stale-contract checks and focused provider/tool
      tests before deleting any existing tests or schema plans.

Review evidence:

- Focused provider RED evidence: `cd packages/api && npx jest
src/steel/ai/provider.spec.ts --runInBand` initially failed because
  `openai.code_interpreter` was still registered and confirmed workbook totals
  still required code evidence.
- Focused provider GREEN evidence: `cd packages/api && npx jest
src/steel/ai/provider.spec.ts --runInBand` passed 26 tests, including no
  registered provider tools, subtotal-consistent totals accepted, and
  subtotal-mismatched summary totals looped for correction.
- Shared contract GREEN evidence: `cd packages/data-provider && npx jest
src/steel/ai.spec.ts --runInBand` passed 11 tests with no
  `calculationEvidence` response field.
- Focused Steel suite GREEN evidence: `cd packages/api && npx jest
src/steel/ai/provider.spec.ts src/steel/models.spec.ts
src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts --runInBand`
  passed 4 suites / 58 tests.
- Build evidence: `npm run build:data-provider` passed, and
  `npm --workspace packages/api run build` created `dist`; Rollup still reports
  existing unrelated TS warnings in agents/custom endpoint/redis/share files.
- Live OAuth/Codex smoke evidence: real `gpt-5.5` returned
  `openai_oauth_responses`, response id
  `resp_0240dd66d2517f58016a267b8bbc04819187281217e02e7816`,
  workbook subtotal `624`, summary total `624`, confirmed amount `624`, warning
  count `0`, and no `calculationEvidence` field.
- Hygiene evidence: `git diff --check` passed. Stale-contract grep found no
  runtime evidence parser/gate symbols and no `code_interpreter: not_applicable`
  in Steel capability maps.

## Active: Steel Merged Rule Tool Definition Cleanup

Goal: remove the already-merged AI-callable Steel tool definitions for
`lookup_instructions` and `lookup_defaults`. The runtime should expose
`lookup_quote_rules` as the single merged rule/default lookup surface, with
`lookup_quote_rules = lookup_instructions + lookup_defaults`.

- [x] Add RED coverage that `getSteelToolDefinitions()` no longer exposes
      `lookup_instructions` or `lookup_defaults`, and that those names are
      rejected as unknown executable AI tools.
- [x] Update provider prompt/reminder copy so AI is told to call
      `lookup_quote_rules` before category-dependent lookups, without legacy
      `lookup_instructions` / `lookup_defaults` fallbacks.
- [x] Remove the merged tool definitions from the Steel tool registry while
      preserving `lookup_quote_rules`, `lookup_catalog_families`,
      `search_customers`, `search_price_candidates`, and `lookup_formula`.
- [x] Update focused provider/tool tests and stale docs references that still
      describe the old merged tools as AI-callable runtime options.
- [x] Run focused Steel tool/provider tests, `packages/api` build, formatting or
      diff hygiene checks, and record review evidence here.

Review evidence:

- RED evidence: `cd packages/api && npx jest src/steel/tools/registry.spec.ts
src/steel/tools/execute.spec.ts --runInBand` initially failed because the
  registry still exposed `lookup_instructions` / `lookup_defaults` and executor
  still accepted `lookup_instructions`.
- GREEN focused evidence: `cd packages/api && npx jest
src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts
src/steel/ai/provider.spec.ts --runInBand` passed 3 suites / 53 tests.
- Build evidence: `npm --workspace packages/api run build` completed and
  created `dist`; Rollup still reports existing unrelated TypeScript warnings in
  agents/custom endpoint/redis/share files.
- Hygiene evidence: `npx prettier --check ...` passed on touched files and
  `git diff --check` passed.

## Active: Steel Workbook First-Load And System Model Fix

Goal: Fix the `/steel/oauth-chat` workbook regressions reported by the user:
`系統訂單`.`型號` should carry the adopted product-price model, the initial workbook
load should not show latest-update cell highlights, and a newly loaded workbook
should display `v1` instead of `v2`.

- [x] Add RED regression coverage for `patch_quote_workbook` carrying the
      product-price model into `系統訂單`.`型號`.
- [x] Update the workbook prompt/tool instructions so AI knows
      `systemOrder.modelCode` / `系統訂單`.`型號` must come from the adopted product
      price row model.
- [x] Add RED API/route coverage that the first workbook data load shows version
      `v1` and does not mark cells as the latest update.
- [x] Implement the narrow semantic schema/projection and first-load state fix.
- [x] Update lessons for the workbook correction pattern.
- [x] Run focused API/client tests, build changed packages, restart dev server,
      and record review evidence here.

Review evidence:

- RED regressions first failed because semantic workbook projection did not emit
  `system_order.model_code`, and the workbook service incremented the first data
  patch to `v2` with highlight paths.
- Semantic workbook projection now accepts `systemOrder.modelCode` and projects
  it to `系統訂單`.`型號` / `model_code`; provider prompt explicitly tells AI to
  source that value from the adopted product-price row `型號`.
- Workbook service now treats the first accepted data patch into an empty
  workbook as initial data load: the workbook remains `v1`, `changedPaths` is
  empty, and `changedFieldSummary` is preserved for concise chat summaries.
- Focused API verification passed:
  `packages/api` `semantic.spec.ts`, `service.spec.ts`, `provider.spec.ts`, and
  `handlers.spec.ts` passed 57 tests.
- Focused UI verification passed:
  `client/src/routes/SteelOAuthChat.spec.tsx` passed 12 tests.
- `npm --workspace packages/api run build` completed successfully with existing
  non-Steel Rollup TypeScript warnings.
- Prettier check and `git diff --check` passed. Backend was restarted; both
  `http://localhost:3080/api/config` and
  `http://localhost:3090/steel/oauth-chat` returned `HTTP/1.1 200 OK`.

## Steel OAuth Stream Provider Error Diagnosis

Goal: Fix the `/steel/oauth-chat` failure state where the Thinking tab only
shows generic `OpenAI OAuth provider request failed.` after successful Steel
lookups. The stream should preserve a sanitized provider error detail so we can
distinguish context-length, schema, auth, rate-limit, and transient provider
failures.

- [x] Gather evidence from the user-visible stream sequence: provider failed
      after `lookup_formula completed`, so Supabase lookup tools had succeeded.
- [x] Reproduce a clean direct provider flow with workbook tools and C 型鋼
      lookup; it succeeded with a workbook patch, so the failure is tied to the
      actual UI payload/session state or a transient provider response, not a
      stable schema or database failure.
- [x] Add RED handler coverage for sanitized unknown provider errors.
- [x] Implement provider-error summary sanitization for chat and stream routes.
- [x] Verify focused handler/provider tests, API build, direct C 型鋼 provider
      smoke, and backend readiness.

Review evidence:

- RED handler regression first failed because stream errors still returned only
  `OpenAI OAuth provider request failed.` for an unknown provider exception.
- Handler error summary now preserves sanitized unknown provider details while
  keeping existing auth, timeout, and Steel tool error categories.
- Clean direct provider smoke with workbook tools returned `ok`, proving
  `patch_quote_workbook` schema is accepted when exposed.
- Full direct C 型鋼 provider flow with real OAuth and cloud Steel tools
  succeeded twice after the failure report, including workbook patch operations
  and a `643` subtotal. This points the user-visible failure toward the
  specific UI session payload/length or transient provider response rather than
  a stable schema/database failure.
- Verification passed:
  `cd packages/api && npx jest src/steel/handlers.spec.ts src/steel/ai/provider.spec.ts src/steel/workbook/semantic.spec.ts --runInBand`,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  TypeScript warnings, and direct C 型鋼 OAuth smoke with workbook patch.
- Backend was restarted after the build; `http://localhost:3080/api/config` and
  `http://localhost:3090/steel/oauth-chat` both return `HTTP/1.1 200 OK`.

## Steel Semantic Workbook Patch

Goal: Replace large AI-authored cell-by-cell quote workbook patches with a
compact semantic quote patch tool. AI still decides customer/material/price/rule
facts from reviewed tool results, while backend projection keeps all workbook
sheets synchronized and supports cascade updates when one quote value changes.

- [x] Write the implementation plan under
      `docs/plans/2026-06-05-steel-semantic-workbook-patch.md`.
- [x] Add RED projection tests that one semantic quote line fills the required
      workbook sheets and that a repriced line re-emits all affected cells.
- [x] Add RED provider tests that `patch_quote_workbook` is AI-callable,
      projected into existing `set_cell` workbook patch operations, and avoids
      incomplete multi-call workbook patch loops.
- [x] Implement the semantic workbook projection helper and provider tool
      parsing/tool-result flow.
- [x] Verify focused workbook/provider tests, API build, diff hygiene, and
      restart backend/frontend readiness for manual `/steel/oauth-chat` testing.

Review evidence:

- RED `semantic.spec.ts` first failed because `./semantic` did not exist; GREEN
  helper tests now prove one semantic C 型鋼 quote line fills required workbook
  sheets and a repriced same-`lineId` quote re-emits affected cells across
  `報價明細`, `系統訂單`, `總結`, `價格來源`, and `給客戶用`.
- RED provider test first failed because `patch_quote_workbook` was not parsed
  as a workbook output tool; GREEN provider tests now expose only
  `patch_quote_workbook` to AI, project semantic quote data into existing
  `set_cell` operations internally, and return a complete workbook output tool
  result before the final assistant text.
- Documentation now records that all AI workbook updates should use semantic
  `patch_quote_workbook`; direct workbook operations are backend projection
  internals, not an AI-callable tool.
- Verification passed:
  `cd packages/api && npx jest src/steel/workbook/semantic.spec.ts src/steel/ai/provider.spec.ts --runInBand`,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  TypeScript warnings, touched-file Prettier check, and `git diff --check`.
- Backend watcher was restarted after the build. Readiness evidence:
  `http://localhost:3080/api/config` returned `HTTP/1.1 200 OK` and
  `http://localhost:3090/steel/oauth-chat` returned `HTTP/1.1 200 OK`.

## Steel Catalog Price Tool Prompt And Semantic Workbook Output

Goal: Make the runtime prompt teach the model exactly how to call
`search_price_candidates` after selecting catalog family keys, with
`productNames` as the only AI-callable reviewed product-name candidate field.
Also prevent workbook completion from pushing the model into hand-written
cell-operation patches by making `patch_quote_workbook` the only AI-callable
workbook output tool.

- [x] Add RED prompt/schema coverage that the first system prompt, retry
      reminder, and tool schema teach generic catalog lookup semantics:
      selected keys go in `catalogFamilies`, oral family/category labels do not
      go in `productNames`, and inferred reviewed product-name candidates use
      `productNames` or `candidateQueries.productNames`. The public tool input
      rejects old `productName`; repository result/source rows may still return
      `productName`.
- [x] Add RED workbook prompt/reminder coverage that AI-visible workbook output
      uses only `patch_quote_workbook`, including follow-up and incomplete
      semantic patch reminders.
- [x] Update provider runtime/workbook instructions, stream status, and
      incomplete-patch tool result text.
- [x] Remove arbitrary workbook size caps from semantic quote lines and
      internally projected workbook operations.
- [x] Update docs/lessons for the prompt and workbook-output corrections.
- [x] Verify focused provider/handler/client tests, API build, formatting, diff checks, and
      restart backend for manual testing.

Review evidence for `productNames` cleanup:

- RED focused registry/normalization tests failed while fixtures still sent old
  `productName`; GREEN focused tests passed after the public
  `search_price_candidates` schema accepted only `productNames` and
  `candidateQueries.productNames`.
- Focused verification passed after formatter: `provider.spec.ts`,
  `execute.spec.ts`, `registry.spec.ts`, and `search.spec.ts` all passed
  57 tests.
- `npm --workspace packages/api run build` completed successfully with the
  existing non-Steel Rollup TypeScript warnings.
- Built `dist` smoke accepted `productNames` and rejected old `productName`;
  direct cloud Supabase `executeSteelTool(search_price_candidates)` returned
  C 型鋼 same-spec 錏/白鐵 candidates from `productNames`.
- Cloud `steel.instruction_packets` C 型鋼 row was updated so runtime
  `lookup_quote_rules` no longer returns the old `productName filter` or
  mutual-exclusion wording.
- `git diff --check` passed.
- User correction applied: `patch_workbook` is no longer AI-callable. Provider
  exposes only `patch_quote_workbook`; semantic tool calls are projected
  internally to workbook `set_cell` operations.
- User correction applied: workbook output must not have arbitrary size caps.
  Removed `quoteLines` max limits and the internal 100-operation cap for
  provider/workbook patch schemas.
- Focused no-size-limit verification passed: `packages/api` semantic/provider/
  handler tests pass 49 tests, including a `patch_quote_workbook` projection
  that produces more than 100 workbook `set_cell` operations.
- Shared contract verification passed: `packages/data-provider` AI/workbook
  schema tests pass 17 tests, including 120-operation provider proposals and
  workbook patch requests.
- Focused verification passed after the semantic-only workbook change:
  `provider.spec.ts`, `handlers.spec.ts`, `semantic.spec.ts`,
  `packages/data-provider/src/steel/ai.spec.ts`, and
  `client/src/routes/SteelOAuthChat.spec.tsx`.
- `npm --workspace packages/api run build` completed successfully with existing
  non-Steel Rollup TypeScript warnings. Backend was restarted; both
  `http://localhost:3080/api/config` and
  `http://localhost:3090/steel/oauth-chat` returned `HTTP/1.1 200 OK`.

- [x] Active runtime slice: stabilize `/steel/oauth-chat` cloud Supabase
      Postgres tool lookup. Steel runtime must connect through `.env`
      `STEEL_POSTGRES_URL` to cloud Supabase, reuse the runtime pool for
      streaming tool execution, and surface fatal DB/tool errors once instead
      of retrying the same failed lookup through the model loop.

Review evidence:

- Direct cloud `pg` ping against `.env` `STEEL_POSTGRES_URL` succeeded through
  Supavisor 5432 and 6543 with `steel_schema_exists=true`.
- Earlier `/steel/oauth-chat` live smoke reached true `openai_oauth_responses`
  and called `lookup_quote_rules`, but `executeSteelTool` returned
  `repository_error: Connection terminated due to connection timeout`; this
  showed the model/tool routing was correct and the runtime blocker was the
  cloud Postgres connection path.
- Updated Steel Postgres runtime pool defaults to use a longer cloud-friendly
  connection timeout and TCP keepalive, and changed the streaming tool executor
  to reuse the runtime cloud Postgres pool instead of creating a new pool per
  request.
- Focused verification passed: `postgres.spec.ts`, `provider.spec.ts`, and
  `handlers.spec.ts` all passed; `npm run build:api` rebuilt `packages/api/dist`
  with existing unrelated Rollup TypeScript warnings.
- Direct runtime tool lookup through cloud Supabase succeeded:
  `lookup_quote_rules` returned reviewed instruction/default data and
  `search_price_candidates` returned 4 C 型鋼 price candidates for
  `錏輕型鋼 100x2.3`.
- `/steel/oauth-chat` live smoke succeeded through the stream endpoint:
  status order was `Request validated` -> `Waiting for provider` ->
  `lookup_quote_rules started/completed` ->
  `search_price_candidates started/completed`, and the AI returned
  C 型鋼 6M 小計 `643.2 元/支`. Semantic workbook patch enforcement remained a
  separate AI behavior follow-up at that point.

## Steel Supabase SSL Runtime Fix

Goal: Fix `/steel/oauth-chat` Steel tool failures where Supavisor Postgres
lookup returns `self-signed certificate in certificate chain` when
`STEEL_POSTGRES_URL` omits libpq-compatible SSL query parameters.

- [x] Reproduce the error with a direct `pg` probe using the current `.env`
      `STEEL_POSTGRES_URL`.
- [x] Add RED coverage for automatic Steel Postgres URL SSL normalization.
- [x] Normalize Steel Postgres URLs so absent SSL params use
      `sslmode=require&uselibpqcompat=true` without printing or changing
      secrets.
- [x] Update lessons/docs for the runtime SSL behavior.
- [x] Verify focused Postgres tests, API build, direct cloud query, formatting,
      diff checks, and restart backend for manual testing.

Review:

- Direct sanitized `pg` probe reproduced the user-facing tool failure:
  current `.env` pointed at Supavisor `6543` without SSL query parameters, and
  `pg` returned `self-signed certificate in certificate chain`.
- Steel Postgres helper now normalizes missing SSL parameters to
  `sslmode=require&uselibpqcompat=true`. Explicit URLs, including
  CA-backed `sslmode=verify-full`, are preserved.
- Verification passed: RED `postgres.spec.ts` failed before the helper update;
  GREEN `postgres.spec.ts` passed 6 tests; `packages/api` build passed with
  existing non-Steel Rollup warnings; built helper direct cloud query returned
  `steelSchemaExists=true`; direct `lookup_catalog_families` tool returned
  `c_type`; Prettier and `git diff --check` passed.
- Backend was rebuilt and nodemon restarted. `http://localhost:3080/api/config`
  and `http://localhost:3090/steel/oauth-chat` both return 200.

## Steel Workbook Fill Instruction From 訂單參考

Goal: Teach the OpenAI Responses workbook patch agent how to organize tool
results from customer lookup, product price lookup, formula lookup, and
calculation results into the seven `訂單參考_轉檔.xlsx` workbook sheets without
inventing missing price/customer/weight/formula facts.

- [x] Write the implementation plan under `docs/plans/`.
- [x] Add RED provider prompt coverage for the workbook fill contract:
      price-before-weight, no zero for unknown, system/customer sheet separation,
      calculation-result precedence, summary split totals, and customer-visible
      field restrictions.
- [x] Update provider workbook patch instructions with the compact workbook fill
      contract.
- [x] Update docs and lessons so future agents keep the same workbook-fill
      behavior.
- [x] Run focused provider tests, API build, formatting, and diff checks.

Review:

- RED verification first failed because the workbook patch system prompt did not
  include the `價格先於重量`, no-zero unknown, sheet separation, summary split,
  customer-visible restriction, or `calculation_results` precedence contract.
- Provider workbook instructions now include the compact
  `docs/reference/訂單參考_轉檔.xlsx` fill contract, while backend behavior stays
  validation/reminder-only and does not synthesize companion workbook rows.
- Documentation and lessons now record that AI maps reviewed tool results into
  workbook sheets, writes unknowns as `未確認` instead of `0`, and keeps
  `給客戶用` free of internal source/tier/candidate/audit data.
- Verification passed:
  `provider.spec.ts` targeted RED/GREEN test, full `provider.spec.ts` 21 tests,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  warnings, touched-file Prettier check, and `git diff --check`.

## Steel Workbook Per-Turn Completion

Goal: Every `/steel/oauth-chat` turn that updates workbook data should check
whether the new information has been propagated to all relevant workbook sheets
and cells. The backend must not hard-fill ERP/customer/summary rows; it should
return missing sheet/cell guidance through the `patch_quote_workbook` tool
result so the AI can decide which values are derivable and which gaps belong in
`人工複核` / `判讀備註`.

- [x] Reproduce the bug with a provider regression where AI updates only
      `報價明細` on a customer/tier repricing follow-up and leaves
      `系統訂單`, `總結`, `人工複核`, and `給客戶用` blank.
- [x] Generalize workbook completion from "required sheets touched" to
      per-turn "required sheet and cell coverage" for workbook patches.
- [x] Keep completion AI-led: tool results identify missing cells and
      instructions, but backend does not synthesize workbook cell values.
- [x] Update docs and lessons with the per-turn workbook completion rule.
- [x] Verify focused provider/handler tests, API build, and diff hygiene.

Review:

- Root cause: workbook completion only checked required sheet ids. A model could
  satisfy the gate by touching every sheet with sparse shell cells while leaving
  user-visible workbook content blank.
- Provider completion now returns both `missingSheetIds` and `missingCells` for
  every Steel runtime workbook patch turn. Incomplete semantic patches feed a
  `patch_quote_workbook` tool result back to the model and require another
  explicit AI patch before the final answer.
- The backend still does not synthesize companion workbook rows. It only reports
  missing sheet/cell targets and tells AI to patch derivable values or record
  unavailable evidence in `manual_review` / `interpretation_notes`.
- Documentation and lessons now record the per-turn minimum-cell coverage rule.
- Verification: RED provider regression first failed because sparse all-sheet
  patches were accepted without `missingCells`; GREEN verification passed
  `provider.spec.ts` 21 tests, `handlers.spec.ts` 22 tests,
  `npm --workspace packages/api run build` with existing non-Steel Rollup
  warnings, touched-file Prettier check, and `git diff --check`.

- [x] Active quote-runtime slice: make catalog-family selection AI-owned. Expose
      reviewed `steel.catalog_families` vocabulary/context to the AI so it can
      judge oral product wording and choose a stable `catalogFamilies` key;
      backend price tools should only validate/query explicit keys and must not
      contain a separate oral-alias matcher.

Review evidence:

- Updated plan
  `docs/plans/2026-06-04-steel-catalog-family-normalization.md` after the user
  corrected the boundary: AI decides oral wording -> key; code does not.
- Removed the started backend alias-matching repository/tests and restored
  `search_price_candidates` to query only explicit AI-provided
  `catalogFamilies`.
- Verification after correction: focused `packages/api` executor Jest passed
  15/15, touched-file Prettier check passed, code grep found no matcher
  implementation residue, and targeted `git diff --check` passed.
- Implementation direction for this slice: add a data-only
  `lookup_catalog_families` tool that returns reviewed vocabulary candidates and
  source refs for AI judgment; do not return a backend-selected or
  backend-resolved key.
- Implemented `lookup_catalog_families` as an AI-visible, data-only tool backed
  by `steel.catalog_families`; provider instructions now tell AI to call it for
  reviewed vocabulary candidates when catalog wording is unclear, then pass
  explicit `catalogFamilies` to price/default/formula tools.
- Verification after implementation: RED tests failed for missing repository,
  registry/executor tool exposure, and provider prompt/tool-list updates; GREEN
  focused tests passed; full `packages/api` Steel Jest passed 29 suites / 128
  tests; `npm run build:api` exited 0 with existing Rollup TypeScript warnings;
  live Supabase sample verified `a_pipe` and `h_beam` aliases; touched-file
  Prettier check, production-code residue grep, and targeted `git diff --check`
  passed.
- C 型鋼 live smoke: `lookup_catalog_families(searchText='C型鋼')` returned
  `c_type` with aliases `C型鋼`, `C鋼`, `C 型鋼`, `C型`, `輕型鋼`, and `型鋼`;
  `search_price_candidates` with AI-selected `catalogFamilies: ['c_type']` and
  derived `specKeyContains: '100x2.3'` returned 8 confirmed price candidates,
  including `白鐵輕型鋼 100*2.3(定尺-3元)` and `錏輕型鋼 100*2.3`; `lookup_formula`
  returned formula `C`.
- User correction captured: do not add a mocked AI response test to prove AI
  will generate `c_type + 100x2.3`; mocked provider tests only prove backend
  prompt/tool plumbing. AI behavior must be verified by live AI API smoke or
  reported as unverified.
- C 型鋼 prompt-rule update: added task-scoped instruction text telling AI not
  to use `productName: C型鋼` as a narrow price filter after selecting `c_type`;
  it should query by size/thickness fragments such as `100x2.3` and present
  白鐵/錏/黑鐵輕型鋼 options when material/surface is ambiguous. Also added
  `c_type.metadata.searchHints` in `steel.catalog_families`.
- Live AI API smoke after the task-scoped prompt rule still failed the desired
  behavior: real `gpt-5.5` selected `catalogFamilies: ['c_type']` but also
  sent `productName: C型鋼` / `productName: C型鋼 100x50x20 2.3t` and
  `specKeyContains: 100x50x20`, so reviewed lookup returned zero candidates.
  This confirmed the user correction: mocked AI response tests would not prove
  the C 型鋼 oral-input behavior.
- Follow-up guardrail: `search_price_candidates` now rejects
  `catalogFamilies: ['c_type']` searches that still use `C型鋼`/`C鋼` as a
  `productName` filter, provider runtime policy includes the C 型鋼
  `c_type + 100x2.3` strategy up front, and invalid-argument price lookup
  results no longer count as completed reviewed price lookup.
- Live AI API smoke after the guardrail passed the target behavior. Real
  `gpt-5.5` first sent the bad `productName: C型鋼` / full-section query and
  received `invalid_arguments`; the forced second tool call used
  `catalogFamilies: ['c_type']`, `productName: 錏輕型鋼`, and
  `specKeyContains: 100x2.3`. Real Supabase returned 4 reviewed
  `錏輕型鋼 100*2.3` price candidates for customer tiers 1-4
  (`26`, `26.8`, `25.5`, `25` TWD / 支).
- User correction captured: oral order flow is AI judges category/catalog key
  first, then `lookup_instructions`, then category-dependent tools such as
  `search_price_candidates`, `lookup_defaults`, or `lookup_formula`. Provider
  runtime now gates direct category-dependent lookups until
  `lookup_instructions` succeeds for the interpreted context.
- User correction captured: C 型鋼材質不明時，AI 可以先塞
  `productName: 錏輕型鋼` as the usual high-confidence provisional material,
  while still keeping the quote provisional and surfacing bounded alternatives
  such as 白鐵輕型鋼 / 黑鐵輕型鋼 when relevant.
- Added gated live AI behavior smoke
  `packages/api/src/steel/ai/provider.catalog-oral.manual.spec.ts`, enabled by
  catalog-specific env flags such as `STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST=true`.
  Mocked provider unit tests remain
  limited to adapter/tool-loop contracts and should not be cited as evidence of
  AI judgment.
- Live OAuth C 型鋼 smoke passed with real `openai_oauth_responses` and real
  Supabase tools. Evidence: actual executed tool sequence included
  `lookup_instructions` before `search_price_candidates`; the price call
  derived `catalogFamilies: ['c_type']`, `productName: 錏輕型鋼`, and
  `100x2.3`, then returned a positive reviewed candidate.
- Follow-up deterministic fix from live smoke: when AI sends both
  `specKey: 100x2.3` and malformed `specKeyContains: 100 2.3`, normalization
  now prefers `100x2.3`; when AI sends a full-section `specKey` together with
  `specKeyContains`, price lookup uses the partial fragment instead of
  over-constraining SQL with an exact full-section spec.
- [x] Follow-up live-smoke slice: extend the same `lookup_instructions` first
      runtime proof beyond C 型鋼 to H 型鋼 and angle/角鐵 oral requests.
      Deterministic coverage must prove H 型鋼 expands `h-type-quote-core`
      instruction packets; gated OAuth smoke must prove real
      `openai_oauth_responses` calls `lookup_instructions` before positive
      `search_price_candidates` lookups for H 型鋼 and angle/角鐵.
- H 型鋼 deterministic coverage now asserts the returned `lookup_instructions`
  packet content includes常規米數 `6M/9M/10M/12M`, 非常規米數
  `7M/8M/11M/13M/14M/15M`, and 非常規米數 `+0.3 元/kg`, not just the packet
  slug. Follow-up user correction recorded that exact reviewed 非常規米數
  product-price rows in `產品價格.xlsx` already include the `+0.3/kg`
  adjustment, so AI must not add `+0.3/kg` again after finding those rows; the
  surcharge rule is only a provisional/default derivation when no exact reviewed
  non-standard length row exists.
- [x] Follow-up live-smoke slice: add real OAuth behavior checks for
      `亞L30x30` bounded-option quoting and H 型鋼 processing interpretation.
      The `亞L30x30` smoke must prove no exact canonical row is required for AI
      to provide a highest-confidence provisional reviewed candidate, list
      bounded alternatives, and accept a later user selection in a multi-turn
      follow-up. The H 型鋼 smoke must prove AI calls `lookup_instructions` before
      processing-dependent lookups for cutting, slotting, and holes, then uses
      reviewed defaults/rules instead of inventing processing prices.
- Live OAuth `亞L30x30` bounded-options smoke passed with real
  `openai_oauth_responses` and real Supabase tools. It ran a two-turn
  conversation: first response found the highest-confidence reviewed
  `錏成型角鐵30*2.5*6M` candidate at `194.3` TWD / 支 while keeping the quote
  provisional and asking for confirmation; follow-up user selection
  `錏成型角鐵30*2.5*6M，第1級價格` resolved to the selected reviewed candidate.
  The live follow-up exposed malformed AI `specKeyContains: 30 2.5 6M`;
  normalization now prefers structured `specKey: 30x2.5x6M` and searches the
  imported `30x2.5x6M` price-table fragment instead of `302.56m`.
- Live OAuth H 型鋼 processing smoke passed with real `openai_oauth_responses`
  and real Supabase tools. It verified `lookup_instructions` before processing
  lookups, reviewed H 型鋼 processing instruction/default rules, material
  `h_beam` price lookup, and reviewed processing price candidates including
  `開槽加工` / `KZZB10` and `沖孔加工` / `KZZB11`; the response kept cutting,
  slotting, and hole fees as provisional/confirmation-needed processing items.
  Runtime policy now tells AI that when instruction packets name processing
  price candidates or ERP item codes, it must call `search_price_candidates` for
  reviewed processing rows instead of quoting processing prices only from
  instruction packet text.
- Live OAuth H 型鋼 smoke passed with real `openai_oauth_responses` and real
  Supabase tools. The first executed tool was `lookup_instructions`; the
  returned instruction content included the H 型鋼米數/加價規則; the subsequent
  price lookup returned a positive reviewed `h_beam` candidate. A deterministic
  normalization regression now converts AI's `100x50x5/7` fragment to the
  imported price-table fragment `100x50x5_7`.
- Live OAuth angle smoke passed with real `openai_oauth_responses` and real
  Supabase tools after the angle instruction packet was updated to tell AI that
  reviewed rows such as `錏成型角鐵30*2.5*6M` require `30x2.5x6M` /
  `30x2.5` spec candidates in addition to equal-angle `30x30` candidates.
  `亞L30x30` remains an oral candidate/confirmation rule rather than a guaranteed
  positive exact price-row smoke fixture.

- [x] Active data/schema slice: replace the steel-only family vocabulary
      vocabulary surface with a generic `catalog_family` lookup key for
      `docs/reference/產品價格.xlsx`; import every product catalog family into
      Supabase, link every imported price row to a catalog family/category,
      remove old `materialFamilies` runtime input logic instead of keeping a
      compatibility alias, and update docs/tests so AI can query product catalog
      terms such as 鋼管, 配管, 壁板, 樹脂, 鋁窗, 擋水板, 鐵門, 棚架,
      方管連料, 伸縮大門, B管, A管, 尺, 紗網, 門花, P型管, 螺絲, 角輪,
      門鎖, I字鐵, 圓鐵, 圓條, 方鐵, 錏板, OT板, 黑板, and 鐵格板.

Review evidence:

- Created plan `docs/plans/2026-06-04-steel-catalog-family-import.md` and
  source-of-truth doc `docs/steel-catalog-family-data-contract.md`.
- Replaced runtime/search/default/rule-proposal paths with
  `catalogFamilies` / `catalogFamily` / `catalog_family`. Old
  `materialFamilies` and `materialFamily` request shapes are rejected by tests.
- Added migration `supabase/migration/20260604071700_steel_catalog_families.sql`
  and synchronized `supabase/schema.sql`. Cloud DB now has
  `steel.catalog_families`; no `steel.material_families` table and no
  `steel.*.material_family` columns remain.
- Updated the reference importer so every `產品價格.xlsx` row receives a
  `categoryCode` and non-empty `catalogFamily`; uncurated rows fall back to
  ERP-prefix keys such as `erp_ax`.
- Reapplied the importer to Supabase. Verification counts: 210 catalog
  families, 277 price categories, 2256 customers, 27024 price rows, 238 cutting
  rows, 31 formulas, and 29 quote defaults.
- Direct SQL verified `price_items` imported from `產品價格.xlsx` have zero null
  `catalog_family` rows and zero null `category_id` rows.
- Direct SQL sample checks passed: `GOB0004` -> `a_pipe`, `GOS0215` ->
  `piping`, `HSA12215` -> `aluminum_window`, `HSS0001` -> `iron_door`,
  `FTB0311` -> `screw`, `FFP00020` -> `corner_wheel`, `FFL0001` ->
  `door_lock`, `EZB070709` -> `i_beam`, `EQA0030` -> `round_bar`,
  `EDA0063` -> `square_bar`, `BNG008408` -> `galvanized_plate`,
  `BNB012408` -> `ot_plate`, `DNB160408` -> `black_plate`, and `ANB3410` ->
  `grating`.
- Corrected `telescopic_gate` mapping so the whole `AX` ERP prefix is not
  classified as 伸縮大門. Current DB counts: `telescopic_gate`=59,
  `screen_mesh`=31, `measuring_tool`=18, and fallback `erp_ax`=24.
- Documented that `龍頂鋼鐵手冊__文字版.docx` remains a secondary
  weight/spec/alias reference and must not override reviewed
  `產品價格.xlsx` product-price facts.
- Verification commands passed: focused API Jest for importer/repositories/
  tools/provider/rules/handlers, data-provider rule contract Jest,
  data-schemas Steel schema Jest, `packages/data-provider` build,
  `packages/data-schemas` build, `npm run build:api`, importer dry-run,
  importer apply, direct cloud SQL checks, Prettier for touched TS/JS/MD files,
  and `git diff --check`.
- [x] Active data slice: implement an executable Steel reference-data importer
      that reads `客戶資料.xlsx`, `產品價格.xlsx`, `切工價錢.xlsx`,
      `公式編號.xlsx`, and `H型鋼.txt`; writes reviewed/updateable facts and
      defaults into Supabase through `STEEL_POSTGRES_URL`; excludes
      `訂單參考.xlsx`, `系統訂單.xlsx`, and quote/order fixtures from formal DB
      fact imports; and proves the applied row counts with SQL verification.

Review evidence:

- Added importer plan `docs/plans/2026-06-04-steel-reference-data-importer.md`,
  parser module `packages/api/src/steel/importer/reference.ts`, executable CLI
  `packages/api/scripts/import-steel-reference-data.cjs`, and npm script
  `steel:import-reference-data`.
- Dry-run summary: 6 customer tiers, 2256 customers, 27024 tiered price rows,
  238 cutting-price rows, 31 formula rows, and 29 quote-default rows.
- Supabase apply initially rolled back because cloud schema was missing
  `steel.quote_defaults`; applied existing migration
  `supabase/migration/20260602035007_phase4a_quote_defaults.sql`, verified the
  table exists, then reran the import successfully.
- Applied Supabase verification counts matched dry-run: 2256 customers, 27024
  price rows, 238 cutting rows, 31 formulas, and 29 quote defaults.
- Direct SQL edge checks passed: `產品價格.xlsx` zero rows stay
  `value_state='unknown'` with `unit_price IS NULL`; formula `C` exists; H 型鋼
  default exists; `訂單參考.xlsx` and `系統訂單.xlsx` have zero imported
  `price_items` source refs.
- Verification commands run: focused importer Jest, dry-run CLI, apply CLI,
  direct SQL check, `npm run build:api`, Prettier, and targeted
  `git diff --check`.
- [x] Record the corrected scope boundary: Admin review UI paused only; other
      implementation work remains sequenced.
- [x] Active slice: reviewed fact price decisions return bounded user-choice
      options when exact reviewed facts are missing, zero-as-missing, or
      ambiguous; preview estimates may be marked provisional, but no final
      confirmed workbook total is produced before confirmation.
- [x] Correct the typo/incomplete-spec price lookup order: AI reasoning
      proposes material/spec `candidateQueries` first, then backend searches
      reviewed price rows with those candidates instead of querying raw text
      such as `亞L30x30`.
- [x] Lock AI-led tool orchestration as the core Steel quote runtime framework
      in related docs: AI chooses business tool paths from normalized context;
      backend provides validated tools, guardrails, source-backed results,
      deterministic calculation, and audit.
- [x] Wire the AI-led orchestration policy into `/steel/oauth-chat` provider
      prompts so runtime calls start from candidate normalization/tool choice,
      not backend-fixed lookup routing.
- [x] Demote AI reasoning helpers from runtime tools: remove
      `normalize_quote_item`, `generate_price_search_terms`, and
      `rank_price_candidates` from the executable tool registry, keep
      `search_price_candidates` as the price reviewed-row lookup tool, and use
      `lookup_defaults` / `steel.quote_defaults` for reviewed reusable defaults.
- [x] Active docs slice: reduce Allowed MVP runtime tools to the AI-led quote
      flow. AI judges steel category, surface, size, and candidate price
      queries; backend exposed lookup tools are `lookup_instructions`,
      `search_price_candidates`, `lookup_defaults`, `search_customers`, and
      `lookup_formula`. Weight, cutting, processing, material-rule, ranking,
      exact-customer, arbitrary source-chunk search, and calculator primitives
      become backend internal capabilities or later extensions, not MVP tools.
- [x] Active docs slice: design AI inference rules as task-scoped
      instructions. Add `lookup_instructions` to the Allowed MVP runtime tools
      so AI can retrieve reviewed instruction packets seeded by
      `docs/reference/instruction.txt` before deriving material/spec/query
      candidates. Keep `search_source_chunks`, alias lookup, and source-text
      search out of MVP unless a later slice proves they need to be AI-callable.
- [x] Active docs slice: rename pre-tool policy to Agent Instruction and mark it
      Admin-managed. Agent Instruction is the default instruction injected into
      every Steel quote turn and can be updated/versioned through backend/Admin
      flows; task-scoped Instruction Packets are still retrieved with
      `lookup_instructions`. Planned storage is `steel.agent_instructions` and
      `steel.instruction_packets`.
- [x] Active docs slice: design `steel.agent_instructions` content sections for
      OCR/file rules, reviewed tool routing, order-line inference, workbook
      output policy, response/confirmation policy, and source validation. Clarify
      that workbook updates currently use the provider-facing `patch_workbook`
      output tool plus backend workbook service validation, not a reviewed lookup
      tool.
- [x] Active docs slice: record the first `steel.agent_instructions` seed text
      as a database-ready default instruction. The text should cover OCR/file
      evidence, AI-led tool choice, raw-typo guardrails, candidate generation,
      reviewed lookup usage, workbook provisional/confirmed writes, and user
      confirmation behavior.
- [x] Active docs slice: design `steel.instruction_packets` as task-scoped,
      reviewed instruction records. Define packet purpose, selectors, payload
      shape, `lookup_instructions` request/response behavior, admin lifecycle,
      and sample packets for `亞L30x30` angle lookup and C-type quote behavior.
- [x] Verify the Agent Instruction / Instruction Packet docs slice with
      Prettier, required-term greps, stale-term greps, and `git diff --check`.
- [x] Active docs correction: split the combined Agent Instruction / Instruction
      Packet baseline into separate documents. `agent_instructions` should own
      only the default AI instruction prompt text; `instruction_packets` should
      own only task-scoped packet design and seed packet text.
- [x] Active docs correction: make future AI instruction prompt injection
      uniformly Traditional Chinese. Database content bodies for
      `steel.agent_instructions` and `steel.instruction_packets` should be
      Traditional Chinese; API/schema field keys can remain canonical English.
- [x] Verify the split-doc correction with Prettier, stale combined-doc greps,
      required separate-doc greps, and `git diff --check`.
- [x] Active docs slice: inspect `docs/reference/instruction.txt`,
      `docs/reference/H型鋼.txt`, `docs/reference/切工價錢.xlsx`, and
      `docs/reference/公式編號.xlsx`, then classify fine-grained quote
      interpretation rules into Traditional Chinese `steel.instruction_packets`
      seed packets.
- [x] Verify the reference-derived instruction packet docs slice with Prettier,
      required packet/source greps, and `git diff --check`.
- [x] Active docs correction: update `lookup_instructions` to use one batched
      full-facet request per interpreted order context. AI should send all
      detected material families, task types, processing types, formula
      candidates, and customer/tier context together, not issue separate packet
      lookups for each small detail such as hole count, cut count, or slotting.
- [x] Verify the batched full-facet instruction lookup correction with
      Prettier, required grep, stale per-detail wording grep, and
      `git diff --check`.
- [x] Active docs correction: update hole-count interpretation so clear
      drawing/order table numbers are high-confidence primary evidence, while
      drawing hole positions are used to cross-check. If table count and drawing
      positions differ, mark manual review instead of silently trusting drawing
      over the table.
- [x] Verify the hole-count table-priority correction with Prettier, required
      grep, stale old-priority grep, and `git diff --check`.
- [x] Active docs correction: organize related steel Instruction Packets into
      packet groups/bundles so one batched `lookup_instructions` call can return
      all relevant detailed rules for the detected material/task/process
      context, instead of independent packet fragments.
- [x] Verify the Instruction Packet group/bundle correction with Prettier,
      required group/bundle grep, stale fragmented-query grep, and
      `git diff --check`.
- [x] Runtime test slice: add a C 型鋼 batched `lookup_instructions` test case
      that returns the `c-type-quote-core` packet group in one tool call,
      including C-type pricing, formula, drawing/hole, and source-priority
      instruction packets.
- [x] Verify the C 型鋼 runtime test slice with RED/GREEN focused Jest,
      registry/executor Jest, Prettier, build/typecheck, and `git diff --check`.
- [x] Active runtime correction: remove Codex/backend implementation wording from
      runtime Instruction Packet bodies. Runtime instructions should describe
      quote behavior, confirmation, and reviewed-data requirements, not tell
      backend implementation modules how to be built.
- [x] Active runtime test slice: add a multi-material batched
      `lookup_instructions` case for one order containing `亞L30x30` and
      C 型鋼, proving one tool call returns both angle/zinc and C-type rule
      groups.
- [x] Active runtime contract slice: make `lookup_defaults` and `lookup_formula`
      accept batch material contexts so one call can retrieve defaults/formulas
      for multiple steel materials.
- [x] Verify the multi-material instruction/default/formula slice with RED/GREEN
      focused Jest, registry/executor Jest, Prettier, build/typecheck, and
      `git diff --check`.
- [x] Active runtime slice: move `lookup_defaults` from seed-backed runtime
      fallback to repository-backed `steel.quote_defaults` retrieval. Keep the
      existing Supabase table schema intact unless a real missing column or
      index is proven; add only the reviewed C 型鋼 default seed data needed for
      runtime retrieval.
- [x] Active runtime correction: model C 型鋼 cutting/hole as a free/no-charge
      business default. Do not require repeated user confirmation for the
      default free charge; keep product/material price zero-as-missing unchanged.
- [x] Add RED tests for DB-backed quote defaults lookup, including a multi-
      material request where only the matching C 型鋼 default is returned from
      reviewed active rows.
- [x] Implement the `quote_defaults` repository mapper/query and wire
      `lookup_defaults` through the Steel tool executor.
- [x] Verify the DB-backed `lookup_defaults` slice with focused RED/GREEN Jest,
      repository/tool specs, Prettier, schema/migration hygiene checks,
      build/typecheck, and `git diff --check`.
- [x] Active runtime cleanup: delete old AI-executable low-level Steel tools
      from registry/schema/executor where the MVP docs already demoted them to
      backend-internal capabilities. Keep repository/internal helpers available
      for backend validation and calculators.
- [x] Add RED tests proving the executable tool registry only exposes
      `lookup_instructions`, `search_customers`, `search_price_candidates`,
      `lookup_defaults`, and `lookup_formula`, and that legacy tool names return
      `unknown_tool` without SQL.
- [x] Remove legacy tool schemas and executor branches for direct spec/weight/
      cutting/hole/processing/material-rule/formula-version/order/source-chunk
      lookup and exact-customer alias lookup.
- [x] Verify the tool-surface cleanup with focused RED/GREEN Jest, full Steel
      Jest, Prettier, stale-tool greps, build/typecheck, and `git diff --check`.
- [x] Active web-test slice: connect the five AI-callable Steel business tools
      to `/steel/oauth-chat` provider execution so the UI can test AI-led
      material/spec inference, reviewed lookup, bounded options, and workbook
      preview output.
- [x] Add RED provider/handler tests proving `/steel/oauth-chat` can execute a
      Steel business tool call and continue to the final assistant response
      while keeping `patch_workbook` as the validated workbook output tool.
- [x] Implement the provider tool-call loop and tool schema conversion using
      the existing Steel tool registry/executor.
- [x] Verify the web-test slice with focused Jest, full Steel Jest, build/type
      checks, and a browser smoke run at `/steel/oauth-chat`.
- [x] Active runtime correction: quick material-price prompts such as
      `亞L30x30 一支多少` must not stop at clarification when bounded
      AI-derived candidate price queries can be formed. AI should search
      reviewed price rows first, lead with the highest-confidence positive
      source-backed approximate candidate as a provisional quote, list other
      plausible options, and keep the customer-facing total unconfirmed until
      user confirmation.
- [x] Update Agent Instruction, Phase 4 tool contract, and provider prompt
      regression so missing length/thickness/customer/tier does not block
      reviewed lookup when bounded candidate queries exist.
- [x] Verify the quick-price correction with RED/GREEN provider Jest, full Steel
      Jest, build/type checks, and `/steel/oauth-chat` smoke.
- [x] Create implementation plan
      `docs/plans/2026-06-03-steel-next-tasks.md` for the four approved next
      tasks.
- [x] Active runtime slice: make quick-price provisional estimates write a
      workbook preview row through `patch_workbook`, including provisional
      source/confidence notes while leaving confirmed totals blank.
- [x] Active verification slice: run Phase 2/4B baseline checks across
      repository/tool/rule-proposal tests, schema/migration grep, builds, and
      diff hygiene; record pass/fail gaps.
- [x] Active C 型鋼 vertical slice: prove one order context retrieves C 型鋼
      instruction packets, quote defaults, and formula candidates, and applies
      free/no-charge cutting and hole defaults without confirming material price
      from missing/zero rows.
- [x] Active source-schema slice: implement tested Chinese reference label to
      backend canonical-key mapping under `packages/api/src/steel/schema`.
- [x] Run baseline verification for the already-landed Phase 2/4B slices:
      repository/tool/rule-proposal tests, schema grep, builds, and diff hygiene.
- [x] Produce a checkpoint gap matrix for
      `tasks/steel-data-rules-architecture/checkpoints.md` A-E so the next
      implementation starts from proven gaps, not assumptions.
- [x] Implement source-schema mapping as code in
      `packages/api/src/steel/schema/mapping.ts` with prompt-serializer tests.
- [x] Connect the provider-neutral Steel business tool executor to
      `/steel/oauth-chat` and `openai_oauth_responses`, keeping `patch_workbook`
      as a validated workbook-output tool.
- [x] C-type quote vertical slice is already completed and manually smoke-tested:
      AI retrieves reviewed customer/price/rule/formula facts, preserves
      ambiguity, and avoids confirmed totals for missing or zero material
      prices.
- [ ] Active Phase 2 remaining slice: expose AI-facing rule prompts through the
      existing business tools. `lookup_catalog_families` returns admin-supplied
      product/category inference rules, `lookup_quote_rules` returns merged
      instruction/default packets, and `search_customers` returns
      customer-specific rules with customer/tier candidates.
- [ ] Active subtotal validation slice: do not implement backend deterministic
      quote calculation primitives. Backend should provide reviewed rule/source
      context and verify workbook summary totals against line `subtotal` sums.
- [ ] Persist accepted quote results into the workbook with source refs,
      confidence, manual-review reasons, latest-only workbook/calculation state,
      and concise audit notes.
- [ ] Superseded by `Steel AI Subtotal Validation Boundary Rebaseline`: do not add
      `quote_calculation_state` or `quote_calculation_item_audits` as backend
      canonical-calculation tables. If audit storage is needed, keep it focused
      on current workbook state, reviewed source context, and prompt
      traceability.
- [ ] Superseded as a runtime tool: do not expose `lookup_defaults` separately.
      Its behavior is merged into `lookup_quote_rules`, which returns typed,
      bounded quote-default candidates with origin refs and explicit user
      disclosure for applied customer defaults. Keep LibreChat user-memory
      adapter as a later separate layer.
- [ ] Implement non-UI Admin rule review backend: list queues, approve, reject,
      keep-one-time, request-info, publish reviewed defaults, and exclude pending
      proposals from quote lookup until approved.
- [ ] Implement non-UI Admin data maintenance backend/import services for ERP
      XLSX-backed product price, cutting price, formulas, and rules. Keep
      handbook DOCX real-data import deferred unless a later task opens it.
- [ ] Record Phase 2 manual/eval evidence for the still-relevant scenarios:
      H-type surcharge/head-tail, product-price unit weight conflict,
      missing/zero material price, no-cut, non-round holes, slotting,
      approximate quote, multi-material audit, and workbook latest-version
      behavior. C-type and `/steel/oauth-chat` manual smokes are already done.
- [ ] After the queue is approved, move the active slice into a detailed
      `docs/plans/YYYY-MM-DD-...md` implementation plan before code changes.

## Review - Steel v8.3 AI-Led Phase 2 Rebaseline 2026-06-08

- Rebased Phase 2 docs away from backend normalization/resolver/ranking/stock
  allocation/calculation-context slices. The active implementation boundary is
  now AI-led judgement/calculation with reviewed rule/tool outputs and workbook
  subtotal validation.
- Runtime lookup surface is `lookup_catalog_families`, `lookup_quote_rules`,
  `search_customers`, `search_price_candidates`, and `lookup_formula`.
  `lookup_instructions` / `lookup_defaults` remain only as internal composition
  names under `lookup_quote_rules`.
- Updated v8.3 checkpoints, README, phase 0/2/3/5/6 docs, source-schema mapping,
  main v8.3 plan, `CONTEXT.md`, and `tasks/lessons.md` so the next slice starts
  from catalog-family rules, customer-specific rules, AI candidate selection,
  rule prompts, `patch_quote_workbook`, and subtotal consistency.
- Verification: `rg` over `CONTEXT.md`, `tasks/v8.3`, and the main v8.3 spec
  shows old runtime tool names only in explicit internal-composition text; old
  backend calculator section names are gone from active quote docs. `git diff
--check` passed. Prettier was not run per user preference.

## Review - Steel Next Tasks 2026-06-03

- Provisional workbook patch: `sendSteelOAuthChat` now requires positive quick
  price lookups with workbook context to patch provisional `quote_details`,
  `price_sources`, and `interpretation_notes`, then continue one more model turn
  for a Traditional Chinese user-facing quote/options/confirmation answer.
- C 型鋼 vertical lookup: added one runtime spec covering
  `lookup_instructions` -> `search_price_candidates` -> `lookup_defaults` ->
  `lookup_formula` in one order context. The test preserves unknown material
  price as `null` while accepting only cutting/hole as `true_zero_rule`.
- Source-schema mapping: added `packages/api/src/steel/schema/mapping.ts` and
  prompt-context tests for `產品價格.xlsx`, `系統訂單.xlsx`, `公式編號.xlsx`,
  `切工價錢.xlsx`, and `客戶資料.xlsx` Chinese headers to backend canonical keys.
- Phase 2/4B baseline evidence: focused repository/tool/rule-proposal suites
  passed, full `packages/api` Steel Jest passed, schema/migration greps found
  `source_refs`, `product_price_unit_weight`, `value_state`, `review_state`,
  `formula_versions`, `calculation_rule_defaults`, and `quote_defaults`; stale
  tool greps only found docs/test banned-name references, not executable tool
  exposure.
- Checkpoint gap matrix: A/B/D have documented/schema/runtime evidence for the
  current MVP surface; D2 has needs-review proposal/backend tests but Admin
  approve/reject/publish remains deferred; C/E still need deterministic
  calculation primitives, calculation audit persistence, full C/H/cutting/hole/
  slotting manual scenario coverage, and multi-material audit aggregation.
- Verification: `npx jest src/steel --runInBand` passed 27 suites / 112 tests;
  `npm run build:api` passed with only the existing Redis/Keyv warning;
  `git diff --check` passed; `/steel/oauth-chat` smoke for
  `亞L30x30 一支多少` returned `NT$194.3 / 支` provisional quote, alternatives,
  confirmation prompts, and workbook cells including
  `quote_details.material_unit_price=194.3`.

## Review - Steel Quick Price Correction

- Root cause: real model calls included size-only `specKey` values such as
  `30x30`, which the repository treated as exact `spec_key = '30x30'` and
  filtered out reviewed rows such as `angle_L30x30x2.5x6M`.
- Added provider guardrails so material price prompts require Steel tool calls
  until `search_price_candidates` has executed; premature clarification text is
  retried with an internal reminder and then rejected if lookup never occurs.
- Added normalization/tool guards so AI-derived size-only `specKey` values are
  downgraded to partial spec lookup, and derived candidate searches keep
  bounded tier options instead of over-filtering arbitrary tier IDs.
- Seeded reviewed angle candidates from `docs/reference/產品價格.xlsx` so
  `亞L30x30 一支多少` can return source-backed approximate options.
- Verification: focused RED/GREEN specs, full `packages/api/src/steel` Jest,
  `npm run build:api`, direct real provider wrapper, and `/steel/oauth-chat`
  smoke all pass. UI smoke returned `錏成型角鐵 L30x30x2.5t x 6M` with
  `售價A 194.3`, `售價B 201`, `售價C 190.95`, `售價F 180.9`, plus
  熱浸鍍鋅/黑角鐵 alternatives for user confirmation.

## Review

- User correction captured: the paused item is Admin review UI only. Backend
  review APIs, approval/publish data flows, quote defaults retrieval, quote
  runtime, calculation, audit, and workbook persistence remain in the
  implementation queue.
- Current implementation starts with reviewed fact price decisions: when lookup
  finds missing or ambiguous price facts, the tool result must include bounded
  options the user can choose from or use to provide a quote-specific price.
- User correction: when the exact reviewed price is missing but there is one
  nearest reviewed positive candidate, the AI may use that candidate for a
  preview, but the response must explain the assumption and ask the user to
  confirm or provide the exact price.
- Implemented the reviewed-facts price decision slice in
  `packages/api/src/steel/pricing/decision.ts`: missing or zero-as-missing
  facts now return unavailable options with `unitPrice: null`, while a single
  nearest reviewed estimate is selected for preview with
  `confirmationRequired: true`.
- Superseding correction: `packages/api/src/steel/pricing/decision.ts` is no
  longer part of the current runtime architecture because numeric quote
  decisions/calculation belong to the AI-owned OAuth/Codex calculation lane.
- Added the 全華興 / 亞L30x30 multi-candidate guard: incomplete angle quote
  requests now preserve all bounded approximate options with source refs, so AI
  can list product/spec/tier price/source choices for the user instead of
  showing only the highest approximate match.
- User correction: the issue is not just a missing `亞` to `錏` alias. The
  lookup order must be AI-proposed material/spec candidates first, reviewed
  table lookup second; raw typo strings are not canonical price keys.
- Added derived `candidateQueries` support for `search_price_candidates`.
  Raw-only terms such as `亞L30x30` are filtered or rejected; derived terms such
  as `錏成型角鐵` + `30x30` can search reviewed rows and return multiple
  thickness/price options. Superseding correction: query generation is AI
  reasoning, not a runtime tool.
- User correction: AI should decide which reviewed-data lookup tool to use
  after normalization. The backend owns table-specific schemas, validation, raw
  typo guards, source refs, and deterministic ranking; it should not silently
  choose the domain lookup path for the AI.
- User correction: the `亞L30x30 一支多少` sample is a full runtime chain, not
  only a lookup contract. AI detects typo/incomplete spec, proposes approximate
  material/spec candidates, calls reviewed-data tools, continues lookup/ranking,
  writes a provisional workbook update, and explains assumptions/options for
  user confirmation.
- Documentation update: promoted AI-led tool orchestration to the core framework
  in `CONTEXT.md`, `tasks/steel-data-rules-architecture/README.md`,
  `checkpoints.md`, Phase 4 tool-calling, Phase 6 verification, and v8.3 Phase
  2 data tools. Future implementation should not start from backend-fixed
  product/weight/cutting/rule routing.
- Implemented the first runtime enforcement slice: `/steel/oauth-chat` now
  passes `steelRuntimePolicy: true`, and the OpenAI OAuth provider adds a system
  instruction that AI owns Steel tool orchestration, must derive candidate
  material/spec queries before searching reviewed price rows, must not treat raw
  typo text such as `亞L30x30` as a confirmed price key, and must present
  bounded options/confirmation for missing, zero, ambiguous, or approximate
  reviewed facts.
- User correction: not every reasoning step needs a tool. Runtime should expose
  reviewed-row lookup tools and workbook/calculation validation tools, not AI
  helper tools. Removed `normalize_quote_item`, `generate_price_search_terms`,
  and `rank_price_candidates` from the executable tool registry; renamed the
  reviewed default concept to `lookup_defaults` / `steel.quote_defaults` /
  `quote_default`.
- User correction: the Allowed MVP tool list is still too broad. For the MVP
  quote flow, AI should derive material category, surface, dimensions, and
  price query candidates itself, then call only reviewed lookup tools:
  `lookup_instructions`, `search_price_candidates`, `lookup_defaults`,
  `search_customers`, and `lookup_formula`. Exact lookup aliases,
  formula-version naming, weight/cutting/processing/material-rule lookups,
  ranking helpers, arbitrary source-chunk search, calculation primitives, and
  workbook read tools should not appear as exposed MVP tools unless a later
  implementation slice proves they are needed.
- User correction: the AI inference process itself needs instruction design.
  `docs/reference/instruction.txt` should seed reviewed, task-scoped
  Instruction Packets for candidate generation and quote interpretation.
  Added `lookup_instructions` to the Allowed MVP runtime tools because AI needs
  a bounded query path for those rules before generating material/spec/price
  candidates. Did not add `search_source_chunks` or a separate alias lookup to
  MVP: instruction retrieval covers interpretation policy, while
  `search_price_candidates` validates derived candidates against reviewed price
  rows.
- User correction: call the pre-tool default rules `Agent Instruction`, not the
  old longer name. Agent Instruction is also Admin-managed and
  injected into every Steel quote turn. It is not a code-fixed provider prompt;
  runtime should use the reviewed active Agent Instruction and record its
  version/source. Planned database surfaces are `steel.agent_instructions` for
  the default injected instruction and `steel.instruction_packets` for
  task-scoped retrieved packets.
- User expectation: Agent Instruction should cover OCR/file interpretation,
  tool routing, workbook behavior, and order inference. Updated the docs to
  model `steel.agent_instructions` with structured sections: `fileOcrRules`,
  `toolRules`, `orderInferenceRules`, `workbookRules`, and `responseRules`.
- Workbook clarification: current `/steel/oauth-chat` can update workbooks via
  the provider-facing `patch_workbook` output tool when workbook context is
  present. AI proposes typed workbook operations; backend workbook schemas and
  services validate/apply them. This remains separate from the MVP reviewed
  lookup tools.
- Updated the related docs to the reduced Allowed MVP runtime tool contract:
  `CONTEXT.md`, v8.3 primary spec, v8.3 Phase 2 data tools, Steel data-rules
  README, checkpoints, Phase 0 decisions, Phase 3 material rules, Phase 4
  tool-calling, Phase 4A quote defaults, and AI rule-selection scenarios.
- Verification passed for this docs cleanup slice: touched-doc Prettier check,
  `git diff --check`, and stale white-list grep confirmed no old broad
  allowed-tool heading or old one-tool-per-line bullets such as
  `lookup_customer`, `lookup_spec_price`, `lookup_weight_spec`,
  `lookup_formula_version`, `lookup_material_rules`, `select_calculation_rule`,
  `lookup_cutting_price`, `lookup_processing_price`, or `get_workbook` remain
  as active allowed-tool entries.
- Verification passed for the instruction-query addition: touched-doc Prettier
  check, stale white-list grep, `lookup_instructions` required-term grep across
  core docs, and `git diff --check` passed. `lookup_instructions` is now the
  only added query tool for AI inference; `search_source_chunks` remains
  explicitly excluded from the MVP inference path.
- Verification passed for Agent Instruction rename/management correction:
  touched-doc Prettier check, stale old-name grep, Agent Instruction/DB-surface
  required-term grep, and `git diff --check` passed.
- Verification passed for Agent Instruction content/workbook clarification:
  touched-doc Prettier check, required-term grep for `fileOcrRules`,
  `toolRules`, `orderInferenceRules`, `workbookRules`, `responseRules`,
  `patch_workbook`, `Workbook Output Tool`, `steel.agent_instructions`, and
  `steel.instruction_packets`, stale old-name grep, and `git diff --check`
  passed.
- Split the earlier combined Agent Instruction / Instruction Packet baseline
  into two documents:
  `tasks/steel-data-rules-architecture/agent-instructions.md` owns only the
  first `steel.agent_instructions` prompt seed, while
  `tasks/steel-data-rules-architecture/instruction-packets.md` owns only
  `steel.instruction_packets` selectors, storage shape, `lookup_instructions`
  request/response behavior, Admin lifecycle, conflict policy, and seed packet
  text.
- The prompt-injected body text for future DB-backed
  `steel.agent_instructions` and `steel.instruction_packets` is now documented
  as Traditional Chinese. Canonical API/schema/tool keys such as
  `fileOcrRules`, `toolRules`, `taskTypes`, and `requiredLookups` can remain
  English.
- The Instruction Packet seed examples now live in `instruction-packets.md` with
  Traditional Chinese bodies and blocking rules:
  `angle-surface-oral-zh-v1`, `c-type-basic-quote-zh-v1`, and
  `workbook-provisional-confirmed-zh-v1`.
- Removed the earlier combined baseline and updated references in `CONTEXT.md`,
  v8.3 primary spec, v8.3 Phase 2, v8.3 Phase 5, Steel data-rules README, and
  Phase 4 tool-calling to point at the separate `agent-instructions.md` and
  `instruction-packets.md` docs.
- Verification passed for the split-doc correction: touched-doc Prettier check,
  stale combined-doc grep, required separate-doc / Traditional Chinese
  injection-term grep, and `git diff --check`.
- Inspected `docs/reference/instruction.txt`, `docs/reference/H型鋼.txt`,
  `docs/reference/切工價錢.xlsx`, and `docs/reference/公式編號.xlsx`. For xlsx
  sources, extracted workbook sheet/table contents using the bundled Python
  runtime after the artifact-tool native dependency was blocked by macOS code
  signing.
- Expanded `tasks/steel-data-rules-architecture/instruction-packets.md` with
  reference-derived Traditional Chinese seed packets:
  `price-source-priority-zh-v1`,
  `oral-material-candidate-generation-zh-v1`,
  `formula-code-selection-zh-v1`, `h-type-length-surcharge-zh-v1`,
  `h-and-i-beam-cutting-price-zh-v1`, `black-steel-cutting-price-zh-v1`,
  `cut-count-and-trim-detection-zh-v1`,
  `drawing-processing-detection-zh-v1`, and
  `workbook-output-columns-zh-v1`.
- The new packets classify detailed rules by runtime task/material/process:
  price-source priority and missing-price handling, oral material candidate
  generation, formula code selection from `公式編號.xlsx`, H-type regular/
  non-standard length surcharge from `H型鋼.txt`, H/i-beam cutting details,
  black steel pipe/angle/channel/flat cutting details, cut-count/head-tail
  trim behavior, drawing/OCR processing detection, and workbook output notes.
- Verification passed for the reference-derived instruction packet docs slice:
  Prettier check for `instruction-packets.md` and `tasks/todo.md`, required
  packet-name grep, required source/detail grep for the four reference sources
  and selected H/cutting/formula markers, and `git diff --check`.
- User correction captured: `lookup_instructions` is a batched full-facet lookup
  per interpreted order context, not a per-detail query loop. The request should
  include all detected steel/material families, task types, processing types,
  formula candidates, customer/tier/project context, and low-confidence facets
  together, then returned packets are applied across the relevant lines.
- Updated Agent Instruction seed text, `instruction-packets.md`, Phase 4
  tool-calling, v8.3 Phase 2 data tools, Steel data-rules README, and lessons
  so hole count, cut count, slotting path, bending, formula, and individual line
  fragments do not become separate `lookup_instructions` tool calls.
- Verification passed for the batched full-facet `lookup_instructions`
  correction: touched-doc Prettier check, required-term grep for batched/
  full-facet/catalogContexts wording, stale request-shape grep confirming no
  `matchedSelectors` or old `limit: 5` example remains, and `git diff --check`.
- User correction captured: hole count follows table count first, with drawing
  hole positions used for cross-check. If table count and drawing positions
  differ, record both and mark manual review instead of silently overriding the
  table.
- Updated `drawing-processing-detection-zh-v1` with the Traditional Chinese
  【孔洞】 rule: round holes, long holes, bolt holes, punched holes, `4-Ø22` and
  `6-Ø26` count as holes; `4-Ø22` means four holes per piece; total holes equal
  per-piece/per-stock count times quantity; non-hole drawing marks must not be
  counted; explicit `產品價格.xlsx` punching/hole-processing items win; C-type
  holes follow the C-type special pricing rule.
- Synced Agent Instruction, Phase 3 material rules, and lessons so table counts
  are high-confidence primary evidence, drawing/vision is cross-check evidence,
  and conflicts become manual review.
- Verification passed for the hole-count table-priority correction: touched-doc
  Prettier check, required-term grep for table-priority/C-type/product-price
  hole wording, stale old-priority grep, and `git diff --check`.
- User correction captured: related steel Instruction Packets must be organized
  into material/task packet groups so one batched `lookup_instructions` call can
  return all relevant detailed rules for the detected context.
- Updated `instruction-packets.md` with `packetGroup`, `groupRole`,
  `relatedPacketSlugs`, selector `packetGroups`, `packetGroupHints`, response
  `packetGroups`, and a seed group map covering `global-quote-core`,
  `angle-zinc-quote-core`, `c-type-quote-core`, `h-type-quote-core`,
  `black-long-material-cutting-core`, `plate-processing-core`, and
  `workbook-output-core`.
- Added packet group membership to each seed packet so price, formula, cutting,
  hole/drawing, workbook, and confirmation rules can be retrieved together
  instead of forcing separate instruction lookups.
- Synced Agent Instruction, Phase 4 tool-calling, v8.3 Phase 2 data tools,
  Steel data-rules README, and lessons to require group expansion for related
  steel rules.
- Verification passed for the Instruction Packet group/bundle correction:
  touched-doc Prettier check, required grep for packet groups, `packetGroupHints`
  and seeded group keys, fragmented-query guard grep, and `git diff --check`.
- Runtime implementation slice started from a C 型鋼 RED test:
  `lookup_instructions` initially returned `ok: false` because the executable
  runtime tool did not exist.
- Added seed-backed runtime support for `lookup_instructions` in the Steel tool
  registry/executor. The first implemented group is `c-type-quote-core`, which
  returns `c-type-basic-quote-zh-v1`, `price-source-priority-zh-v1`,
  `formula-code-selection-zh-v1`, and `drawing-processing-detection-zh-v1` in
  one batched call without SQL.
- The C 型鋼 runtime test verifies one request with `packetGroupHints:
["c-type-quote-core"]` returns the related price/formula/hole instruction
  packet group, includes C 型鋼專用孔費 wording, includes table-priority hole
  wording, and does not return unrelated H 型鋼 or angle packets.
- Verification passed for the C 型鋼 runtime test slice: the focused RED run
  failed because `lookup_instructions` was not yet executable; the GREEN run
  passed after adding the runtime catalog; `execute.spec.ts` and
  `registry.spec.ts` passed with 12 tests; touched-file Prettier check passed;
  `npm run build:api` exited 0 with only the existing non-Steel Redis type
  warning in `src/cache/cacheFactory.ts`; `git diff --check` passed.
- User correction captured: runtime Instruction Packet bodies must not contain
  Codex/backend implementation instructions. C 型鋼切工與孔費免費是業務預設，
  可透過 quote default 列為 true-zero/no-charge；此預設不代表材料單價、
  特殊加工或非 C 型鋼加工免費。
- Added one-call multi-material `lookup_instructions` runtime coverage for an
  order containing `亞L30x30` and C 型鋼. The test proves one tool call returns
  both `angle-zinc-quote-core` and `c-type-quote-core`, including angle oral/
  surface rules and C 型鋼 price/formula/hole rules, without returning unrelated
  H 型鋼 packets.
- Added batch-capable `lookup_formula` and `lookup_defaults` executable tool
  contracts. `lookup_formula` accepts multiple material contexts and retrieves
  formula rows for all supplied formula candidates in one tool call;
  `lookup_defaults` accepts multiple material contexts and returns the matching
  C 型鋼 quote default without SQL while DB-backed defaults remain a later slice.
- Verification passed for the multi-material instruction/default/formula slice:
  RED focused tests failed for implementation wording, missing angle group, and
  missing `lookup_formula` / `lookup_defaults`; GREEN focused tests passed;
  `execute.spec.ts` and `registry.spec.ts` passed with 15 tests; touched-file
  Prettier check passed; runtime-facing stale wording grep returned no matches;
  `npm run build:api` exited 0 with only the existing non-Steel Redis type
  warning in `src/cache/cacheFactory.ts`; `git diff --check` passed.
- User correction captured: C 型鋼的預設邏輯是切工/孔費免費，不是每次都要求使用者
  重新確認 true-zero。Runtime packet、Instruction Packet docs、lessons and
  checkpoints now model this as a quote-default true-zero/no-charge behavior
  while preserving product/material price zero-as-missing.
- Added repository-backed `lookup_defaults`: `searchSteelQuoteDefaults` reads
  reviewed active rows from `steel.quote_defaults` using one batched material/
  charge/formula query, and tool output maps returned defaults back to matching
  order line refs.
- Added idempotent data migration
  `supabase/migration/20260603091515_seed_c_type_quote_defaults.sql` to seed the
  reviewed C 型鋼 cutting/hole no-charge quote default. No table schema change was
  needed because `steel.quote_defaults` already existed.
- Verification passed for the DB-backed `lookup_defaults` slice: RED tests
  failed first because the repository did not exist and the executor did not run
  SQL; GREEN focused tests passed; `npx jest src/steel --runInBand` passed with
  101 tests; touched-file Prettier check passed; stale runtime wording grep
  returned no non-test matches; migration file content checks passed;
  `git diff --check` passed; `npm run build:api` exited 0 with only the existing
  non-Steel Redis type warning in `src/cache/cacheFactory.ts`.
- `npx supabase migration list --local` could not run because this checkout has
  no local Supabase Postgres listening on `127.0.0.1:54322`; this matches the
  project cloud-only Supabase setup, so local migration-list verification was
  replaced by file/content checks.
- User correction captured: C 型鋼 runtime packet body should state the rule
  directly and not say `依【C 型鋼專用計價規則】處理`, because the packet content
  itself is the C 型鋼專用規則. Runtime and docs now say C 型鋼切工/孔費預設免費
  directly.
- Deleted old AI-executable low-level Steel tools from schema, registry, and
  executor branches. The executable runtime surface is now only
  `lookup_instructions`, `search_customers`, `search_price_candidates`,
  `lookup_defaults`, and `lookup_formula`; direct customer/spec/weight/cutting/
  hole/processing/material-rule/formula-version/order/source-chunk lookups are
  backend-internal capabilities.
- Provider runtime policy now lists the same five AI-callable Steel tools plus
  workbook patch output, and tells AI to rely on backend internal validation for
  unit-weight, cutting, processing, material-rule, and formula-version details.
- Verification passed for the tool-surface cleanup: RED registry/executor tests
  failed while legacy tools were still callable; GREEN focused tests passed;
  `npx jest src/steel --runInBand` passed with 99 tests; Prettier write/check
  passed; stale executable-tool grep returned no non-test source matches; C 型鋼
  self-reference grep has no runtime/docs matches except the lesson's banned
  example.
- Connected `/steel/oauth-chat` provider execution to the AI-callable Steel
  business tool surface. The provider now exposes the five registry tools as AI
  SDK function tools, executes Steel business tool calls through the existing
  tool executor, feeds results back as `role: tool` messages, aggregates
  multi-round usage/warnings, and keeps `patch_workbook` as a validated workbook
  output proposal.
- Added RED/GREEN provider coverage for the runtime loop: the RED test first
  proved only one provider generation happened; the GREEN test proves
  `lookup_instructions` is executed, its JSON result is returned to the model,
  and the final assistant answer/usage comes from the follow-up generation. A
  second regression test proves backend tool execution failures are returned to
  the model as `repository_error` tool results instead of being mislabeled as
  JSON argument errors.
- Browser smoke passed on `http://localhost:3090/steel/oauth-chat` with backend
  `http://localhost:3080`: login succeeded, workbook v1 initialized, and the
  prompt `亞L30x30 一支多少` returned AI-derived candidates (`錏角鐵 30x30`,
  `錏成型角鐵 30x30`, `鍍鋅角鐵 30x30`, `角鐵 30x30`, `L30x30`) before reporting
  no reviewed price match and asking the user to confirm surface, thickness, and
  length. No confirmed workbook total was written.
- Verification passed for the web-test slice: focused provider Jest passed;
- User correction captured: for `亞L30x30 一支多少`, AI should not stop before
  lookup just because length, thickness, customer, or tier is missing. If
  reviewed lookup finds positive source-backed approximate candidates, the
  response should lead with the highest-confidence provisional quote and then
  list other plausible specs/options for confirmation.
- Live smoke gap found: `steel.price_items` had no reviewed product-price rows,
  so `/steel/oauth-chat` could not produce a source-backed provisional quote.
  Added a minimal reviewed seed from `docs/reference/產品價格.xlsx` for
  `錏成型角鐵30*2.5*6M`, `熱浸鍍鋅角鐵30*3.0`, and comparable black angle 30
  candidates.
- Tool lookup correction: AI may pass oral candidates such as `錏角鐵`; backend
  price search now uses bounded token matching for those AI-derived candidates
  while still rejecting raw typo strings such as `亞L30x30`.
  `npx jest src/steel/ai/provider.spec.ts --runInBand` passed with 7 tests;
  `npx jest src/steel --runInBand` passed with 101 tests; `npm run build:api`
  exited `0` with the existing Redis type warning plus non-blocking
  `zod-to-json-schema` circular dependency warnings; touched-file Prettier
  passed after formatting; `git diff --check` passed.
- Updated core docs to point at the new baseline:
  `CONTEXT.md`, v8.3 primary spec, v8.3 Phase 2 data tools, v8.3 Phase 5 Admin
  source management, Steel data-rules README, and Phase 4 tool-calling. The new
  doc is explicitly docs/design only; implementation that adds Steel PostgreSQL
  schema must still update both `supabase/schema.sql` and a new migration.
- Verification passed for this Agent Instruction / Instruction Packet docs
  slice: touched-doc Prettier check, stale bootstrap-name grep, required-term
  grep for Agent Instruction/Instruction Packet/workbook output terms and seed
  packet names, and `git diff --check`.
- Verification passed for this tool-boundary/schema-rename slice: focused Steel
  Jest suite covering normalization search, price repositories, executable tool
  registry/executor, pricing decisions, provider policy, and chat handler
  behavior passed with 51 tests; old-name schema/tool grep returned no active
  `lesson_memory_entries`, `retrieve_lesson_memory`, `retrieve_user_memory`,
  `ai_selected_lesson`, `entry_type`, or `supersedes_entry_id` matches;
  Prettier, `git diff --check`, and `npm run build:api` also passed. The API
  build still emits the existing non-Steel Redis type warning in
  `src/cache/cacheFactory.ts`, but exits `0`.
- Verification passed: focused normalization/pricing/repository/tool Jest with
  38 tests, Prettier, `git diff --check`, and `npm run build:api`. The API
  build still emits the existing non-Steel Redis type warning in
  `src/cache/cacheFactory.ts`, but exits `0`.

# Steel Historical Audit Storage And High-Confidence Preview Correction

- [x] Historical: moved raw calculation-tool output out of visible workbook notes.
      Superseded: hidden provider code/tool disclosure is not a required backend
      acceptance contract.
- [x] Historical: modeled dedicated calculation audit storage for multi-item
      orders. Superseded: do not add required backend canonical-calculation
      tables.
- [x] Correct workbook/calculation storage policy so database keeps only latest state; `version` is an update counter, not historical retention.
- [x] Clarify workbook preview may show concise source/calculation summaries in
      `價格來源` or `判讀備註`, while raw hidden-tool output stays out of visible
      workbook cells.
- [x] Reframe 全華興 / 亞L30x30 as a high-confidence best-effort preview from typo/incomplete specs, not a blocker scenario.
- [x] Sync lessons and checkpoints for future implementation agents.
- [x] Verify Markdown formatting and diff hygiene.

## Review

- Historical correction: raw calculation-tool output and verbose execution
  artifacts do not belong in visible workbook cells, while `價格來源` and
  `判讀備註` may still show concise human-readable source/calculation summaries.
- Historical schema planning for dedicated current calculation audit storage was
  superseded by the later no-required-calculation-table decision.
- Superseding correction: do not add `quote_calculation_state` or
  `quote_calculation_item_audits`; keep any future storage focused on current
  workbook state, reviewed source context, and prompt traceability.
- Corrected workbook persistence policy: `version` is only a visible update counter/freshness marker, and accepted updates overwrite old workbook/calculation data instead of retaining historical database versions.
- Updated the 全華興 / 亞L30x30 scenario so typo/incomplete specs can still produce a highest-confidence source-backed preview; overall confidence may remain `中` until the user supplies thickness or material variant.
- Added a multi-item scenario proving one order can contain separate C-type and angle lines, each with its own current calculation plan, audit row, confidence, and workbook patch target.
- Verification passed: Markdown Prettier, required-term grep, and `git diff --check`.

# Steel AI Python Audit And Estimate Scenario Docs Sync

- [x] Historical: clarified that AI/backend numeric mismatch did not block
      workbook preview patching when backend calculation succeeded. Superseded:
      AI on the OAuth/Codex path is now the calculation lane and backend must not keep a
      parallel canonical calculator.
- [x] Historical: documented backend-confirmed numbers as highest confidence.
      Superseded: confirmed totals now require workbook summary/subtotal
      consistency instead of backend canonical calculation.
- [x] Add the 全華興 / 亞L30x30 approximate quote scenario with customer tier lookup, nearest product-price candidate, medium confidence, and low-confidence reasons.
- [x] Sync lessons so future agents do not reject preview patches solely because AI Python differs from backend calculation.
- [x] Verify Markdown formatting and diff hygiene.

## Review

- Historical note: this section is superseded by the current subtotal validation
  boundary. Backend-confirmed calculator values are no longer the numeric source;
  confirmed totals are accepted only with workbook summary/subtotal consistency.
- Added a concrete 全華興 / 亞L30x30 approximate quote scenario: customer tier `A級`, highest-confidence reviewed product-price candidate `錏成型角鐵 30x30x2.5x6M`, A-tier price `194.3 元/支`, quantity about 100, medium overall confidence, and low-confidence reason for missing thickness.
- Updated project lessons so future agents keep approximate estimates and backend-wins mismatch behavior.
- Verification passed: Markdown Prettier, required-term grep, and `git diff --check`.

# Steel AI Rule And Formula Orchestration Docs Sync

- [x] Clarify that formula/rule selection starts from AI-normalized material/spec context and reviewed formula/rule data.
- [x] Clarify that AI decides which backend tools to call, while backend validates selected formula/rule/source and calculates deterministically.
- [x] Document that C-type cutting/hole true zero comes from selected rule or quote-specific override, not backend product-family hardcoding.
- [x] Add concrete simulated AI logic scenarios for C-type, ambiguity, missing price, custom override, and H-type surcharge.
- [x] Sync user-corrected behavior for nearest material-price candidates, H-type head/tail clarification, and applied customer-default disclosure.
- [x] Sync user-corrected behavior that C-type free cutting/hole must be preconfigured as a default rule/lesson and that all cuttable materials ask head/tail when cutting is needed.
- [x] Verify Markdown formatting, required-term grep, and diff hygiene.

## Review

- Updated the Steel data-rules architecture package and v8.3 Phase 2 roadmap to make the AI/backend boundary explicit.
- Added `tasks/steel-data-rules-architecture/ai-rule-selection-scenarios.md` as a durable scenario reference for the next C-type quote vertical slice.
- Updated scenarios from user correction: C-type default true-zero comes from global/site-managed quote defaults retrieval, zero material price asks with nearest candidates, H-type cutting asks head/tail before cut-count, and approved customer H-type defaults must be disclosed when applied.
- Updated cutting behavior: no-cut still records `0` cutting in workbook; cuttable materials with cutting needed ask head/tail; remainder-tail omission is explained in chat and workbook notes.
- No Supabase migration was needed because this is a documentation/architecture sync only.

# Steel OAuth Chat Workbook Context Retrieval

- [x] Keep this scoped to `/steel/oauth-chat`; do not move workbook patching into formal Steel Workspace or official chat.
- [x] Read the current workbook before provider calls when workbook id/version context is present.
- [x] Send bounded workbook structure context to the OpenAI OAuth provider so AI resolves visible labels to internal ids/keys.
- [x] Add regression coverage for `總結` / `總額` mapping to `summary.summary_total_amount.value`.
- [x] Verify focused provider/API/client tests, direct API build, live OAuth smoke, service restart, and diff hygiene.

## Review

- User correction: the user should not provide workbook internal ids or keys. AI must obtain the workbook structure/context and decide the typed `patch_workbook` operation itself.
- Root cause hypothesis: the previous tool-calling slice enabled typed patch operations, but the provider prompt did not include the current workbook's visible labels, rows, columns, and id/key mapping.
- Added backend workbook context retrieval before provider calls when `workbookId` and `workbookVersion` are present.
- Added bounded workbook context serialization with sheet labels, column labels/keys, row ids, and cell values so phrases such as `總結的總額` can resolve to `summary.summary_total_amount.value`.
- Added provider prompt guidance telling AI not to ask users for internal workbook ids or keys when the target can be resolved from context.
- Regression tests now prove the provider receives workbook context and the handler applies the `總結` / `總額` patch target through the workbook service.
- Real OAuth provider smoke passed: `總結的總額更新為100` returned `summary` / `summary_total_amount` / `value` / `100` as a typed `patch_workbook` operation.
- Verification passed: focused provider/handler Jest, client SteelOAuthChat Jest, direct `packages/api` build, real OAuth smoke, `git diff --check`, and restarted local dev services with `3080/api/config` plus `3090/steel/oauth-chat` returning `200`.
- Direct `packages/api` build still reports the existing non-Steel Redis type warning in `src/cache/cacheFactory.ts`, but exits `0`.

# Steel OAuth Chat AI Workbook Patch Tooling

- [x] Keep the slice scoped to `/steel/oauth-chat`; do not move behavior into formal Steel Workspace or official chat.
- [x] Remove the manual-command direction; natural-language workbook updates must be decided by AI/tool calling.
- [x] Provide a typed `patch_workbook` tool to the OpenAI OAuth provider when workbook context is present.
- [x] Extract AI tool calls into workbook patch operations and apply them through the existing workbook service.
- [x] Verify focused provider/API/client behavior, builds/formatting, and diff hygiene.
- [x] Provide corrected manual browser test steps for natural-language workbook updates.

## Review

- User correction: this should not be implemented as hidden dev command parsing. `/steel/oauth-chat` should let AI decide whether to execute a workbook patch through tool calling, then backend validation applies the typed operations.
- Removed the manual-command path from the handler; natural-language messages now still go through the OpenAI OAuth provider.
- Added a `patch_workbook` function tool to the provider adapter when workbook context is present.
- Added provider extraction of `tool-call` content into typed `workbookPatch.operations`.
- Handler passes `workbookPatchTool: true` only when the request includes `workbookId` and `workbookVersion`, then applies AI-emitted operations through `workbookService.patch`.
- The corrected manual browser test input is natural language: `set quote_details line_1 material_unit_price 115`.
- Verification passed: packages/api provider/handler Jest, client SteelOAuthChat Jest, direct `packages/api` build, Prettier, and `git diff --check`.
- Direct `packages/api` build still reports the existing non-Steel Redis type warning in `src/cache/cacheFactory.ts`, but no new Steel warning remains.
- Manual-command grep passed with no code/task hits for `manualWorkbook`, `Manual workbook`, `/workbook set`, or `workbook test command`.
- Local manual-test services are reachable after backend restart: backend `http://localhost:3080/api/config` returned `200`, and frontend `http://localhost:3090/steel/oauth-chat` returned `200`.
- User-reported provider failure was reproduced in Node runtime: plain OAuth text passed, but `workbookPatchTool=true` failed with `Invalid schema for function 'patch_workbook'` because `op` used `const` without a `type`.
- Fixed `patch_workbook` schema by adding explicit `type` keys and making strict-tool fields required; added a regression assertion for the `op` schema.
- Real OAuth tool smoke passed after the fix: `set quote_details line_1 material_unit_price 115` returned a typed `workbookPatch.operations` payload instead of provider failure.
- Added a handler fallback summary so a pure tool-call response still returns visible assistant text after the workbook patch is applied.
- Restarted backend dev after the fix; backend `http://localhost:3080/api/config` returned `200`, and frontend `http://localhost:3090/steel/oauth-chat` returned `200`.

# Steel OAuth Chat Workbook Patch Backend

- [x] Keep the slice scoped to `/steel/oauth-chat`; do not move workbook behavior into formal Steel Workspace or official chat.
- [x] Extend the Steel chat schema so AI/provider output can propose operations-only workbook patches.
- [x] Add a failing handler test proving `/steel/oauth-chat` applies provider patch operations through the workbook service.
- [x] Implement backend patch application so the response returns the persisted workbook patch result, not raw provider operations.
- [x] Verify focused data-provider/API tests, builds/formatting, and diff hygiene.

## Review

- Added `steelProviderWorkbookPatchProposalSchema` for provider/tool output that proposes operations-only workbook patches.
- Added the red/green handler test proving `/steel/oauth-chat` merges request workbook context with provider patch operations, calls `workbookService.patch`, and returns the persisted workbook patch result.
- Updated the Steel chat handler so raw provider operations are never returned directly to the browser; successful patches return the workbook service result, known workbook conflicts/validation errors return `rejectedReason`, and malformed provider patch output returns `structured_output_invalid`.
- Kept this scoped to `/steel/oauth-chat`; no formal Steel Workspace or official chat integration was added.
- No Supabase migration was needed because this slice only changes chat/workbook API contracts and Mongo workbook patch application.
- Verification passed: data-provider Steel AI Jest, `build:data-provider`, packages/api Steel handler Jest, direct `packages/api` build, Prettier, and `git diff --check`.
- Direct `packages/api` build still reports the existing non-Steel Redis type warning in `src/cache/cacheFactory.ts`, but exits `0`.

# Steel Workbook Canonical Headers

- [x] Record the requested seven-sheet header contract.
- [x] Add failing service tests for exact sheet header order and required seed rows.
- [x] Update initial workbook definitions without changing public sheet ids.
- [x] Verify focused service/repository tests, build, formatting, and diff checks.

## Review

- Updated the initial Steel workbook contract so new workbooks keep the seven public sheet ids but render the requested visible sheet labels and exact header order.
- Verified `docs/reference/系統訂單.xlsx` first-row headers match the requested 20-column ERP system-order header.
- `報價明細` now contains the full pricing, weight, source, confidence, fee, and review columns. Its patch-oriented material price key is `material_unit_price` with label `材料單價`.
- `總結` now seeds `總重量` and `總額`; `給客戶` now seeds a final `訂單總額` row.
- Synchronized stale workbook test fixtures from `quoted_unit_price` / `單價` to `material_unit_price` / `材料單價`.
- Build-output cloud Mongo smoke passed: `createWorkbook` returned `201`, visible sheet labels were `報價明細`, `總結`, `人工複核`, `價格來源`, `判讀備註`, `系統訂單`, `給客戶`; `報價明細` had 40 headers, `系統訂單` had 20 headers, and `給客戶` included the `訂單總額` row. The temporary workbook was deleted.
- User-corrected visible sheet order is now canonical: `系統訂單`, `總結`, `人工複核`, `報價明細`, `價格來源`, `判讀備註`, `給客戶`. The public sheet ids remain stable.
- Rebuilt data-provider before API tests so `packages/api` consumed the updated `requiredSteelWorkbookSheetIds` order.
- Build-output cloud Mongo order smoke passed: `createWorkbook` returned `201` with sheet labels exactly `系統訂單`, `總結`, `人工複核`, `報價明細`, `價格來源`, `判讀備註`, `給客戶`; the temporary workbook was deleted.
- No Supabase migration was needed because this changes Mongo workbook JSON initialization and tests only.

# Steel Workbook Live Endpoint Still 500

- [x] Confirm which backend process is serving `:3080` and whether it uses this worktree/build.
- [x] Verify built `packages/api/dist` contains the workbook repository fix and diagnostic response.
- [x] Reproduce workbook creation against the live backend or live Mongo seam.
- [x] Fix any remaining backend issue with focused regression coverage.
- [x] Verify focused tests/build/diff checks and document the final live-smoke result.

## Review

- Root cause of the repeated `{"message":"Steel workbook request failed"}` on `steel/v8.3`: the running/build target branch did not yet include the workbook repository plain-object fix or the diagnostic workbook handler response that were present in the detached Codex worktree.
- Confirmed the Codex worktree had `steel_workbook_unknown` diagnostics and the Mongoose `toPlain()` fix, while `/Users/neven/Documents/projects/LibreChat` on branch `steel/v8.3` did not.
- Applied the same verified repository and handler changes directly to the `steel/v8.3` branch worktree so rebuilding that branch uses the fixed code.
- No local `:3080` or `:3090` listener was visible from the tool environment during diagnosis, so the live browser request could not be replayed against the user's currently running process.
- Verified the built branch handler directly against `.env` `MONGO_URI`: after an explicit `mongoose.connect`, `createWorkbook` returned `201`, created seven sheets, and the first sheet label was `報價明細`; the smoke script then deleted the temporary workbook data.
- Verified the diagnostic path too: calling the handler without an active Mongo connection now returns `errorCategory: steel_workbook_unknown` and an `errorSummary`, so any remaining generic-only response is from an older running backend.

# Steel Workbook API 500 Bug Fix

- [x] Reproduce `POST /api/steel/workbooks` failure at the real repository/schema seam.
- [x] Identify whether the failure is Mongoose workbook schema, stale package build, or runtime database configuration.
- [x] Add a regression test for the real failure mode before changing production code.
- [x] Implement the minimal backend fix and preserve the retryable frontend error state.
- [x] Verify focused workbook API tests, build, formatting, and diff hygiene.

## Review

- Root cause: the Mongoose workbook repository returned Mongoose documents/subdocuments directly into `toRecord()`. Spreading those subdocuments dropped getter-backed fields, so Zod saw `sheets[].id`, `label`, `columns[].key`, and `rows[].id` as `undefined`.
- Added `packages/api/src/steel/workbook/repository.spec.ts` with a real `mongodb-memory-server` create/read path through `createMongooseSteelWorkbookRepository`.
- Fixed `packages/api/src/steel/workbook/repository.ts` by converting workbook documents, sheet subdocuments, column subdocuments, and row subdocuments to plain objects before shaping the public workbook DTO.
- Added workbook handler diagnostics for unexpected 500s: production still hides internals, development returns `errorCategory: steel_workbook_unknown` plus `errorSummary`, and the server logger records the underlying error.
- Verification passed: focused `handlers.spec.ts` + `workbook/repository.spec.ts`, Prettier, `npm run build:api`, and `git diff --check`. `build:api` still reports existing non-Steel TypeScript warnings in app/config/cache/middleware files; no new Steel warnings remain.

# Steel OAuth Chat Workbook Layout

- [x] Document the approved UI layout plan.
- [x] Add failing tests for gpt-5.5-only model behavior, workbook panel toggle, and draggable divider resizing.
- [x] Remove the gpt-5.4 model option and model selector from `/steel/oauth-chat`.
- [x] Add right-header workbook panel open/close icon behavior.
- [x] Add desktop workbook divider dragging with min 100px, max chat view width minus 200px, and default 1:1 sizing.
- [x] Verify focused client tests, formatting, filtered typecheck, diff hygiene, and browser smoke where possible.

## Review

- Added `docs/plans/2026-06-02-steel-oauth-chat-workbook-layout.md` with the approved UI implementation plan.
- Removed the model selector from `/steel/oauth-chat`; chat requests now always send `model: 'gpt-5.5'`.
- Added a right-header icon-only workbook toggle using `Hide workbook` / `Show workbook` aria labels.
- Added a desktop workbook divider with mouse drag resizing. The panel defaults to `50%`, clamps to a `100px` minimum, and clamps maximum width to layout width minus `200px` chat space.
- Workbook hide/show keeps workbook state intact; it only removes the panel from the layout.
- Verification passed: focused `SteelOAuthChat` Jest red/green suite, Prettier, filtered client typecheck for Steel UI files, and `git diff --check`.
- In-app browser smoke could not reach the route because the browser session blocked localhost navigation with `net::ERR_BLOCKED_BY_CLIENT`; no UI data-changing browser actions were attempted.

# Steel Workbook Loading Bug Fix

- [x] Add a regression test for failed workbook initialization showing an error instead of infinite loading.
- [x] Confirm the regression test fails against the current UI behavior.
- [x] Add explicit workbook initialization state, error display, and retry behavior.
- [x] Verify focused client tests, formatting, typecheck filter, and diff hygiene.

## Review

- Root cause: `SteelOAuthChat` did not catch `createSteelWorkbook` failures, so `workbook` stayed `null` and `SteelWorkbookPreview` rendered `Workbook loading` forever.
- Added a regression test that rejects `createSteelWorkbook`, verifies the error is visible, verifies loading disappears, and verifies `Retry workbook` reloads the workbook.
- Added explicit workbook loading/error state in `SteelOAuthChat` and passed it into the workbook preview.
- Added a retryable error state in `client/src/features/steel/workbook/Preview.tsx`.
- Verification passed: focused SteelOAuthChat Jest, Prettier, filtered client typecheck for Steel UI files, and `git diff --check`.

# Steel Workbook UI Patch Slice

- [ ] Extend workbook DTOs so seven-sheet quote workbooks have renderable sheet/column/row metadata.
- [ ] Extend Mongo workbook and patch schemas so workbook JSON is durable app state, not a one-time attachment.
- [ ] Add backend workbook service/repository for create, read, and optimistic-version patch.
- [ ] Register workbook API routes under `/api/steel/workbooks`.
- [ ] Add a reusable LibreChat workbook preview that renders tabs, rows, and recent patch highlights.
- [ ] Wire the current Steel route to create/read a workbook and apply multi-turn patch responses.
- [ ] Verify focused data-provider, data-schemas, API, route, and client tests plus builds/diff checks.

## Review

- Extended `packages/data-provider/src/steel/workbooks.ts` so every workbook sheet carries UI-renderable column metadata, rows, selected refs, changed paths, changed summaries, and explicit `set_cell` patch operations.
- Extended `packages/data-provider/src/steel/ai.ts` so Steel chat requests can carry current workbook context and chat responses can carry an accepted `workbookPatch` for UI refresh.
- Extended Mongo Steel workbook schemas so `steel_workbooks` stores full workbook JSON and `steel_workbook_patches` stores operations, selected refs, changed paths, changed summaries, accepted/rejected status, and rejection reason.
- Added `packages/api/src/steel/workbook/` service and Mongoose repository for create/read/optimistic-version patch.
- Registered `POST /api/steel/workbooks`, `GET /api/steel/workbooks/:workbookId`, and `PATCH /api/steel/workbooks/:workbookId` under JWT auth.
- Added data-provider wrappers: `createSteelWorkbook`, `getSteelWorkbook`, and `patchSteelWorkbook`.
- Added reusable LibreChat workbook preview at `client/src/features/steel/workbook/Preview.tsx` and mounted it on `client/src/routes/SteelOAuthChat.tsx`.
- The Steel route now creates a workbook, sends current `workbookId`/`workbookVersion` with chat requests, and refreshes/highlights the preview when a later chat response includes `workbookPatch`.
- Verification passed: data-provider Steel AI/workbook Jest, data-schemas Steel schema Jest, packages/api workbook/handler Jest, api route shell Jest, client SteelOAuthChat Jest, `build:data-provider`, `build:data-schemas`, direct `packages/api` build, filtered client typecheck for new Steel UI files, and `git diff --check`.
- Full `client` typecheck still fails on existing unrelated repository errors; the filtered output no longer contains `SteelOAuthChat` or `client/src/features/steel/workbook/Preview.tsx`.
- Scope correction: `/steel/oauth-chat` remains the full-flow validation harness. Do not move this into formal Steel Workspace or official chat until the user confirms the complete flow.

# Steel Non-Round Hole Calculator Slice

- [x] Create a Supabase migration for non-round hole dimensions on `steel.hole_prices`.
- [x] Update `supabase/schema.sql` with the same `hole_prices` shape.
- [x] Apply and verify the migration on cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Add repository/tool tests for non-round hole lookup.
- [x] Implement repository/tool support for `oval`, `long`, `rectangular`, and `custom` hole price lookup.
- [x] Add failing calculator tests for round and non-round hole fees.
- [x] Implement `calculate_hole_fee`.
- [x] Run focused tests, build, formatting, and diff checks.

## Review

- Generated `supabase/migration/20260602092407_phase_cd_non_round_hole_prices.sql` with `npx supabase migration new phase_cd_non_round_hole_prices`.
- Added `length_mm`, `width_mm`, and `dimension_label` to `steel.hole_prices`, plus positive-length/width checks and `hole_prices_non_round_lookup_idx`.
- Updated `supabase/schema.sql` with the same current schema snapshot.
- Applied the migration SQL to cloud Supabase through `.env` `STEEL_POSTGRES_URL`; `supabase db push --dry-run` showed remote migration history is not aligned with previously applied migrations, so this task used direct SQL apply and live verification rather than replaying all old migrations.
- Live cloud verification passed for new columns, check constraints, index, and rollback insert smoke for an `oval` 30x15 reviewed hole price row.
- Added non-round hole repository lookup fields and `lookup_hole_price` tool support.
- Added `calculateHoleFee` as a pure backend calculator for round and non-round hole groups.
- Verification passed: repository/tool/calculator red-green Jest suites, combined focused Jest run, `npm run build:api`, `git diff --check`, and required-term grep.
- `npm run build:api` still reports existing non-Steel TypeScript warnings in config/cache/middleware files; no new Steel build failure was introduced.

# Steel Cutting/Hole/Slotting Rule Docs

- [x] Read `docs/reference/instruction.txt` for hole and slotting rules.
- [x] Document confirmed cut-count semantics, including head/tail trim, remainder behavior, and billable vs operation cut counts.
- [x] Document hole-count and slotting-length calculator contracts.
- [x] Sync the active architecture package and v8.3 implementation roadmap.
- [x] Verify Markdown formatting and diff hygiene.

## Review

- Updated `tasks/steel-data-rules-architecture/phase-3-material-rules.md` with confirmed cut-count semantics, hole processing rules, and slotting path rules.
- Expanded hole processing docs so future Admin-reviewed oval, long, rectangular, and custom non-round hole prices are supported by runtime lookup/calculators even when current source rows are missing or `0`.
- Updated `tasks/steel-data-rules-architecture/phase-4-tool-calling.md` so AI
  produces structured cutting/hole/slotting calculation context. Superseded
  correction: backend does not own deterministic quote computation.
- Updated `tasks/steel-data-rules-architecture/checkpoints.md` with rule/tool/manual scenario gates for cut count, holes, and slotting.
- Synced `tasks/v8.3/phase-2-data-tools.md` and `docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md` so the implementation roadmap includes `calculate_cut_count`, hole groups, and slotting paths.
- Verification passed: Markdown Prettier, `git diff --check`, and required-term grep for `calculate_cut_count`, `operationCutCount`, `billableCutCount`, hole groups, and slotting paths.

# Steel Phase 4B Rule Proposal Backend

- [x] Add Phase 4B plan and checkpoint for backend-only proposal creation.
- [x] Add public rule proposal create/read schemas.
- [x] Replace the generic proposal placeholder schema with structured proposal fields.
- [x] Add backend proposal service/repository and authenticated create handler.
- [x] Register `/api/steel/rule-proposals` under JWT auth.
- [x] Verify focused schemas, handler, route, builds, and diff hygiene.

## Review

- Added `tasks/steel-data-rules-architecture/phase-4b-rule-proposal-backend.md` and linked it from the phase map/checkpoints.
- Kept Admin review UI, Admin approval/rejection API, promotion into `steel.calculation_rule_defaults`, and publication into `steel.quote_defaults` deferred for that Phase 4B closeout. Superseded by the current queue above: only Admin review UI remains paused; non-UI backend approval/publish work should be sequenced.
- Added `packages/data-provider/src/steel/rules.ts` with strict public create/response schemas for structured rule proposals.
- Replaced the generic Mongo proposal name/status placeholder with proposal fields, source refs, selectors, adjustable parameters, creator/reviewer metadata, and review queue indexes. Current docs use `steel_rule_proposals` for the proposal surface.
- Added `packages/api/src/steel/rules/` service/repository and `createRuleProposal` handler.
- Registered `POST /api/steel/rule-proposals` under existing JWT auth.
- No Supabase migration was needed in Phase 4B because the proposal surface uses Mongo; the earlier Phase 4A Supabase migration remains the Postgres quote-default schema change.
- Clarified that AI uses tool calling to request proposal creation; backend validation owns persistence, and global/site-managed quote defaults are a future extension module.
- Added the confirmed conversation scenarios for quote-only adjustments, explicit future defaults, unclear scope, multiple candidates, product-price zero handling, and global memory requests.
- Closed Phase 4B scope so remaining Admin review/backend/UI and global quote defaults extension work stays deferred while implementation returns to the core order quoting path.
- Verification passed: focused data-provider/data-schemas/API/route Jest suites and `npm run build:data-provider`, `npm run build:data-schemas`, `npm run build:api`.
- `npm run build:api` still reports existing non-Steel TypeScript warnings in config/cache/middleware files; no new Steel build failure was introduced.

# Steel Phase 4A Quote Default Schema

- [x] Generate a Supabase migration for reviewed calculation defaults and published quote defaults.
- [x] Update `supabase/schema.sql` with the same Phase 4A schema.
- [x] Apply the migration to cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Verify table columns, constraints, indexes, triggers, and private Steel access posture.
- [x] Update architecture checkpoints/review evidence.

## Review

- Generated the Phase 4A Supabase migration. Current filename and schema naming have been updated to `supabase/migration/20260602035007_phase4a_quote_defaults.sql`.
- Added `steel.calculation_rule_defaults` for Admin-reviewed durable customer/tier/material/product/company calculation defaults.
- Added `steel.quote_defaults` for published task-scoped retrieval entries generated from reviewed facts.
- Kept LibreChat user memory outside Steel Admin-reviewed tables; user memory remains an adapter/retrieval layer, not a persisted site-wide default.
- Updated `supabase/schema.sql` with the same tables, constraints, indexes, and `set_updated_at` triggers.
- Applied the migration to cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- Live cloud verification passed: both tables exist, expected column/constraint/index/trigger counts are present, `anon`/`authenticated` have no grants, and rollback insert smoke passed.
- Verification passed: Markdown Prettier, schema grep, `npm run build:api`, and `git diff --check`.

# Steel Quote Default Layer Boundary Update

- [x] Distinguish LibreChat user memory from Steel Admin-reviewed quote defaults.
- [x] Define priority rules where user custom memory can override reviewed defaults without mutating them.
- [x] Update provider-neutral tool contract so both layers stay scoped, bounded, and backend-validated.
- [x] Update lessons with the new boundary.
- [x] Verify Markdown formatting, required terms, and diff hygiene.

## Review

- Updated `CONTEXT.md` with `LibreChat User Memory` and clarified that it stays separate from reviewed Steel facts.
- Updated Phase 4A so Steel Admin-reviewed quote defaults are the site-managed default retrieval layer, while LibreChat user memory is a user/account-scoped custom memory layer.
- Locked quote-time priority: current quote override first, then applicable LibreChat user memory, then Admin-reviewed customer/tier/company defaults.
- Earlier docs considered `lookup_user_memory` and separate `userMemoryCandidates` handling. Superseding correction: the MVP exposed default lookup tool is `lookup_defaults`; LibreChat user memory remains a later separate adapter.
- Clarified that user memory can override retrieval priority but cannot mutate reviewed Steel facts, invent formula codes, or bypass backend validation.
- Verification passed: Markdown Prettier, required-term grep, and `git diff --check`.

# Steel Quote Default Promotion Architecture

- [x] Separate quote-specific overrides from reusable customer defaults.
- [x] Define rule proposals as the only path from conversation adjustments to Admin-reviewed defaults.
- [x] Define quote defaults as generated task-scoped retrieval over reviewed database facts, not source of truth.
- [x] Define how AI retrieves matching quote defaults through backend tools and scoped filters.
- [x] Update Phase 2/Phase 4/Phase 5 docs and checkpoints with the Admin approval boundary.
- [x] Verify docs formatting, required terms, and diff hygiene.

## Review

- Added `tasks/steel-data-rules-architecture/phase-4a-quote-defaults-architecture.md`.
- Added `Rule Proposal` and `Quote Default` to `CONTEXT.md`.
- Planned lifecycle: quote override -> rule proposal with `needs_review` -> Admin review -> reviewed database rule/default/formula/price row -> generated task-scoped quote defaults.
- Locked that "save as customer default" must not write quote defaults directly; it only creates a structured proposal after required customer/material/charge/formula/parameter fields are known.
- Planned future storage surfaces: proposal surface (`steel_rule_proposals`) and reviewed default surface (`steel.calculation_rule_defaults`) referencing `steel.formula_versions.code` instead of duplicating formulas.
- Planned retrieval surface `steel.quote_defaults`, quote-facing tool `lookup_defaults`, internal/default validation policy, and `select_calculation_rule`.
- Locked retrieval behavior: typed filters first, bounded reviewed candidates only, origin refs required, and backend revalidation before selected quote defaults becomes `selectedCalculationRule`.
- Verification passed: Markdown Prettier, retrieval-contract grep, memory-dump guard grep, and `git diff --check`.

# Steel Phase 2 Adjustable Calculation Rule Overrides

- [x] Extend selected calculation rules so quote defaults/admin defaults can carry adjustable numeric parameters.
- [x] Accept explicit user-provided conversation overrides for numbers or prices without hardcoding those values in code.
- [x] Keep fixed formula identity separate from adjustable parameters.
- [x] Preserve `產品價格.xlsx` zero-as-missing behavior unless a user override supplies the value or a confirmed true-zero rule applies through non-product-price evidence.
- [x] Verify with focused pricing/tool tests, lint, build, smoke, and diff checks.

## Review

- Extended `selectedCalculationRule` with optional `formulaCode`, `defaultParameters`, and `parameterOverrides`.
- `formulaCode` identifies the fixed formula path; `defaultParameters` represent quote defaults/admin defaults; `parameterOverrides` represent explicit user, quote-evidence, or admin adjustments.
- Price decision policy accepts a high-confidence `unitPrice` / `unit_price` override from the selected rule and applies it before rejecting missing prices. Superseding correction: this remains internal policy, not an exposed runtime tool.
- Medium/low-confidence overrides return `parameter_override_not_confirmed`, so the chat flow asks for confirmation instead of silently pricing.
- The selected rule and its override details are returned in `priceDecision.calculationRule` so later calculators can audit which defaults and custom numbers were used.
- Verification passed: focused Steel Jest suites, focused ESLint, `npm run build:api`, built-package user-override smoke, and diff hygiene checks.

# Steel Phase 2 Price Decision Rules

- [x] Add backend price decision contract for ranked candidates.
- [x] Treat `產品價格.xlsx` zero values as missing price, not confirmed free price.
- [x] Require a `quote_default` or Admin-reviewed selected calculation rule before any zero charge becomes confirmed true zero.
- [x] Let the selected calculation rule decide whether the price path skips remainder calculation.
- [x] Require user confirmation when multiple usable price candidates remain.
- [x] Add price-ranking decision policy. Superseding correction: do not expose it as a runtime tool.

## Review

- Added `packages/api/src/steel/pricing/decision.ts` and focused tests for price ranking/decision behavior.
- Added price-ranking decision policy. Superseding correction: `rank_price_candidates` was removed from the executable Steel tool registry; ranking/confirmation stays backend internal policy plus AI explanation.
- Product/material price `0` from `產品價格.xlsx` is rejected with `product_price_zero_is_missing`.
- A zero charge is usable only when the caller supplies a selected calculation rule with `effect = true_zero_charge`, matching `appliesToChargeTypes`, and `confidence = high`.
- The current C-type cutting/hole free-charge behavior is represented as a `quote_default` or Admin-reviewed selected calculation rule, not as product-family hardcoding in pricing code.
- True-zero decisions normalize `valueState` to `true_zero` and use the selected rule's `skipRemainderCalculation` flag.
- Zero cutting/hole values without a selected calculation rule are rejected by default, even for C-type steel.
- Multiple positive usable candidates return `confirm_candidates` so the user chooses before pricing.
- Verification passed at the time for focused Steel Jest suites, focused ESLint, `npm run build:api`, built-package price-decision smoke, and diff hygiene checks. Superseded runtime-tool exposure was later removed.

# Steel Phase 2 AI Spec Clarification

- [x] Add backend contract for AI-proposed quote item candidates.
- [x] Require user confirmation when AI confidence is not high.
- [x] Require user confirmation when multiple plausible spec candidates exist.
- [x] Preserve one high-confidence complete candidate as usable but still traceable to AI inference.
- [x] Add focused tests and export the normalization layer.

## Review

- Earlier slice added `packages/api/src/steel/normalization/clarify.ts` and `resolveSteelQuoteItemCandidates()` as a backend contract for AI-proposed quote item candidates.
- Superseding correction: AI candidate generation stays in reasoning, not a runtime helper. `clarify.ts` / `clarify.spec.ts` were removed, and `normalize_quote_item` must not be exposed as an executable runtime tool.
- AI should ask for confirmation when candidate confidence is not high, when multiple plausible candidates exist, or when required fields are missing.
- Medium/low confidence candidates return `ask_user` with bounded options for user confirmation.
- Multiple plausible candidates return `confirm_candidates` so the chat flow can show choices before pricing.
- Missing required fields return a targeted question naming the missing canonical fields.
- Focused red/green tests passed for the clarification rules. Superseded executor integration was later removed from the runtime tool registry.

# Steel Phase 2 Tool Executor MVP

- [x] Add provider-neutral Steel tool schemas and registry for repository-backed tools.
- [x] Add executor envelopes, bounded logging, per-run call limit handling, and typed errors.
- [x] Sanitize tool results before returning them to any Steel AI provider.
- [x] Wire existing read repositories into tool handlers without raw SQL or raw file access.
- [x] Verify the tool executor with focused red/green tests, API build, and diff hygiene.
- [x] Record deferred scope: real Admin ERP XLSX import and real handbook data SQL/import remain later work.

## Review

- Added `packages/api/src/steel/tools/` with provider-neutral Zod schemas, registry definitions, result envelopes, sanitizer, executor, and tests.
- Implemented repository-backed tools: `lookup_customer`, `search_customers`, `search_price_candidates`, `lookup_spec_price`, `lookup_weight_spec`, `lookup_cutting_price`, `lookup_processing_price`, `lookup_material_rules`, `lookup_formula_version`, `find_order_items`, and `search_source_chunks`.
- The registry deliberately excludes raw SQL, raw Mongo, file-read, and directory-listing tools.
- Tool execution validates arguments before SQL dispatch, enforces optional per-run call limits, returns typed success/error envelopes, and emits bounded log entries with source refs and redaction version.
- Tool output sanitization redacts prompt-injection-like source text and drops undefined fields before returning data to provider adapters.
- Unknown prices remain `null` with `valueState = unknown`; tool code does not convert missing prices to `0`.
- Exported `postgres`, `repositories`, and `tools` through the package root so thin `/api` wrappers can consume the new Steel layers from `@librechat/api`.
- Verification passed: initial red tests failed for missing modules, then focused tool tests passed, repository plus tool tests passed, and `npm run build:api` passed with only existing non-Steel TypeScript warnings.
- Live Supabase cloud smoke through `.env` `STEEL_POSTGRES_URL` passed against the built package: `search_price_candidates` returned a success envelope with zero candidates for a synthetic no-match spec.
- Deferred scope remains unchanged: real Admin ERP XLSX import, import commit/upsert workflows, and real handbook data SQL/import belong to later Phase 5 or explicitly approved data-import work.

# Steel Phase 2 Repository Layer

- [x] Add canonical repository helpers for `source_refs`, `value_state`, and `review_state`.
- [x] Add read repositories for Phase 2 quote facts and source chunks.
- [x] Add validation that rejects malformed `source_refs` before insert serialization.
- [x] Verify the repositories against focused Jest coverage.
- [x] Verify the exported Steel API build boundary and live Supabase cloud schema.

## Review

- Added `packages/api/src/steel/repositories/` with typed query helpers for price items, customers, weight specs, processing/cutting/hole/slotting/bending prices, material rules, formula versions, order items, and source chunks.
- Default quote-facing repository reads filter to `review_state = reviewed` and active rows where the table has `active`; callers can opt into a different review state or inactive records where that is useful for Admin workflows.
- Added `parseSteelSourceRefs()` and `serializeSteelSourceRefsForInsert()` so code validates canonical `source_refs` arrays before writing JSONB values.
- Exported the repository layer through `packages/api/src/steel/index.ts`.
- Focused repository verification passed: 8 Jest suites, 14 tests.
- Steel Postgres plus repository verification passed: 9 Jest suites, 18 tests.
- `npm run build:api` passed. It still emits existing non-Steel TypeScript warnings in config/cache/middleware files, but no new Steel repository warnings.
- Live Supabase cloud read probe through `.env` `STEEL_POSTGRES_URL` passed with `source_refs_array_violations = 0`.
- Hosted Supabase MCP config is present in `.mcp.json`; the endpoint is reachable and returns `401` until the client/user completes OAuth authentication.

# Steel Supabase Cloud Migration Setup And Phase 2 Schema

- [x] Remove Docker-oriented Supabase local-stack setup and root npm scripts.
- [x] Add project MCP config for the hosted Supabase MCP server.
- [x] Update agent docs so Steel uses cloud Supabase through `.env` `STEEL_POSTGRES_URL`.
- [x] Generate the Phase 2 schema migration with Supabase CLI.
- [x] Update `supabase/schema.sql` with the same Phase 2 schema changes.
- [x] Apply the migration to the cloud Supabase development database.
- [x] Verify the cloud schema, formatting, and diff hygiene.

## Review

- Removed the root `npm run supabase:*` scripts and the generated local-stack `supabase/config.toml` / `supabase/.gitignore` files.
- Kept Steel runtime database connection on `.env` `STEEL_POSTGRES_URL`; `.env.example` and local-dev docs show the direct Supabase `db.<project-ref>.supabase.co` URL shape first, with the Session pooler documented as a fallback.
- Added project `.mcp.json` for the hosted Supabase MCP server scoped to project ref `iumtsqkuppgopxskuwns`.
- Preserved the canonical singular `supabase/migration/` directory by adding `supabase/migrations` as a symlink for Supabase CLI migration generation only.
- Generated `supabase/migration/20260601101055_phase2_canonical_quote_facts.sql` with `npx supabase migration new phase2_canonical_quote_facts`.
- Updated `supabase/schema.sql` with the same Phase 2 columns, constraints, and indexes.
- Applied the migration to the cloud Supabase development database through `.env` `STEEL_POSTGRES_URL`.
- Live verification passed: required Phase 2 columns, constraints, and indexes are present; `weight_specs.source_ref` and `material_rules.source_ref` are removed; Steel still has 21 tables; `anon` and `authenticated` have no Steel schema/table access.

# Steel Phase 2 Supabase Schema Delta Plan

- [x] Inspect current Supabase schema snapshot and accepted Phase 2 canonical contracts.
- [x] Create a schema delta plan under `tasks/steel-data-rules-architecture/`.
- [x] Link the schema delta plan from the active Phase 2 architecture package.
- [x] Run focused docs verification, Markdown formatting, and `git diff --check`.

## Review

- Created `tasks/steel-data-rules-architecture/phase-2-schema-delta-plan.md` as a review-only plan, not a migration.
- Proposed migration filename `supabase/migration/202606010001_phase2_canonical_quote_facts.sql` for the later implementation step.
- Planned table deltas for source-backed customer/category data, `price_items`, `weight_specs`, `material_rules`, processing/cutting/hole/slotting/bending price tables, cutting adjustments, and formula versions.
- Preserved project schema discipline: later implementation must update both `supabase/schema.sql` and one migration, with Steel tables still in the private `steel` schema.
- Linked the plan from `tasks/steel-data-rules-architecture/README.md`, `phase-2-canonical-data-model.md`, and checkpoints.
- Verification passed: required-contract grep found the plan anchors, plan-safety grep confirmed the plan is not an applied migration, Markdown Prettier completed successfully, and `git diff --check` passed.

# Steel Phase 2 Canonical Contracts

- [x] Record accepted Phase 2 canonical answers from the grill.
- [x] Update source-ref, schema-value, true-zero, material-rule, formula, and tool-boundary contracts across active Phase 2 docs.
- [x] Expand ADR 0002 into a full rationale document.
- [x] Reconcile stale active-looking wording in `tasks/todo.md`, source mapping, and v8.3 planning docs.
- [x] Run focused docs verification, Markdown formatting, and `git diff --check`.

## Review

- Accepted all Phase 2 canonical grill recommendations and updated the active docs package before any schema/code implementation.
- Locked source refs as a canonical `source_refs` JSONB array with `channel`, `factType`, locator, confidence, `sourceVersionId`, `extractedLabel`, and `canonicalKey`; normalized source-ref tables are deferred.
- Locked schema direction for typed product-price unit weight, value/review state, material-rule priority/selectors, formula source/review shape, and nullable unknown price/charge values instead of zero placeholders.
- Narrowed true-zero to Admin-reviewed price/charge facts; zero unit weight remains invalid or unknown unless a later source-specific task proves a real zero-weight concept.
- Clarified Phase 2 tool boundaries: provider-neutral executor only, `normalize_quote_adjustment` is non-mutating, no Phase 2 `apply_workbook_patch` stub, and Phase 3 selected workbook refs use camelCase DTOs without trusted client `currentValue`.
- Expanded `docs/adr/0002-steel-source-priority-policy.md` into a full ADR with status, context, decision, consequences, and rejected alternatives.
- Verification passed: stale-contract grep returned no matches for old Phase 2 terms, required-contract grep found the new anchors, Markdown Prettier completed successfully, and `git diff --check` passed.

# Steel Data Rules Phase 1 Source Inventory

- [x] Read `CLAUDE.md`, Steel lessons, Phase 1 source inventory plan, and data-rule checkpoints.
- [x] Inspect every `docs/reference` source for sheets/headers/row counts/sample evidence.
- [x] Expand `tasks/steel-data-rules-architecture/phase-1-source-inventory.md` with source authority, source-ref strategy, review confidence, and AI/tool usage boundaries.
- [x] Reconcile related checkpoints or source-schema mapping docs if the inventory exposes drift.
- [x] Run focused documentation verification, Markdown formatting, and `git diff --check`.

## Review

- Started Phase 1 as a docs/source-inventory slice. No Supabase schema, migration, parser, runtime import, or tool implementation is in scope for this step.
- Inspected reference source structure: customer workbook rows/header/tiers, product price rows/tier prices/unit weights/processing-like rows, formula workbook rows and CSV encoding caveat, handbook page/section anchors, H-type text rule, cutting workbook sheets/confidence notes, system-order output headers, quote evidence RTF, and legacy XLS shape.
- Expanded `tasks/steel-data-rules-architecture/phase-1-source-inventory.md` with inventory evidence, source-ref locator strategy, source-specific authority semantics, review confidence rules, and AI/tool use boundaries.
- Reconciled formula-source wording in `tasks/v8.3/source-schema-mapping.md` and `tasks/v8.3/phase-2-data-tools.md` to prefer `公式編號.xlsx`; the CSV remains development reference only because current parsing showed an encoding/readability caveat.
- Verification passed: Markdown Prettier, Phase 1/source-ref grep, stale v8.3 formula-CSV runtime grep with no matches, and `git diff --check`.

# Steel Data Rules Phase 0 Grill

- [x] Read `CLAUDE.md`, existing Steel lessons, target Phase 0 decisions, `CONTEXT.md`, downstream data-rule phase docs, and source references.
- [x] Batch all unresolved Phase 0 grill questions with recommended answers.
- [x] Update `CONTEXT.md` immediately when a domain term or relationship changes.
- [x] Update `tasks/steel-data-rules-architecture/phase-0-decisions.md` and related active docs when decision wording changes.
- [x] Run focused docs verification after resolved edits.

## Review

- Started grill pass from `tasks/steel-data-rules-architecture/phase-0-decisions.md`.
- Current evidence: the Phase 0 decisions are already reflected in `CONTEXT.md`; downstream risk is mainly whether source-priority wording is precise enough for Phase 2 schema/tool behavior.
- Resolved grill corrections: product-price unit weight is the main quote weight when reviewed product price data carries one; H-type lengths outside 6M, 9M, 10M, and 12M automatically receive +0.3/kg on material unit price only; customer chat can create quote-specific line adjustments such as no-charge, special price, added surcharge, or one-line rule override.
- Updated `CONTEXT.md`, the Steel data-rules package, `tasks/v8.3/phase-2-data-tools.md`, `tasks/v8.3/source-schema-mapping.md`, `tasks/lessons.md`, and new ADR `docs/adr/0002-steel-source-priority-policy.md`.
- Verification passed: focused term grep for glossary/package/v8.3 links, source-schema grep for `product_price_unit_weight`, `cutting_unit_price`, material rules, quote-specific adjustment, and true zero, stale-wording grep with no matches, Markdown Prettier, and `git diff --check`.

# Steel Data Rules Architecture Work Package

- [x] Record accepted Phase 2 data/rule decisions from the company manual quoting workflow.
- [x] Create a dedicated multi-phase work package under `tasks/steel-data-rules-architecture/`.
- [x] Link the package from the active v8.3 Phase 2 plan so it does not drift from implementation work.
- [x] Update `CONTEXT.md` with the resolved business vocabulary for quote request evidence, material rules, product-price unit weight, and cutting price source.
- [x] Update `tasks/lessons.md` with the new correction patterns.
- [x] Run focused documentation verification.

## Review

- Created `tasks/steel-data-rules-architecture/` as the dedicated package for mapping the real manual quoting workflow into database facts, rule facts, and AI tool-calling contracts.
- Captured the accepted decisions: product-price unit weight is the main quote weight when reviewed product-price data carries it; C-type rules are disclosed to AI only for C-type quote items; H non-standard-length surcharge adjusts material unit price only; product price owns material/product/processing price, while cutting source owns cutting except for explicit reviewed product-price chargeable cutting/processing rows for the requested work; `切工價錢.xlsx` is a formal cutting-price source; customer inquiry files are quote evidence, not formal import sources.
- Added phase files and checkpoints covering source inventory, canonical data/schema, material-rule architecture, tool-calling, Admin update flow, and verification scenarios.
- Updated the active v8.3 Phase 2 plan with a pointer to the new package.
- Updated glossary and lessons so future agents preserve these boundaries.

# V8.3 Phase 1 Foundation Completion Slice

- [x] Record accepted grill decisions and the Traditional Chinese workbook label correction.
- [x] Record that `/steel/oauth-chat` already proves OAuth file support, and confirm the active route is the OAuth Responses API path.
- [x] Split Steel Mongo schemas into `packages/data-schemas/src/schema/steel/` owner files and replace stale `not_run` capability status with `unverified`.
- [x] Restrict Steel OAuth Responses model support to `gpt-5.5`; remove `gpt-5.4` and lower models from the active allowlist.
- [x] Add durable `steel_audit_logs` schema/model and reusable audit service.
- [x] Add Steel conversation services and routes for authenticated, guest, and owner-token read paths.
- [x] Add service-level access checks for `STEEL_GUEST_MODE=true|false`, owner denial, and guest-token denial.
- [x] Keep `/api` wrappers thin and update route tests for guest/auth/admin boundaries.
- [x] Reconcile v8.3 env naming drift: fallback means choosing the API driver instead of OAuth, with no `STEEL_FALLBACK_*` matrix and no fallback model key.
- [x] Add legacy Office source metadata and a server-conversion proof script task: `.xls` / `.doc` may be handled by AI/provider now, while server-side conversion ships only after the script succeeds.
- [x] Run focused data-provider, data-schemas, API, route, build, and diff checks.

## Review

- Added Phase 1 Steel conversation contracts for authenticated and guest creation plus owner/guest-token read responses. These extend the existing Steel data-provider boundary without introducing tenant/org scoping.
- Split Steel Mongo schema/model ownership into `packages/data-schemas/src/schema/steel/`, `packages/data-schemas/src/models/steel/`, and `packages/data-schemas/src/types/steel/`. New collections include `steel_audit_logs` and `steel_source_versions`; capability status now uses `unverified` instead of stale `not_run`.
- Added `steel_audit_logs` model support and `createMongooseSteelAuditRecorder()` as the reusable Phase 1 audit primitive.
- Added Steel conversation repository/service coverage for authenticated create, guest create, guest-mode disabled denial, non-admin user denial, owner-only read, and guest-token hash denial.
- Added thin route wrappers for `POST /api/steel/conversations/authenticated`, `POST /api/steel/conversations/guest`, and `GET /api/steel/conversations/:conversationMetaId`.
- Tightened active Steel OAuth model support to `gpt-5.5` only and removed the stale local proxy runtime helper. The local `openai-oauth` proxy remains manual diagnostics only; the coded runtime path is direct `openai-oauth-provider`.
- Reconciled active v8.3 docs so fallback means explicitly choosing the `openai_api` driver. No `STEEL_FALLBACK_*`, `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`, or fallback-model contract remains in active runtime docs/code.
- Added `npm run steel:prove-office-conversion` in `packages/api` as the development proof gate for `.xls` / `.doc` server-side conversion. Runtime conversion is still not enabled until a real converter proof succeeds; this machine currently has no `soffice`/`libreoffice` binary on `PATH`, so the script fails clearly with status `2` against `docs/reference/legacy/客戶資料.xls`.
- Verification passed: focused data-provider Steel Jest, data-schemas Steel Jest, API Steel config/provider/models/conversation/handler Jest, API Steel Postgres Jest, API route Jest, `build:data-provider`, `build:data-schemas`, `build:api`, touched-file ESLint, conversion-proof CLI help, stale-contract grep, Markdown subset Prettier check, and `git diff --check`.
- Caveat: `build:api` still emits existing repo-wide TypeScript warnings in non-Steel files such as `agents/resources.ts`, `app/config.ts`, `endpoints/config/*`, `cache/cacheFactory.ts`, `middleware/remoteAgentAuth.ts`, and `middleware/share.ts`. The Steel-specific missing export warnings were fixed by exporting Steel model creators from `@librechat/data-schemas`.

# V8.3 Phase 1 Follow-Up: LibreOffice Proof And Diff Review

- [x] Install or locate LibreOffice/soffice locally.
- [x] Rerun `steel:prove-office-conversion` against legacy `.xls` references.
- [x] Review the current Phase 1 diff for defects before any Phase 2 work.
- [x] Record proof and review result.

## Review

- Installed LibreOffice through Homebrew cask; `soffice` is now linked at `/opt/homebrew/bin/soffice`.
- `npm run steel:prove-office-conversion -- ../../docs/reference/legacy/客戶資料.xls ../../docs/reference/legacy/產品價格.xls` passed and produced `.xlsx` outputs under `/var/folders/.../T/steel-office-conversion-*`.
- No `.doc` legacy fixtures currently exist under `docs/reference`; only `docs/reference/legacy/客戶資料.xls` and `docs/reference/legacy/產品價格.xls` were available for proof.
- Review finding P1: `GET /api/steel/conversations/:conversationMetaId` does not run auth middleware, so normal logged-in owner reads will not populate `req.user`; authenticated conversation records then return 401 unless some unrelated upstream middleware has already set `req.user`.
- Review finding P2: conversation access errors return the Error class name as `errorCategory`, losing the service's typed category such as `steel_guest_mode_disabled` or `steel_quote_access_denied`.
- Resolved P1 before closing Phase 1: conversation reads now run JWT auth unless `x-steel-guest-token` is present, preserving owner reads while still allowing guest-token reads.
- Resolved P2 before closing Phase 1: Steel conversation access errors now return typed `errorCategory` values.
- Phase 1 is closed after rerunning focused data-provider, data-schemas, API, route, build, lint, conversion proof, formatting, and diff checks. Do not start Phase 2 until explicitly requested.

# V8.3 Phase 1 Conversion Proof Output Directory

- [x] Change `steel:prove-office-conversion` output from OS temp folders to `tmp/steel-office-conversion/`.
- [x] Reuse the repo-level `tmp/` ignore rule for conversion proof artifacts.
- [x] Rerun the conversion proof and diff checks.

## Review

- `steel:prove-office-conversion` now writes converted `.xlsx` / `.docx` files to `tmp/steel-office-conversion/`.
- Root `tmp/` is already ignored by git so conversion proof artifacts remain local-only.
- Removed stale OS temp `steel-office-conversion-*` folders created by earlier proof runs.

# V8.3 Phase 1 Temp Directory Unification

- [x] Move `steel:prove-office-conversion` output to root `tmp/steel-office-conversion/`.
- [x] Remove the redundant `packages/api/.tmp/` ignore rule and local artifacts.
- [x] Rerun conversion proof, ignore checks, formatting/lint, and diff checks.

## Review

- The package-local `packages/api/.tmp/` path is removed from `.gitignore` and from local disk.
- `npm run steel:prove-office-conversion -- ../../docs/reference/legacy/客戶資料.xls ../../docs/reference/legacy/產品價格.xls` now writes both files under root `tmp/steel-office-conversion/`.
- `git check-ignore` confirms the generated `.xlsx` outputs are covered by the existing root `tmp/` rule.

# V8.3 File Analysis Instructions Management

- [x] Record plan for confirming the instruction management contract.
- [x] Add focused regression coverage for Admin config updates to `fileAnalysis.instructions`.
- [x] Add focused regression coverage for runtime config override merge of `fileAnalysis.instructions`.
- [x] Update Steel OAuth docs with the management path and Admin Panel UI follow-up.
- [x] Run focused tests, docs grep, and diff checks.

## Review

- Confirmed the current management path is config-driven, not provider-adapter code: local/base config uses `librechat.yaml`, and Admin config overrides can patch `fileAnalysis.instructions`.
- Confirmed the runtime path: merged `AppConfig.fileAnalysis.instructions` reaches request config; Steel prefixes it only for image/PDF file-bearing user messages, and normal LibreChat file formatting uses the same runtime instruction text without mutating stored user text.
- Added Admin config handler coverage for `PATCH /api/admin/config/:principalType/:principalId/fields` with `fieldPath: "fileAnalysis.instructions"`.
- Added config override merge coverage proving DB/YAML overrides deep-merge `fileAnalysis.instructions` into runtime `AppConfig`.
- Updated Steel OAuth setup docs, v8.3 active spec, Phase 3 prompt-order notes, and checkpoints. The docs now distinguish `fileAnalysis.instructions` from LibreChat `ocr` config and record that a dedicated Admin Panel textarea should edit this same field.
- Verification passed: focused Admin config Jest, config resolution Jest, touched-file ESLint, Prettier write check, docs grep, and `git diff --check`.
- Caveat: this slice confirms and documents the backend/API management contract; it does not add the dedicated Admin Panel visual editor field yet.

# V8.3 Steel OAuth Image Detail High

- [x] Record plan for forcing highest OpenAI image detail.
- [x] Add failing provider test for image file `imageDetail: high`.
- [x] Set OpenAI image detail to `high` for Steel OAuth image file parts.
- [x] Run focused provider tests, lint, API build, and diff checks.

## Review

- User asked to use the highest `imageDetail` setting first, before adding image preprocessing.
- Scope is Steel OAuth provider image inputs only: `image/*` file parts get OpenAI `imageDetail: high`; PDF inputs remain `input_file` and are not affected by image detail.
- Added provider coverage proving image file parts include `providerOptions.openai.imageDetail = high`.
- Verified focused provider tests, touched-file ESLint, API build, and `git diff --check`.
- `build:api` still emits existing TypeScript warnings outside this slice but exits 0.

# V8.3 Steel OAuth Chat Reasoning Controls

- [x] Record plan for reasoning effort selector and New Chat reset.
- [x] Add failing tests for request-level reasoning effort override.
- [x] Add failing UI tests for selector payload and New Chat reset.
- [x] Implement data-provider and Steel backend support for `reasoningEffort`.
- [x] Add `/steel/oauth-chat` selector for `low`, `medium`, `high`, and `xhigh`.
- [x] Add `/steel/oauth-chat` New Chat button that clears local chat state.
- [x] Run focused tests, lint, builds, and diff checks.

## Review

- User asked for `/steel/oauth-chat` to switch reasoning effort directly from the UI and add a New Chat button.
- Scope is page-local runtime behavior: selector sends `reasoningEffort` on each chat request, while env config remains the backend default when no request override is provided.
- New Chat should reset local UI state only: messages, input, selected files, pending provider metadata, and send/encoding state.
- Added request contract support for `reasoningEffort: low | medium | high | xhigh`; backend rejects unsupported request values and otherwise falls back to env config.
- Added `/steel/oauth-chat` reasoning selector and a New Chat button that clears the local thread while preserving the selected model and reasoning effort.
- Verified red/green tests for data-provider request schema, Steel handler override/rejection, and UI payload/reset behavior.
- Verification passed: focused Jest suites, touched-file ESLint, `npm run build:data-provider`, `npm run build:api`, `npm run build:client`, and `git diff --check`.
- `build:api` still emits existing TypeScript warnings outside this slice; `build:client` emits existing large-chunk/PWA glob warnings but exits 0.
- Unauthenticated Playwright smoke reached `/login?redirect_to=%2Fsteel%2Foauth-chat`, so visual browser verification requires a logged-in browser/session.

# V8.3 Configurable File Vision Instructions

- [x] Record plan and correction lesson.
- [x] Add failing tests for configurable file instructions.
- [x] Add a shared config-driven file instruction helper.
- [x] Wire the helper into Steel OAuth file messages.
- [x] Wire the helper into normal LibreChat image/document message formatting.
- [x] Keep PDF/image file-analysis guidance configurable and note that Admin Panel UI must edit the same config field.
- [x] Run focused tests and diff checks.

## Review

- User observed rotated JPG Chinese extraction works when the instruction explicitly says images may need rotation and Chinese recognition.
- User clarified this must not be hard-coded in Steel code only: normal LibreChat must inject the same instruction, and Admin Panel UI must be able to update it.
- User also clarified PDFs may wrap images, so PDF/document inputs need the same configurable guidance.
- Added `fileAnalysis.instructions` to the LibreChat config schema and example YAML. The example notes that Admin Panel UI should update this same field instead of baking prompt text into code.
- Added a shared API helper that injects configured instructions only for image or PDF targets and keeps the instruction text out of provider adapters.
- Steel `/api/steel/ai/chat` now prefixes configured file instructions onto file-bearing user messages before calling the OAuth provider, including PDF attachments.
- Normal LibreChat attachment processing now carries the same runtime-only file instruction into prompt formatting for image/document messages without mutating the stored user text.
- Focused verification passed for API helper/Steel handler tests, data-provider config parsing, LibreChat prompt formatting, BaseClient attachment tests, data-provider/data-schemas builds, API build, touched-file ESLint, and `git diff --check`.
- User corrected the boundary: LibreChat's `ocr` config is the Mistral/custom OCR upload pipeline, while this requirement targets OpenAI-native file/image analysis.
- Renamed the config contract from `ocr.instructions` to `fileAnalysis.instructions` so the prompt guidance is not coupled to LibreChat's OCR framework.
- Caveat: this slice records and exposes the shared `fileAnalysis.instructions` config contract for Admin Panel editing, but does not add a dedicated Admin Panel visual editor field yet.

# V8.3 OpenAI OAuth UI File Upload Smoke

- [x] Add a repeatable fixture export command that writes manual smoke files under `tmp/steel-oauth-fixtures/`.
- [x] Include `.txt`, `.pdf`, `.docx`, `.xlsx`, `.png`, and a 90-degree pixel-rotated `.jpg` fixture with English, Chinese, numeric, and sentinel text.
- [x] Add provider-level rotated JPG real-auth smoke before touching browser UI.
- [x] Extend Steel chat request parsing so JSON file payloads reach `sendSteelOAuthChat()` as provider file parts.
- [x] Add `/steel/oauth-chat` file attachment UI and send selected files with the current message.
- [x] Verify focused unit tests, gated real-auth smoke, API build, and browser smoke through `/steel/oauth-chat`.

## Review

- User asked to proceed in order: first disk fixtures, then rotated JPG capability smoke, then `/steel/oauth-chat` UI upload.
- Current file capability fixtures are generated in-memory only; there is no manual fixture directory yet.
- Current `/steel/oauth-chat` UI only sends text and the backend route only parses message role/content, so browser upload requires both client and handler changes.
- Added `npm run steel:export-oauth-fixtures` in `packages/api`; it writes manual files to `/Users/neven/Documents/projects/LibreChat/tmp/steel-oauth-fixtures/`.
- Exported files: `steel-oauth-smoke.txt`, `steel-oauth-smoke.pdf`, `steel-oauth-smoke.docx`, `steel-oauth-smoke.xlsx`, `steel-oauth-smoke.png`, `steel-oauth-smoke-rotated.jpg`, and `manifest.json`.
- Added browser-safe file DTO shape `files[].dataBase64` and backend decode into provider `Uint8Array` file parts.
- Added `/steel/oauth-chat` attachment control, selected-file chips, and JSON file payload sending.
- Provider-level rotated JPG strict smoke currently classifies as parse-wrong: it extracts the sentinel, English, and number, but misses the Chinese phrase from the 90-degree rotated JPG.
- Browser smoke passed through `/steel/oauth-chat` with `steel-oauth-smoke.txt`: request included `files[].dataBase64`, filename `steel-oauth-smoke.txt`, media type `text/plain`, and the assistant response contained `TXT_SENTINEL_7F3A`, `鋼鐵檔案測試`, and `73921`.
- Manual rotated JPG UI smoke through `/steel/oauth-chat` read `JPG_ROTATED_SENTINEL_C5F9`, `Steel OAuth capability smoke`, and `73921`, but misread the Chinese phrase as `钥鏈檔案測試` instead of `鋼鐵檔案測試`; classify this as parse-wrong, not passed.
- Follow-up manual prompt test passed when the injected/user prompt explicitly said the Chinese text is Traditional Chinese; this points to prompt-language guidance as the primary fix before escalating to model or reasoning-effort changes.
- Created local browser-smoke account `steel.oauth.ui.smoke.20260527@example.com` for this verification run.

# V8.3 OpenAI OAuth File Capability Smoke

- [x] Confirm scope change: text-only `/steel/oauth-chat` smoke was manually proven.
- [x] Exclude `steel-oauth-smoke.jpg`; PNG image coverage is enough for this slice.
- [x] Add generated non-secret fixtures with English, Chinese, numeric content, and unique sentinels.
- [x] Add provider-level file-part adapter coverage before live OAuth file smoke.
- [x] Run gated `openai_oauth_responses` real-auth smoke for TXT, PDF, DOCX, XLSX, and PNG.
- [x] Classify each result as passed, unsupported, parse-wrong, or request/adapter failure.
- [x] Record commands, smoke evidence, skipped checks, and remaining risks.

## Review

- User confirmed text OAuth is already manually working.
- The remaining question is whether `openai_oauth_responses` can analyze uploaded document/image contents: `.txt`, `.pdf`, `.docx`, `.xlsx`, and `.png`.
- This is a provider-level capability probe, not a `/steel/oauth-chat` browser upload test, because the current smoke page only sends text messages.
- Added generated in-memory fixtures for `.txt`, `.pdf`, `.docx`, `.xlsx`, and `.png`. Each fixture contains English text, Chinese text, numeric text, and a unique sentinel. `.jpg` is intentionally excluded.
- Added provider adapter coverage proving message file attachments are serialized as AI SDK file parts, `passThroughUnsupportedFiles` is forwarded, and abort signals reach the provider call.
- Focused non-live verification passed for `config.spec.ts`, `fixtures.spec.ts`, `provider.spec.ts`, `provider.real-auth.manual.spec.ts`, and `provider.file-capability.manual.spec.ts`; gated manual specs are skipped unless their env flags are enabled.
- Real-auth smoke command passed with `STEEL_OPENAI_OAUTH_AUTH_FILE="~/.codex/auth.json"`, `STEEL_OPENAI_DEFAULT_MODEL=gpt-5.4`, `STEEL_OPENAI_REASONING_EFFORT=medium`, and `NODE_OPTIONS=--experimental-vm-modules`.
- Real-auth classification: TXT passed in 4.641s, PDF passed in 14.108s, DOCX passed in 5.724s, XLSX passed in 6.278s, and PNG passed in 3.606s.
- Earlier manual-spec auth failure exposed a resolver mismatch: direct tests used the raw `~/.codex/auth.json` string instead of the backend auth-file resolver. The text and file-capability manual specs now use `resolveSteelOpenAIOAuthAuthFilePath()`.
- Regression smoke for the existing text real-auth manual spec passed with the literal `~/.codex/auth.json` env value.
- `npm run build:api` passed with the existing `cacheFactory.ts` Redis/KeyvRedis type warning; `git diff --check` passed.

# V8.3 OpenAI OAuth Provider Real Auth

- [x] Write dedicated implementation plan with todo checklist.
- [x] Confirm the plan before implementation.
- [x] Add requested Steel OpenAI env keys to `.env.example`, plan, runbook, and lessons.
- [x] Add AI SDK/openai-oauth-provider dependencies and overrides.
- [x] Add Steel OpenAI runtime env parser.
- [x] Add provider DTO contracts and sanitized response types.
- [x] Implement direct `openai-oauth-provider` adapter with fake-auth tests.
- [x] Add real-auth manual smoke test gated by env.
- [x] Add authenticated `/api/steel/ai/chat` route.
- [x] Add minimal LibreChat Steel OAuth chat surface.
- [x] Run focused automated verification.
- [ ] Run local real-auth browser smoke.
- [x] Record results and remaining risks.

## Review

- Plan created at `tasks/v8.3/openai-oauth-provider-real-auth-implementation.md`.
- User approved implementation and added env contract: `STEEL_OPENAI_PROVIDER`, `STEEL_OPENAI_DEFAULT_MODEL`, and `STEEL_OPENAI_REASONING_EFFORT`.
- Dependency path adjusted after npm peer conflict: do not add top-level `ai@6` because `ai-tokenizer@1.0.6` peers on `ai@^5`; install `openai-oauth-provider` plus AI SDK provider packages and call the provider model interface directly.
- Verification: `npm ls openai-oauth-provider @ai-sdk/openai @ai-sdk/provider @ai-sdk/provider-utils` shows a single overridden provider package set; `npm ls ai` shows no top-level `ai` package.
- Implemented `packages/api/src/steel/ai/config.ts`, `packages/api/src/steel/ai/provider.ts`, `POST /api/steel/ai/chat`, and the minimal authenticated client route at `/steel/oauth-chat`.
- Added gated real-auth manual spec `packages/api/src/steel/ai/provider.real-auth.manual.spec.ts`.
- Live provider smoke passed with local `~/.codex/auth.json`: expected text `librechat-steel-oauth-live-ok`, provider `openai_oauth_responses`, model `gpt-5.4`, response ID present, usage present, and no secret-shaped fields in the returned DTO.
- Focused tests passed: `packages/data-provider/src/steel/ai.spec.ts`, `packages/api/src/steel/ai/config.spec.ts`, `packages/api/src/steel/ai/provider.spec.ts`, `packages/api/src/steel/handlers.spec.ts`, and `api/server/routes/__tests__/steel.spec.js`.
- Build verification: `npm run build:data-provider` passed; `npm run build:api` passed with the pre-existing Redis `KeyvRedis` type warning in `packages/api/src/cache/cacheFactory.ts`.
- Frontend verification: touched-file ESLint passed. `npm run build:client` remains blocked before this Steel route by missing root resolution for `framer-motion` from `packages/client/dist/index.es.js`; `client npm run typecheck` has many existing repo-wide errors and no Steel route errors in the filtered output.
- Remaining risk: full browser smoke through a running LibreChat server is not done in this slice.

# V8.3 Phase 1 Platform Foundation Grill

- [x] Read project guidance, lessons, context, memory, and the target Phase 1 plan.
- [x] Cross-check unresolved Phase 1 decisions against current code and v8.3 docs.
- [x] Ask the user one batched set of unresolved questions with recommended answers.
- [x] Record the grill review result after decisions are resolved.

## Review

- Reviewed `tasks/v8.3/phase-1-platform-foundation.md` against live Steel context, v8.3 roadmap/spec docs, setup runbooks, ADRs, current route shells, Steel DTOs, Mongo schema scaffolding, access helpers, and provider seam code.
- User agreed to all recommendations: Phase 1 now expects direct `openai-oauth-provider` as the coded path, a full foundation gate rather than the earlier partial slice, split Mongo schema files, durable `steel_audit_logs`, real conversation routes, `unverified` capability status vocabulary, and docs-only production `verify-full` policy until deployment CA details are known.
- Updated Phase 1/checkpoint/runbook/ADR docs to remove stale local-proxy-primary wording and clarify the expected Phase 1 implementation outcome.

# Pre-commit Markdown Formatting

- [x] Add `*.md` prettier formatting to `.husky/lint-staged.config.js`.
- [x] Verify lint-staged config loads and formatting checks pass.
- [x] Record review evidence.

## Review

- Added a `*.md` lint-staged entry that runs `prettier --write`.
- Verification: `node -e "console.log(require('./.husky/lint-staged.config.js'))"` loaded the config and showed the new Markdown rule.
- Verification: `npx prettier --check .husky/lint-staged.config.js tasks/todo.md` passed.
- Verification: `git diff --check -- .husky/lint-staged.config.js tasks/todo.md` passed.

# V8.3 Remove OAuth Transport Selector

- [x] Remove `STEEL_OPENAI_OAUTH_TRANSPORT` from `.env.example`.
- [x] Remove env-controlled local proxy mode from setup/spec/phase docs.
- [x] Update `tasks/lessons.md` with the direct-provider-only env rule.
- [x] Run focused grep verification and `git diff --check`.

## Review

- Removed `STEEL_OPENAI_OAUTH_TRANSPORT` from `.env.example`; Steel OAuth env now only exposes `STEEL_OPENAI_OAUTH_RESPONSES_ENABLED` and `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`.
- Removed env-controlled local proxy/provider-mode language from setup/spec/phase docs. Direct `openai-oauth-provider` is now the only coded runtime path; local proxy remains manual smoke-probe material only.
- Verification: focused grep found no active `STEEL_OPENAI_OAUTH_TRANSPORT` or `STEEL_OPENAI_OAUTH_LOCAL_PROXY_BASE_URL` assignment in `.env.example`, setup/spec env blocks, or v8.3 task docs.
- Verification: `git diff --check -- .env.example docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md tasks/v8.3/README.md tasks/v8.3/phase-0-decisions.md tasks/v8.3/phase-1-platform-foundation.md tasks/v8.3/phase-3-quote-workbook-mvp.md tasks/v8.3/openai-oauth-provider-spike.md tasks/lessons.md tasks/todo.md` passed.

# V8.3 Direct Provider Base URL Cleanup

- [x] Remove active `STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL` from `.env.example`.
- [x] Clarify that the localhost `/v1` URL is local-proxy-only manual diagnostic material, not runtime env.
- [x] Update setup/spec/phase docs and `tasks/lessons.md`.
- [x] Run focused grep verification and `git diff --check`.

## Review

- Removed active `STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL` from `.env.example`; direct provider mode now has no active `/v1` URL.
- Superseded: a later correction removed the transport selector entirely; local proxy is now manual diagnostic material only, not runtime env.
- Updated setup runbook, active v8.3 spec, Phase 3 provider notes, and lessons so URL semantics are local-proxy-only.
- Verification: focused grep found no `STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL` assignment in `.env.example`, setup runbook, active spec, or task docs.
- Verification: `git diff --check -- .env.example docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md tasks/v8.3/phase-3-quote-workbook-mvp.md tasks/lessons.md tasks/todo.md` passed.

# V8.3 .env.example Fallback Key Rename

- [x] Rename simplified `.env.example` fallback switch from `STEEL_OPENAI_API_ENABLED` to `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`.
- [x] Sync v8.3 setup/spec env blocks so the key describes automatic OAuth fallback behavior.
- [x] Update `tasks/lessons.md` with the fallback-key naming rule.
- [x] Run focused grep verification and `git diff --check`.

## Review

- Renamed the simplified operator-facing fallback switch to `STEEL_OPENAI_OAUTH_AUTO_FALLBACK=false` in `.env.example`.
- Synced the setup runbook and active v8.3 spec env blocks, and added wording that the flag means automatic reroute from OAuth primary to `openai_api`, still gated by passed capability smoke results.
- Verification: grep found the new key in `.env.example`, setup runbook, active spec, todo, and lessons; old `STEEL_OPENAI_API_ENABLED` remains only as explanatory text in the lesson/todo correction, not as an env assignment.
- Verification: `git diff --check -- .env.example docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md tasks/lessons.md tasks/todo.md` passed.

# V8.3 .env.example Steel AI Routing Simplification

- [x] Simplify `.env.example` Steel AI provider routing to only operator-facing switches and URL.
- [x] Update `tasks/lessons.md` with the env-example simplification rule.
- [x] Run focused env grep and `git diff --check`.

## Review

- Reduced `.env.example` Steel AI routing to `STEEL_OPENAI_OAUTH_RESPONSES_ENABLED` and the fallback switch later renamed to `STEEL_OPENAI_OAUTH_AUTO_FALLBACK`; later corrections removed transport/proxy URL env entirely.
- Detailed provider defaults remain documented in the v8.3 plan/runbook, but are no longer exposed as sample env knobs.
- Verification: focused grep found no removed internal Steel AI routing env keys in `.env.example`.
- Verification: `git diff --check -- .env.example tasks/lessons.md tasks/todo.md` passed.

# V8.3 openai-oauth Primary Decision Correction

- [x] Record user correction: Vercel AI SDK 6 is Apache-2.0, production-approved, and should be unified through overrides/resolutions.
- [x] Update `tasks/lessons.md` with the dependency decision pattern.
- [x] Update the openai-oauth provider spike result so AI SDK 6 is no longer a blocker.
- [x] Update v8.3 README, checkpoints, Phase 1, Phase 3, setup runbook, and active spec so `openai-oauth` is primary with unified AI SDK versions.
- [x] Run focused grep verification and `git diff --check`.
- [x] Record review evidence in this file.

## Review

- Updated `tasks/lessons.md` with the correction pattern: AI SDK 6 is Apache-2.0, production-approved, not a blocker, and must be unified through package-manager overrides/resolutions when `openai-oauth-provider` is used.
- Updated the provider spike result, v8.3 README, Phase 0, Phase 1, Phase 3, checkpoints, setup runbook, active v8.3 spec, and `.env.example` so direct `openai-oauth-provider` is the preferred primary path after version unification and packaging verification.
- Local HTTP proxy wording is now diagnostic/fallback local-dev only; direct provider production use is represented by `STEEL_OPENAI_OAUTH_ALLOW_PRODUCTION=true`, while proxy production hosting remains blocked by `STEEL_OPENAI_OAUTH_LOCAL_PROXY_ALLOW_PRODUCTION=false`.
- Verification: focused stale-term grep across `tasks/v8.3`, the setup runbook, active spec, `tasks/todo.md`, and `.env.example` returned no stale direct-provider blocker/local-proxy-default hits.
- Superseded verification: later env simplification removed active proxy-production/internal keys from `.env.example`; those details remain in setup/spec docs only.
- Verification: `git diff --check` passed.

# V8.3 openai-oauth-provider Compliance And Dependency Spike

- [x] Record the direct-provider spike scope before running isolated dependency tests.
- [x] Create an isolated `/tmp` Node project and install `openai-oauth-provider` with its AI SDK peers without changing LibreChat package files.
- [x] Verify package metadata, license, peer dependency, ESM/runtime import behavior, and transitive dependency footprint.
- [x] Run a mocked direct-provider smoke that proves `createOpenAIOAuth()` can call `/responses` through injected fetch without a real OAuth token.
- [x] Run a minimal live direct-provider text smoke with local Codex auth without printing tokens or request headers.
- [x] Compare direct provider path against the local HTTP proxy path for LibreChat integration risk.
- [x] Update the v8.3 phase plan/runbook with the spike result.
- [x] Run focused verification and `git diff --check`.
- [x] Record final spike evidence and next implementation choices in this file.

## Review

- Created isolated spike project at `/tmp/lc-openai-oauth-provider-spike`; installed `openai-oauth-provider@1.0.3`, `ai@6.0.191`, `@ai-sdk/openai@3.0.65`, `typescript@6.0.3`, and `tsx@4.22.3`. No LibreChat package files were changed.
- Package metadata: `openai-oauth-provider@1.0.3` is `AGPL-3.0-only`; it depends on AI SDK 6-era packages and introduced duplicate AI SDK provider/openai package versions in the isolated install.
- Import/runtime checks: Node 22.17.1 could both `require('openai-oauth-provider')` and dynamic import it; exported keys were `createOpenAIOAuth`, `deriveAccountId`, `loadAuthTokens`, `openai`, and `parseJwtClaims`.
- TypeScript check passed with `moduleResolution=bundler`; `createOpenAIOAuth()` returned a model accepted by AI SDK `generateText()`.
- Mocked smoke passed: fake auth plus mocked `fetch` proved `generateText({ model: openai('gpt-5.4') })` calls `https://chatgpt.com/backend-api/codex/responses`, injects OAuth headers, normalizes the body to `stream: true`, `instructions: ""`, `store: false`, and returns text/usage/provider metadata from mocked SSE.
- Live smoke passed with local `~/.codex/auth.json`: `gpt-5.4` returned exactly `librechat-provider-live-ok`; output included usage and provider metadata, and no token material or request headers were printed.
- Superseded decision: the later user correction approves AI SDK 6 for production and makes direct `openai-oauth-provider` the coded provider path, with package-manager overrides/resolutions required to unify AI SDK package versions. Keep local HTTP proxy only as a manual diagnostic smoke probe.
- Added `tasks/v8.3/openai-oauth-provider-spike.md` and updated v8.3 README, Phase 1, Phase 3, checkpoints, setup runbook, and active v8.3 spec with this result.
- Verification: focused grep found the spike result and direct-provider blockers across active docs. `git diff --check` passed.

# V8.3 openai-oauth Provider Research Plan Update

- [x] Research `EvanZhouDev/openai-oauth` README, package surfaces, CLI proxy, direct AI SDK provider, live tests, and license/dependency shape.
- [x] Update the active v8.3 spec with the researched integration decision.
- [x] Update `tasks/v8.3` phase/checkpoint docs so implementation starts with the local HTTP `/v1` proxy path and treats the direct provider package as a gated compatibility/compliance spike.
- [x] Update the openai-oauth setup runbook with concrete commands, smoke probes, and stateless `/v1/responses` constraints.
- [x] Run focused documentation verification and `git diff --check`.
- [x] Record review evidence and next tasks in this file.

## Review

- Researched `EvanZhouDev/openai-oauth` at repo commit `aa526920af322568968a30fe820b2b9d55545f8a`; npm metadata reported `openai-oauth@1.0.2` and `openai-oauth-provider@1.0.3`, both `AGPL-3.0-only`.
- Key finding: `openai-oauth` CLI/local server exposes an OpenAI-compatible localhost `/v1` surface with `/v1/models`, `/v1/responses`, and `/v1/chat/completions`; `/v1/responses` is stateless and rejects provider replay state such as `previous_response_id` / `item_reference`.
- Superseded finding: the later dependency correction approves AI SDK 6 for production; direct `openai-oauth-provider` is now the preferred primary path once AI SDK package versions are unified through overrides/resolutions and packaging is verified.
- Superseded update: a later correction changed this to direct `openai-oauth-provider` primary path, with local HTTP proxy retained only for diagnostic/fallback local-dev adapter tests.
- Setup runbook now includes `npx @openai/codex login`, `npx openai-oauth@latest --host 127.0.0.1 --port 10531`, optional `--models`, `/health`, `/v1/models`, and `/v1/responses` smoke probes.
- Superseded verification: active v8.3 docs now keep the stateless replay constraints, but no longer treat AI SDK 6 or direct-provider usage as blockers.
- Verification: `git diff --check -- tasks/todo.md tasks/v8.3 docs/steel-openai-oauth-responses-setup.md docs/steel_librechat_plan_v8.3_openai_oauth_responses_primary.md` passed.

# V8.3 Phase 1 Foundation And OAuth Proxy Start

- [x] Record the Phase 1/2 start decisions and user corrections before implementation.
- [x] Inspect existing LibreChat model/default setting, role/admin, route registration, and data-provider patterns before adding Steel-specific seams.
- [x] Update v8.3 phase/checkpoint docs if live code inspection shows the plan needs narrower integration wording.
- [x] Write failing tests for Steel shared DTO contracts and model option/provider capability types.
- [x] Implement the minimal `packages/data-provider/src/steel` public contracts and endpoint/key helpers needed for Phase 1.
- [x] Write failing tests for Steel Mongo schemas, including `steel_` collection names, guest token hash lookup, provider run metadata, and capability smoke result shape.
- [x] Implement minimal Steel Mongo schemas in `packages/data-schemas` without full business behavior.
- [x] Write failing tests for Steel access decisions around `STEEL_GUEST_MODE`, LibreChat ADMIN/USER role handling, and admin route denial for guests.
- [x] Implement Steel access helpers and thin route shells under `/api/steel` and `/api/admin/steel`.
- [x] Write failing tests for backend-owned Steel model options that reuse LibreChat model/default setting concepts where available.
- [x] Implement minimal model option service and provider metadata contracts, keeping `openai_oauth_responses` as the early priority path and `openai_api` as capability-gated secondary.
- [x] Add an early OpenAI OAuth proxy smoke/test seam that can be exercised before full workbook orchestration.
- [x] Keep Phase 2 source-schema mapping changes narrow; treat ERP XLSX columns as stable append-only and tolerate new columns while preserving required-key validation.
- [x] Run focused verification: data-provider build/tests, data-schemas tests/build, packages/api Steel tests/build, and `git diff --check`.
- [x] Record review evidence and remaining next tasks in this file.

## Active Decisions

- Work stays on the current branch.
- Phase 1 implementation comes first: contracts, schemas, routes, auth/role access, audit, provider metadata, and early OAuth proxy seam.
- Phase 2 mapping/schema design can proceed in parallel, but this pass should not make broad Supabase schema changes.
- Model allowlist/default model behavior must adapt to LibreChat's existing model/default setting framework before adding Steel-only behavior.
- Admin route authorization should first use existing LibreChat account role semantics for ADMIN vs USER.
- ERP XLSX fields are basically stable and append-only; future files may add columns but should not rename existing columns.
- OpenAI OAuth as proxy must be developed and tested early enough to guide later workbook and provider adjustments.

## Review

- Implemented the first Phase 1 foundation slice only: shared Steel DTO/provider contracts, endpoint/key helpers, minimal Mongo schema definitions, access helpers, LibreChat model-option adaptation, OpenAI OAuth proxy client seam, and thin `/api/steel` plus `/api/admin/steel` route shells.
- Updated v8.3 docs for the locked corrections: adapt model/default settings through LibreChat first, use existing ADMIN/USER route semantics first, treat ERP XLSX columns as stable append-only, and prioritize an early `openai_oauth_responses` proxy seam.
- Added focused red-first coverage before implementation in `packages/data-provider`, `packages/data-schemas`, `packages/api`, and `api/server/routes`.
- Verification passed for focused Steel tests: data-provider `src/steel/ai.spec.ts` and `src/steel/workbooks.spec.ts`; data-schemas `src/schema/steel.spec.ts`; packages/api `src/steel/access.spec.ts`, `models.spec.ts`, and `oauth.spec.ts`; API route smoke `server/routes/__tests__/steel.spec.js`.
- Verification passed for package builds: `npm run build:data-provider`, `npm run build:data-schemas`, and `npm run build:api`.
- Remaining Phase 1 work: full conversation route behavior, guest token issuance/hash persistence, workbook orchestration schemas beyond public DTOs, audit service wiring, real capability persistence, and real OpenAI OAuth provider smoke. No Supabase schema or migration was changed in this slice.

# V8.3 OpenAI OAuth Responses Package Sync

- [x] Record the v8.3 docs/package scope and user corrections before editing.
- [x] Create the full `tasks/v8.3/` package from the current phase-plan structure.
- [x] Update active v8.3 planning docs for `openai_oauth_responses`, capability-gated fallback keys, and primary/secondary smoke gates.
- [x] Create `tasks/v8.3/source-schema-mapping.md` focused on database-bound spec and price fields, with Chinese ERP sheet names kept for workbook/export interoperability.
- [x] Update mobile Workbook Preview selected-target behavior to support multiple selected targets with clear sheet/field markers.
- [x] Reconcile setup/env/context/ADR docs with the v8.3 decisions.
- [x] Run focused grep/diff verification.
- [x] Record review results.

## Review

- Created the full `tasks/v8.3/` package: README, checkpoints, phases 0-6, and `source-schema-mapping.md`.
- Updated active v8.3 docs around `openai_oauth_responses` as primary and `openai_api` as capability-gated secondary. Removed active v8.3 OpenHarness-era wording from the new package.
- Standardized fallback config to the five requested keys: `STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED`, `STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED`, `STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED`, `STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED`, and `STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED`.
- Updated `.env.example` and added `docs/steel-openai-oauth-responses-setup.md`; left `docs/steel-chatgpt-oauth-setup.md` as a short superseded pointer.
- Reworked `tasks/v8.3/source-schema-mapping.md` to focus on DB-bound spec, price, formula, and processing-price fields. Chinese workbook sheet names are documented as ERP-facing output labels, not database keys.
- Captured the formula-reference correction: `docs/reference/公式編號 - Sheet1.csv` is a development reference for formula naming/structure; runtime calculator data should come from reviewed app-ready JSON or database rows.
- Updated mobile Workbook Preview planning so a message can carry multiple selected targets. Markers must show sheet and field/cell position; selection overwrites the marker before user text and appends a new marker after user text.
- Updated `CONTEXT.md` with `ERP Workbook Sheet Name` and `Selected Workbook Target`, and added ADR `docs/adr/0001-openai-oauth-responses-primary.md`.
- Updated `tasks/lessons.md` with the correction patterns.
- Verification: focused stale-term grep over active v8.3 docs found no OpenHarness, stale fallback env, stale v8.3 spec filename, `docs/reference/doc`, or single-selected-cell limit.
- Verification: required fallback keys are present in `.env.example`, the openai-oauth setup runbook, the v8.3 spec, task package, and lessons.
- Verification: selected-target checks found multiple-target and sheet/field marker wording in the v8.3 spec, checkpoints, and Phase 3 plan.
- Verification: `git diff --check` passed.

# V8.2 Responses Fallback And Inline Warning Sync

- [x] Record the focused sync scope before editing docs/env examples.
- [x] Update the verified v8.2 spec so `openai_api` is Responses-first and explicit API reroute is env-gated.
- [x] Update `tasks/v8.2` so OAuth unsupported capabilities return typed errors when OpenAI API reroute is disabled.
- [x] Update UI guidance from toast to inline small warning text in the chat transcript.
- [x] Add Steel AI provider/reroute keys to `.env.example`.
- [x] Run focused grep/diff verification.
- [x] Record review results.

## Review

- Answer to Q1: yes, this belongs in both `docs/steel_librechat_plan_v8.2_openharness_verified.md` and `tasks/v8.2` because it changes the provider contract, runtime gates, env behavior, and UI surface.
- Updated the verified v8.2 spec so `openai_api` is Responses-first, preserves LibreChat UI/preset/agent model parameters as requested runtime settings, and uses capability preflight before provider calls.
- Replaced silent fallback language with env-gated API reroute: `STEEL_OPENAI_API_FALLBACK_ENABLED=false` returns typed unsupported errors in local/dev; `true` allows direct reroute to `openai_api` before calling OAuth.
- Updated UI guidance from toast to inline small warning text inside the chat transcript.
- Added Steel AI provider/reroute keys to `.env.example`, including `STEEL_OPENAI_API_FALLBACK_ENABLED=false`, `STEEL_OPENAI_API_RESPONSES_REQUIRED=true`, and `STEEL_PROVIDER_UNSUPPORTED_NOTICE_STYLE=inline_chat_warning`.
- Updated `tasks/v8.2` README, checkpoints, Phase 0, Phase 1, Phase 2, Phase 3, and Phase 6 to match the new contract.
- Updated `docs/steel-chatgpt-oauth-setup.md` so unsupported OAuth capabilities either return typed errors or reroute only when env-enabled.
- Updated `tasks/lessons.md` with the pattern: OpenHarness must not bypass LibreChat settings, and unsupported provider capabilities should use typed errors plus inline chat warning text.
- Verification: required anchors for Responses-first, capability preflight, typed unsupported errors, inline small warning text, and the new env keys are present.
- Verification: stale env/key/path phrases such as `STEEL_OPENAI_API_FALLBACK=true`, `STEEL_FALLBACK_ON_...`, `openai-api-fallback`, and direct fallback policy phrases returned no matches in active spec/task/env docs.
- Verification: `git diff --check` passed.

# V8.2 Admin Route And Setup Runbook Sync

- [x] Record the focused sync scope before editing docs.
- [x] Update the verified v8.2 spec so admin-only Steel routes use `/api/admin/steel/...`.
- [x] Update `tasks/v8.2` phase/checkpoint docs to match the admin route split.
- [x] Add local admin/user account setup runbook.
- [x] Add ChatGPT OAuth binding prerequisite runbook.
- [x] Run focused grep/diff verification.
- [x] Record review results.

## Review

- Updated the verified v8.2 spec API route draft so quote/user routes stay under `/api/steel/...`, while admin diagnostics, source/project management, import/table/memory controls, and eval runs use `/api/admin/steel/...`.
- Updated Phase 3, Phase 5, checkpoints, and README gates so ChatGPT OAuth binding is a prerequisite before real OpenHarness smoke or chat UI live testing, and admin-only source/eval routes are under `/api/admin/steel/...`.
- Added `docs/steel-account-setup.md` with the local admin/user creation flow and the current LibreChat first-registered-user role rule.
- Added `docs/steel-chatgpt-oauth-setup.md` with token-storage rules, binding flow, smoke order, fallback expectations, and evidence requirements.
- Verification: stale route grep for `/api/steel/admin`, `/api/steel/projects`, `/api/steel/sources`, `/api/steel/source-versions`, and `/api/steel/evals` returned no matches across the verified spec and `tasks/v8.2`.
- Verification: required anchors for `/api/admin/steel`, setup docs, ChatGPT OAuth binding, and first-user role behavior are present.
- Verification: `git diff --check` passed.

# V8.2 Phase 0 OpenHarness Lock Pass

- [x] Read `tasks/v8.2/phase-0-decisions.md` after the OpenHarness-verified replan.
- [x] Lock D0.1-D0.15 as the active Phase 0 decision baseline.
- [x] Mark `tasks/v8.2/checkpoints.md` Checkpoint 0 as passed.
- [x] Run focused Phase 0 consistency verification.
- [x] Record review results.

## Review

- Phase 0 is now locked after the OpenHarness-verified v8.2 replan.
- `tasks/v8.2/phase-0-decisions.md` no longer says Phase 0 is superseded.
- `tasks/v8.2/checkpoints.md` Checkpoint 0 is marked passed and its baseline items are checked.
- Focused verification confirmed required anchors for fixed seven-sheet workbook, SteelAIProvider/OpenHarness/OpenAI fallback capability policy, ERP XLSX/Admin upload boundaries, source schema mapping, and the absence of stale old-spec/OpenAI-only planning terms.
- No implementation code was changed; this was the documentation/decision gate required before Phase 1 implementation planning.

# V8.2 OpenHarness Verified Replan

- [x] Read `CLAUDE.md`, `CONTEXT.md`, `tasks/lessons.md`, `docs/steel_librechat_plan_v8.2_openharness_verified.md`, and the current `tasks/v8.2` package.
- [x] Update `tasks/v8.2` to use the OpenHarness-verified Steel AI Provider framework instead of the old OpenAI-first framing.
- [x] Remove stale references to `docs/steel_librechat_plan_v8.2.md` and point the task package at the verified spec file.
- [x] Add provider driver, capability smoke, fallback, model allowlist, file/vision/XLSX evidence, state-trace, and production-risk gates to the phase plans and checkpoints.
- [x] Run focused document consistency checks across `tasks/v8.2`.
- [x] Record review results.

## Review

- Updated `tasks/v8.2/README.md` to point at `docs/steel_librechat_plan_v8.2_openharness_verified.md` and define the OpenHarness-verified phase map.
- Updated Phase 0 with `SteelAIProvider`, `openharness_chatgpt_oauth` default, `openai_api` fallback, provider state boundaries, capability smoke, model selector, and fallback decisions.
- Updated Phase 1 to include AI driver/model/capability/run metadata contracts without implementing full provider behavior yet.
- Updated Phase 2 to keep tools provider-neutral so OpenHarness and OpenAI adapters only serialize tool definitions.
- Rewrote Phase 3 around `SteelAIProvider`, OpenHarness OAuth adapter, OpenAI API fallback adapter, unified `SteelAIEvent`, capability gates, fallback routing, backend model allowlist, and both live provider smoke cases.
- Split the old Phase 4/5 shape into `phase-4-excel-export.md`, `phase-5-admin-source-management.md`, and `phase-6-production-hardening.md`, matching the new spec's phase structure.
- Updated `tasks/v8.2/checkpoints.md` so checkpoints require provider capability smoke, typed provider errors, fallback evidence, and both OpenHarness OAuth plus OpenAI API fallback smoke before Phase 4.
- Focused consistency checks passed: no stale references to `docs/steel_librechat_plan_v8.2.md`, old phase file names, or OpenAI-only Phase 3 adapter/state gates remain in `tasks/v8.2`.

# V8.2 Spec Upgrade

- [x] Read current v8.1 plan package, Supabase schema, and project glossary before writing v8.2.
- [x] Create `steel_librechat_plan_v8.2.md` in Traditional Chinese as an executable development spec.
- [x] Remove external database/enterprise connector planning and replace old import wording with ERP XLSX / Admin Import wording.
- [x] Add Admin ERP XLSX upload policy, seven fixed Workbook sheets, Quote Resolution Engine, eval harness, interfaces, API routes, schemas, and production checklist.
- [x] Verify required v8.2 terms are present and removed v8.1 planning terms are absent.
- [x] Rename `tasks/v8.1` to `tasks/v8.2` and update the phase plans to match `steel_librechat_plan_v8.2.md`.
- [x] Verify `tasks/v8.2` no longer contains stale v8.1-only import, workbook, PDF, or connector assumptions.
- [x] Apply user correction: remove Admin PDF parser/transformation planning and restrict ongoing Admin data uploads to ERP XLSX only.

## Review

- User supplied the v8.2 handoff as the approved design baseline. The task is to consolidate it into one implementation-ready spec file, not to implement runtime code yet.
- Created `steel_librechat_plan_v8.2.md` with 30 core sections plus API route, Mongo schema, Supabase schema, Admin preview, UX, and production checklist drafts.
- Verification checked required v8.2 anchors, TypeScript interface draft names, fixed seven-sheet names, Admin ERP XLSX upload policy, ExcelJS, Supabase PostgreSQL, and removed old connector/import planning terms.
- Renamed the phase-plan package from `tasks/v8.1` to `tasks/v8.2` and rewrote README, checkpoints, and phases 0-5 around v8.2.
- Phase plans now include Admin ERP XLSX upload policy, ERP XLSX Admin Import, fixed seven-sheet Workbook, Quote Resolution Engine, normalization, price search/ranking, stock allocation, deterministic calculators, ExcelJS export, Admin preview, table UI maintenance, handbook-informed schema boundary, and eval harness gates.

# V8.2 Dev Planning Package

- [x] Read `CLAUDE.md`, `CONTEXT.md`, `tasks/lessons.md`, and `docs/plan_v8.1.md`.
- [x] Inventory current Steel implementation state before planning new work.
- [x] Create phase-based dev plans under `tasks/v8.2/`.
- [x] Add checkpoints, acceptance criteria, verification commands, and PM decision gates.
- [x] Verify the plan package covers all major v8.2 modules and current repo constraints.
- [x] Record planning review results.

## Review

- `docs/plan_v8.1.md` is an architecture and feature planning doc, not an implementation-ready task breakdown.
- Current implemented Steel code is still narrow: `packages/api/src/steel/postgres.ts`, its unit test, the initial Supabase schema/migration, and local-dev docs.
- Existing domain glossary already defines `Canonical Product`, `Product Alias`, `Spec Candidate`, `Preference Rule`, and `Clarification`; the dev plan must preserve those terms.
- This pass should not import or process `docs/reference/doc` source files during planning; later correction scoped the steel handbook DOCX as a schema/data-model reference.
- The requested output location is now `tasks/v8.2/`, so this planning package intentionally uses that path instead of the generic `docs/plans/` convention.
- Created the v8.2 plan package: `README.md`, phase 0-5 plan files, and `checkpoints.md`.
- User corrected guest mode: quote conversation/workbook/export access must be controlled by an environment flag. Enabled means no login or permission required; disabled means login plus admin-approved Steel permission required.
- Grill-with-docs resolved the guest mode default: `STEEL_GUEST_MODE` defaults to `false` and fails closed unless explicitly set to `true`.
- Phase 0 high-risk decisions are now recorded through the export library decision.
- Grill-with-docs resolved the OpenAI state contract: Responses API calls use `conversation` only; `previous_response_id` is mutually exclusive with `conversation` and is stored only for audit/fallback.
- User corrected quote traceability: workbook lines must persist the related formula, database default unit price, quoted unit price, line total, and explicit unit-price/total-price adjustments as permanent workbook data.
- Grill-with-docs resolved workbook price stability: latest database unit price is only the default for new pricing or explicit recalculation; existing workbook prices, quantities, and totals must not change unless the user asks to change that line.
- v8.2 Admin data updates use admin-uploaded ERP export XLSX files; rows missing confirmed ERP lookup keys go to `needs_review`.
- Grill-with-docs resolved retrieval strategy: Steel uses its own PostgreSQL + pgvector retrieval module so required project/source/version/chunk/category/guest filters are enforced server-side.
- Grill-with-docs resolved customer Excel mask: allow only customer quote fields using `quoted_unit_price` and `line_total` for visible prices, and hide `customer_tier` plus internal/debug fields.
- Grill-with-docs resolved async boundary: first prove a real OpenAI chat can create a customer-visible workbook; keep MVP small flows synchronous with payload/timeout limits and defer BullMQ to Phase 5 unless measured scale forces it earlier.
- Grill-with-docs resolved source data readiness: ongoing real data updates flow through ERP XLSX upload or Admin table UI review, then backend API commit; steel handbook DOCX first informs schema/data-model design.
- Current dependency check found `openai@5.8.2` only in the legacy `api` package, and `xlsx@0.20.3` but no `exceljs`; Phase 4 must add ExcelJS deliberately to the backend package that owns customer-facing export rendering.
- Grill-with-docs resolved export rendering: use ExcelJS for customer-facing XLSX output, while keeping `xlsx` for admin import parsing and generated workbook read-back tests unless implementation proves consolidation is better.
- The plan covers all final v8.2 modules through phase ownership: conversation meta, projects, sources, instructions, handbook-informed schema boundary, Admin ERP XLSX source parsing, Admin table maintenance, Admin import, AI merge table, tool registry, OpenAI orchestrator, prompt builder, Quote Resolution Engine, normalization, pricing, stock allocation, calculators, workbook, Excel export, memory, retrieval, evals, audit, repositories, permissions, and async jobs.
- User clarified Phase 0 should not require a live OpenAI smoke test; live provider verification belongs to Phase 3's quote workbook vertical slice.
- User clarified Admin data import flow: export XLSX from ERP, upload through parser, compare with old data, admin confirm, then update the database.
- User clarified DOCX scope again: code agent should first use the steel handbook DOCX to design schema/data model; chat UX development is priority; real handbook data SQL/import implementation comes later.
- User clarified current reference data state: files in `docs/reference/doc` are not database-ready; AI/code agents may reference them for schema and API mock data while prioritizing chat UX, with real data handling deferred.
- User clarified API mock data placement: keep mock data in one shared folder, not separate frontend/backend folders.
- User accepted the API mock export boundary: import mock fixtures through `packages/data-provider/src/steel/mock/`, not the production Steel data-provider barrel.
- User accepted the Phase 3 UI boundary: build an independent Steel workspace first, and use one shared desktop/mobile Steel UX framework rather than separate mobile workflow.
- User clarified mobile workbook UX: open workbook as a full-view modal with top-right close, allow one selected workbook cell to populate a composer marker, submit one structured ref plus user text to AI, and sync returned workbook patches back to the UI.
- User clarified workbook edit targeting: Phase 3 supports one selected cell at a time; workbook data can still be modified across multi-round chat, or by natural-language requests that describe multiple explicit changes for AI to translate into validated patch ops.
- User rejected per-patch preview/confirmation because it slows chat UX; latest accepted workbook updates should be marked by background color on the changed fields.
- User chose latest-update highlight lifetime: keep highlighted changed fields until the next accepted workbook patch replaces them.
- User clarified failed/rejected AI patches should not highlight workbook fields; show the reason in chat and leave workbook/highlight state unchanged.
- User rejected explicit Undo UI; revert/change requests should go through chat and create normal validated workbook patches.
- User accepted short chat summaries for successful AI workbook patches; list changed fields briefly, but do not show a full diff table in chat.
- User accepted contract ownership: public workbook DTOs live in `packages/data-provider/src/steel/workbooks.ts`, backend canonical Zod validation lives in `packages/api/src/steel/workbook/schema.ts`, and frontend/mock data consume shared DTOs without owning workbook validation schema.
- User clarified Chinese source data handling: `docs/reference/doc` is Chinese, so Phase 2 needs a schema mapping from Chinese source labels/headers/terms to English canonical schema keys; programmatic DTO/API/tool/repository/DB query contracts should use English keys while Chinese remains as display/source/alias data.
- User corrected reference-data framing: `docs/reference/doc` can be used to design the real Steel schema/data model, not only mock fixtures; real data SQL/import is deferred to a later code-agent data task that starts from correct data.
- User resolved source-schema mapping decisions: create `tasks/v8.2/source-schema-mapping.md`; do not add typo approval/review-status fields because later code-agent data work should already use correct data; teach AI API the mapping so it can resolve correct schema keys; keep mock data schema-realistic; and design a code-owned source-schema mapping module alongside real schema design.

# Steel Dev Preflight Setup

- [x] Read `docs/plan_v8.1.md` database boundary and local dev notes.
- [x] Check local Postgres configuration without printing secrets.
- [x] Resolve Step 1: choose the canonical PostgreSQL target for schema import.
- [x] Resolve Step 2: verify Supabase SQL access and pgvector extension readiness.
- [x] Create `supabase/schema.sql` as the complete Steel Supabase schema snapshot.
- [x] Create an initial one-change SQL file under `supabase/migration/`.
- [x] Update project agent docs with the schema snapshot plus migration rule.
- [x] Apply `supabase/migration/202605230001_initial_steel_schema.sql` in Supabase SQL Editor.
- [x] Verify Steel Supabase schema objects after initial migration.
- [x] Inventory `docs/reference/doc` source files before planning data import.
- [x] Verify Steel Supabase trigger/function wiring.
- [x] Smoke-test `updated_at` and `price_history` behavior inside a rollback transaction.
- [x] Resolve the first non-data engineering preflight target.
- [x] Add `pg` as the Steel backend Postgres client dependency.
- [x] Add a test-first Steel Postgres connection helper in `packages/api`.
- [x] Verify the helper can perform a read-only Supabase smoke query through `STEEL_POSTGRES_URL`.
- [x] Decide Supabase pooler TLS behavior for local backend development.
- [ ] Decide Supabase CA-backed `verify-full` policy for deployed backend environments.

## Review

- `docs/plan_v8.1.md` requires MongoDB for LibreChat/application state and PostgreSQL `steel` schema for structured steel business data.
- `.env` already has a non-empty `STEEL_POSTGRES_URL`.
- The development database target is Supabase Postgres via `STEEL_POSTGRES_URL`; Docker is intentionally out of scope for this setup.
- The MongoDB target is the configured cloud MongoDB via `MONGO_URI`; Docker MongoDB is intentionally out of scope.
- `psql` CLI is not currently available on PATH.
- Supabase SQL access is verified by the user; `vector` extension exists at version `0.8.0` in the `public` schema.
- Supabase CLI is not currently available on PATH, so the initial migration filename is created directly rather than via `supabase migration new`.
- Added `supabase/schema.sql` and `supabase/migration/202605230001_initial_steel_schema.sql`; both currently contain the same initial Steel schema.
- Updated `AGENTS.md` and `CLAUDE.md` so code agents must update the full schema snapshot and add a one-change migration together.
- Supabase SQL Editor reported the initial migration succeeded with no returned rows.
- `source_embeddings.embedding` was verified as PostgreSQL `vector`.
- `docs/reference/doc` contains company reference inputs: `龍頂鋼鐵手冊__文字版.docx` is now scoped as a schema/data-model reference; `公式編號.xlsx`, `客戶資料.xlsx`, `產品價格.xlsx`, and `系統訂單.xlsx` remain reference/import fixtures unless promoted through ERP XLSX import.
- Runtime AI should query normalized database/tool results, not directly inspect XLSX/DOCX reference files for prices or specs.
- The `steel` schema table list contains all 21 expected base tables.
- Trigger wiring is present: `price_items` has `record_price_history`, and every table with an `updated_at` column has `set_updated_at`.
- Rollback smoke test proved `price_items.unit_price` updates write `steel.price_history` with `old_unit_price`, `new_unit_price`, and `last_import_log_id`.
- Do not process or import `docs/reference/doc` files as real data in the chat UX priority path; steel handbook DOCX may inform schema/data-model design, while real data SQL/import comes later.
- Current dependency check: `packages/api` has `zod` and `ioredis`; no Postgres client dependency is present yet. `openai` is currently only declared in the legacy `api` package.
- Ambiguous customer terms such as `常用的` should resolve through admin-taught preference rules/memory, not hard-coded product-table defaults such as `is_default`.
- For incomplete price questions with multiple matching specs, AI should ask for the missing spec detail and may show all candidate prices, e.g. t8 and t12, in NTD.
- User approved `pg` for the Steel backend Postgres access layer.
- Added `pg` runtime dependency for `api`, `pg` peer dependency for `packages/api`, and `@types/pg` for `packages/api`.
- Added `packages/api/src/steel/postgres.ts` with `STEEL_POSTGRES_URL` config, conservative pool defaults, and a read-only readiness query.
- The focused Steel Postgres unit test passes, and `npm run build:api` completes without TypeScript warnings.
- Read-only live smoke is blocked because the current `STEEL_POSTGRES_URL` uses a direct Supabase host that does not resolve from this environment; use Supavisor session pooler for IPv4-compatible local development.
- To reduce future upstream merge conflicts, Steel code should stay in additive project-specific paths; premature root exports/core entrypoint edits should be avoided until runtime integration needs them.
- After switching `STEEL_POSTGRES_URL` to the Supavisor session pooler, DNS resolves to IPv4 and the read-only helper smoke query returns `steelSchemaExists=true`, `steelTableCount=21`, and `vectorExtensionVersion=0.8.0`.
- Additional SSL introspection returned `ssl=false`; treat Supabase pooler TLS/CA verification as a separate explicit preflight decision before production deployment.
- Testing `?sslmode=require` alone with the current Node `pg` stack fails with `self-signed certificate in certificate chain` because current `pg-connection-string` treats `require` like `verify-full`.
- Testing `?sslmode=require&uselibpqcompat=true` succeeds for the read-only Supabase smoke query, but production should still prefer explicit CA-backed `verify-full` once the Supabase CA certificate is configured.
- `.env` now uses the Supavisor session pooler with `sslmode=require&uselibpqcompat=true`, and the Steel Postgres helper smoke query passes.

# V8.2 Phase 0 Lock Pass

- [x] Collect all remaining Phase 0 questions in one pass.
- [x] Record user approval for the Phase 0 lock answers.
- [x] Update `tasks/v8.2/phase-0-decisions.md` with the final lock review.
- [x] Run Checkpoint 0 focused verification.

## Review

- User approved all final Phase 0 lock answers.
- Phase 0 is locked with D0.1-D0.14 as the decision baseline.
- Phase 1 implementation should stay narrow around contracts, auth/permission gates, route shells, audit, and foundational schema seams.
- Phase 2 should extend `tasks/v8.2/source-schema-mapping.md`, design `packages/api/src/steel/schema/mapping.ts`, and derive the minimal Supabase schema delta from handbook/mapping work.
- Phase 3 mock data may proceed with locked canonical keys without waiting for full mapping coverage.
- Checkpoint 0 verification passed for fixed workbook sheets, ERP XLSX/DOCX boundary, ExcelJS/Quote Resolution/Eval Harness anchors, and source-schema mapping anchors.
- `docs/local-dev.md` documents the local Steel `STEEL_POSTGRES_URL` pooler format.

# Frontend Dev Build Check

- [x] Review project workflow docs and root npm scripts.
- [x] Trace `frontend:dev` dependencies through workspace package manifests.
- [x] Identify the minimal required build command sequence.
- [x] Run the selected build commands.
- [x] Smoke-test `npm run frontend:dev` startup and document results.

# `/api/config` Proxy Check

- [x] Reproduce the `/api/config` proxy failure.
- [x] Check whether backend is listening on port 3080.
- [x] Build missing `client/dist` required by backend startup.
- [x] Start or repair the backend dev server.
- [x] Verify `/api/config` through the frontend proxy.
- [x] Document the final run commands.

# Local Dev Docs Update

- [x] Create `docs/local-dev.md` for the verified local frontend/backend dev command sequence.
- [x] Replace the detailed `CLAUDE.md` sequence with a pointer to `docs/local-dev.md`.
- [x] Verify the docs mention the `client/dist/index.html` backend startup requirement.
- [x] Record the docs update result.

# LibreChat Config Startup Fix

- [x] Confirm `librechat.yaml` is required at the repo root unless `CONFIG_PATH` is set.
- [x] Create a minimal `librechat.yaml`.
- [x] Verify backend startup passes the missing YAML error.
- [x] Note the separate MeiliSearch warning cause.

# Disable Local MeiliSearch

- [x] Confirm which env vars control MeiliSearch plugin and index sync.
- [x] Disable local MeiliSearch in `.env`.
- [x] Verify backend starts without Meili fetch errors.
- [x] Update `docs/local-dev.md` with the precise disable settings.

## Review

- `.env` contains `MONGO_URI` and `STEEL_POSTGRES_URL` keys; values were not printed.
- Minimal build path for `npm run frontend:dev`: `npm run build:data-provider && npm run build:client-package`.
- `npm run build:data-provider` completed successfully.
- `npm run build:client-package` completed successfully and recreated `packages/client/dist`.
- `npm run frontend:dev` started Vite successfully on `http://localhost:3090/`; a direct HTTP probe returned `200 OK`.
- The final npm lifecycle error came from intentionally stopping the smoke-test process after startup verification.
- Later `/api/config` proxy error root cause: backend was not listening on port 3080.
- Direct backend startup showed MongoDB connected, then backend exited because `/Users/neven/Documents/projects/LibreChat/client/dist/index.html` was missing.
- `npm run build:client` completed successfully and created `client/dist/index.html`.
- After `npm run backend:dev`, `http://localhost:3080/health`, `http://localhost:3080/readyz`, and `http://localhost:3080/api/config` returned `200`.
- With `npm run frontend:dev` running too, `http://localhost:3090/api/config` returned `200` through the Vite proxy.
- Smoke-test backend/frontend processes launched by Codex were stopped after verification.
- Added `docs/local-dev.md` with the verified command sequence and `/api/config` proxy troubleshooting note.
- Updated `CLAUDE.md` to point to `docs/local-dev.md`.
- Created a minimal root `librechat.yaml` with `version: 1.3.11`.
- Verified `npm run backend:dev` starts after adding `librechat.yaml`; `http://localhost:3080/health` and `http://localhost:3080/api/config` returned `200`.
- Documented local `librechat.yaml` and MeiliSearch log handling in `docs/local-dev.md`.
- Disabled local MeiliSearch by setting `SEARCH=false`, clearing `MEILI_HOST` and `MEILI_MASTER_KEY`, and setting `MEILI_NO_SYNC=true` in `.env`.
- Verified backend startup after disabling MeiliSearch: `http://localhost:3080/api/config` returned `200`, and captured startup logs had no `mongoMeili`, `indexSync`, or `fetch failed` lines.

# Backend Dev Logger Dependency Fix

- [x] Reproduce the dependency resolution failure from the reported require stack.
- [x] Confirm `packages/data-schemas/dist/config/winston.cjs` directly requires `winston-daily-rotate-file`.
- [x] Move `winston-daily-rotate-file` into `packages/data-schemas` runtime dependencies.
- [x] Keep `winston` as a compatible peer of the existing backend `winston@3.11.0`.
- [x] Verify logger import, dependency tree, package build, and backend HTTP readiness.

## Review

- Root cause: `@librechat/data-schemas` directly imports `winston-daily-rotate-file`, but the package was only declared as a peer and only installed under sibling `api/node_modules`, which Node cannot resolve from `packages/data-schemas/dist`.
- Added root lockfile entries for `winston-daily-rotate-file` and its missing transitive `object-hash` package so workspace resolution works from `data-schemas`.
- `npm ls winston winston-daily-rotate-file --depth=0` passes.
- `npm run build:data-schemas` passes.
- `npm run build:api` passes with the pre-existing Redis `KeyvRedis` TypeScript warning in `packages/api/src/cache/cacheFactory.ts`.
- Existing backend process on `http://localhost:3080` returns `200` for `/api/config`.

# Frontend Dev Workspace Peer Dependency Fix

- [x] Reproduce Vite dependency scan failure for `framer-motion` and `@react-spring/web`.
- [x] Confirm the imports originate from `packages/client/dist/index.es.js`.
- [x] Add Vite aliases for workspace peer dependencies provided by the frontend app.
- [x] Add missing `react-window` dependency required by `react-vtree`.
- [x] Rebuild `packages/client`.
- [x] Smoke-test `npm run frontend:dev` on an alternate port.

## Review

- Root cause: Vite resolves `@librechat/client` through the workspace package realpath, so peer imports from `packages/client/dist` do not automatically see packages installed under sibling `client/node_modules`.
- Added `WORKSPACE_PEER_ALIASES` in `client/vite.config.ts` for `@react-spring/web`, `framer-motion`, and `react-window`.
- Added `react-window@^1.8.11` to `client/package.json` because `react-vtree@3.0.0` imports `react-window` as a peer and its v3 code expects the v1 list exports.
- `npm run build:client-package` passes.
- `PORT=3091 npm run frontend:dev` starts without dependency scan errors; `http://localhost:3091/steel/oauth-chat` and `http://localhost:3091/api/config` both returned `200`.

# Steel OAuth Chat Auth Path Fix

- [x] Reproduce the `/api/steel/ai/chat` 401 behavior.
- [x] Distinguish LibreChat JWT 401 from OpenAI OAuth provider auth failure.
- [x] Confirm local `~/.codex/auth.json` can be loaded without exposing token material.
- [x] Identify `.env` literal `$HOME/.codex/auth.json` as the provider auth failure root cause.
- [x] Add backend expansion for `~`, `$HOME`, `${HOME}`, `$CODEX_HOME`, and `${CODEX_HOME}` in `STEEL_OPENAI_OAUTH_AUTH_FILE`.
- [x] Remove the active local default `STEEL_OPENAI_OAUTH_AUTH_FILE` from `.env`.
- [x] Keep a commented hosted/server example in `.env.example` for GCP-style mounted secret files.
- [x] Prevent failed assistant turns from being sent back to the provider on the next Steel test-page submit.

## Review

- `openai-oauth-provider` real-auth manual spec passes with local `~/.codex/auth.json`.
- Direct built-handler smoke with `STEEL_OPENAI_OAUTH_AUTH_FILE=$HOME/.codex/auth.json` expands to `/Users/neven/.codex/auth.json` and returns `steel-expanded-auth-ok`.
- Focused package API tests pass: `config.spec.ts`, `handlers.spec.ts`, and `provider.spec.ts`.
- Focused data-provider Steel AI contract tests pass.
- API Steel route shell tests pass.
- `npm run build:api` passes with only the pre-existing Redis `KeyvRedis` TypeScript warning in `packages/api/src/cache/cacheFactory.ts`.
- `docs/steel-openai-oauth-responses-setup.md` now documents GCP/server deployment via an absolute path to a mounted `auth.json`.

# Steel OAuth Chat Waiting State Fix

- [x] Reproduce the exact prompt through the built provider adapter.
- [x] Confirm direct OAuth provider returns `steel-librechat-oauth-ok` instead of hanging.
- [x] Confirm unauthenticated `/api/steel/ai/chat` still returns LibreChat JWT `401 No auth token` quickly.
- [x] Identify provider-auth HTTP `401` as a bad boundary for the frontend because Axios treats every 401 as a LibreChat session refresh trigger.
- [x] Change Steel provider failures to HTTP `502` while preserving `errorCategory: auth` for provider-auth failures.
- [x] Add regression coverage for provider auth failures not using browser session refresh semantics.
- [x] Rebuild `packages/api/dist`.

## Review

- Built provider smoke for `Reply exactly: steel-librechat-oauth-ok` returned the exact text with usage and response ID.
- Provider auth failure smoke now returns HTTP `502` with `errorCategory: auth`, avoiding the global frontend JWT refresh interceptor.
- `packages/api` focused Steel tests pass.
- `npm run build:api` passes with only the pre-existing Redis `KeyvRedis` TypeScript warning in `packages/api/src/cache/cacheFactory.ts`.
- Backend must be manually restarted after this fix because root nodemon ignores `packages/` changes.

# Frontend Dev Health Proxy Fix

- [x] Confirm authenticated frontend health checks call `/health`.
- [x] Confirm backend owns `/health` and `/readyz` on port 3080.
- [x] Add Vite dev proxy entries for `/health` and `/readyz`.
- [x] Update local dev docs with frontend proxy health probes.
- [x] Smoke-test `/health`, `/readyz`, and `/api/config` through a Vite dev server.

## Review

- Root cause: Vite dev server proxied `/api` and `/oauth`, but not backend health endpoints, so `/health` could fall through to the frontend router/cache layer.
- `PORT=3091 npm run frontend:dev` returned backend `200 OK` for `http://localhost:3091/health` and `http://localhost:3091/readyz`.
- `http://localhost:3091/api/config` still returns `200 OK` through the existing `/api` proxy.

# Balance Route Missing Record Fix

- [x] Reproduce unauthenticated `/api/balance` route behavior to distinguish route absence from missing user balance data.
- [x] Confirm logged-in `404` comes from `Balance not found`, not Vite proxy routing.
- [x] Reuse existing balance initialization middleware on `/api/balance`.
- [x] Add focused regression coverage for `/api/balance` initialization.
- [x] Run focused tests and diff checks.

## Review

- Root cause: `/api/balance` existed, but it only read the user's balance record. Existing users could get `404 Balance not found` after balance was enabled because initialization only ran during auth flows.
- Added the existing `createSetBalanceConfig` middleware to `/api/balance` before the balance controller, so a missing record can be initialized on first balance read when balance is enabled and `startBalance` is configured.
- `cd api && npx jest server/routes/__tests__/balance.spec.js --runInBand` passes.

# Steel OAuth Chat UI Live Smoke

- [x] Confirm local backend and frontend dev ports are available.
- [x] Start `npm run backend:dev` and verify `http://localhost:3080/api/config`.
- [x] Start `npm run frontend:dev` and verify `http://localhost:3090/api/config`.
- [ ] Open `http://localhost:3090/steel/oauth-chat` in a browser session.
- [ ] Submit `亞L30x30 一支多少？` and check for bounded options plus a highest-confidence provisional quote.
- [ ] Submit the follow-up `先用錏成型角鐵30*2.5*6M，第1級價格。` and check that the same conversation updates the selected candidate.
- [ ] Submit the H 型鋼 cutting/slotting/hole prompt and check the processing quote explanation.

## Review

- User interrupted the automated browser smoke before Playwright execution.
- Backend `npm run backend:dev` and frontend `npm run frontend:dev` were stopped with SIGINT.
- Shutdown verification passed: `lsof` found no listeners on ports `3080` or `3090`, and the residual process check found no `nodemon`, `vite`, Playwright, or headless Chrome process.

# Steel DB-Backed Quote Rules and Merged Lookup Tool

- [x] Update docs before implementation: design `steel.instruction_packets`, `lookup_quote_rules`, and Admin-updatable rule boundaries.
- [x] Add a lesson that editable Steel quoting rules must not stay hard-coded in provider/tool code.
- [x] Write RED repository/tool tests for DB-backed instruction packets and merged instructions/defaults lookup.
- [x] Generate a Supabase migration with `npx supabase migration new`.
- [x] Update `supabase/schema.sql` and the new migration together.
- [x] Seed current reviewed instruction packets from the existing static runtime packets into SQL.
- [x] Implement `steel.instruction_packets` repository retrieval.
- [x] Implement `lookup_quote_rules` and route legacy `lookup_instructions` through the DB-backed repository.
- [x] Update provider instructions to prefer `lookup_quote_rules` before category-dependent lookup.
- [x] Verify focused Jest, `packages/api` build, Prettier check, and `git diff --check`.

## Review

- RED evidence: focused Jest initially failed because `./instructions` repository was missing and `lookup_quote_rules` was not implemented.
- GREEN evidence so far: focused repository/tool Jest passed 25/25; provider policy/tool-loop Jest passed 12/12.
- Implemented `steel.instruction_packets` as Admin-editable DB rows, with idempotent SQL seed for 10 reviewed active packets. Applied the migration SQL to the configured Steel Postgres from `.env`; live DB verification returned 10 reviewed active packet slugs.
- Live DB group-order verification: `c-type-quote-core` returns `c-type-basic-quote-zh-v1`, `price-source-priority-zh-v1`, `formula-code-selection-zh-v1`, `drawing-processing-detection-zh-v1`; `h-type-quote-core` returns `h-type-length-surcharge-zh-v1`, `h-and-i-beam-cutting-price-zh-v1`, `cut-count-and-trim-detection-zh-v1`.
- Final verification: focused repository/tool/provider Jest passed 37/37; full `packages/api/src/steel` Jest passed 30 suites / 142 tests; `npm run build:api` exited 0 with only existing non-Steel Rollup TypeScript warnings; touched-file Prettier check passed; `git diff --check` passed.
- Follow-up live smoke: updated `provider.catalog-oral.manual.spec.ts` so the C/H/angle oral quote smoke cases require `lookup_quote_rules` instead of legacy `lookup_instructions`. Real OAuth C 型鋼 smoke passed with `STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST=true`: true `gpt-5.5` called `lookup_quote_rules` before `search_price_candidates`, lookup arguments included `c_type`, and the successful positive price lookup arguments included `c_type`, `100x2.3`, and `錏輕型鋼`.

# Steel Product Price Unit Weight Calculation Rule

- [x] Capture user corrections in `tasks/lessons.md`, including C 型鋼
      `kg_per_m` pricing and product-name parenthetical weight fallback.
- [x] Update agent/runtime instructions so AI treats product-price unit price,
      price `unit`, and unit weight correctly.
- [x] Update instruction packet docs with product-price unit weight calculation
      rules.
- [x] Add a follow-up Supabase migration to update reviewed
      `steel.instruction_packets` and existing `steel.price_items` unit
      semantics.
- [x] Apply the migration to the configured Steel Postgres and verify returned
      C 型鋼/H 型鋼/白鐵平鐵 rows include the corrected rule semantics.
- [x] Add deterministic tests so `lookup_quote_rules` returns the new rule for
      C 型鋼 and provider policy mentions the calculation boundary.
- [x] Run focused Jest, full Steel Jest, importer dry-run, API build, Prettier,
      and `git diff --check`.

## Review

- Added migration `20260604140123_steel_product_price_unit_weight_rules.sql`.
  It fixes existing `steel.price_items` by separating `unit` from
  `product_price_unit_weight_unit`, imports validated product-name parentheses
  as weight-per-piece evidence, and upserts
  `product-price-unit-weight-calculation-zh-v1`.
- Updated the reference importer so future `產品價格.xlsx` updates recalculate
  the same semantics. Verified fixtures:
  `CCG10023` -> `unit=kg`, `kg_per_m`, `4kg/m`; `EHS121206` ->
  `unit=kg`, `kg_per_piece`, `142kg/支`; `EIS20080` -> `unit=piece`,
  `kg_per_piece`, `19.7kg/支`, source origin `product_name_parentheses`.
- Live DB verification matched those three rows and confirmed the instruction
  packet contains both the C 型鋼 `NT$600-643.2` example and the
  `白鐵平鐵 50 *8.0( 19.7)` bracket-weight example.
- Live C 型鋼 OAuth smoke initially caught a real search-normalization
  regression: AI supplied `specKeyContains=100x2.3`, but backend normalization
  replaced it with full-section `100x50x20x2.3`. Added a regression so compact
  C 型鋼 fragments win over full-section `specKey`; the live smoke then passed
  with real `openai_oauth_responses` and real Steel DB.
- Verification passed: focused Jest 4 suites / 50 tests, full Steel Jest 30
  suites / 143 tests, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  `npm run steel:import-reference-data -- --dry-run`, `npm run build:api` exit
  0 with existing non-Steel Rollup TypeScript warnings, Prettier write, and
  `git diff --check`.

## Follow-up Audit

- [x] Compare `docs/reference/產品價格.xlsx` expected steel row semantics against
      live `steel.price_items`.
- [x] Confirm non-steel rows are not treated as steel price-calculation rows.
- [x] Confirm agent/runtime instructions contain the unified price calculation
      logic.
- [x] Confirm live `steel.instruction_packets` has the latest reviewed rule.
- [x] Confirm docs contain the same rule and source examples.

### Review

- Reapplied the current reference importer to Supabase from
  `docs/reference/產品價格.xlsx`. Apply verification returned 27,024
  `price_items`, 6,756 product codes, 2,256 customers, 238 cutting prices, 31
  formula versions, and 29 quote defaults.
- Reapplied migration
  `20260604142955_steel_product_price_weight_rule_scope.sql` after importer
  apply so live `steel.instruction_packets` and existing price rows use the
  final scope/weight rules.
- Live DB audit after importer + migration: 0 null `catalog_family` rows, 0
  null `category_id` rows, 198 catalog families used by product-price rows,
  2,912 steel/material product codes, 1,339 steel/material product codes with
  usable weight evidence, 0 non-material product codes with steel weight
  semantics, and 0 material/non-material scope misses.
- Sample rows verified: `CCG10023` C 型鋼 is `c_type`, `unit=kg`,
  `4kg/m`; `EHC150706` 輕量H is `h_beam`, `53kg/支`; `BNH0054020` is
  `plate`, `9.79kg/支`; `ERB06060` 6K鐵軌 is `rail`, `unit=piece`,
  `36kg/支`, with parenthetical `38` preserved only as contradiction metadata;
  `AVA0414` 彈簧 and `HNU0846` 消光 remain non-material scope with no steel
  unit-weight semantics.
- Live instruction packet `product-price-unit-weight-calculation-zh-v1` now
  includes non-material scope, 輕量H, BNH, 6K鐵軌/2090 piece-total guard,
  related-material proportional inference, and selectors for
  `metadata.sourceParentheticalUnitWeight`.
- Verification passed after formatting: full `packages/api/src/steel` Jest 30
  suites / 143 tests; `npm run steel:import-reference-data -- --dry-run`;
  `npm run steel:import-reference-data -- --apply`; `npm run build:api` exit 0
  with existing non-Steel Rollup TypeScript warnings.

# Steel C 型鋼 6M Live Price Smoke

- [x] Query live `steel.price_items` for `C型鋼 C100x50x20x2.3t 6M`.
- [x] Run a real `gpt-5.5` OAuth provider/tool-loop smoke for the same prompt.
- [x] Fix c_type compact-spec guard when AI labels include both `100x2.3` and
      the full section text.
- [x] Correct the C 型鋼 example arithmetic from `NT$150-160.8` to
      `NT$600-643.2`.
- [x] Reapply the DB instruction correction migration.
- [x] Re-run the real OAuth provider/tool-loop smoke.
- [x] Run full Steel Jest, API build, and diff checks.

## Review

- Initial DB query returned the correct reviewed rows: `CCG10023 錏輕型鋼
100*2.3`, `unit=kg`, `unitPrice=25-26.8`, `productPriceUnitWeight=4kg/m`.
  Therefore `4kg/m * 6M = 24kg`, and the 6M piece amount is
  `NT$600-643.2`.
- Initial real OAuth smoke failed: `gpt-5.5` called `lookup_quote_rules`, but
  `search_price_candidates` validation rejected the useful `100x2.3` candidate
  after extracting a false expected fragment `100x50` from a mixed label.
- Fix: `getExpectedCTypeCompactSpec` now extracts numbers only from the matched
  full-section substring, so a mixed label like `錏輕型鋼 100x2.3 /
C100x50x20x2.3` no longer creates a false `100x50` requirement.
- Reapplied migration `20260604145800_steel_c_type_price_math_correction.sql`.
  Live DB verification: instruction packet has `NT$600-643.2` and no
  `NT$150-160.8`.
- Re-run real OAuth smoke passed: first tool was `lookup_quote_rules`; a
  subsequent positive `search_price_candidates` call returned reviewed
  `CCG10023 錏輕型鋼 100*2.3`, `unit=kg`, `unitPrice=25-26.8`, `4kg/m`; final
  response said `4 * 6 = 24kg`, A/B/C/F amounts `624 / 643.2 / 612 / 600`
  TWD/支, and did not mention the old `150-160.8` amount.
- Verification after the fix: focused `execute.spec.ts` / live-smoke fixture
  Jest passed 24/24, full `packages/api/src/steel` Jest passed 30 suites / 143
  tests, `npm run build:api` exited 0 with existing non-Steel Rollup TypeScript
  warnings, and `git diff --check` passed.

# Steel C 型鋼 Default Tier And Material Follow-Up

- [x] Capture correction at that time: missing customer/tier must not filter by
      A/tier 1. This has since been superseded by the next section's global
      B-tier lookup rule.
- [x] Capture correction: first C 型鋼 material-unknown reply must show
      same-spec material options, and a later follow-up with no alternate
      material should confirm the default 錏輕型鋼 assumption.
- [x] Update runtime policy, instruction-packet fixture, docs, and lessons.
- [x] Add Supabase data migration for the reviewed C 型鋼 instruction packet.
- [x] Apply the migration to Steel Postgres and verify live
      `lookup_quote_rules`.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Live DB verification after
  `20260604152413_steel_c_type_b_tier_material_followup.sql` confirmed
  `c-type-basic-quote-zh-v1` contained the then-current B-price/default-material
  wording. The unknown-tier lookup behavior from this review is superseded by
  the next section's global B-tier lookup rule.
- Runtime policy now says price-type oral orders must follow
  `category key -> lookup_quote_rules -> search_price_candidates -> answer`.
  It also tells AI not to invent `customerId` / `customerTierId` when
  `tierKnown=false`.
- Provider runtime at that time restricted the post-rule price round to
  `search_price_candidates` only and prevented repeated A/tier-1 bias loops.
  The customer-tier handling is superseded by the next section.
- Real OAuth smoke passed for `C100x50x20x2.3t 6M 一支多少？` using live
  `gpt-5.5` and live Steel DB. The smoke verified `lookup_quote_rules` happens
  before positive `search_price_candidates`, the positive lookup includes
  `c_type`, `100x2.3`, and `錏輕型鋼`, and the final response contains 24kg
  math, B/default pricing, and material alternatives.
- Verification passed: focused provider Jest 14/14, full Steel Jest 30 suites /
  145 tests, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  `npm run build:api` exit 0 with existing non-Steel Rollup TypeScript warnings,
  and `git diff --check` passed.

# Steel Global Default B Customer Tier

- [x] Confirm live Steel tier ids: B price is `customerTierId = 2`.
- [x] Capture correction: unknown/default customer tier must directly use
      B price lookup, not omit `customerTierId` and let the model choose.
- [x] Update runtime policy, provider guardrail tests, docs, and lessons.
- [x] Add and apply a follow-up Supabase data migration for reviewed
      instruction packet text.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Live DB confirmed customer tier `B` is `steel.customer_tiers.id = 2`
  (`code = B`, `name = B級`).
- Runtime policy now treats missing customer/tier as unknown customer context
  plus default B price lookup. It still forbids inventing `customerId`, but
  forces `search_price_candidates` to use `customerTierId: 2` until a user
  message or selected customer/tier explicitly overrides it.
- Follow-up migration
  `20260605020554_steel_default_b_customer_tier_instruction.sql` was applied to
  live Steel Postgres. Verification query confirmed
  `c-type-basic-quote-zh-v1` contains `customerTierId 2` and no longer contains
  old omit-tier wording.
- Live DB currently has `steel.instruction_packets` but not
  `steel.agent_instructions`; the every-turn default rule is therefore active
  in provider runtime policy/docs now, and should be moved into
  `steel.agent_instructions` when that Admin-managed table is implemented.
- Updated agent/runtime docs, instruction packet docs, catalog-family data
  contract, tests, and lessons so the rule applies to all products, not just
  C 型鋼.
- Live C 型鋼 OAuth smoke now asserts the positive `search_price_candidates`
  call includes `"customerTierId":2` in addition to `c_type`, `100x2.3`, and
  `錏輕型鋼`.
- Verification passed: focused provider/executor Jest 38/38, full Steel Jest
  30 suites / 145 tests, `npm run build:api` exit 0 with existing non-Steel
  Rollup TypeScript warnings, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  and `git diff --check` passed.

# Steel Default B Customer Notice

- [x] Capture correction: if the user did not provide a customer, or no usable
      customer price tier can be found, quote with B by default.
- [x] Capture correction: response must remind the user that 價格B is the
      current default quote price and that a customer name can be used to look
      up that customer's quote price. Superseded by the later concise-response
      correction: current replies should not add highest/most-expensive wording.
- [x] Capture correction: when `search_customers` finds a usable customer tier,
      use that tier instead of overriding it with B.
- [x] Update runtime policy, provider guardrail tests, docs, and lessons.
- [x] Add and apply a follow-up Supabase data migration for reviewed
      instruction packet text.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Runtime policy now distinguishes fallback B from found customer tiers. If the
  user provides no customer or `search_customers` cannot find a usable tier,
  price lookup uses `customerTierId: 2`; if `search_customers` finds one usable
  customer tier, that tier is carried into price lookup instead of being
  overwritten by B.
- Provider guardrail tests cover both branches: unknown customer/tier defaults
  to B, and a found customer A-tier lookup stays A instead of becoming B.
- Follow-up migration
  `20260605021828_steel_default_b_customer_notice.sql` was applied to live
  Steel Postgres. Verification query confirmed live
  `c-type-basic-quote-zh-v1` had the B default and customer-name follow-up
  notice. The later concise-response migration supersedes the highest/most
  wording and makes current replies name `價格B` only.
- Verification passed: focused provider/executor Jest 39/39, full Steel Jest
  30 suites / 146 tests, `npm run build:api` exit 0 with existing non-Steel
  Rollup TypeScript warnings, opt-in C 型鋼 OAuth smoke 1 passed / 4 skipped,
  and the live smoke checked `價格B`, customer reminder, and `customerTierId: 2`.

# Steel Concise Quote And Workbook Summary

- [x] Capture correction: first quick-price response should be shorter. For B
      default, say `目前用 價格B：26.8 元/kg`; do not add highest/most-expensive
      wording.
- [x] Capture correction: do not list `單位重` as a separate bullet when the
      response already shows total piece weight, e.g.
      `6M 一支重量：4 × 6 = 24 kg`.
- [x] Capture correction: after a later workbook update such as
      `客戶是龍頂`, the assistant must explain the new information and changed
      workbook fields, not only say `已更新 workbook：N 個欄位`.
- [x] Update runtime policy, workbook patch instruction, docs, tests, and
      lessons.
- [x] Add and apply a follow-up Supabase data migration for reviewed
      instruction packet text.
- [x] Re-run focused Jest, full Steel Jest/build checks, and live OAuth smoke.

## Review

- Runtime policy now tells the model to write the fallback B notice as
  `目前用 價格B：26.8 元/kg`, mention customer-name lookup separately, and avoid
  highest/most-expensive wording unless the user explicitly asks for ranking.
- Quick-price formatting now avoids a separate `單位重` bullet when the same
  response already shows total piece weight. The preferred shape is
  `6M 一支重量：4 × 6 = 24 kg`, followed by B unit price and line subtotal.
- Workbook patch guidance now requires a short Traditional Chinese summary of
  newly interpreted information and workbook fields changed after
  `patch_workbook` succeeds; field-count-only replies such as
  `已更新 workbook：16 個欄位` are explicitly blocked.
- Follow-up migration
  `20260605025616_steel_concise_quote_workbook_summary.sql` was applied to live
  Steel Postgres. Verification query confirmed live `c-type-basic-quote-zh-v1`
  contains the short B notice, the no-highest/most rule, the no-separate-unit-
  weight rule, and the workbook-summary rule.
- Live C 型鋼 OAuth smoke with real `openai_oauth_responses` and real Supabase
  passed after updating the assertion to accept `價格B`: the model responded
  with `目前用 價格B：26.8 元/kg`, `6M 一支重量：4 × 6 = 24 kg`, no `最高` /
  `最貴`, and no separate `單位重` bullet.
- Verification passed: focused provider/executor Jest 39/39, full Steel Jest
  30 suites / 146 tests, `npm run build:api` exit 0 with existing non-Steel
  Rollup TypeScript warnings, and opt-in C 型鋼 OAuth smoke 1 passed /
  4 skipped.

# Steel Response Wording And Provider Progress Research

- [x] Capture correction: change response wording from
      `reviewed 價格：26.8 元/kg` to `價格：26.8 元/kg`.
- [x] Reproduce and fix the workbook follow-up bug where `客戶是龍頂` only
      returns `已更新 workbook：N 個欄位`.
- [x] Research official OpenAI Responses API streaming/progress surfaces to
      determine whether the UI can show model reasoning/progress beyond
      `Waiting for provider`.
- [x] Update runtime/docs/tests/lessons and reviewed instruction packet data
      where needed.
- [x] Run focused tests, Steel tests, live smoke or endpoint repro, and diff
      hygiene before reporting results.

## Review

- Reproduced the workbook bug with a failing handler regression: when provider
  text is only `已更新 workbook：19 個欄位`, the handler previously returned that
  field-count-only text even though `changedFieldSummary` contained customer,
  tier, and price changes.
- Fixed the handler fallback so field-count-only workbook replies are replaced
  with a concise summary containing `本輪新增資訊` and `主要改動`, sourced from
  backend-applied `changedFieldSummary`.
- Runtime policy and live smoke now reject `reviewed 價格` as a user-facing
  price bullet label. Current rule is to show `價格：<單價>` and move
  reviewed/source status into source or note text.
- Added migration
  `20260605031930_steel_price_label_and_workbook_summary.sql` and applied it
  to live Steel Postgres. Verification query confirmed the reviewed
  `c-type-basic-quote-zh-v1` packet has the price-label rule, the
  `reviewed 價格` blocking rule, and the workbook-summary rule.
- OpenAI Responses API research: official docs say raw reasoning tokens are not
  exposed, but reasoning summaries can be opted in. Streaming Responses API
  events can expose progress such as response lifecycle, output text deltas,
  function-call argument deltas, code interpreter/file search progress, and
  reasoning summary deltas when summaries are enabled.
- Current `/steel/oauth-chat` uses a plain Axios POST to `/api/steel/ai/chat`;
  the backend provider adapter calls `doGenerate`, which aggregates the internal
  stream before returning. Progress UI therefore needs a new streaming endpoint
  and client path; the current UI can only show `Waiting for provider`.
- Verification passed: RED handler regression failed on the exact
  field-count-only response; GREEN handler regression passed; focused
  handler/provider/executor Jest passed 58/58; full Steel Jest passed
  30 suites / 147 tests; `npm run build:api` exited 0 with existing non-Steel
  Rollup TypeScript warnings; opt-in C 型鋼 OAuth smoke passed 1 enabled case /
  4 skipped and rejects `最高|最貴`, `單位重`, and `reviewed 價格`.
- Follow-up screenshot diagnosis: the source and `packages/api/dist/index.js`
  already contained the workbook-summary fallback, but the running backend on
  port 3080 had started before the rebuild and still held the old handler in
  memory. Restarted backend dev server so `/steel/oauth-chat` now loads the
  updated dist.

# Steel Workbook Patch Concise Summary

- [x] Capture correction: workbook patch fallback should not show a detailed
      diff list. It should only report interpreted order information and a key
      change summary.
- [x] Update handler fallback and regression tests so long fields such as search
      keywords and candidate item lists do not appear in chat.
- [x] Update lessons and rerun focused/backend verification before restarting
      the backend for manual retest.

## Review

- Handler fallback now emits a concise workbook reply with interpreted order
  information and a key-change summary, without per-field diffs, long search
  keywords, or long candidate item lists.
- Provider prompts, tool-result guidance, docs, and the reviewed C 型鋼
  instruction packet now all state that successful `patch_workbook` replies
  should summarize only order information and key workbook changes.
- Applied migration
  `supabase/migration/20260605034146_steel_workbook_patch_concise_summary.sql`
  to the live Steel Supabase database; SQL verification confirmed the
  instruction packet includes the concise summary rule and blocks per-field
  diff / long candidate text.
- Verification before backend restart: focused handler/provider Jest passed
  34/34; full `packages/api/src/steel` Jest passed 30 suites / 147 tests;
  `npm run build:api` exited 0 with existing non-Steel Rollup TypeScript
  warnings.
- Final local verification: Prettier completed for touched files;
  `git diff --check` and untracked migration whitespace checks passed; restarted
  the backend dev server so port 3080 loads the rebuilt `@librechat/api` dist;
  `GET /api/config` on 3080 and `/steel/oauth-chat` on 3090 both returned 200.

# Steel Quote Field And Requote Summary

- [ ] Capture correction: `報價明細` should use `小計` as the unified quote
      amount field. Do not add a separate duplicate `報價` column; keep
      `材料費` as a material-cost component when needed.
- [ ] Ensure customer/tier follow-up workbook updates also update and report
      the new quote amount, not only customer/tier/unit-price fields.
- [ ] Update provider/tool guidance, docs, lessons, and tests; then rerun
      focused/full verification and restart the backend dev server.

## Review

- Pending verification.

# Steel Workbook Xlsm Reference Template

- [x] Inspect `docs/reference/訂單參考.xlsm` sheet order, labels, headers, and
      populated reference rows.
- [x] Add failing tests proving workbook initialization cannot use the old blank
      seven-sheet template.
- [x] Capture correction: `訂單參考.xlsm` is a development reference only; runtime
      workbook initialization must use code constants and must not read the file.
- [x] Update workbook initialization constants to mirror `訂單參考.xlsm` sheet
      order, visible labels, headers, and seed rows while preserving stable
      English sheet ids.
- [x] Run focused/full verification, rebuild shared packages, and do not restart
      the dev server in this pass.

## Review

- Implemented workbook initialization as a code-owned template in
  `packages/api/src/steel/workbook/template.ts`; `docs/reference/訂單參考.xlsm`
  remains a development reference only and is not read by runtime
  initialization.
- Verification: `packages/api npx jest src/steel/workbook/service.spec.ts
--runInBand --coverage=false` passed 6 tests; `packages/api npx jest
src/steel --runInBand --coverage=false` passed 30 suites / 149 tests;
  `packages/data-provider npx jest src/steel/workbooks.spec.ts --runInBand
--coverage=false` passed 5 tests; `client npx jest
src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false` passed 8
  tests; `npm run build:data-provider` passed; `npm run build:api` exited 0
  with existing non-Steel Rollup/TypeScript warnings; `git diff --check`
  passed.
- No dev server was restarted in this pass.

# Steel Ai Subtotal Workbook Patch Verification

- [x] Verify AI/chat response behavior includes concise `小計` quote information
      after workbook patch application.
- [x] Verify workbook patch data lands in the expected visible sheets/columns,
      including `報價明細.小計`, pricing source fields, and interpretation notes.
- [x] Add or update regression coverage if existing tests only check field-count
      summaries or incomplete workbook fields.
- [x] Run focused verification without restarting the dev server.

## Review

- Added a handler regression using a real in-memory workbook service and a
  simulated model `patch_workbook` tool call. The response fallback now has
  test coverage for `小計：624`, and the returned workbook is asserted to contain
  matching cells in `報價明細.line_1`, `價格來源.source_1`, and
  `判讀備註.note_1`.
- Verification: `packages/api npx jest src/steel/handlers.spec.ts --runInBand
--coverage=false` passed 20 tests; `packages/api npx jest src/steel
--runInBand --coverage=false` passed 30 suites / 150 tests; `npm run
build:api` exited 0 with existing non-Steel Rollup/TypeScript warnings; `git
diff --check` passed.
- Live AI supplement: gated real OAuth C 型鋼 oral smoke passed with
  `STEEL_OPENAI_OAUTH_C_TYPE_ORAL_TEST=true`, real `gpt-5.5`, and real Steel DB
  tools. It verified `lookup_quote_rules` before c_type price lookup and the
  `100x2.3` candidate path. This live smoke validates AI judgment/tool sequence;
  workbook field application is covered by the handler regression above.
- No dev server was restarted in this pass.

# Steel Live Workbook Patch Manual Smoke

- [x] Add a gated real OAuth manual smoke for `patch_workbook`.
- [x] Verify the true model emits workbook patch operations for `報價明細`,
      `價格來源`, and `判讀備註`.
- [x] Verify the patch includes `報價明細.小計` for the provisional quote amount.
- [x] Update the OAuth Responses runbook with the exact opt-in command and
      expected evidence.
- [x] Run focused manual smoke verification without restarting the dev server.

## Review

- RED evidence: running `provider.catalog-oral.manual.spec.ts` with
  `STEEL_OPENAI_OAUTH_WORKBOOK_PATCH_TEST=true` initially failed because the
  old oral helper returned no `response.workbookPatch.operations`.
- Added a gated live workbook-patch smoke that uses real OAuth `gpt-5.5` and
  the real provider loop, while supplying deterministic reviewed
  `lookup_quote_rules` / `search_price_candidates` results inside the test.
- The smoke verifies the sequence `lookup_quote_rules`, then
  `search_price_candidates`, then `patch_workbook`, and asserts workbook
  operations for `報價明細.line_1`, `價格來源.source_1`, `判讀備註.note_1`,
  including `報價明細.小計` around `643.2`.
- GREEN evidence: `STEEL_OPENAI_OAUTH_WORKBOOK_PATCH_TEST=true` live smoke
  passed: 1 passed / 5 skipped in `provider.catalog-oral.manual.spec.ts`.
- Focused default verification: running the same manual spec without opt-in
  flags skipped all 6 tests, so routine runs do not call the live API.
- No dev server was restarted in this pass.

# Steel Streaming Chat Prototype

- [x] Add a focused design for `POST /api/steel/ai/chat/stream` as an NDJSON
      prototype scoped to `/steel/oauth-chat`.
- [x] Add RED tests for stream event schemas, backend stream route behavior, and
      UI progress rendering.
- [x] Implement the backend stream handler and route shell without changing the
      existing non-streaming chat route.
- [x] Add data-provider endpoint/types/client helper for parsing stream events.
- [x] Update `SteelOAuthChat` to show lookup/tool/progress states while the
      provider is running.
- [x] Run focused backend/data-provider/client verification and record the
      results.

## Design Check-In

- Scope: prototype only for the Steel smoke route. Keep `/api/steel/ai/chat`
  unchanged, and add `/api/steel/ai/chat/stream` for streaming diagnostics.
- Wire format: `application/x-ndjson`; each line is one JSON event so `POST`
  payloads work with `fetch` streaming.
- Event contract: `progress` for coarse phases, `lookup` for lookup tools,
  `tool` for non-lookup tool calls and workbook patch application, `text` for
  assistant text, `done` for the final normalized chat response, and `error`
  for provider/workbook failures after headers are open.
- Backend behavior: parse and validate the same chat payload as the normal
  route, write initial progress events, pass a wrapped `executeSteelToolCall`
  into the provider so lookup/tool start and completion events reflect real
  tool calls, apply workbook patches through the same backend validation, then
  emit `text` and `done`.
- UI behavior: keep the current chat layout, but replace the generic
  `Waiting for provider` line with a compact status timeline showing the latest
  progress, lookup, tool, and workbook-patch events. Fall back to the existing
  non-stream request only if streaming is unavailable.

## Review

- Added `POST /api/steel/ai/chat/stream` as an authenticated NDJSON stream route
  while keeping the existing `/api/steel/ai/chat` response route unchanged.
- Added shared `SteelProviderChatStreamEvent` contract and
  `dataService.streamSteelChat`, which reads one JSON event per line and returns
  the final `done.response`.
- Backend stream events now include request/provider progress, real
  `executeSteelToolCall` lookup/tool start/completion events, backend
  `patch_workbook` application status, text, done, and post-header error events.
- `/steel/oauth-chat` now sends through `streamSteelChat` and keeps a compact
  status timeline visible after completion until the next send/new chat.
- RED evidence: focused tests first failed for missing
  `steelProviderChatStreamEventSchema`, missing `handlers.streamChat`, router
  404, and UI not calling/rendering stream statuses.
- Verification passed: `packages/data-provider npx jest src/steel/ai.spec.ts
--runInBand --coverage=false` passed 10 tests; `packages/api npx jest
src/steel/handlers.spec.ts --runInBand --coverage=false` passed 21 tests;
  `client npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand
--coverage=false` passed 9 tests; `api npx jest
server/routes/__tests__/steel.spec.js --runInBand --coverage=false` passed 10
  tests; `npm run build:data-provider` passed; `npm run build:api` exited 0
  with existing non-Steel TypeScript warnings; `git diff --check` passed.
- `client npm run typecheck` still fails on existing broad repo errors such as
  `src/a11y/LiveMessage.tsx`, Agents tests, ArtifactRouting tests, MCPBuilder,
  Web citations, and other unrelated files. The output did not report a
  `SteelOAuthChat.tsx` error.
- No dev server was restarted in this pass.

# Steel OAuth Chat Empty Workbook, Quote Rules Defaults, And IME Enter

- [x] Verify why `/steel/oauth-chat` new workbook initializes with populated
      quote data instead of an empty user-editable workbook.
- [x] Add failing regression coverage that new runtime workbooks keep sheet
      structure/headers but no quote/customer/material data rows.
- [x] Extend `lookup_quote_rules` so one call can return instruction/default
      data for one or more catalog/material keys, making `lookup_defaults`
      unnecessary for this flow when rules are requested together.
- [x] Add failing regression coverage for batched `lookup_quote_rules` returning
      defaults for multiple material/catalog keys.
- [x] Fix `/steel/oauth-chat` textarea Enter behavior so 注音/IME composition
      confirmation does not submit the chat.
- [x] Run focused backend/data-provider/client verification, rebuild affected
      shared packages, and record evidence.

## Review

- Root cause: runtime workbook initialization reused code-owned reference rows
  copied from `docs/reference/訂單參考.xlsm`; patch validation also required rows
  to already exist, so a truly empty workbook needed row creation on accepted
  patch. `lookup_quote_rules` already merged defaults structurally, but
  `lookupSteelDefaults()` filtered out contexts without workbook `lineRefs`.
  The textarea submitted because Enter handling ignored IME composition state.
- Implementation: new workbooks now keep the seven sheet/column structure but
  start with zero rows; validated workbook patches may create missing target
  rows such as `line_1`; `lookup_quote_rules` returns quote defaults for
  matched material/catalog contexts even when `lineRefs` are absent; runtime
  prompt/tool descriptions prefer `lookup_quote_rules` for merged
  instruction/default lookups; `/steel/oauth-chat` blocks Enter submit during
  composition.
- Verification: RED tests failed for populated initial rows, missing-row patch
  rejection, no-rowRef quote defaults, and IME Enter submit. GREEN verification
  passed: `packages/api jest` for `workbook/service.spec.ts`,
  `tools/execute.spec.ts`, `ai/provider.spec.ts`, and `handlers.spec.ts`
  passed 70 tests; `client jest src/routes/SteelOAuthChat.spec.tsx` passed 10
  tests; `git diff --check` passed; `npm run build:api` exited 0 with existing
  non-Steel TypeScript warnings.
- Runtime smoke: backend `/api/steel/workbooks` returned version 1 with 0 rows
  in all seven sheets. Live cloud Supabase `executeSteelTool(lookup_quote_rules)`
  for `c_type` + `h_beam` returned instruction packets plus four quote defaults.
  Headless `/steel/oauth-chat` smoke showed 0 rows on every tab and composition
  Enter left textarea value unchanged with 0 stream requests.

# Steel Catalog-Key Lookup Enforcement And Stream Reasoning UI

- [x] Confirm whether current provider/tool guard allows oral material text to
      skip `lookup_catalog_families` and jump directly to `lookup_quote_rules`.
- [x] Add RED provider coverage that oral material/category price requests must
      call `lookup_catalog_families` before `lookup_quote_rules`, then use the
      selected catalog keys for rule/price/formula lookups.
- [x] Add RED stream/UI coverage for reasoning summary events and a Codex-like
      Steel stream status panel.
- [x] Implement backend stream event contract for provider-visible reasoning
      summaries when the model/provider returns them; do not expose or invent raw
      chain-of-thought.
- [x] Implement a compact Codex-like stream status UI that shows reasoning
      summaries, tool lookups, progress, and errors in a readable timeline.
- [x] Run focused API/data-provider/client verification, build affected shared
      outputs, and record runtime smoke evidence if possible.

## Review

- Confirmed gap: the previous runtime could show
  `lookup_quote_rules started/completed` before `lookup_catalog_families`; the
  provider guard only enforced quote rules before category-dependent price
  tools, not catalog vocabulary lookup before rules.
- Implemented catalog-first runtime policy for reviewed quick-price requests:
  the first required tool set is now restricted to `lookup_catalog_families`,
  then the AI can select catalog keys and call `lookup_quote_rules`, followed by
  `search_price_candidates`.
- Added provider-visible reasoning summary streaming. The UI displays summaries
  only when the model/provider returns them; it does not expose or invent raw
  chain-of-thought.
- Verification: data-provider stream contract Jest passed 10 tests;
  API provider/handler Jest passed 40 tests; client `/steel/oauth-chat` Jest
  passed 10 tests; `npm run build:data-provider` passed; `npm run build:api`
  passed with existing non-Steel Rollup TypeScript warnings; `git diff
--check` passed.
- `npm --workspace client run typecheck` still fails on existing broad client
  errors outside this slice. A filtered rerun found no `SteelOAuthChat`,
  `steel/ai`, `SteelProviderChatStreamEvent`, or `streamSteelChat` matches in
  the typecheck errors.
- Live `/steel/oauth-chat` smoke was not rerun in this pass; the backend was not
  restarted.

# Steel OAuth Chat Live C-Type Smoke After Dev Restart

- [x] Stop existing backend/frontend dev servers and verify ports 3080/3090 are clear.
- [x] Restart backend and frontend dev servers from the current checkout.
- [x] Open `/steel/oauth-chat`, send a C 型鋼 quick-price prompt, and verify the
      live stream status includes `lookup_catalog_families` before
      `lookup_quote_rules` and `search_price_candidates`.
- [x] Record the AI reply and whether the quoted C 型鋼 subtotal is still
      calculated from kg/m _ meters _ B/customer price.

## Review

- Created and verified reusable smoke login `steel-smoke@example.test` for
  `/steel/oauth-chat`; use this account instead of registering random users for
  manual smoke runs.
- First smoke reproduced a real runtime blocker: the tool order correctly began
  with `lookup_catalog_families`, but cloud Postgres failed with
  `Connection terminated due to connection timeout`.
- Root cause evidence: direct TCP to the configured Supabase pooler `5432`
  timed out; `6543` was reachable, and read-only Postgres queries succeeded
  when the runtime used the `6543` URL plus explicit `ssl: true`.
- Updated the Steel Postgres pool config to pass explicit `ssl: true`; rebuilt
  `packages/api/dist`; restarted backend with a `6543` Steel Postgres runtime
  override. Read-only `steel.catalog_families` query returned 211 rows.
- Live `/steel/oauth-chat` smoke using the fixed account completed. Status order
  included `lookup_catalog_families completed` before `lookup_quote_rules`,
  then `search_price_candidates`, `lookup_formula`, and `patch_workbook`.
- AI response quoted the C 型鋼 subtotal correctly: 錏輕型鋼 `100*2.3`,
  `4 kg/m * 6m = 24 kg`, `價格B 26.8 元/kg`, 小計 `NT$643.2/支`, with 白鐵
  alternative `NT$2,400/支`.
- Workbook v2 `報價明細` row was written with `材料類別 c_type / C型鋼`,
  `材料單價 26.8`, `材料計價單位 kg`, `計價數量 24`, and `小計 643.2`.

# Steel OAuth Chat Final Answer And Full Workbook Patch Fix

- [x] Reproduce and trace why `/steel/oauth-chat` can show completed tool status without replacing the visible progress area with the final answer.
- [x] Add failing UI coverage that final text is visible and completed stream status is not the primary visible result after a successful stream.
- [x] Trace workbook patch behavior for quick-price C 型鋼 and identify why `系統訂單`, `總結`, `人工複核清單`, and `給客戶用` stay empty.
- [x] Add failing workbook/handler coverage that a successful quick-price patch fills all required workbook sheets, not only `報價明細`, `價格來源`, and `判讀備註`.
- [x] Implement the smallest code changes that satisfy those contracts.
- [x] Run focused client/API/data-provider tests, rebuild shared packages if needed, and record verification evidence.

## Review

- Root cause: `/steel/oauth-chat` rendered the stream status panel whenever
  `streamEvents.length > 0`, so a completed stream could leave tool status as
  the visible final UI even after the assistant answer arrived.
- Root cause: the provider workbook instructions still told the model to patch
  only `報價明細`, `價格來源`, and `判讀備註` for provisional quick prices, so
  empty workbooks could leave `系統訂單`, `總結`, `人工複核清單`, and
  `給客戶用` blank.
- Implemented UI completion behavior: stream status is visible only while a
  request is sending; after `done`, the final assistant message replaces it.
- Implemented handler-level workbook patch completion: when a quick quote patch
  includes a calculable `報價明細/小計`, the handler derives missing preview rows
  for `系統訂單`, `總結`, `人工複核清單`, and `給客戶用` without overwriting
  model-provided cells.
- Updated provider instructions/reminder so live AI should patch all seven
  user-relevant workbook sheets for provisional price previews, while labeling
  summary/customer quote totals as `暫估/待確認`.
- Verification: client `SteelOAuthChat.spec.tsx` passed 10 tests; API
  `handlers.spec.ts` passed 22 tests; `npm --workspace packages/api run build`
  passed with existing non-Steel Rollup TypeScript warnings; `git diff --check`
  passed.
- `npm --workspace client run typecheck` still fails on existing broad client
  type errors outside this Steel slice, including `LiveMessage.tsx`, Agents
  tests, artifact attachment types, missing `react-zoom-pan-pinch`, and related
  non-Steel files.

# Steel OAuth Chat Right Panel Thinking Tab

- [x] Add RED client coverage for right panel `Workbook / Thinking` tabs.
- [x] Add RED client coverage that `Thinking` shows only the last run status,
      including provider-visible reasoning summaries, tool events, and errors.
- [x] Rename the workbook `manual_review` visible tab from `人工複核清單` to
      `人工複核` in the workbook UI contract.
- [x] Implement the right panel tab UI without reintroducing completed status
      into the main chat result.
- [x] Run focused client tests and diff checks, then record verification.

## Review

- Implemented right panel tabs named exactly `Workbook` and `Thinking`.
- `Thinking` shows a `Last run` status panel for the latest run only; each new
  submit resets the status list and replaces prior run entries.
- The Thinking panel includes provider-visible reasoning summaries,
  lookup/tool/progress events, and error events. If a request throws without a
  streamed error event, the UI adds a synthetic `unknown` error event using the
  visible error text.
- The main chat still only shows stream status while a request is sending; once
  the request completes, the conversation area shows the assistant answer/error
  and the completed status remains available only in the right panel.
- Renamed the workbook `manual_review` label to `人工複核` in the API workbook
  template, and the frontend preview also maps any older persisted
  `manual_review` sheet to the shorter label.
- Verification: client `SteelOAuthChat.spec.tsx` passed 12 tests; API workbook
  `service.spec.ts` and `repository.spec.ts` passed 8 tests; `npm --workspace
packages/api run build` passed with existing non-Steel Rollup TypeScript
  warnings; `git diff --check` passed.

# Steel OAuth Catalog-Key Tool Flow And Formula Lookup

- [x] Add RED provider coverage that oral catalog lookup results are used to
      force `lookup_quote_rules` before `search_price_candidates`.
- [x] Add RED provider coverage that instruction packets requiring
      `lookup_formula` keep the tool loop open until formula rows are retrieved.
- [x] Add RED provider coverage that a customer name in the first quote request
      allows first-round `search_customers`, then feeds customer context into
      `lookup_quote_rules` and price lookup.
- [x] Update runtime agent instructions/tool gating so selected catalog keys
      feed `lookup_quote_rules`, `search_price_candidates`, and
      `lookup_formula`.
- [x] Run focused provider/tool tests and record verification evidence.

## Review

- Root cause: provider tool gating allowed all Steel tools after
  `lookup_catalog_families`, so a real model could jump directly to
  `search_price_candidates` and reuse `C型鋼` as `productName` instead of first
  using the selected `c_type` key in `lookup_quote_rules`.
- Root cause: the provider only required `search_price_candidates` before a
  quick-price answer. When reviewed rules required `lookup_formula`, a model
  could answer after price lookup without retrieving reviewed formula rows.
- Implemented first-round lookup tools as `lookup_catalog_families` plus
  `search_customers`, so AI can search a provided customer name without code
  deciding which raw words are customer names.
- After catalog lookup, the next required tool set is narrowed to
  `lookup_quote_rules`; after rules, price lookup is required; if returned
  `requiredLookups` includes `lookup_formula`, the loop requires
  `lookup_formula` before accepting the final answer.
- Runtime instructions now tell AI to pass selected customer
  `customerId/customerTierId/customerName` as `customerContext` to
  `lookup_quote_rules`, so customer-scoped defaults/rules can be returned before
  price lookup.
- Updated `docs/steel-catalog-family-data-contract.md` to document the current
  catalog/customer -> quote rules/defaults -> price/formula flow.
- Verification: RED provider tests failed on the old open tool set and missing
  formula completion gate; GREEN `npm --workspace packages/api test --
--runInBand --watch=false src/steel/ai/provider.spec.ts` passed 19 tests.

# Steel AI-Led Workbook Patch Completion

- [x] Add RED provider coverage that workbook patch instructions tell AI to fill derivable blank workbook fields across all user-relevant sheets.
- [x] Add RED provider coverage that a quote_details-only quick quote patch is treated as incomplete and the model must call patch_workbook again with explicit rows for the other user-relevant sheets.
- [x] Implement prompt/runtime guidance so AI fills blank cells only when usable material/customer/source/calculation data exists, otherwise leaves cells blank and records the missing evidence in review/notes.
- [x] Remove or narrow backend hard-fill behavior that conflicts with AI-owned multi-material workbook patching.
- [x] Run focused provider/handler tests, build check, and diff check.

## Review

- Replanned after user correction: multi-material workbook lists need AI to
  generate explicit patch rows from workbook context and tool results. Backend
  should validate/apply/remind, not hard-code derived companion rows.
- Provider prompt now tells AI to fill derivable blank workbook cells across all
  user-relevant sheets, and to leave unavailable facts blank while recording
  missing material/customer/source/calculation evidence in manual review or
  interpretation notes.
- Provider tool loop now marks provisional quick-price workbook patches as
  incomplete when sheets are missing, returns `missingSheetIds`, and requires
  another AI `patch_workbook` call before the final answer.
- Handler no longer derives companion rows from `報價明細`; it validates and
  applies explicit AI patch operations only.
- Documentation updated in `docs/steel-catalog-family-data-contract.md` to make
  workbook patch ownership AI-led and backend hard-fill out of bounds.
- Verification: `provider.spec.ts` passed 19 tests; `handlers.spec.ts` passed
  22 tests; `npm --workspace packages/api run build` passed with existing
  non-Steel Rollup TypeScript warnings; `git diff --check` passed.

# Steel Follow-Up Workbook Patch Completion

- [x] Add RED provider coverage for a follow-up customer/material update that patches quote cells but initially omits companion workbook sheets.
- [x] Extend workbook patch completeness detection so quote/calculation patch operations trigger the missing-sheet loop even when the latest user message is not a price question.
- [x] Keep backend handler as validation/apply only; do not reintroduce hard-coded companion row generation.
- [x] Run focused provider/handler tests, API build, and diff check.

## Review

- Root cause: workbook patch completeness was only required when the latest user
  message looked like a price request. Follow-up updates such as `客戶是龍頂`
  could patch `quote_details` price/customer fields and still end without
  companion rows for `系統訂單`, `總結`, `人工複核`, `價格來源`, `判讀備註`,
  or `給客戶用`.
- Added provider coverage for this exact follow-up path. The RED test failed
  because the model loop stopped after one partial `patch_workbook`; it now
  continues with `missingSheetIds` and requires a second explicit AI patch.
- Implemented a narrow quote-field trigger: in Steel runtime, if AI patches
  quote/calculation fields in `quote_details`, provider applies the same
  workbook completeness loop even when the latest user text is not a price
  question.
- Backend handler remains apply-only for AI operations; no hard-coded companion
  row generation was reintroduced.
- Verification: `provider.spec.ts` passed 20 tests; `handlers.spec.ts` passed
  22 tests; `npm --workspace packages/api run build` passed with existing
  non-Steel Rollup TypeScript warnings; `git diff --check` passed.

# Steel C-Type Rule-Derived Price Lookup Prompt

- [x] Add only generic rule-derived price lookup and invalid-argument retry guidance to `docs/rules/agent規則.txt`.
- [x] Add C 型鋼-specific `productNames` restrictions and `錏輕型鋼` default candidate guidance to `docs/rules/鋼材規則.txt`.
- [x] Sync reviewed Steel rules with dry-run then apply.
- [x] Verify changed text, sync readback, and diff hygiene.

## Review

- Updated `docs/rules/agent規則.txt` with only generic rule-derived
  `search_price_candidates` guidance: use product-name/spec fragments derived
  from reviewed rules, and treat `invalid_arguments` as a parameter correction
  path rather than no-data.
- Updated `docs/rules/鋼材規則.txt` C 型鋼專用規則 with the C 型鋼 / C 鋼 /
  輕型鋼 `productNames` ban and the existing `錏輕型鋼` default direction.
- Synced reviewed Supabase rows with `node packages/api/scripts/sync-steel-rules.cjs --dry-run`
  and `node packages/api/scripts/sync-steel-rules.cjs --apply`.
- Readback confirmed `steel-default-agent-instruction` contains the retry and
  rule-derived lookup text; `steel_quote_rules_c_type` contains the
  productNames ban and `錏輕型鋼` default.
- Tool smoke confirmed `search_price_candidates` rejects `productNames:
  ['C型鋼']` with `invalid_arguments`, while `['錏輕型鋼', '100*2.3']`
  returns reviewed candidates including `錏輕型鋼 100*2.3` at price B 26.8.
- Live OAuth C 型鋼 smoke passed: tool order was
  `lookup_catalog_families`, `search_customers`, `lookup_quote_rules`,
  `search_price_candidates`; price args used `錏輕型鋼`, `100*2.3`, and
  `100x2.3` instead of `"C型鋼"` productNames, and the final answer quoted
  `錏輕型鋼 100*2.3` at price B 26.8 with 24 kg / 643.2 per 6M piece.
- `git diff --check` passed.

# Steel System Order Adopted Price Row Identity

- [x] Add RED semantic projection coverage so `system_order.item_spec` is not filled from `normalizedItemName` when `systemOrder.itemSpec` is missing.
- [x] Add RED provider completion coverage so `system_order.model_code` is required alongside `system_order.item_spec`.
- [x] Update projection/completion logic and workbook rules so `系統訂單.型號` = adopted price row code and `系統訂單.品名規格` = adopted price row productName.
- [x] Sync reviewed workbook rules.
- [x] Run focused semantic/provider tests, sync readback, live/tool smoke as needed, and `git diff --check`.

## Review

- RED semantic test first failed because `system_order.item_spec` still fell back to `normalizedItemName`; after the projector change it passes and no fallback cell op is emitted when adopted price row `productName` is missing.
- RED provider test first failed because workbook completion accepted patches without `system_order.model_code`; after the completion gate change it loops until model code is supplied.
- `docs/rules/workbook規則.txt` now requires `systemOrder.modelCode` from adopted `search_price_candidates` `erpItemCode` / source `型號`, and `systemOrder.itemSpec` from adopted `productName` / source `產品名稱`.
- Synced reviewed rule row `steel-workbook-output-policy`; readback confirmed both new prompt fragments and SHA-256 `a6b328c12b66124e96e8c4691d03a9ec33ef415cf74725c9403452d97e615b39`.
- Verification: `jest src/steel/workbook/semantic.spec.ts -- --runInBand` passed 6/6, `jest src/steel/ai/provider.spec.ts -- --runInBand` passed 32/32, `jest src/steel/handlers.spec.ts -- --runInBand` passed 42/43 with 1 skipped, `npm --workspace packages/api run build` completed with exit 0 and an existing Redis type warning, and `git diff --check` passed.
