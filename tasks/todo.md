# Active: search_price_candidates Material Keyword Lookup

Goal: make `search_price_candidates` treat lookup `material` as a material
keyword, with query-facing material choices simplified to oral lookup terms.

Plan:

- [x] Write failing schema/repository tests for simplified material keywords while keeping
      import storage variants unchanged.
- [x] Change AI-facing material input handling so storage variants collapse to
      simple query keywords for tool calls only.
- [x] Change price lookup SQL so `material` filters use keyword matching instead
      of exact equality.
- [x] Update rule/schema docs that expose Steel material choices.
- [x] Run focused Jest tests and `git diff --check`.
- [x] Record review evidence.
- [x] Add regression coverage for broad `鐵板/鋼板` + `鋅` lookup.
- [x] Relax `鐵板/鋼板` + `鋅` query filters so sparse zinc plate data is not
      over-constrained by thickness or keyword terms.
- [x] Re-run focused repository/tool/provider tests and record verification.
- [x] Correct related cutting whitelist: only rail/H/I/angle/channel/flat/round
      bar/square bar/pipe/tube categories attach `切工/切割` rows.
- [x] Remove the wrong Steel plate cutting-price assumption from task lessons
      and rule-facing docs.
- [x] Re-run focused tests after the whitelist correction.

Design lock:

- AI-facing `material` should expose simple query keywords: `黑鐵`, `白鐵`,
  `錏`, `鋁`, and `鋅`.
- Import/storage material values remain canonical source values; do not collapse
  `OT 黑鐵`, `No1 白鐵3t以上含`, `BA 白鐵亮面`, `錏/鍍鋅`, `鋁鋅`, or other source
  labels into query keywords in the import path.
- Price search should find existing rows whose `material`, product name, spec
  key, ERP code, or source spec carries the requested material marker.
- `鐵板/鋼板` lookup queries should not be related to separate `切工/切割`
  rows, and Steel plate has no separate cutting price lookup.
- Only `鐵軌`/鋼軌, `H型鋼`, `工字鐵/I字鐵`, `角鐵/角鋼`, `槽鐵`,
  `平鐵/扁鐵`, `圓鐵/圓鋼`, `方鋼/方鐵`, `圓管/鋼管`, `方管`, and
  `扁方管` attach related `切工/切割` rows.
- `鐵板/鋼板` with lookup material `鋅` should stay broad because there are only
  a few zinc-family plate rows; category plus material is enough and should not
  be narrowed by thickness or extra keyword terms.
- This is a behavior change only; no Steel PostgreSQL table migration is needed.

Review - 2026-06-25:

- Added query-only material enum values `黑鐵`, `白鐵`, `錏`, `鋁`, and `鋅`.
  Import/storage `materialKinds` and Steel PostgreSQL material checks remain
  unchanged.
- `searchSteelPriceItems` now applies lookup `material` as an `ILIKE` keyword
  against `material`, `product_name`, `spec_key`, `erp_item_code`, and
  `source_spec` instead of `material = $n`.
- Category discovery keyword matching now includes `material`, so split terms
  such as `白鐵 方管` can match across material and product/spec fields.
- Plate lookups stay within `鐵板/鋼板` category data; they do not OR in
  separate `切工/切割` related rows.
- Corrected the plate cutting assumption: `鐵板/鋼板` has no separate cutting
  price lookup. Related `切工/切割` rows are attached only for the explicit
  rail/H/I/angle/channel/flat/round bar/square bar/pipe/tube category whitelist.
- `鐵板/鋼板` + `鋅` lookup now stays broad and ignores thickness/keyword
  narrowing, so sparse zinc-family plate rows are searched by category plus
  material keyword only.
- Updated the AI-visible tool schema, tool description, agent rule doc, and
  provider/tool/repository tests to use the simplified query enum.
- Verification:
  - `cd packages/api && npx jest src/steel/pricing/import.spec.ts src/steel/tools/registry.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand` passed with 68 tests after the related-cutting whitelist correction.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still fails
    on existing unrelated TypeScript errors in cache/openai/langchain/manual
    Steel specs/rules/vision files; no current touched file remains in the
    error list.

# Active: Phase 1 Native Steel Context Adapter Interface

Goal: create the first native Steel context adapter contract at
`packages/api/src/steel/native/context.ts` using the master framework as the
only architecture entrypoint.

Plan:

- [x] Read project instructions, current lessons, master framework, and active
      implementation plan.
- [x] Inspect existing Steel runtime context and native AgentClient context
      seams.
- [x] Add the Phase 1 native context adapter interface and minimal render
      helpers.
- [x] Add focused tests for fixed prefix ordering, compact mode defaults, global
      OCR/file rule inclusion, and metadata-only attachment references.
- [x] Export the native adapter through `@librechat/api`.
- [x] Run focused verification and record review evidence.

Design lock:

- Steel native context is global. Do not add modelSpec opt-in, ordinary-chat
  classifier, YAML Steel enablement switches, or Phase 1 runtime disable paths.
- `instructionPrefix` uses the fixed user-confirmed order: agent rules, quote
  defaults/rules, output rules, tool policy, other rules including OCR/file
  rules, reviewed agent rules, instruction packets.
- Runtime context defaults to `compact_workbook`.
- Attachments enter Phase 1 Steel context as LibreChat file metadata/references
  only. File bytes/base64 stay in LibreChat provider/file pipelines; OCR bytes
  are fetched later by the AI-visible `run_file_ocr` tool executor.
- `fileAnalysis.instructions` is not a duplicate Steel OCR policy source for
  native context. Reviewed Steel OCR/file rules are authoritative.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/context.ts` with the Phase 1 native
  adapter contract:
  - `buildSteelGlobalAgentContext(input)` returns `instructionPrefix`,
    `runtimeContextText`, raw `runtimeContext`, diagnostic metadata, context
    slot labels, attachment references, and prefix section metadata.
  - `SteelNativeFileReference` carries LibreChat file metadata/references only;
    it has no byte/base64 field.
  - Native context metadata records `nativeContextVersion: 1`,
    `globalApplied: true`, `contextMode`, `renderProfile`, byte policy, OCR
    execution policy, and fixed prefix order.
- Added `packages/api/src/steel/native/index.ts` and exported the native adapter
  through `packages/api/src/steel/index.ts` and `packages/api/src/index.ts`.
- Native adapter wraps runtime context dependencies so other global rules are
  loaded with `includeOcrRules: true`, matching the fixed global OCR/file rule
  decision without adding a product disable/enable path.
- Verification:
  - `cd packages/api && npx jest src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `git diff --check` for the touched files passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still fails on
    existing project errors in cache/openai endpoint/manual Steel specs/rules
    tooling, but the native context files are no longer in the TypeScript error
    list after fixing the readonly attachment evidence mismatch.
