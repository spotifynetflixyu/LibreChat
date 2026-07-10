# Task 3 Report: grouped multi-query lookup and safe ratio options

## Result

Implemented the v4.2 grouped `search_price_candidates` contract without applying
or querying a live database.

- One tool call accepts 1-20 lookup or discovery queries.
- Missing query IDs normalize to `q1`, `q2`, and so on; supplied IDs are trimmed
  and preserved.
- Per-query limits default in the repository to 30 and positive integers above
  100 clamp to 100. Zero, negative, and non-integer values remain invalid.
- Category/subcategory validation uses the shared v4.2 registry. Legacy category
  names and `加工/其他 -> 扁` are rejected; `加工/其他 -> 扁鐵` is valid.
- The lookup material enum is `黑鐵, 白鐵, 鋁, 錏, 鎢, 塑膠`; raw DB material
  text remains unchanged and is matched by explicit family terms.
- All lookup and discovery queries execute through one SQL statement using
  `jsonb_to_recordset`, query index/ID provenance, per-query limits, and one
  result row per input query.
- Repository candidates project only v4.2 columns and parse direct A-F prices
  plus A-F ratios. Deduplication is per group only.
- AI-visible output is authoritative under `queryResults`, with normalized
  `query`, `status`, `candidates`, `categoryCandidates`, `issues`, and a compact
  count `summary`.
- Direct price options precede ratio options. Ratios are quote-eligible only for
  exact `Kg` or `M` units. Other units receive a non-quoteable
  `category_rule_pending` skipped marker without raw ratio values.
- Same-round provider coalescing preserves distinct query IDs and reports grouped
  counts. Price memory extraction now reads grouped candidate provenance.

## TDD evidence

Genuine RED runs were recorded before each implementation slice:

- Schema: 5 expected failures for missing IDs/filters, limit rejection, old
  material enum, and absent subcategory validation.
- Repository: 3 expected failures because the grouped repository API did not
  exist.
- Executor: 3 expected failures because grouped safe output was not implemented.
- Sanitizer: 1 expected failure because raw ratio keys were retained.
- Provider: 1 expected failure because coalesced grouped counts/IDs were absent.
- Memory: 2 expected failures because grouped candidates saved zero documents.
- Registry: 1 expected failure because the old single-query description remained.

Final focused GREEN:

- `provider.spec.ts`: 17/17 tests passed.
- `categories`, `v4`, `schemas`, `registry`, `prices`, `execute`, `sanitize`, and
  `memory`: 8 suites, 117/117 tests passed.
- Total focused result: 9 suites, 134/134 tests passed.
- Focused ESLint with `--quiet` passed for provider, registry, schema,
  repository, executor, sanitizer, and their Task 3 tests.
- `git diff --check` passed.

The package-wide `tsc --noEmit` remains blocked by 49 existing diagnostics in
unrelated modules/tests (Redis type duplication, OAuth/runtime fixtures, legacy
v3 importer comparisons, and other pre-existing type issues). The touched
memory service also retains six pre-existing `no-nested-ternary` diagnostics at
lines outside the Task 3 diff; the new grouped-memory lines add no lint errors.

## Review correction

The rejected first implementation received three focused regression corrections:

- Numeric thickness filters now follow importer storage text: `2` and `2.0`
  both normalize to `2`, `2.3` remains `2.3`, and duplicate normalized values
  are removed.
- Provider coalescing now merges validated raw query objects and parses the batch
  once. Two same-round calls without IDs become `q1` and `q2`; supplied IDs such
  as `line-c` remain unchanged in execution arguments, grouped results, and the
  compact coalesced summary.
- The `錏` lookup family now searches both `錏` and `鍍鋅`, including raw values
  such as `鍍鋅 / 白A` that do not contain `錏`.

The repository regression also explicitly retains reviewed/active filtering and
AND semantics across normalized keyword terms.

## Test replacement review

No non-pricing executor coverage was removed. Customer search, workbook/OCR
reads, argument dispatch, and tool-limit tests remain. Replaced price tests were
limited to contracts explicitly superseded by v4.2: dropped v3 columns, legacy
category aliases/hole canonicalization, the flattened candidate array, and
automatic related-cutting expansion. Processing prices are now queried through
their explicit v4.2 `加工/*` categories and the category rules implemented in a
later task.

## Changed files

- `packages/api/src/steel/pricing/enums.ts`
- `packages/api/src/steel/tools/schemas.ts`
- `packages/api/src/steel/tools/schemas.spec.ts`
- `packages/api/src/steel/tools/registry.ts`
- `packages/api/src/steel/tools/registry.spec.ts`
- `packages/api/src/steel/repositories/prices.ts`
- `packages/api/src/steel/repositories/prices.spec.ts`
- `packages/api/src/steel/tools/execute.ts`
- `packages/api/src/steel/tools/execute.spec.ts`
- `packages/api/src/steel/tools/sanitize.ts`
- `packages/api/src/steel/tools/sanitize.spec.ts`
- `packages/api/src/steel/ai/provider.ts`
- `packages/api/src/steel/ai/provider.spec.ts`
- `packages/api/src/steel/memory/service.ts`
- `packages/api/src/steel/memory/service.spec.ts`

## Deferred

- Category-specific query documentation/rule sync belongs to Task 4.
- `system_order.度` belongs to Task 5.
- Cloud/dev migration, importer execution, and live SQL smoke tests belong to the
  later deployment task. No DB state was modified here.
