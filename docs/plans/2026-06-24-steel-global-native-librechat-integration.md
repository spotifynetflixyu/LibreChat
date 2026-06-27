# Steel Native LibreChat Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Steel workflow a global native LibreChat behavior while preserving the original LibreChat UI, chat history, memory, skills, MCP, tools, presets, model settings, SSE, abort, resume, file handling, and permissions.

**Architecture:** Add a Steel global augmentation layer to native LibreChat agent execution. Steel rules are prepended at the top of native agent context; Steel runtime context, tools, MCP, skills, Markdown persistence, and provider policy are merged additively into the existing LibreChat modules instead of replacing them or routing users through `/steel/oauth-chat`.

**Tech Stack:** LibreChat monorepo, `packages/api` TypeScript for new backend logic, `/api` thin JS integration only, MongoDB for LibreChat chat/conversation state, Supabase `steel` schema for Steel business data, OpenAI Responses API by API key, OpenAI OAuth provider in stateless mode, existing AgentClient/LangGraph execution path.

---

## Master Framework Reference

The canonical project framework and module lookup index is `docs/steel-native-librechat-master-framework.md`.

Use that document to find module ownership, hook locations, context ordering, provider-state policy, Markdown persistence behavior, route boundaries, and verification expectations. This document is the implementation plan for building those modules. If a module is added, renamed, moved, or replaced while executing this plan, update the master framework document in the same change.

## Locked Product Decision

Steel must become a global native LibreChat behavior.

That means:

- The user sees and uses the normal LibreChat chat interface.
- LibreChat remains responsible for chat history, message persistence, regenerate/edit, files, user memory, skills, MCP, tools, presets, model selector, SSE, abort/resume, permissions, and billing.
- Steel adds rules/context/tools/MCP/skills/Markdown persistence on top of those modules.
- Steel rules must be loaded at the top of context.
- Existing user-added skills, memories, MCP servers, and settings must continue to work.
- Steel-enabled Open Responses requests must be durable and LibreChat-managed, equivalent to `store:true`. Do not implement a Steel `store:false` state path.
- `/steel/oauth-chat` is dev-only. It may be used during development for workflow smoke tests and activity-log inspection, but it is not the user workflow, not the implementation base, and not a production integration path.

## Current Code Path Findings

### Standalone Steel Path

Current `/steel/oauth-chat` is a parallel implementation:

- `client/src/routes/index.tsx` registers the standalone route.
- `client/src/routes/SteelOAuthChat.tsx` owns local message state, activity state, stream events, and calls `dataService.streamSteelChat`.
- `packages/data-provider/src/data-service.ts` exposes `streamSteelChat`.
- `api/server/routes/steel/index.js` routes to `/api/steel/ai/chat/stream`.
- `packages/api/src/steel/handlers.ts` parses Steel chat requests, prepares Steel history/runtime context, streams NDJSON, captures structured quote/workbook state currently named `Working Order Memory` in code, and calls `sendSteelOAuthChat`.
- `packages/api/src/steel/ai/provider.ts` uses `openai-oauth-provider` with `responsesState: false`, so it is stateless and reconstructs prompt/context on every provider round.

This proves the workflow, but it bypasses native LibreChat modules.

Use this route only for development diagnostics:

- quick OAuth provider smoke tests
- activity-log inspection while native event mapping is still being built
- fixture comparison when validating native parity

Do not add new product behavior only to this route. Any behavior proven here must be moved into the native Steel global layer before it is considered part of the project architecture.

### Native LibreChat Chat Path

Native chat path already provides the modules Steel must preserve:

- `api/server/controllers/agents/request.js` creates resumable jobs through `GenerationJobManager`, pre-generates `conversationId`, and supports SSE resume/abort.
- `api/server/services/Endpoints/agents/initialize.js` initializes primary, handoff, addedConvo, and subagents; resolves tools, MCP auth, skills, permissions, model validation, and event handlers.
- `api/app/clients/BaseClient.js` owns `sendMessage`, `loadHistory`, user/assistant message persistence, token counts, conversation save, edit/regenerate, and attachment persistence.
- `api/server/controllers/agents/client.js` builds ordered history, formats messages, applies file context/RAG, runs LibreChat memory, builds scoped agent context, applies MCP instructions, primes skills, executes tools, records usage, and saves output.
- `packages/api/src/agents/context.ts` applies agent instructions, MCP instructions, and dynamic run context.
- `packages/api/src/agents/skills.ts` injects skill catalog and skill primes without replacing user-selected skills.
- `api/server/services/ToolService.js` loads tool definitions, tool registry, MCP tools, OAuth events, file search, code execution, web search, actions, and deferred/programmatic tools.
- `api/server/controllers/agents/responses.js` implements the external Open Responses-compatible route with its own previous-response/history and tool execution path.

The global Steel integration must hook into these paths rather than creating another chat stack.

## Implementation Research Checklist

Before implementing any phase, preserve these audited constraints:

- Native LibreChat chat reconstructs context from LibreChat Mongo message history plus LibreChat Memory, instructions, MCP, skills, files/RAG, tools, and pruning/summarization. Steel must extend that reconstruction path instead of replacing it with provider-only state.
- Steel rules/tool policy must be injected as a stable top prefix. Steel runtime data is volatile and belongs later near the current turn; do not put all Steel state in `sharedRunContext` or at the top.
- `useResponsesApi: true` currently means native OpenAI Responses transport with reconstructed messages. It does not automatically mean LibreChat sends only the latest user message with `previous_response_id`.
- LangChain/OpenAI can forward a top-level `previous_response_id` call option to `this.client.responses.create(...)`, but LibreChat does not currently synthesize that option from prior OpenAI `response.id` values.
- Implement `openai_responses_previous_response_id` only after provider `response.id` persistence, lookup by LibreChat conversation/message ids, call-option injection, and reconstructed-context fallback are all implemented and tested.
- The external `/api/agents/v1/responses` route uses `previous_response_id`
  as a LibreChat conversation/history key and resends DB-reconstructed history;
  generated `resp_*` ids resolve through the saved assistant message id back to
  the LibreChat `conversationId`.
- Steel-enabled Open Responses must be durable and LibreChat-managed, equivalent to `store:true`; do not add a Steel `store:false` branch.
- Keep LibreChat user Memory separate from Steel structured quote/workbook state, even when existing Steel service names contain `Memory`.
- Final assistant Markdown capture must run after assistant message persistence succeeds. Use a native UI post-save hook around the assistant `databasePromise`, and use `responses.js` `saveResponseOutput()` after `db.saveMessage` for Open Responses.
- LibreChat file records and permissions remain canonical. Native provider vision/file inputs must still be available to the AI agent for drawing reasoning such as holes, bends, slots, and cut marks. When OCR/table extraction is needed, use PaddleOCR MCP OCR (`PaddleOCR-VL-1.6` / `paddleocr_vl`) to parse text/table content, and reuse persisted OCR Markdown state on follow-up turns.
- `/steel/oauth-chat` is dev-only. It may provide fixture smoke evidence and activity-log comparison, but product behavior must be implemented in native LibreChat hooks.

## Module And Entrypoint Map

See `docs/steel-native-librechat-master-framework.md`.

Do not duplicate the canonical module map here. This plan names concrete files inside each implementation phase only.

## Context Architecture

### Ordering Contract

Use a KV-cache-friendly static-to-dynamic order for native agent context:

1. Steel rules.
2. Steel tool policy.
3. Existing LibreChat agent/system instructions.
4. Existing LibreChat MCP server instructions.
5. Stable LibreChat skill catalog / stable always-available skill instructions.
6. LibreChat user Memory.
7. Normal chat history from LibreChat `Message` records.
8. Steel runtime data: active quote/workbook state, file/OCR state, current turn state.
9. Current-turn dynamic skill primes, including manual `$` skills and any per-turn generated prime bodies.
10. Current user message.

Steel rules and stable tool policy belong near the top because they change rarely and define global behavior. Steel runtime data belongs near the tail because it is conversation/turn-specific and may change every turn; putting it after LibreChat chat history preserves more reusable prefix for provider KV/prompt caching and keeps the latest structured state close to the current user message.

Do not put Steel rules only into `sharedRunContext`, because the current native code appends `sharedRunContext` to `additional_instructions`. That would make Steel a system-tail, not the top of context. Also do not put all Steel runtime data at the top with the rules; only stable rules/tool policy should be in the cache-friendly prefix.

### New Shared Module

Add a TypeScript native adapter under `packages/api/src/steel/native/`.

Suggested files:

- `context.ts`
- `tools.ts`
- `skills.ts`
- `mcp.ts`
- `provider.ts`
- `markdown.ts`
- `events.ts`
- `index.ts`

The adapter should expose these functions:

- `buildSteelGlobalAgentContext(input)`
- `applySteelGlobalInstructions(agent, context)`
- `mergeSteelToolDefinitions(input)`
- `mergeSteelSkillPrimes(input)`
- `resolveSteelProviderStatePolicy(input)`
- `createSteelNativeToolExecutor(input)`
- `captureSteelNativeMarkdownState(input)`
- `mapSteelRuntimeEventToLibreChatEvent(input)`

Keep `/api` changes thin. JS files should call TypeScript exports from `@librechat/api` or `packages/api`, not implement Steel business logic.

### Steel Context Source

Use existing Steel runtime context as the source of truth:

- `packages/api/src/steel/runtime/context.ts`
- `prepareSteelRuntimeContext`
- `serializeSteelRuntimeContext`
- `steelRuntimeActiveOutputSheetIds`
- `steelRuntimeAiVisibleTools`
- `steelRuntimeCompactWorkbookAiVisibleTools`

Default to `compact_workbook` unless a test or rollback path explicitly needs full context.

Runtime sources:

- Reviewed Steel rules from Supabase `steel` schema repositories.
- Structured quote/workbook state from Mongo-backed Steel readers currently named `Output Sheet Memory` in code.
- Current LibreChat conversation and message ids.
- Current turn attachments from LibreChat file records.
- Existing `fileAnalysis.instructions` for native file/image/PDF guidance.

Do not use `docs/reference` as runtime data.

## Stateful And Stateless Provider Policy

LibreChat chat history must remain the source of truth in both modes.

### OpenAI OAuth Stateless Mode

For OpenAI OAuth API in normal LibreChat chat:

- Route through the native provider adapter in `packages/api/src/steel/native/provider.ts`, not through `/steel/oauth-chat`.
- Keep `responsesState: false`.
- Do not rely on provider-side `previous_response_id`.
- Reconstruct full provider prompt from LibreChat history plus Steel global context every turn.
- Preserve native LibreChat stream, abort/resume, tools, files/vision inputs, permissions, and message persistence.
- Persist final chat messages through LibreChat `Message` records.
- Persist Steel structured quote/workbook state through Steel services keyed by LibreChat `conversationId` and `messageId`. The current code names for these state readers/writers are `Output Sheet Memory` and `Working Order Memory`, but they are not the LibreChat user Memory feature.
- Track enough metadata to audit the mode, including `steel.providerStateMode = openai_oauth_stateless`.

### OpenAI Responses Stateful Mode

For official OpenAI API key path:

- LibreChat OpenAI model config should default `useResponsesApi: true` for Steel-enabled OpenAI specs.
- API-key Responses can use stateful provider features only as an optimization.
- LibreChat Mongo history remains canonical.
- If provider state is missing, incompatible, disabled, or the user setting explicitly opts out, fall back to reconstructed stateless context.
- Store enough metadata to audit which mode ran:
  - `steel.providerStateMode`
  - `steel.contextMode`
  - `steel.runtimeContextVersion`
  - `steel.usedPreviousResponseId`
  - `steel.fallbackReason`

Current native provider audit:

- `@langchain/openai` can pass a call option `previous_response_id` through to OpenAI SDK `this.client.responses.create(...)`.
- It also auto-selects the Responses implementation when that call option exists.
- Both streaming and non-streaming LangChain Responses paths still send `input: convertMessagesToResponsesInput({ messages, ... })`, so any LibreChat-reconstructed messages in the run are sent with the request.
- Native LibreChat agent runs currently rebuild history from LibreChat `Message` records and prepend agent/system instructions each run.
- No native AgentClient/provider hook currently persists an OpenAI `response.id` and injects it as the next run's call option.
- Therefore today's native `useResponsesApi: true` path should be treated as `openai_responses_reconstructed`; only a future verified resolver should mark `openai_responses_previous_response_id`.
- OpenAI's own conversation-state guide says previous-turn tokens in a `previous_response_id` chain are still billed as input tokens, so this should not be documented as a free token or KV-cache bypass.

### External Open Responses Route

`api/server/controllers/agents/responses.js` has its own `previous_response_id` logic and does not call `AgentClient.buildMessages`.

Global Steel behavior must be added there too, otherwise API-key/Open Responses callers will miss Steel rules/tools/context even if the UI path works.

Current audit result:

- The route is mounted at `POST /api/agents/v1/responses`.
- It implements an Open Responses-compatible facade locally; it emits `object: 'response'`, but repo search found no direct `client.responses.create()` call in this route path.
- On continuation, `previous_response_id` is resolved as either a direct
  LibreChat conversation id or a generated saved assistant `resp_*` message id.
- Generated `resp_*` response ids are resolved through the saved assistant
  `Message.messageId` to the durable LibreChat `conversationId`; direct
  conversation-id continuation remains supported.
- The resolved `conversationId` is used to load previous messages from Mongo
  through `db.getMessages({ conversationId, user })`.
- Current input is converted and merged with previous messages before `formatAgentMessages()` and `createRun()`.
- The current route therefore resends reconstructed LibreChat history every continuation turn. It is not a provider-side state-only path that sends only the latest user input.
- The returned response `id` is a generated `resp_*` and is saved as the
  assistant `messageId`, so `previous_response_id = prior response.id` can
  resolve back to the same LibreChat conversation after storage.

## Missing Module Audit

| Module | Current status | Needed for global Steel |
|---|---|---|
| Native LibreChat UI | Existing chat UI works | No new Steel chat UI required; `/steel/oauth-chat` is dev-only for smoke/activity-log inspection |
| LibreChat history | `BaseClient.loadHistory()` reconstructs Mongo message chain | Bind Steel structured quote/workbook state to native `conversationId`, `messageId`, edit/regenerate semantics |
| Context top ordering | `applyContextToAgent()` currently appends run context to `additional_instructions` | Add explicit Steel global instruction prefix before base agent instructions |
| Steel runtime context | Exists for standalone Steel path | Expose reusable native builder that consumes LibreChat messages/files |
| OpenAI OAuth API native chat | Exists in `sendSteelOAuthChat` with `responsesState: false` only in the dev probe | Implement through the native provider adapter so normal LibreChat chat can use OpenAI OAuth API without replacing LibreChat history, stream, files, tools, or permissions |
| OpenAI API key Responses | General LibreChat `useResponsesApi` exists | Implement Steel official API provider path and default Responses API for Steel-enabled OpenAI specs |
| Tool registry | Native `ToolService` builds `toolDefinitions/toolRegistry` | Add Steel tools as additive native definitions and event-driven execution handlers |
| Steel tool execution | `executeSteelTool` exists | Wrap as native LibreChat tool executor with structured state capture and event mapping |
| MCP | Native MCP server/tool/OAuth flow exists | Add Steel MCP as config/permission-aware MCP entries or native tool wrappers, not a separate auth path |
| Skills | Native catalog, manual primes, always-apply primes exist | Add Steel skills/rules as additive always-apply primes or instruction prefix while preserving user skills |
| LibreChat user Memory | `AgentClient.useMemory()` and memory agent exist | Keep it intact; Steel structured state is separate and must not mutate LibreChat user Memory |
| File handling | Native file context and Responses `input_file` encoding exist | Bridge Steel OCR/file evidence to LibreChat file records; OCR/table extraction should use PaddleOCR MCP OCR and persist assistant OCR Markdown |
| Streaming | Native resumable SSE via `GenerationJobManager` exists | Map Steel progress/tool/memory events into existing run-step/custom events, not NDJSON |
| Abort/resume | Native job manager supports abort/resume | Use native lifecycle; standalone Steel close handler is not enough |
| Settings/model specs | Existing modelSpecs/presets and `useResponsesApi` setting exist | Add Steel defaults through modelSpecs/config, preserve explicit user choices unless admin enforces |
| Permissions | Native role/resource permissions exist | Do not add Steel-specific role/capability gates; Steel modules and read-only AI tools are globally open by default while LibreChat continues to own file, MCP, provider/model, and admin-setting permissions |
| Steel structured quote/workbook state | Existing Steel state readers/writers are currently named memory readers/writers in code | Key to LibreChat conversation/message ids and honor edit/regenerate rollback |
| Markdown auto parse/save/update/overwrite | Existing standalone Steel path parses assistant Markdown and saves Steel structured state | Add native adapter so UI chat and Agents API routes capture final assistant Markdown, current workbook/OCR snapshots, tool facts, and edit/regenerate chat-turn rollback |
| Conversation API route | `/api/agents/chat` handled by AgentClient | Hook Steel global layer here |
| Open Responses API route | Separate `responses.js` route | Hook Steel global layer here too |
| Tests/evals | Existing focused Steel and agent tests | Add tests for context order, additive tools/skills/MCP, stateful/stateless fallback, history persistence |
| Dev-only probe cleanup | Standalone route still exists | Keep explicitly dev-only; remove or hide separately after native diagnostics cover the same activity-log needs |

Main missing modules are the native Steel adapter, additive native tool registration, native Markdown persistence adapter, native provider-state policy, event mapping, and shared integration into both `AgentClient` and `responses.js`.

## Extension Feasibility Check

The current LibreChat modules can support this design as an extension. The target implementation should add Steel adapter code and thin hook points, not rewrite LibreChat chat, memory, MCP, tools, or skills modules.

### Thin Hook Points

- `api/server/controllers/agents/client.js`: call the Steel native context adapter during `buildMessages`. Keep `BaseClient.loadHistory()` and `BaseClient.saveMessageToDatabase()` unchanged.
- `packages/api/src/agents/context.ts`: add an optional stable Steel prefix parameter to `applyContextToAgent()` so Steel rules/tool policy can be prepended before existing agent instructions.
- `api/server/controllers/agents/client.js` / `packages/api/src/agents/skills.ts`: insert Steel runtime data as a current-turn meta context block near the tail, before the current user message, using the same style of index-safe insertion already used by skill primes.
- `api/server/services/ToolService.js`: merge Steel native tool definitions into existing `toolDefinitions/toolRegistry`; keep existing tool loader, deferred tool execution, MCP OAuth, actions, file search, web search, and code execution flow.
- `api/server/services/Endpoints/agents/initialize.js`: populate per-agent tool contexts with the merged Steel registry and state writer; keep `agentToolContexts`, `ON_TOOL_EXECUTE`, and `GenerationJobManager` lifecycle intact.
- `api/server/controllers/agents/responses.js`: apply the same Steel adapter to this route's separate message formatting and tool execution path. This is a duplicate hook location, not a new architecture.
- Native final assistant persistence hooks: call the Steel Markdown persistence adapter at the assistant-message persistence boundary, after the final assistant message save succeeds. For native UI chat, use a thin optional post-save lifecycle hook around `BaseClient.sendMessage()`'s assistant `databasePromise`; for Open Responses, hook `responses.js` `saveResponseOutput()` after `db.saveMessage` succeeds. Keep Steel logic in `packages/api/src/steel/native/markdown.ts`, not in generic LibreChat persistence code.

### New Adapter Code

Add new TypeScript modules under `packages/api/src/steel/native/` for Steel-specific logic:

- context building and message conversion
- stable prefix construction
- current-turn runtime-data meta message construction
- tool definition/registry merge
- structured state capture after Steel tool calls
- Markdown parse/save/update/overwrite capture after final assistant output
- provider state policy
- event mapping

### Modules To Preserve

Do not replace or fork these LibreChat modules:

- `BaseClient.loadHistory()` and message persistence
- LibreChat user Memory via `AgentClient.useMemory()`
- existing skill catalog, manual skill primes, and always-apply skill handling
- existing MCP config/auth/OAuth flow
- existing tool execution callbacks
- existing SSE, abort, resume, and content aggregation
- existing model settings and modelSpecs behavior, except setting Steel-enabled OpenAI defaults through configuration

### Non-Goal

Do not make `/steel/oauth-chat` the implementation base for native chat. It is only a development probe for smoke testing and activity-log inspection.

## Implementation Plan

### Phase 1 - Native Steel Context Adapter

Create `packages/api/src/steel/native/context.ts`.

Tasks:

- Convert LibreChat `TMessage`/formatted messages into `SteelOAuthChatMessage` input for `prepareSteelRuntimeContext`.
- Treat Steel as globally applied native behavior; do not make Phase 1 context correctness depend on a model-spec opt-in marker.
- Do not add code that classifies ordinary chat as non-Steel and skips the framework; the AI decides whether Steel quoting behavior is relevant.
- Do not add new `librechat.yaml` schema/config for Phase 1. Steel native
  context should use existing LibreChat config surfaces only where they already
  exist, such as model specs, endpoint config, and permissions. Do not duplicate
  reviewed Steel OCR/file rules into `fileAnalysis.instructions`.
- Preserve current user turn, file metadata, and active history.
- Build native render outputs from the Steel runtime context:
  - `instructionPrefix`, using fixed order: agent rules, quote defaults/rules,
    output rules, tool policy, other rules including OCR/file rules, reviewed
    agent rules, instruction packets.
  - `runtimeContext`, carrying compact workbook/state metadata near the tail.
- Do not conditionally omit OCR/file rules or other rule groups from the global
  prefix.
- Add stable diagnostic metadata, including native context version, context mode,
  render profile, and `globalApplied: true`.
- Default `runtimeContextMode` to `compact_workbook`.
- Do not inline attachment bytes/base64 into Phase 1 Steel context; carry only
  LibreChat file metadata/references there. The actual attachment should still
  flow through LibreChat's native provider file/vision path when supported, and
  OCR/tool byte access should use the permission-checked file pipeline.
- Do not auto-inject OCR text into every prompt when LibreChat receives or loads
  a file. When structured OCR/table extraction or durable drawing evidence is
  needed, use PaddleOCR MCP OCR (`paddleocr_vl`) and persist the assistant's OCR
  confirmation Markdown.
- Do not introduce a Phase 1 runtime disable switch. Tests should use dependency
  injection, no-op dependencies, or mocks to verify behavior without adding a
  product path that disables global Steel.
- Return both:
  - `instructionPrefix`: for top-of-context Steel rules.
  - `runtimeContext`: for tools and structured state writers.

Tests:

- Unit test rules appear before base agent instructions.
- Unit test existing `additional_instructions`, memory, RAG, and file context remain present.
- Unit test no runtime context is built from `docs/reference`.

### Phase 2 - Hook Native AgentClient

Modify native chat path with minimal JS changes:

- In `api/server/controllers/agents/client.js`, call the new Steel native context builder during `buildMessages`.
- Extend `packages/api/src/agents/context.ts` to accept optional `globalInstructionPrefix`.
- Build final instructions as:
  - Steel prefix
  - base agent instructions
  - MCP instructions
- Keep `additional_instructions` as:
  - existing additional instructions
  - existing shared run context

Tests:

- `AgentClient.buildMessages` context-order test.
- Regression test that LibreChat memory is still injected.
- Regression test that skill primes still insert before the latest user message.
- Regression test that MCP instructions still append after base instructions.

### Phase 3 - Additive Steel Tools

Create `packages/api/src/steel/native/tools.ts`.

Tasks:

- Convert `getSteelToolDefinitions({ contextMode })` to native `LCTool` definitions.
- Merge Steel tool definitions into `toolDefinitions` and `toolRegistry`.
- Register only tools allowed by `SteelRuntimeContext.toolPolicy.aiVisibleTools`.
- Use unique names if needed to avoid collisions, for example `steel_search_price_candidates`; add prompt/tool aliases only if model behavior requires it.
- Execute tools through `executeSteelTool`.
- Capture successful tool output into Steel structured state using the existing writer.
- Preserve existing user tools, MCP tools, actions, web search, file search, and code execution.

Tests:

- Existing user tools remain in `toolDefinitions`.
- Steel tools are added when enabled.
- Duplicate tool names are rejected or namespaced deterministically.
- Tool execution writes structured state for successful Steel tool calls.
- `read_markdown` appears only in compact workbook mode and reads current
  conversation-scoped Markdown text for either `scope: "workbook"` or
  `scope: "ocr"`.

### Phase 4 - Steel MCP And Skills

Create `packages/api/src/steel/native/mcp.ts` and `skills.ts`.

Tasks:

- Decide whether Steel MCP should be exposed as configured MCP servers or native wrappers.
- If exposed as MCP, register through existing MCP config and permissions, so OAuth and auth maps stay native.
- If exposed as native wrappers, document why and still route through `toolRegistry`.
- Add Steel skills/rules additively:
  - Steel rules in instruction prefix for mandatory global behavior.
  - Optional Steel skills as always-apply primes only when they are real LibreChat skills.
- Preserve manual user `$` skills.
- Preserve per-user skill active/deactivated states.

Tests:

- User manual skill and Steel always-apply skill both appear.
- Manual skill wins duplicate-name ordering as current `injectSkillPrimes` expects.
- MCP OAuth event flow still emits native run-step events.

### Phase 5 - Native Provider Adapter And Provider State Resolver

Create `packages/api/src/steel/native/provider.ts`.

Tasks:

- [x] Add standard normal LibreChat chat support for OpenAI OAuth API through the native Steel provider adapter.
- [x] Reuse the existing `openai-oauth-provider` behavior where appropriate, but do not route product traffic through `/steel/oauth-chat`.
- [x] Preserve native LibreChat stream, abort/resume, tool calls, provider file/vision inputs, usage metadata, message persistence, and permissions in OAuth mode for standard single-agent native chat runs.
- [x] Resolve per-turn provider mode:
  - `openai_oauth_stateless`
  - `openai_responses_reconstructed`
  - `openai_responses_previous_response_id`
- [x] For OAuth, require reconstructed context, `responsesState: false`, and no `previous_response_id` in the provider policy.
- For official OpenAI API key, prefer Responses API when model/spec supports it.
- [x] Default Steel-enabled OpenAI modelSpecs to `useResponsesApi: true` in native policy resolution.
- [x] Preserve explicit user `useResponsesApi: false` unless an admin-enforced Steel spec requires otherwise.
- [x] Keep native Responses in `openai_responses_reconstructed` until OpenAI `response.id` persistence, lookup, and call-option injection are implemented.
- [x] Only set `openai_responses_previous_response_id` when a persisted provider response id is available and previous-response-id mode is explicitly allowed.
- [x] Add fallback metadata to assistant message metadata for native AgentClient runs.
- [x] Wire the native run/model factory so `openai_oauth_responses` can execute through `openai-oauth-provider` in the normal LibreChat chat path.
- [x] Keep the root LangChain peer surface installable for native API tests and
  provider imports by declaring root `@langchain/core@^1.2.1`; this satisfies
  the hoisted `@langchain/openai` and nested OAuth/provider imports without
  routing product traffic through `/steel/oauth-chat`.
- Add a later per-agent model factory seam before claiming multi-agent OAuth support; the current Graph `overrideModel` seam is only safe for standard single-agent native chat.

Tests:

- [x] Native LibreChat chat can select OpenAI OAuth API without using `/steel/oauth-chat` in the standard single-agent path.
- [x] OAuth provider policy always uses reconstructed context with `responsesState: false`.
- [x] OAuth transport preserves native stream, abort, files/vision inputs, tool execution, and message persistence surfaces in adapter/run contract tests.
- [x] API-key Responses defaults to `openai_responses_reconstructed` before previous-response-id resolver is wired.
- [x] API-key Responses uses `openai_responses_previous_response_id` only when a persisted provider response id is found and passed to the next model call.
- [x] Missing provider state falls back to reconstructed context.
- [x] API `AgentClient` and `ToolService` focused integration tests load the
  native Steel/OAuth dependency graph and pass after regenerating ignored
  `packages/api/dist` from the current TypeScript sources.
- [x] Explicit user `useResponsesApi: false` is preserved in non-enforced specs.

### Phase 6A - Hook External Chat Completions Route

Modify `api/server/controllers/agents/openai.js`.
Use `packages/api/src/steel/native/agents.ts` for reusable context application
logic.

Tasks:

- [x] Build Steel global context for `/api/agents/v1/chat/completions` after
  primary and discovered agent initialization, and before
  `formatAgentMessages()` / `createRun()`.
- [x] Use render profile `agents_chat_completions` so diagnostics can
  distinguish this route from native UI and Open Responses routes.
- [x] Apply Steel instruction prefix to each initialized primary and handoff
  agent's stable `instructions`.
- [x] Append Steel runtime context to each initialized primary and handoff
  agent's dynamic `additional_instructions`.
- [x] Set request-scoped Steel metadata with `conversationId`, request id, and
  turn/checkpoint indexes so native Steel tool execution can share the same
  state boundary.
- [x] Keep `api/server/controllers/agents/openai.js` as a thin route-shape
  bridge; reusable mutation logic lives in `packages/api/src/steel/native`.
- [x] Preserve existing remote-agent permissions, skill primes, MCP/tool
  execution, streaming/non-streaming response behavior, and usage billing.
- If `packages/api/src/agents/openai/service.ts` becomes the mounted route in a
  later refactor, wire the same helper there instead of creating a second Steel
  context path.

Tests:

- [x] OpenAI-compatible controller builds and applies Steel context before
  `createRun`.
- [x] Primary and discovered handoff agents are both passed through the Steel
  context application hook.
- [x] The reusable package helper preserves the fixed context order:
  Steel prefix before base instructions, Steel runtime after existing dynamic
  context.
- [x] Existing conversation ownership, billing, recursion limit, and sub-agent
  tool context tests still pass.

### Phase 6B - Hook External Open Responses Route

Modify `api/server/controllers/agents/responses.js`.

Tasks:

- [x] Build Steel global context before `formatAgentMessages`.
- [x] Require or normalize durable storage for Steel-enabled Open Responses
  requests so they are equivalent to `store:true`.
- [x] Apply Steel instruction prefix to primary and discovered agent configs.
- [x] Append Steel runtime context after existing per-agent attachment context.
- [x] Merge Steel tools into each relevant agent tool registry through the
  native `ToolService` definitions/execution path.
- [x] Preserve DB-backed continuation loading and normalize generated
  `resp_*` response ids back to the saved LibreChat conversation.
- [x] Add a resolver that maps generated `resp_*` response ids back to the
  LibreChat `conversationId` through the saved assistant message id.
- [x] Store Steel metadata on the saved response.
- [x] Keep this route as reconstructed-history mode unless the provider-state resolver explicitly routes a compatible API-key OpenAI Responses flow.

Tests:

- [x] `/api/agents/v1/responses` sees Steel top context.
- [x] `previous_response_id` history still loads.
- [x] A follow-up using the previous response body's `id` resolves to the same
  LibreChat conversation.
- [x] The route does not silently treat a generated `resp_*` as a conversation
  id unless such a conversation actually exists.
- [x] Steel-enabled Open Responses cannot run as a non-stored Steel state flow.
- [x] Streaming and non-streaming responses both execute Steel tools through the
  shared native tool execution callback path.

### Phase 7 - File And OCR Bridge

Tasks:

- Reuse native LibreChat file records and attachment permissions.
- Preserve native provider file/vision inputs so the AI agent can inspect
  uploaded drawings/images/PDFs directly for holes, bends, slots, cut marks,
  dimensions, and visual cross-checks.
- When a LibreChat file message or attachment needs OCR/table extraction, pass the permitted LibreChat file bytes and metadata into the Steel OCR path instead of bypassing native file ownership.
- Use existing document encoder support for Responses `input_file`.
- Treat reviewed Steel OCR/file rules as the authoritative OCR policy. Do not
  duplicate that policy through `fileAnalysis.instructions`; if the YAML field is
  retained for non-Steel compatibility, keep it as a short generic
  provider-vision hint.
- Default Steel table/drawing OCR to the configured PaddleOCR MCP OCR
  implementation, currently `PaddleOCR-VL-1.6` / `paddleocr_vl`; provider
  vision may still inspect attachments directly, but it is not the durable
  structured-state writer by itself.
- Ensure prior OCR/file evidence is read from Steel structured state, not prompt-inlined forever.
- Do not re-OCR the same file on later turns when persisted OCR/file-analysis state is already available, unless the user explicitly asks to re-read/re-analyze or the stored state is missing/incomplete.

Tests:

- PDF/image upload in native chat keeps OCR/file rules available and passes
  permitted attachments through the native provider file/vision path when
  supported.
- OCR text/table parsing uses PaddleOCR MCP OCR (`paddleocr_vl`) when needed,
  then the assistant outputs an OCR confirmation Markdown table.
- LibreChat PDF/image attachment requiring OCR reaches the PaddleOCR MCP OCR path.
- Previous file evidence can be used on follow-up turns.
- Follow-up turns use persisted OCR Markdown state without re-running OCR by default.
- Unauthorized file ids are rejected by native permissions before Steel sees bytes.

Current implementation status:

- Native `AgentClient` stores current-turn Steel file references on
  `req.steelNativeContext.currentTurnFiles` after LibreChat attachment
  processing keeps provider file/vision inputs intact.
- Native OCR table/text parsing is handled through PaddleOCR MCP OCR
  (`paddleocr_vl`) rather than the Steel `executeSteelTool()` business-tool
  dispatcher.
- Open Responses `convertInputToMessages()` preserves `input_file` blocks
  instead of degrading them to text placeholders, so Responses file inputs can
  continue through the model/provider path.
- Open Responses `responses.js` collects current-turn `input_file.file_id`
  references into `req.steelNativeContext.currentTurnFiles`, attaches them to
  the native Steel context input, and keeps inline `file_data` provider-visible
  without copying it into Steel
  context bytes.
- Runtime context now reuses active OCR extracts from Steel structured state:
  `prepareSteelRuntimeContext()` reads `Output Sheet Memory`
  `derivedIndex.ocrExtracts`, exposes them as
  `attachments.priorActiveFileEvidence`, and keeps OCR/file rules available on
  follow-up turns even when there is no new attachment.
- Live no-re-OCR follow-up behavior remains a Phase 7 evidence gap: the model
  should use the persisted file evidence by default and rerun PaddleOCR MCP OCR
  only when the user asks to re-read/re-analyze or stored evidence is
  missing/incomplete.

### Phase 8 - Event Mapping And UI Persistence

Create `packages/api/src/steel/native/events.ts`.
Create `packages/api/src/steel/native/markdown.ts`. Initial native UI
Markdown/tool-result persistence is implemented through
`captureSteelNativeAssistantMarkdown()` and `captureSteelNativeToolResult()`;
Open Responses persistence is implemented through
`captureSteelNativeResponseOutput()` in `saveResponseOutput()`.

Current native event mapping status:

- `packages/api/src/steel/native/events.ts` maps capture results into native
  `steel_event` stream envelopes.
- Native UI assistant Markdown capture emits `parse_status` and `memory_saved`
  after the assistant message save hook captures Steel state.
- Native Steel tool-result capture emits `memory_saved` after successful
  `executeSteelTool()` state capture.
- Native frontend SSE handling routes `steel_event` envelopes into live Steel
  activity state and renders parse/save status under the assistant message
  without mutating message content.
- External Open Responses capture intentionally does not emit custom
  `steel_event` SSE from the Open Responses-compatible route yet. Keep that
  route protocol-safe unless a LibreChat-owned side channel is introduced.

Tasks:

- [x] Reuse `packages/api/src/steel/memory/service.ts` for final assistant Markdown parsing and tool-result capture.
- [x] Add a thin optional native UI post-save lifecycle hook around `api/app/clients/BaseClient.js` `sendMessage()` where the assistant `responseMessage.databasePromise` is assigned. The hook must run only after assistant `saveMessageToDatabase()` resolves successfully.
- [x] Wire the native Steel adapter into that hook from Agent initialization/options; do not put Steel parsing logic directly in `BaseClient`.
- [x] Skip capture for partial disconnect saves, unfinished abort saves, error-only messages, temporary responses, blank content, and user messages.
- Persist emitted complete workbook/quote Markdown sheets as current snapshots by deleting prior current rows for that conversation/sheet and inserting the latest rows.
- Persist row-change or incomplete Markdown tables as calculation/manual-review evidence; do not merge them into workbook rows. The assistant must output complete updated sheets when it wants workbook rows changed.
- [x] Preserve existing tool-result fact capture for customer, price, rule, OCR, calculation, and workbook evidence in the native Steel tool execution path.
- [x] Wire `api/server/controllers/agents/responses.js` `saveResponseOutput()` to call the same Markdown adapter after `db.saveMessage` succeeds, for both streaming and non-streaming stored branches. Steel-enabled Open Responses should already be durable before this point.
- Do not use `AgentClient.chatCompletion()`, `GenerationJobManager.emitDone()`, or `packages/data-schemas/src/methods/message.ts` `saveMessage()` as the primary Markdown capture point.
- On edit/regenerate, reuse `packages/api/src/steel/history/service.ts` rollback for chat turns. Structured workbook/OCR state remains the current conversation dataset exposed to tools.
- [x] Map persisted Steel capture results to native LibreChat custom stream events
  for native UI assistant Markdown and native Steel tool execution:
  - structured state saved through `memory_saved`
  - parse/save status through `parse_status`
- [x] Route native `steel_event` envelopes through `useSSE()` and
  `useResumableSSE()` into a live frontend Steel activity surface.
- Remaining live progress mapping:
  - provider round progress
  - tool start/end
  - OCR progress
- Keep Activity/thinking live-only unless a specific final content part needs persistence.
- Do not persist internal reasoning/tool activity as chat message text.

Tests:

- Native Steel save/parse events are emitted to the native chat stream after
  persistence capture.
- Tool progress is visible in native chat.
- Native UI capture runs after the assistant message DB save succeeds and
  before controller final completion is treated as Steel-complete.
- Open Responses capture runs from `saveResponseOutput()` after the saved assistant response exists; Steel-enabled Open Responses is always durable.
- Partial disconnect saves, unfinished abort saves, error-only messages, temporary responses, and any non-Steel stateless API calls do not create active Steel Markdown state.
- Complete Markdown sheet output replaces the current conversation workbook/quote sheet.
- Row-change Markdown output is stored as calculation/manual-review evidence and does not patch workbook rows.
- Edit/regenerate excludes superseded chat turns from active context.
- Disconnect/resume keeps final assistant message and content parts.
- Abort stops provider/tool work.

### Phase 9 - Permissions, Admin Defaults, And Existing Config Surfaces

Tasks:

- Do not add `librechat.yaml` switches that disable global Steel behavior or
  selectively omit Steel rules/tools/framework. Steel is globally applied.
- Reuse existing LibreChat config surfaces where needed:
  - `modelSpecs` and endpoint config for provider/model defaults.
  - existing LibreChat permissions only for platform-owned resources such as
    files, MCP auth, provider/model config, and admin settings.
- Do not add Steel-specific role, capability, or permission gates. Steel rules,
  context, quote/OCR behavior, and read-only AI tools are globally open by
  default.
- Keep Steel global behavior enabled for all native agent execution; no
  test-only or runtime switch should disable the framework.
- Use modelSpecs/default presets to expose Steel-enabled OpenAI Responses defaults.

Tests:

- Global Steel preserves user memory/skills/tools.
- Steel native tools/context remain exposed by default without a Steel-specific
  access check, while existing LibreChat file/MCP/provider permissions still run
  through their original paths.

### Phase 10 - Parity, Dev Probe Cleanup, And Rollout

Tasks:

- Run native UI smoke for a Steel quote/OCR flow.
- Run native UI smoke for an OpenAI OAuth API Steel quote/OCR flow.
- Compare output against `/steel/oauth-chat` for the same fixture.
- Keep `/steel/oauth-chat` dev-only while it remains useful for:
  - OAuth workflow smoke tests
  - activity-log inspection
  - fixture comparison during native parity work
- Do not add user-facing requirements to `/steel/oauth-chat`.
- Remove, hide, or restrict `/steel/oauth-chat` in a separate cleanup plan once native diagnostics cover the same activity-log needs.

Tests:

- Ordinary non-quote LibreChat chat still passes with the global Steel framework present.
- Native Steel flow passes OCR, price lookup, customer lookup, quote output, structured-state follow-up, edit, regenerate, abort, resume.
- Native OpenAI OAuth API flow passes Steel text/PDF/image fixture smoke without routing through `/steel/oauth-chat`.
- `git diff --check`.
- Targeted Jest suites for `packages/api` Steel native adapter, `api` agent controller integration, and data-provider config.

Current implementation status:

- Native mock UI smoke passes for the normal LibreChat chat path with global
  Steel context/tools present by default.
- The smoke verifies backend context injection, native Steel tool exposure,
  assistant Markdown capture, native `steel_event` activity rendering, and ERP
  `system_order` item numbering with `項次=10`.
- Cloud Steel rule sync for the item-numbering policy was checked directly
  against `steel.rules`; the active reviewed output policy already contains
  `10、20、30`.
- Playwright mock UI checks require a fresh production frontend build. The
  backend serves `client/dist`, so run `npm run frontend` or
  `npm run e2e:prepare` before direct Playwright runs after client changes.
- Remaining Phase 10 evidence gaps are native PDF/image OCR fixture smoke,
  native OpenAI OAuth API smoke, and fixture comparison against the dev-only
  `/steel/oauth-chat` probe.

## Verification Matrix

| Scenario | Expected result |
|---|---|
| Ordinary non-quote LibreChat chat | Steel global framework is present; the AI does not force the quote workflow unless relevant |
| Native LibreChat chat, Steel enabled | Steel rules appear first; user memory/skills/MCP/tools still appear |
| User manually invokes a skill | Manual skill preserved; Steel additions do not suppress it |
| User has MCP server selected | MCP auth/instructions/tools still work |
| OpenAI OAuth API provider selected in native chat | Stateless reconstructed context; no provider `previous_response_id` dependency; native stream, abort, files/vision, tools, permissions, and persistence still work |
| OpenAI API key Responses selected | Responses API default on for Steel spec; provider state used only when safe |
| Provider state missing | Fallback to reconstructed context with metadata |
| PDF/image turn | FileAnalysis instructions and OCR/file rules are present; native provider vision still receives permitted attachments where supported |
| Tool call writes quote data | Steel structured state captures tool evidence and output sheet state |
| Assistant emits full system-order Markdown table | Active working-order rows are overwritten by a new snapshot |
| Assistant emits row-change Markdown table | Backend does not patch workbook rows; assistant must emit a complete sheet to update workbook data |
| Edit/regenerate | Steel structured state rolls back to the edited message boundary |
| External Responses route | Receives the same Steel global behavior as native UI chat |

## Risks And Guardrails

- Context bloat: default to `compact_workbook`; use `read_markdown` only when
  token compression or context pruning loses the complete assistant Markdown
  table/evidence needed for workbook or OCR state recovery.
- Tool collisions: namespace or deterministic collision rejection before model sees duplicate names.
- User setting loss: merge with existing settings, never replace whole agent/tool/skill arrays.
- Memory terminology contamination: keep LibreChat user Memory separate from Steel structured quote/workbook state and reviewed Steel defaults.
- Provider mismatch: make provider-state policy explicit and auditable.
- Route drift: keep `/steel/oauth-chat` dev-only and never let it become the owner for product behavior.
- Schema drift: if any Steel PostgreSQL schema changes become necessary later, update both `supabase/schema.sql` and a new migration created with `npx supabase migration new`.

## Done Definition

The integration is done when a user can use the normal LibreChat interface and get the Steel workflow globally:

- Steel rules are first in context.
- Steel tools/MCP/skills are additive.
- LibreChat user memory, manual skills, MCP, files, settings, history, edit/regenerate, SSE, abort/resume, and message persistence still work.
- OAuth stateless and OpenAI API-key Responses modes both have explicit tested context behavior.
- Normal LibreChat chat can run through OpenAI OAuth API without using `/steel/oauth-chat` as the product path.
- Steel structured workbook/OCR state, currently named `Output Sheet Memory` and
  `Working Order Memory` in code, is keyed to the native LibreChat conversation
  and represents the current dataset rather than multiple AI-selectable
  versions.
- `/steel/oauth-chat` remains dev-only and is no longer required for normal Steel work.
