# Phase 3: Quote Workbook MVP

Goal: deliver the first usable chat UX vertical slice: Chat Workspace message -> backend-selected `SteelAIProvider` -> provider-neutral tool loop -> Quote Resolution Engine -> structured workbook JSON or patch -> seven-tab Workbook Preview with audit records.

## Scope

- Authenticated conversation message endpoint.
- Backend model allowlist and driver selection.
- `SteelAIProvider` interface with openai-oauth /v1/responses default driver and official OpenAI API explicit fallback driver.
- Capability smoke tests and env-gated fallback routing for text, streaming, tool calling, structured output, workbook patch, image/PDF/XLSX input, File Search, and Code Interpreter.
- Prompt bundle builder.
- Provider-neutral tool-calling loop.
- Quote Resolution Engine integration.
- Structured output schemas.
- Workbook JSON engine with seven fixed sheets.
- JSON Patch application and concurrency control.
- Basic customer-visible workbook API.
- API mock data shaped from `docs/reference` examples for chat UX development only; formula runtime fixtures should come from reviewed app-ready JSON or database rows, not direct CSV parsing.
- `client/src/features/steel` Chat Workspace.
- Seven-tab Workbook Preview with low-confidence/manual-review visibility.
- Unified Steel UX framework for desktop and mobile responsive web layouts.
- Mobile Workbook Preview full-view modal with selected-cell-to-message workflow.
- Latest accepted workbook patch field highlighting.

Full source RAG, Memory Review UI, production OCR/vision drawing evidence, full Admin import, Admin table maintenance, and real handbook data SQL/import remain out of scope for this phase. Reference files under `docs/reference` may inform real schema design and mock API fixtures, but their values are not imported into the database in this phase.

## Milestone 3.0: Chat UX Shell And API Mock Data

Files:

- Create `client/src/features/steel/chat`
- Create `client/src/features/steel/workbook`
- Create `client/src/features/steel/shared`
- Create `packages/data-provider/src/steel/mock`
- Modify Steel data-provider query hooks created in Phase 1.

Tasks:

- Build the first Chat Workspace screen for message entry, backend model/provider selection, send state, response status, and inline provider warning status.
- Build a Workbook Preview with the seven fixed tabs and stable empty/loading/error states.
- Use `packages/data-provider/src/steel/workbooks.ts` as the public DTO owner for workbook JSON, patch request/response, selected workbook refs, changed paths, and changed-field summary items.
- Keep backend canonical Zod validation in `packages/api/src/steel/workbook/schema.ts`; frontend code and mock data must not define an independent workbook validation schema.
- Build the Phase 3 UI as an independent Steel workspace under `client/src/features/steel`; reuse LibreChat auth/navigation/model-selector shell patterns, but do not rework the core LibreChat chat store or global message flow for the MVP.
- Read available models from the Steel backend allowlist. Show provider/driver status from backend data, not from frontend guesses.
- Use the same Steel UX framework for desktop and mobile: shared components, hooks, API contracts, and mock data; only layout behavior changes at responsive breakpoints.
- On mobile, open Workbook Preview as a full-view modal with a clear top-right close button; closing returns to the same chat draft and selected model state.
- Support multiple selected workbook targets per submit with stable selected CSS state.
- When a user selects a workbook cell, show a field marker/chip in the bottom message input that includes the sheet and field/cell position, so the user can confirm the target.
- If the message input has no user-entered text, the next selected cell replaces the existing marker. If the user has entered text, the next selected cell is added as a new marker on a new line.
- Send selected targets as structured `selected_workbook_refs` alongside the message; Phase 3 supports multiple selected refs per submit.
- Allow multi-round chat edits to continue modifying workbook data after each accepted patch.
- Allow users to describe multiple workbook changes in text without selecting every cell; AI may propose multiple patch operations only when the target fields are unambiguous.
- Do not require a patch preview/diff confirmation step for every AI workbook update in Phase 3.
- After an accepted workbook patch, highlight the latest updated workbook cells/fields with a background color using server-returned changed paths.
- Keep latest-updated highlights until the next accepted workbook patch; the next accepted patch replaces the highlighted changed-path set.
- Do not highlight fields for failed or rejected workbook patches; show the failure/rejection reason in chat and keep workbook data unchanged.
- Do not add an explicit Undo button or version-control UI in Phase 3; users ask AI in chat to revert or change workbook data, and AI must use the normal validated patch flow.
- After a successful workbook patch, show a short chat summary of changed fields using accepted patch metadata; do not render a full diff table in chat.
- Provide API mock data for workbook lines, manual review rows, price source rows, system order rows, and customer quote rows from `packages/data-provider/src/steel/mock/`.
- Apply the source schema mapping before creating mock fixtures: workbook/DTO keys are English canonical keys, while visible labels and source excerpts may remain Chinese.
- Mocked AI responses and prompt fixtures use the source-schema mapping packet when translating Chinese source/customer wording to canonical workbook/tool keys.
- Do not create separate frontend and backend mock-data folders; the shared data-provider mock folder is the single source.
- Do not re-export mock fixtures from `packages/data-provider/src/steel/index.ts`; frontend tests and backend mock handlers import them through the explicit mock path only.

Acceptance:

- User can type a LINE-style order into the Steel chat surface and see a seven-tab workbook preview from mock API data.
- The Steel chat/workbook route works without depending on core LibreChat chat-store changes beyond minimal navigation/registration.
- Desktop and mobile layouts expose the same core actions: send message, inspect seven workbook tabs, see manual-review rows, and view customer quote output.
- Mobile users can open workbook preview in a full-view modal and close it with a visible top-right X.
- Selecting workbook cells highlights them and inserts clear sheet/field markers into the bottom composer; submitting sends both the user's text and structured selected refs.
- Multi-round conversations can patch workbook data over time.
- Accepted AI workbook patches update the workbook without a required per-patch confirmation gate.
- The latest changed workbook cells/fields are marked with a background color after the patch is accepted and stay highlighted until the next accepted workbook patch.
- Revert requests are submitted through chat and result in a new validated workbook patch; no direct client-side undo mutates workbook JSON.
- Successful patch chat replies briefly list changed fields.
- Low-confidence/manual-review rows are visible in the UI.
- Customer quote preview hides customer tier/internal/debug fields.
- API mock fixtures derived from Chinese reference examples use English DTO/API keys and preserve Chinese only as display/source/alias data.
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
  "selected_model": "gpt-5.5",
  "selected_provider": "openai_oauth_responses",
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
    },
    {
      "workbook_id": "workbook-id",
      "version_seq": 3,
      "sheet_id": "manual_review",
      "row_id": "review-2",
      "column_key": "confidence_reason",
      "label": "人工複核清單 / review-2 / 低信心原因",
      "current_value": "尺寸不清"
    }
  ]
}
```

Tasks:

- Validate request body.
- Validate `selected_provider` and `selected_model` against the backend Steel model allowlist and capability status.
- Validate selected workbook refs against the current workbook/version and allowed sheet/column set; Phase 3 accepts multiple refs only when each target is explicit and allowed.
- Apply Phase 1 access guard.
- Include selected workbook refs in the prompt context as structured references, not only as user-visible text.
- Create `steel_ai_runs` record before external provider calls start.
- Save failure states with typed provider and workbook error categories.
- Return provider/fallback metadata that the UI can display without exposing secrets or raw provider payloads.

Acceptance:

- Missing model/provider/message/conversation access fail with explicit status codes.
- Failed or disabled model/provider selections fail before model execution.
- Invalid selected workbook refs fail before model execution.
- Selected-cell edit requests produce workbook patches through the workbook service and return updated workbook data or a patch for UI sync.
- Text-only multi-field edit requests can produce multiple patch operations when targets are explicit; ambiguous targets produce a clarification or manual-review response instead of guessing.
- Successful workbook patch responses include changed paths or refreshed workbook metadata that the UI can use to highlight the latest updated fields.
- Failed or rejected patch responses include a user-facing reason but no latest-update highlight metadata.
- Service does not depend on frontend-only assumptions.

Verification:

```bash
rtk npm run test:api -- --runTestsByPath api/server/routes/steel/index.spec.js
rtk npm run build:api
```

## Milestone 3.2: Steel AI Provider Adapter And Capability Gates

Files:

- Create `packages/api/src/steel/ai/provider.ts`
- Create `packages/api/src/steel/ai/events.ts`
- Create `packages/api/src/steel/ai/runs.ts`
- Create `packages/api/src/steel/ai/models.ts`
- Create `packages/api/src/steel/ai/capabilities.ts`
- Create `packages/api/src/steel/ai/providers/openai-oauth-responses/client.ts`
- Create `packages/api/src/steel/ai/providers/openai-oauth-responses/provider.ts`
- Create `packages/api/src/steel/ai/providers/openai-api/client.ts`
- Create `packages/api/src/steel/ai/providers/openai-api/provider.ts`
- Add tests under `packages/api/src/steel/ai/**/*.spec.ts`

Tasks:

- Define the `SteelAIProvider` interface with `listModels`, `smokeTest`, and `run`.
- Convert openai-oauth and OpenAI provider events into a unified `SteelAIEvent`.
- Complete `docs/steel-openai-oauth-responses-setup.md` before any real openai-oauth provider smoke or chat UI live test.
- Read LibreChat UI / preset / agent model parameters into provider-neutral `SteelRuntimeOptions`; do not silently ignore enabled settings.
- Keep openai-oauth client/session injectable so tests do not require real OAuth.
- Store openai-oauth responses token material server-side or in a local encrypted development file; never put it in frontend localStorage.
- Implement official OpenAI API secondary driver with injectable client and current Responses API type checks.
- Force `openai_api` to use the Responses API for v8.3 fallback paths; `STEEL_OPENAI_API_ENABLE_ONLY_AFTER_SMOKE_TEST=true` means the driver remains disabled until its relevant smoke cases pass.
- For `openai_api`, use official `conversation` state and do not send `previousResponseId` with `conversation`; previous response IDs are audit/fallback metadata only.
- For `openai_oauth_responses`, store session/conversation IDs as runtime trace only.
- Persist capability smoke results per provider/model for text, streaming, tool calling, structured output, workbook patch, image input, PDF input, XLSX input, File Search, Code Interpreter, and conversation state.
- Route pure text and passed tool workflows to openai-oauth by default.
- When openai-oauth lacks a required capability, return a typed unsupported error unless the matching `STEEL_FALLBACK_ON_*` flag is enabled and `openai_api` has a passed smoke result for that same capability.
- Return chat-inline small warning metadata for unsupported/fallbackd provider decisions; do not design this as toast UI.
- Do not require `remaining quota` for openai-oauth; record subscription/rate/auth failures as typed statuses.
- Record API token usage/cost/rate metadata when available for `openai_api`.

Acceptance:

- Provider tests cover first run, subsequent run, provider error, unsupported capability, env-disabled typed errors, env-enabled capability-gated API fallback, and invalid structured output.
- openai-oauth adapter can be tested without real OAuth.
- OpenAI adapter can be tested without real API calls.
- Capability records are usable by the model selector and orchestrator routing policy.
- Manual live smoke test plan is documented before moving to Phase 4, and openai-oauth binding is complete before it hits a real provider.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/ai/.*\\.spec\\.ts$"
rtk npm run build:api
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

- Include current user instruction, optional agent instructions, current workbook summary, available tools, structured schema, and task-scoped source-schema mapping context.
- Record empty arrays in `context_refs` for sources/instructions/memories until those modules exist.
- Keep provider-specific serialization outside the core prompt bundle so openai-oauth and OpenAI adapters can format messages/tools without changing business prompt rules.

Acceptance:

- Current-turn user instruction has highest priority.
- Memory cannot override current user instruction, Supabase price results, weight results, or backend calculations.
- Prompt bundle tests assert ordering.
- Mapping context is task-scoped; workbook patch prompts do not receive unrelated SQL/table mapping details.

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
- Require every priced workbook line to persist original item name, normalized item name, formula identity/version, calculation basis, database default unit price, quoted unit price, line total, adjustment source, quote trace, price source refs, and weight source refs.
- Treat latest database unit price as default only for new lines or explicit recalculation.
- Reject patches that change existing quantity, quoted unit price, or line total unless tied to current user request for that line.
- Treat selected workbook refs from the message request as explicit user targeting evidence, but still validate patch paths and protected fields server-side.
- Allow one user turn to produce multiple patch operations when the user describes multiple unambiguous workbook changes in text.
- Reject or clarify ambiguous natural-language patch targets.
- Recalculate line total when quoted unit price changes.
- Recalculate quoted unit price when line total changes.
- Apply RFC 6902 JSON Patch.
- Reject patch paths touching system fields.
- Require `target_version_seq`.
- Return `409` on version mismatch.
- Write `steel_workbook_patches` for each accepted patch.
- Return accepted patch metadata, including changed workbook paths and summary items, so the UI can highlight latest updated fields and show concise chat acknowledgements.
- Return failed/rejected patch reasons without changed paths; failed/rejected patches must not mutate workbook state or latest-update highlight state.
- Keep patch history for audit, but do not expose an MVP Undo UI.

Acceptance:

- Patch tests cover add/replace/remove, blocked system path, stale version, and valid version increment.
- Patch tests prove unit-price and total-price paired recalculation.
- Patch tests prove later chat rounds do not refresh existing line prices from the database without explicit request.
- Workbook creation always includes seven fixed sheets.
- Accepted patch responses expose changed paths and changed-field summary items.
- Backend workbook tests reject DTO-shaped payloads that violate runtime validation rules.
- Latest-updated-field highlighting persists until the next accepted patch and is replaced, not accumulated.
- Chat-driven revert requests are tested as normal patch operations.

Verification:

```bash
rtk npm run test:packages:api -- --testPathPatterns="src/steel/workbook/.*\\.spec\\.ts$"
rtk npm run build:api
```

## Milestone 3.5: Quote Resolution Integration

Files:

- Create `packages/api/src/steel/quote/resolve.ts`
- Create `packages/api/src/steel/quote/trace.ts`
- Modify `packages/api/src/steel/ai/orchestrator.ts`
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

## Milestone 3.6: Steel Agent Orchestrator Loop

Files:

- Create `packages/api/src/steel/ai/orchestrator.ts`
- Create `packages/api/src/steel/ai/structured.ts`
- Modify `packages/api/src/steel/tools/execute.ts`
- Add tests under `packages/api/src/steel/ai/orchestrator.spec.ts`

Tasks:

- Resolve selected provider/model from the backend allowlist and capability matrix.
- Send prompt bundle with tool definitions through the selected `SteelAIProvider`.
- Execute custom tool calls server-side through the shared tool registry.
- Feed tool results back to the provider using adapter-specific serialization.
- Enforce max tool calls per run.
- Parse structured workbook output or workbook patch.
- Apply workbook patch through workbook service only.
- Persist `context_refs`, `tool_call_ids`, provider IDs, requested/effective provider/model, and fallback status.
- Convert provider auth/rate/subscription/capability failures into typed errors.
- If openai-oauth capability is unsupported and no matching fallback flag is enabled, return typed unsupported error without calling OpenAI API.
- If openai-oauth capability is unsupported and the matching fallback flag is enabled, fallback directly to `openai_api` only when the same capability is `passed` for the secondary driver.
- Render provider unsupported/fallback notices inside the chat transcript as small warning text, not toast.
- Keep file/vision/XLSX/hosted-tool routing explicit; do not assume same-model means same capability across drivers.

Acceptance:

- Mocked openai-oauth run can call price tools and produce a workbook patch.
- Mocked OpenAI fallback run can call price tools and produce a workbook patch.
- Mocked openai-oauth unsupported file/vision/XLSX path falls back to OpenAI API or returns a typed manual-review error according to policy.
- Mocked run can use multiple selected workbook refs to propose patches for targeted workbook cells.
- Mocked run can process a text-only request with multiple explicit workbook changes and produce multiple validated patch operations.
- Runaway tool loop stops with typed error and audit record.
- Invalid structured output does not mutate workbook state.

Verification:

```bash
rtk npm run test:packages:api -- --runTestsByPath packages/api/src/steel/ai/orchestrator.spec.ts
rtk npm run build:api
```

## Milestone 3.7: Live Provider Smoke

Prerequisite: complete `docs/steel-openai-oauth-responses-setup.md` and verify the server can load the openai-oauth binding without printing secrets. Do not run these cases against a real openai-oauth provider before that prerequisite is complete.

Required manual smoke cases:

| Case | Driver | Scenario | Pass condition |
|---|---|---|---|
| OAUTH-01 | `openai_oauth_responses` | Pure text LINE-style order | Streams or returns response through Steel provider adapter |
| OAUTH-02 | `openai_oauth_responses` | Backend API tool call | Model emits tool call, backend executes, sanitized result returns to model |
| OAUTH-03 | `openai_oauth_responses` | Structured workbook patch | Patch passes backend schema validation and updates workbook |
| OAUTH-04 | `openai_oauth_responses` | Image/PDF/XLSX capability probe | Passed capability is recorded, or typed unsupported error is returned when matching fallback is disabled or secondary capability is not passed |
| API-01 | `openai_api` | Official Responses API conversation | `conversation` pattern works and previous response ID is audit only |
| API-02 | `openai_api` | Customer-visible workbook from chat | Creates or patches a seven-sheet workbook |
| API-03 | `openai_api` | File/vision/XLSX explicit fallback | Produces evidence or low-confidence/manual-review result without corrupting workbook |

Evidence to record in `tasks/todo.md` review:

- Provider and model.
- Capability case ID.
- Provider session/conversation/response IDs when available.
- Fallback or unsupported reason when relevant.
- Tool call IDs.
- Workbook ID/version.
- Context refs.
- Any typed provider error category.

## Phase Gate

Do not move to Phase 4 until:

- One authenticated Chat Workspace vertical slice works with API mock data and mocked providers.
- The Chat Workspace is implemented as an independent Steel workspace, with no MVP dependency on changing the core LibreChat chat store/message flow.
- Desktop and mobile use the same Steel UX framework and data contracts.
- Mobile Workbook Preview uses a full-view modal with top-right close control.
- Phase 3 UI supports multiple selected workbook targets per submit when each marker has clear sheet and field/cell position.
- Selected workbook cells are represented as structured refs in message requests and drive workbook patch sync after AI processing; backend targeting does not depend on parsing marker text alone.
- Workbook patches do not require per-update user confirmation in Phase 3.
- Latest updated workbook cells/fields are visibly highlighted with a background color after accepted patches, until replaced by the next accepted patch.
- Failed or rejected patch attempts show a chat explanation and do not highlight workbook fields.
- Phase 3 has no explicit Undo button; revert/change requests go through chat and the validated patch service.
- Successful AI workbook patches include a concise chat summary of changed fields, not a full diff table.
- Backend model selector returns driver capability status and hides failed/disabled runtime options.
- openai-oauth and OpenAI provider adapters are injectable and tested without real external calls.
- Capability smoke records exist for all MVP model/provider options.
- openai-oauth binding setup is complete before real openai-oauth provider smoke or Steel chat UI live testing.
- openai-oauth responses live smoke creates or patches a customer-visible workbook for a text/tool/structured workflow.
- Official OpenAI API fallback live smoke creates or patches a customer-visible workbook and verifies the official `conversation` pattern.
- File/vision/XLSX capability failures either fallback to `openai_api` when enabled or return typed low-confidence/manual-review errors.
- Provider unsupported/fallback UI is rendered as inline small warning text in the chat transcript, not toast.
- Workbook Preview renders all seven tabs and hides customer-blocked fields.
- Workbook patch concurrency is tested.
- Provider run records include requested provider, effective provider, selected model, provider IDs when available, context refs, tool call IDs, fallback status, and typed provider error categories.
- Workbook JSON contains all seven fixed sheets.
- No AI output can directly mutate MongoDB/Supabase outside whitelisted services.
