# Steel Global Native LibreChat Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Steel workflow a global native LibreChat behavior while preserving the original LibreChat UI, chat history, memory, skills, MCP, tools, presets, model settings, SSE, abort, resume, file handling, and permissions.

**Architecture:** Add a Steel global augmentation layer to native LibreChat agent execution. Steel rules are prepended at the top of native agent context; Steel runtime context, tools, MCP, and skills are merged additively into the existing LibreChat modules instead of replacing them or routing users through `/steel/oauth-chat`.

**Tech Stack:** LibreChat monorepo, `packages/api` TypeScript for new backend logic, `/api` thin JS integration only, MongoDB for LibreChat chat/conversation state, Supabase `steel` schema for Steel business data, OpenAI Responses API by API key, OpenAI OAuth provider in stateless mode, existing AgentClient/LangGraph execution path.

---

## Locked Product Decision

Steel must become a global native LibreChat behavior.

That means:

- The user sees and uses the normal LibreChat chat interface.
- LibreChat remains responsible for chat history, message persistence, regenerate/edit, files, user memory, skills, MCP, tools, presets, model selector, SSE, abort/resume, permissions, and billing.
- Steel adds rules/context/tools/MCP/skills on top of those modules.
- Steel rules must be loaded at the top of context.
- Existing user-added skills, memories, MCP servers, and settings must continue to work.
- `/steel/oauth-chat` remains useful as a debug/smoke route until native parity is proven, but it is not the target user workflow.

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
- `events.ts`
- `index.ts`

The adapter should expose these functions:

- `buildSteelGlobalAgentContext(input)`
- `applySteelGlobalInstructions(agent, context)`
- `mergeSteelToolDefinitions(input)`
- `mergeSteelSkillPrimes(input)`
- `resolveSteelProviderStatePolicy(input)`
- `createSteelNativeToolExecutor(input)`
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

### OAuth Stateless Mode

For Open OAuth API:

- Keep `responsesState: false`.
- Do not rely on provider-side `previous_response_id`.
- Reconstruct full provider prompt from LibreChat history plus Steel global context every turn.
- Persist final chat messages through LibreChat `Message` records.
- Persist Steel structured quote/workbook state through Steel services keyed by LibreChat `conversationId` and `messageId`. The current code names for these state readers/writers are `Output Sheet Memory` and `Working Order Memory`, but they are not the LibreChat user Memory feature.

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

### External Open Responses Route

`api/server/controllers/agents/responses.js` has its own `previous_response_id` logic and does not call `AgentClient.buildMessages`.

Global Steel behavior must be added there too, otherwise API-key/Open Responses callers will miss Steel rules/tools/context even if the UI path works.

## Missing Module Audit

| Module | Current status | Needed for global Steel |
|---|---|---|
| Native LibreChat UI | Existing chat UI works | No new Steel chat UI required; keep `/steel/oauth-chat` only as debug/smoke until parity |
| LibreChat history | `BaseClient.loadHistory()` reconstructs Mongo message chain | Bind Steel structured quote/workbook state to native `conversationId`, `messageId`, edit/regenerate semantics |
| Context top ordering | `applyContextToAgent()` currently appends run context to `additional_instructions` | Add explicit Steel global instruction prefix before base agent instructions |
| Steel runtime context | Exists for standalone Steel path | Expose reusable native builder that consumes LibreChat messages/files |
| OpenAI OAuth stateless | Exists in `sendSteelOAuthChat` with `responsesState: false` | Reuse policy, but integrate through native AgentClient or provider adapter without replacing LibreChat history |
| OpenAI API key Responses | General LibreChat `useResponsesApi` exists | Implement Steel official API provider path and default Responses API for Steel-enabled OpenAI specs |
| Tool registry | Native `ToolService` builds `toolDefinitions/toolRegistry` | Add Steel tools as additive native definitions and event-driven execution handlers |
| Steel tool execution | `executeSteelTool` exists | Wrap as native LibreChat tool executor with structured state capture and event mapping |
| MCP | Native MCP server/tool/OAuth flow exists | Add Steel MCP as config/permission-aware MCP entries or native tool wrappers, not a separate auth path |
| Skills | Native catalog, manual primes, always-apply primes exist | Add Steel skills/rules as additive always-apply primes or instruction prefix while preserving user skills |
| LibreChat user Memory | `AgentClient.useMemory()` and memory agent exist | Keep it intact; Steel structured state is separate and must not mutate LibreChat user Memory |
| File handling | Native file context and Responses `input_file` encoding exist | Bridge Steel OCR/file evidence to LibreChat file records and existing `fileAnalysis.instructions` |
| Streaming | Native resumable SSE via `GenerationJobManager` exists | Map Steel progress/tool/memory events into existing run-step/custom events, not NDJSON |
| Abort/resume | Native job manager supports abort/resume | Use native lifecycle; standalone Steel close handler is not enough |
| Settings/model specs | Existing modelSpecs/presets and `useResponsesApi` setting exist | Add Steel defaults through modelSpecs/config, preserve explicit user choices unless admin enforces |
| Permissions | Native role/resource permissions exist | Add Steel capability gates for rules/tools/data access; do not bypass existing role checks |
| Steel structured quote/workbook state | Existing Steel state readers/writers are currently named memory readers/writers in code | Key to LibreChat conversation/message ids and honor edit/regenerate rollback |
| Conversation API route | `/api/agents/chat` handled by AgentClient | Hook Steel global layer here |
| Open Responses API route | Separate `responses.js` route | Hook Steel global layer here too |
| Tests/evals | Existing focused Steel and agent tests | Add tests for context order, additive tools/skills/MCP, stateful/stateless fallback, history persistence |
| Cleanup | Standalone route still exists | Deprecate only after parity and smoke coverage |

Main missing modules are the native Steel adapter, additive native tool registration, native provider-state policy, event mapping, and shared integration into both `AgentClient` and `responses.js`.

## Extension Feasibility Check

The current LibreChat modules can support this design as an extension. The target implementation should add Steel adapter code and thin hook points, not rewrite LibreChat chat, memory, MCP, tools, or skills modules.

### Thin Hook Points

- `api/server/controllers/agents/client.js`: call the Steel native context adapter during `buildMessages`. Keep `BaseClient.loadHistory()` and `BaseClient.saveMessageToDatabase()` unchanged.
- `packages/api/src/agents/context.ts`: add an optional stable Steel prefix parameter to `applyContextToAgent()` so Steel rules/tool policy can be prepended before existing agent instructions.
- `api/server/controllers/agents/client.js` / `packages/api/src/agents/skills.ts`: insert Steel runtime data as a current-turn meta context block near the tail, before the current user message, using the same style of index-safe insertion already used by skill primes.
- `api/server/services/ToolService.js`: merge Steel native tool definitions into existing `toolDefinitions/toolRegistry`; keep existing tool loader, deferred tool execution, MCP OAuth, actions, file search, web search, and code execution flow.
- `api/server/services/Endpoints/agents/initialize.js`: populate per-agent tool contexts with the merged Steel registry and state writer; keep `agentToolContexts`, `ON_TOOL_EXECUTE`, and `GenerationJobManager` lifecycle intact.
- `api/server/controllers/agents/responses.js`: apply the same Steel adapter to this route's separate message formatting and tool execution path. This is a duplicate hook location, not a new architecture.

### New Adapter Code

Add new TypeScript modules under `packages/api/src/steel/native/` for Steel-specific logic:

- context building and message conversion
- stable prefix construction
- current-turn runtime-data meta message construction
- tool definition/registry merge
- structured state capture after Steel tool calls
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

Do not make `/steel/oauth-chat` the implementation base for native chat. It should remain a parity/debug route until native LibreChat chat can perform the Steel workflow.

## Implementation Plan

### Phase 1 - Native Steel Context Adapter

Create `packages/api/src/steel/native/context.ts`.

Tasks:

- Convert LibreChat `TMessage`/formatted messages into `SteelOAuthChatMessage` input for `prepareSteelRuntimeContext`.
- Preserve current user turn, file metadata, and active history.
- Build a `Steel Global Context` text block using `serializeSteelRuntimeContext`.
- Add a stable context version field.
- Default `runtimeContextMode` to `compact_workbook`.
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
- `read_active_workbook` appears only in compact workbook mode.

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

### Phase 5 - Provider State Resolver

Create `packages/api/src/steel/native/provider.ts`.

Tasks:

- Resolve per-turn provider mode:
  - `oauth_stateless`
  - `openai_responses_stateful`
  - `openai_responses_reconstructed`
- For OAuth, require reconstructed context and no `previous_response_id`.
- For official OpenAI API key, prefer Responses API when model/spec supports it.
- Default Steel-enabled OpenAI modelSpecs to `useResponsesApi: true`.
- Preserve explicit user `useResponsesApi: false` unless an admin-enforced Steel spec requires otherwise.
- Add fallback metadata to assistant message metadata.

Tests:

- OAuth always uses reconstructed context.
- API-key Responses uses provider state only when compatible.
- Missing provider state falls back to reconstructed context.
- Explicit user `useResponsesApi: false` is preserved in non-enforced specs.

### Phase 6 - Hook External Open Responses Route

Modify `api/server/controllers/agents/responses.js`.

Tasks:

- Build Steel global context before `formatAgentMessages`.
- Apply Steel instruction prefix to primary and discovered agent configs.
- Merge Steel tools into each relevant agent tool registry.
- Preserve `previous_response_id` DB loading.
- Store Steel metadata when `store: true`.

Tests:

- `/api/agents/v1/responses` sees Steel top context.
- `previous_response_id` history still loads.
- Streaming and non-streaming responses both execute Steel tools.

### Phase 7 - File And OCR Bridge

Tasks:

- Reuse native LibreChat file records and attachment permissions.
- Use existing document encoder support for Responses `input_file`.
- Preserve `fileAnalysis.instructions`.
- Route OCR tool calls through Steel `run_file_ocr`.
- Ensure prior OCR/file evidence is read from Steel structured state, not prompt-inlined forever.

Tests:

- PDF/image upload in native chat exposes OCR rules only when relevant.
- Previous file evidence can be used on follow-up turns.
- Unauthorized file ids are rejected by native permissions before Steel sees bytes.

### Phase 8 - Event Mapping And UI Persistence

Create `packages/api/src/steel/native/events.ts`.

Tasks:

- Map Steel events to native LibreChat content/run-step/custom events:
  - provider round progress
  - tool start/end
  - OCR progress
  - structured state saved, using the current `memory_saved` event name if that remains the backend event contract
  - parse/patch status
- Keep Activity/thinking live-only unless a specific final content part needs persistence.
- Do not persist internal reasoning/tool activity as chat message text.

Tests:

- Tool progress is visible in native chat.
- Disconnect/resume keeps final assistant message and content parts.
- Abort stops provider/tool work.

### Phase 9 - Permissions, Config, And Admin Defaults

Tasks:

- Add Steel global config under existing app config parsing, for example:
  - `steel.global.enabled`
  - `steel.global.includeRules`
  - `steel.global.includeTools`
  - `steel.global.includeMcp`
  - `steel.global.includeSkills`
  - `steel.global.providerMode`
  - `steel.global.contextMode`
- Gate Steel data/tool access by existing user role plus Steel-specific capability.
- Default enabled for this deployment, but keep testable switches.
- Use modelSpecs/default presets to expose Steel-enabled OpenAI Responses defaults.

Tests:

- Disabled Steel global config produces original LibreChat behavior.
- Enabled config preserves user memory/skills/tools.
- Unauthorized user cannot access Steel business tools/data.

### Phase 10 - Parity, Cleanup, And Rollout

Tasks:

- Run native UI smoke for a Steel quote/OCR flow.
- Compare output against `/steel/oauth-chat` for the same fixture.
- Keep `/steel/oauth-chat` available until:
  - native chat can load rules
  - native chat can use Steel tools
  - native chat can write Steel structured quote/workbook state
  - native chat can handle edit/regenerate rollback
  - native chat passes OAuth stateless and API-key Responses paths
- After parity, mark `/steel/oauth-chat` as debug-only or remove it in a separate cleanup plan.

Tests:

- Existing LibreChat chat without Steel enabled still passes.
- Native Steel flow passes OCR, price lookup, customer lookup, quote output, structured-state follow-up, edit, regenerate, abort, resume.
- `git diff --check`.
- Targeted Jest suites for `packages/api` Steel native adapter, `api` agent controller integration, and data-provider config.

## Verification Matrix

| Scenario | Expected result |
|---|---|
| Normal LibreChat chat, Steel disabled | No Steel rules/tools/context; existing behavior unchanged |
| Native LibreChat chat, Steel enabled | Steel rules appear first; user memory/skills/MCP/tools still appear |
| User manually invokes a skill | Manual skill preserved; Steel additions do not suppress it |
| User has MCP server selected | MCP auth/instructions/tools still work |
| OAuth provider selected | Stateless reconstructed context; no provider `previous_response_id` dependency |
| OpenAI API key Responses selected | Responses API default on for Steel spec; provider state used only when safe |
| Provider state missing | Fallback to reconstructed context with metadata |
| PDF/image turn | FileAnalysis instructions and OCR rules included only when relevant |
| Tool call writes quote data | Steel structured state captures tool evidence and output sheet state |
| Edit/regenerate | Steel structured state rolls back to the edited message boundary |
| External Responses route | Receives the same Steel global behavior as native UI chat |

## Risks And Guardrails

- Context bloat: default to `compact_workbook`; use `read_active_workbook` for row details.
- Tool collisions: namespace or deterministic collision rejection before model sees duplicate names.
- User setting loss: merge with existing settings, never replace whole agent/tool/skill arrays.
- Memory terminology contamination: keep LibreChat user Memory separate from Steel structured quote/workbook state and reviewed Steel defaults.
- Provider mismatch: make provider-state policy explicit and auditable.
- Route drift: keep `/steel/oauth-chat` only as parity reference until native path is proven.
- Schema drift: if any Steel PostgreSQL schema changes become necessary later, update both `supabase/schema.sql` and a new migration created with `npx supabase migration new`.

## Done Definition

The integration is done when a user can use the normal LibreChat interface and get the Steel workflow globally:

- Steel rules are first in context.
- Steel tools/MCP/skills are additive.
- LibreChat user memory, manual skills, MCP, files, settings, history, edit/regenerate, SSE, abort/resume, and message persistence still work.
- OAuth stateless and OpenAI API-key Responses modes both have explicit tested context behavior.
- Steel structured quote/workbook state, currently named `Output Sheet Memory` and `Working Order Memory` in code, is keyed to native LibreChat conversation/message lifecycle.
- `/steel/oauth-chat` is no longer required for normal Steel work.
