# Phase 3: Quote Workbook MVP

Goal: deliver the first vertical slice: authenticated user message -> real OpenAI API smoke path plus mocked test path -> deterministic tools -> Quote Resolution Engine -> structured workbook JSON or patch -> persisted seven-sheet workbook and audit records.

## Scope

- Authenticated conversation message endpoint.
- OpenAI conversation/run service.
- Prompt bundle builder.
- Function-calling loop.
- Quote Resolution Engine integration.
- Structured output schemas.
- Workbook JSON engine with seven fixed sheets.
- JSON Patch application and concurrency control.
- Basic customer-visible workbook API.

Full source RAG, Memory Review UI, production OCR/vision drawing evidence, and full Admin import remain out of scope for this phase. UX polish is deferred until the real OpenAI chat path can create a customer-visible workbook end to end.

## Milestone 3.1: Conversation Message Contract

Files:

- Modify `packages/data-provider/src/steel/conversations.ts`
- Modify `packages/api/src/steel/conversations/service.ts`
- Create `packages/api/src/steel/conversations/messages.ts`
- Modify `api/server/routes/steel/index.js`

Endpoint:

```text
POST /api/steel/conversations/:conversationMetaId/messages
```

Request shape:

```json
{
  "message": "幫我查這筆訂單價格",
  "selected_model": "model-name",
  "reasoning_effort": "low"
}
```

Tasks:

- Validate request body.
- Apply Phase 1 access guard.
- Pass `selected_model` through; do not hard-code a Steel model.
- Create OpenAI run record before external calls start.
- Save failure states with typed error categories.

Acceptance:

- Missing model/message/conversation access fail with explicit status codes.
- Service does not depend on frontend-only assumptions.

Verification:

```bash
rtk npm run test:api -- --runTestsByPath api/server/routes/steel/index.spec.js
rtk npm run build:api
```

## Milestone 3.2: OpenAI State Adapter

Files:

- Create `packages/api/src/steel/openai/client.ts`
- Create `packages/api/src/steel/openai/state.ts`
- Create `packages/api/src/steel/openai/runs.ts`
- Add tests under `packages/api/src/steel/openai/*.spec.ts`

Tasks:

- Implement Phase 0 decision for `conversation` and `previous_response_id`.
- Store `openai_conversation_id`, prior response ID, current response ID, selected model, token usage, context refs, and error summaries.
- Add `provider_state_broken` recovery flag.
- Never fetch historical conversation text from OpenAI as source of truth.
- Reconfirm current OpenAI SDK/API event shape before implementation.

Acceptance:

- Tests cover first run, subsequent run, provider error, and fallback marking.
- OpenAI client is injectable for tests.
- Manual live smoke test is documented before UX polish.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/openai/.*\\.spec\\.ts$"
```

## Milestone 3.3: Prompt Bundle Builder

Files:

- Create `packages/api/src/steel/prompt/builder.ts`
- Create `packages/api/src/steel/prompt/context.ts`
- Create `packages/api/src/steel/prompt/schemas.ts`
- Add tests under `packages/api/src/steel/prompt/*.spec.ts`

Prompt order:

1. User current-turn instruction.
2. LibreChat Agent instructions when present.
3. Steel Project Instructions.
4. Active Text Sources.
5. Relevant System Memories.
6. Retrieved Source Chunks.
7. Current Workbook Summary.
8. Available Tools.
9. Structured Output Schema.

MVP behavior:

- Include current user instruction, optional agent instructions, current workbook summary, available tools, and structured schema.
- Record empty arrays in `context_refs` for sources/instructions/memories until those modules exist.

Acceptance:

- Current-turn user instruction has highest priority.
- Memory cannot override current user instruction, Supabase price results, weight results, or backend calculations.
- Prompt bundle tests assert ordering.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/prompt/.*\\.spec\\.ts$"
```

## Milestone 3.4: Workbook JSON Engine

Files:

- Create `packages/api/src/steel/workbook/schema.ts`
- Create `packages/api/src/steel/workbook/service.ts`
- Create `packages/api/src/steel/workbook/patch.ts`
- Create `packages/api/src/steel/workbook/summary.ts`
- Create `packages/api/src/steel/workbook/handlers.ts`
- Add tests under `packages/api/src/steel/workbook/*.spec.ts`

Required sheet IDs:

- `quote_details`
- `summary`
- `manual_review`
- `price_sources`
- `interpretation_notes`
- `system_order`
- `customer_quote`

Tasks:

- Define workbook JSON v1 with stable sheet IDs.
- Require every workbook to include all seven fixed sheets.
- Require every priced workbook line to persist:
  - original item name
  - normalized item name
  - formula identity/version
  - calculation basis
  - database default unit price
  - quoted unit price
  - line total
  - adjustment source
  - quote trace
  - price source refs
  - weight source refs
- Treat latest database unit price as default only for new lines or explicit recalculation.
- Reject patches that change existing quantity, quoted unit price, or line total unless tied to current user request for that line.
- Recalculate line total when quoted unit price changes.
- Recalculate quoted unit price when line total changes.
- Apply RFC 6902 JSON Patch.
- Reject patch paths touching system fields.
- Require `target_version_seq`.
- Return `409` on version mismatch.
- Write `steel_workbook_patches` for each accepted patch.

Acceptance:

- Patch tests cover add/replace/remove, blocked system path, stale version, and valid version increment.
- Patch tests prove unit-price and total-price paired recalculation.
- Patch tests prove later chat rounds do not refresh existing line prices from the database without explicit request.
- Workbook creation always includes seven fixed sheets.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/workbook/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Milestone 3.5: Quote Resolution Integration

Files:

- Create `packages/api/src/steel/quote/resolve.ts`
- Create `packages/api/src/steel/quote/trace.ts`
- Modify `packages/api/src/steel/openai/orchestrator.ts`
- Add tests under `packages/api/src/steel/quote/*.spec.ts`

Tasks:

- Wire customer tier resolver, normalization, price search/ranking, stock allocation, calculators, and quote trace into one service.
- Convert quote resolution result into workbook lines.
- Populate manual review rows for low-confidence items.
- Populate price source rows with search terms, candidates, selected item, rejected reasons, and source refs.
- Populate interpretation notes when OCR/vision/drawing evidence exists.
- Populate system order rows with fixed fields.
- Populate customer quote rows through allowlist projection.

Acceptance:

- Text order produces workbook lines, summary, manual review rows, price source rows, system order rows, and customer quote rows.
- Missing price appears as `未確認`, not `0`.
- Low-confidence items appear in manual review sheet.
- Customer quote projection excludes internal trace fields.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/(quote|workbook)/.*\\.spec\\.ts$"
```

## Milestone 3.6: Orchestrator Loop

Files:

- Create `packages/api/src/steel/openai/orchestrator.ts`
- Create `packages/api/src/steel/openai/structured.ts`
- Modify `packages/api/src/steel/tools/execute.ts`
- Add tests under `packages/api/src/steel/openai/orchestrator.spec.ts`

Tasks:

- Send prompt bundle with tool definitions.
- Execute function calls server-side.
- Feed tool outputs back to Responses API.
- Enforce max tool calls per run.
- Parse structured workbook output or workbook patch.
- Apply workbook patch through workbook service only.
- Persist `context_refs` and `tool_call_ids`.

Acceptance:

- Mocked OpenAI run can call price tools and produce a workbook patch.
- Manual live OpenAI API smoke run can create or patch a seven-sheet customer-visible workbook from chat.
- Runaway tool loop stops with typed error and audit record.
- Invalid structured output does not mutate workbook state.

Verification:

```bash
rtk npm run test:packages:api -- --runTestsByPath packages/api/src/steel/openai/orchestrator.spec.ts
rtk npm run build:api
```

## Phase Gate

Do not move to Phase 4 until:

- One authenticated vertical slice works under mocked OpenAI.
- One authenticated manual smoke run works against the real OpenAI API before UX polish begins.
- Workbook patch concurrency is tested.
- OpenAI run records include model, response IDs, context refs, and tool call IDs.
- Workbook JSON contains all seven fixed sheets.
- No AI output can directly mutate MongoDB/Supabase outside whitelisted services.
