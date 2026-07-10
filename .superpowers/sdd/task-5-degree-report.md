# Task 5 Report: `system_order.度`

Base: `d87a2521c`

## Implemented contract

- `system_order` now renders the strict 21-column order with `度` immediately after `長度`.
- English output cells may use `degree`; the Markdown renderer maps it to `度`.
- `系統訂單.xlsx` source label `度` maps to canonical key `degree` and target
  `steel.order_items.metadata.degree` as a number.
- Markdown persistence fixtures preserve `度` in the parsed system-order payload.
- No other active sheet received a `度` column.
- `docs/rules/輸出規則.txt` now states both required gates: only category
  `捲門/伸縮門` with formula `DA`, `DB`, or `DC` may fill `度`; every other category or
  formula leaves it blank. It also identifies `度` as the system-order name for legacy formula
  input `肚` and records:
  - `DA = (長度 / 4) * 度`
  - `DB = (長度 / 3) * 度`
  - `DC = 長度 * 寬度 * 度`

## TDD evidence

RED:

```text
npx jest src/steel/tools/execute.spec.ts src/steel/schema/mapping.spec.ts --runInBand

FAIL mapping.spec.ts: 系統訂單.xlsx / 度 resolved to undefined
FAIL execute.spec.ts: rendered strict header omitted 度
Test Suites: 2 failed, 2 total
Tests: 2 failed, 20 passed, 22 total
```

GREEN after the minimal implementation:

```text
npx jest src/steel/tools/execute.spec.ts src/steel/schema/mapping.spec.ts \
  src/steel/memory/service.spec.ts src/steel/handlers.spec.ts --runInBand \
  -t 'reads current workbook data|resolves reviewed reference headers|captures final assistant system-order Markdown|smoke-autosaves final Markdown'

Test Suites: 4 passed, 4 total
Tests: 4 passed, 78 skipped, 82 total
```

## Strict-header fixture inventory

- Canonical renderer: `packages/api/src/steel/tools/execute.ts`
- Persistence fixtures: `packages/api/src/steel/memory/service.spec.ts`
- Stream-handler smoke: `packages/api/src/steel/handlers.spec.ts`
- Provider exact-header smoke: `packages/api/src/steel/ai/provider.pb-pdf-quote.manual.spec.ts`
- Native E2E fake-model responses: `e2e/setup/fake-model.js`

All old `長度 | 類別` strict-header forms were removed. The two E2E table groups have 22 pipe
delimiters per header, separator, and row, which represents the same 21 columns.

## Final verification

- `execute`, `mapping`, `memory`, and regular provider suites: 4 suites / 77 tests passed.
- Focused Mongo-backed handler smoke: 1 suite / 1 selected test passed.
- Targeted TypeScript ESLint: no issues.
- E2E fake-model ESLint and `node --check`: no issues.
- `git diff --check`: clean.
- `npx tsc --noEmit -p tsconfig.build.json` remains blocked by 15 existing errors in eight
  unrelated files, including Redis client type duplication, duplicate Steel exports, legacy OCR
  target/type issues, OAuth `Runnable` visibility, and old pricing-category comparisons. None of
  those diagnostics points to a Task 5 changed line.

No rule sync or dev/prod database mutation was performed in this task.
