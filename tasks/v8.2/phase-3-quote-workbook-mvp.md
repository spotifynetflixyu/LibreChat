# Phase 3: Quote Workbook MVP

Goal: deliver the first usable chat UX vertical slice: Chat Workspace message -> selected model or mocked API path -> Quote Resolution Engine -> structured workbook JSON or patch -> seven-tab Workbook Preview with audit records.

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
- API mock data shaped from `docs/reference/doc` examples for chat UX development only.
- API mock data uses English canonical DTO/API keys mapped from Chinese source references; Chinese text remains only as display/source/alias values.
- `client/src/features/steel` Chat Workspace.
- Seven-tab Workbook Preview with low-confidence/manual-review visibility.
- Unified Steel UX framework for desktop and mobile responsive web layouts.
- Mobile Workbook Preview full-view modal with selected-cell-to-message workflow.
- Latest accepted workbook patch field highlighting.

Full source RAG, Memory Review UI, production OCR/vision drawing evidence, full Admin import, Admin table maintenance, and real handbook data SQL/import remain out of scope for this phase. Reference files under `docs/reference/doc` may inform real schema design and mock API fixtures, but their values are not imported into the database in this phase.

## Milestone 3.0: Chat UX Shell And API Mock Data

Files:

- Create `client/src/features/steel/chat`
- Create `client/src/features/steel/workbook`
- Create `client/src/features/steel/shared`
- Create `packages/data-provider/src/steel/mock`
- Modify Steel data-provider query hooks created in Phase 1.

Tasks:

- Build the first Chat Workspace screen for message entry, selected model, send state, and response status.
- Build a Workbook Preview with the seven fixed tabs and stable empty/loading/error states.
- Use `packages/data-provider/src/steel/workbooks.ts` as the public DTO owner for workbook JSON, patch request/response, selected workbook refs, changed paths, and changed-field summary items.
- Keep backend canonical Zod validation in `packages/api/src/steel/workbook/schema.ts`; frontend code and mock data must not define an independent workbook validation schema.
- Build the Phase 3 UI as an independent Steel workspace under `client/src/features/steel`; reuse LibreChat auth/model-selector capabilities, but do not rework the core LibreChat chat store or global message flow for the MVP.
- Use the same Steel UX framework for desktop and mobile: shared components, hooks, API contracts, and mock data; only layout behavior changes at responsive breakpoints.
- On mobile, open Workbook Preview as a full-view modal with a clear top-right close button; closing returns to the same chat draft and selected model state.
- Support one selected workbook cell at a time with a stable selected CSS state.
- When a user selects a workbook cell, show a field marker/chip in the bottom message input so the user can type the requested change against that exact cell.
- Send the selected field as structured `selected_workbook_refs` alongside the message; Phase 3 allows at most one selected ref per submit.
- Allow multi-round chat edits to continue modifying workbook data after each accepted patch.
- Allow users to describe multiple workbook changes in text without selecting every cell; AI may propose multiple patch operations only when the target fields are unambiguous.
- Do not require a patch preview/diff confirmation step for every AI workbook update in Phase 3; preserve chat speed.
- After an accepted workbook patch, highlight the latest updated workbook cells/fields with a background color using server-returned changed paths.
- Keep latest-updated highlights until the next accepted workbook patch; the next accepted patch replaces the highlighted changed-path set.
- Do not highlight fields for failed or rejected workbook patches; show the failure/rejection reason in chat and keep workbook data unchanged.
- Do not add an explicit Undo button or version-control UI in Phase 3; users ask AI in chat to revert or change workbook data, and AI must use the normal validated patch flow.
- After a successful workbook patch, show a short chat summary of changed fields using accepted patch metadata; do not render a full diff table in chat.
- Keep latest-updated background highlighting visually distinct from selected-cell styling.
- Provide API mock data for workbook lines, manual review rows, price source rows, system order rows, and customer quote rows from `packages/data-provider/src/steel/mock/`.
- Use `docs/reference/doc` to shape realistic mock cases and schema-design assumptions; do not read those files at runtime.
- Apply the source schema mapping before creating mock fixtures: workbook/DTO keys are English canonical keys, while visible labels and source excerpts may remain Chinese.
- Mocked AI responses and prompt fixtures use the source-schema mapping packet when translating Chinese source/customer wording to canonical workbook/tool keys.
- Keep mock data replaceable by real conversation/workbook APIs without changing component contracts.
- Do not create separate frontend and backend mock-data folders; the shared data-provider mock folder is the single source.
- Do not re-export mock fixtures from `packages/data-provider/src/steel/index.ts`; frontend tests and backend mock handlers import them through the explicit mock path only.

Acceptance:

- User can type a LINE-style order into the Steel chat surface and see a seven-tab workbook preview from mock API data.
- The Steel chat/workbook route works without depending on core LibreChat chat-store changes beyond minimal navigation/registration.
- Desktop and mobile layouts expose the same core actions: send message, inspect seven workbook tabs, see manual-review rows, and view customer quote output.
- Mobile users can open workbook preview in a full-view modal and close it with a visible top-right X.
- Selecting one workbook cell highlights it and inserts a field marker into the bottom composer; submitting sends both the user's text and a single structured selected-cell ref.
- Multi-round conversations can patch workbook data over time.
- Natural-language requests can update multiple workbook fields in one turn only when backend validation can map each patch operation to allowed workbook paths.
- Accepted AI workbook patches update the workbook without a required per-patch confirmation gate.
- The latest changed workbook cells/fields are marked with a background color after the patch is accepted and stay highlighted until the next accepted workbook patch.
- Failed or rejected patch attempts do not highlight fields, do not change workbook data, and do not replace the previous accepted-patch highlight set.
- Revert requests are submitted through chat and result in a new validated workbook patch; no direct client-side undo mutates workbook JSON.
- Successful patch chat replies briefly list changed fields, for example `已更新：報價明細 line-1 報價單價 120 -> 115`.
- Low-confidence/manual-review rows are visible in the UI.
- Customer quote preview hides customer tier/internal/debug fields.
- The mock API data contract matches the workbook JSON schema used by backend tests.
- Mock API fixtures derived from Chinese reference examples use English DTO/API keys and preserve Chinese only as display/source/alias data.
- Prompt/tool tests prove AI-facing mapping context resolves Chinese labels to existing canonical keys and rejects unknown keys through clarification/manual-review behavior.
- API mock data is typed against the shared workbook DTOs and remains compatible with backend Zod validation.
- Frontend tests consume shared workbook DTOs/API responses instead of local workbook schemas.
- Frontend tests and backend mock handlers import mock data from the same `packages/data-provider/src/steel/mock/` folder.
- Production Steel data-provider barrel exports do not include API mock fixtures.

Verification:

```bash
rtk npm run test:client -- --runTestsByPath client/src/features/steel
rtk npm run build:client-package
rtk npm run build:api
```

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
  "reasoning_effort": "low",
  "selected_workbook_refs": [
    {
      "workbook_id": "workbook-id",
      "version_seq": 3,
      "sheet_id": "quote_details",
      "row_id": "line-1",
      "column_key": "quoted_unit_price",
      "label": "報價明細 / line-1 / 報價單價",
      "current_value": "120"
    }
  ]
}
```

Tasks:

- Validate request body.
- Validate selected workbook refs against the current workbook/version and allowed sheet/column set; Phase 3 rejects requests with more than one selected ref.
- Apply Phase 1 access guard.
- Pass `selected_model` through; do not hard-code a Steel model.
- Include selected workbook refs in the prompt context as structured references, not only as user-visible text.
- Create OpenAI run record before external calls start.
- Save failure states with typed error categories.

Acceptance:

- Missing model/message/conversation access fail with explicit status codes.
- Invalid selected workbook refs fail before model execution.
- Selected-cell edit requests produce workbook patches through the workbook service and return updated workbook data or a patch for UI sync.
- Text-only multi-field edit requests can produce multiple patch operations when targets are explicit; ambiguous targets produce a clarification or manual-review response instead of guessing.
- Successful workbook patch responses include changed paths or refreshed workbook metadata that the UI can use to highlight the latest updated fields.
- The UI tracks one latest-update highlight set by accepted patch id/version; a later accepted patch replaces the previous highlight set.
- Failed or rejected patch responses include a user-facing reason but no latest-update highlight metadata.
- Successful patch responses include enough changed-field metadata for a short chat summary; failed/rejected responses only explain why nothing changed.
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
- Manual live smoke test is documented before moving to Phase 4.

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
- Treat selected workbook refs from the message request as explicit user targeting evidence, but still validate patch paths and protected fields server-side.
- Allow one user turn to produce multiple patch operations when the user describes multiple unambiguous workbook changes in text.
- Reject or clarify ambiguous natural-language patch targets; AI must not invent row/column targets when no selected ref or clear text target exists.
- Recalculate line total when quoted unit price changes.
- Recalculate quoted unit price when line total changes.
- Apply RFC 6902 JSON Patch.
- Reject patch paths touching system fields.
- Require `target_version_seq`.
- Return `409` on version mismatch.
- Write `steel_workbook_patches` for each accepted patch.
- Return accepted patch metadata, including changed workbook paths, so the UI can highlight the latest updated fields.
- Return accepted patch summary items with sheet label, row label, field label, previous value, and new value for concise chat replies.
- Return failed/rejected patch reasons without changed paths; failed/rejected patches must not mutate workbook state or latest-update highlight state.
- Keep patch history for audit, but do not expose an MVP Undo UI; chat-driven revert requests create new accepted patches when valid.
- Keep backend Zod schemas in this module as the runtime source of truth, even when public DTOs come from `packages/data-provider/src/steel/workbooks.ts`.

Acceptance:

- Patch tests cover add/replace/remove, blocked system path, stale version, and valid version increment.
- Patch tests prove unit-price and total-price paired recalculation.
- Patch tests prove later chat rounds do not refresh existing line prices from the database without explicit request.
- Workbook creation always includes seven fixed sheets.
- Accepted patch responses expose changed paths for latest-updated-field highlighting.
- Accepted patch responses expose changed-field summary items for concise chat acknowledgement.
- Backend workbook tests reject DTO-shaped payloads that violate runtime validation rules.
- Latest-updated-field highlighting persists until the next accepted patch and is replaced, not accumulated.
- Failed or rejected patches do not update highlights.
- Chat-driven revert requests are tested as normal patch operations; no frontend-only undo bypasses backend validation.

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
- Mocked OpenAI run can use selected workbook refs to propose a patch for the targeted workbook cell.
- Mocked OpenAI run can process a text-only request with multiple explicit workbook changes and produce multiple validated patch operations.
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

- One authenticated Chat Workspace vertical slice works with API mock data and mocked OpenAI.
- The Chat Workspace is implemented as an independent Steel workspace, with no MVP dependency on changing the core LibreChat chat store/message flow.
- Desktop and mobile use the same Steel UX framework and data contracts.
- Mobile Workbook Preview uses a full-view modal with top-right close control.
- Phase 3 UI supports one selected workbook cell per submit; text-only instructions may still ask AI to update multiple unambiguous workbook fields.
- Selected workbook cells are represented as structured refs in message requests and drive workbook patch sync after AI processing.
- Workbook patches do not require per-update user confirmation in Phase 3.
- Latest updated workbook cells/fields are visibly highlighted with a background color after accepted patches, until replaced by the next accepted patch.
- Failed or rejected patch attempts show a chat explanation and do not highlight workbook fields.
- Phase 3 has no explicit Undo button; revert/change requests go through chat and the validated patch service.
- Successful AI workbook patches include a concise chat summary of changed fields, not a full diff table.
- One authenticated manual smoke run works against the real OpenAI API before Phase 4 begins.
- Workbook Preview renders all seven tabs and hides customer-blocked fields.
- Workbook patch concurrency is tested.
- OpenAI run records include model, response IDs, context refs, and tool call IDs.
- Workbook JSON contains all seven fixed sheets.
- No AI output can directly mutate MongoDB/Supabase outside whitelisted services.
