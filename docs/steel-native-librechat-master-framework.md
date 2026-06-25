# Steel Native LibreChat Master Framework

**Goal:** Make Steel workflow a global native LibreChat behavior while preserving the original LibreChat UI, chat history, Memory, skills, MCP, tools, presets, model settings, SSE, abort, resume, file handling, and permissions.

**Architecture:** Steel is an additive global augmentation layer inside native LibreChat agent execution. Steel rules are prepended at the top of native context; Steel runtime context, tools, MCP, skills, Markdown persistence, and provider policy are merged through existing LibreChat modules instead of replacing them or routing users through `/steel/oauth-chat`.

**Implementation Plan:** See `docs/plans/2026-06-24-steel-global-native-librechat-integration.md`.

---

## Document Role

This document is the canonical project framework and module lookup index for Steel native LibreChat integration.

Future planning and implementation work must use this document as the lookup entrypoint for:

- target architecture
- module ownership
- integration hook locations
- provider-state policy
- context ordering
- Markdown parse/persistence behavior
- route and UI boundaries
- verification expectations

When a Steel-native module is added, renamed, moved, or replaced, update the module map in this document in the same change. Narrower phase docs may link back here and describe only implementation details for their slice.

## Locked Product Decision

Steel must become a global native LibreChat behavior.

That means:

- Users stay in the normal LibreChat chat interface.
- LibreChat remains responsible for chat history, message persistence, regenerate/edit, files, user Memory, skills, MCP, tools, presets, model selector, SSE, abort/resume, permissions, and billing.
- Steel adds rules, runtime context, tools, MCP, skills, Markdown persistence, and provider policy on top of those modules.
- Steel rules, tools, and framework behavior apply globally to native LibreChat agent execution; Phase 1 must not require a model-spec opt-in marker for Steel correctness.
- Non-steel and non-quote conversations still receive the global Steel framework; the AI decides from the user request whether the Steel quoting workflow is relevant. Do not add code that tries to classify and skip Steel context for ordinary chat.
- Do not add `librechat.yaml` Steel enablement or inclusion switches such as `steel.enabled`, `includeRules`, or `includeTools` for the native framework. Existing LibreChat YAML configuration, such as model specs, endpoint config, and permissions, still applies through the normal LibreChat config path. Steel OCR/file behavior should come from reviewed Steel rules, not duplicated OCR policy in `fileAnalysis.instructions`.
- Steel rules must be loaded at the top of context.
- Existing user-added skills, Memory, MCP servers, and settings must continue to work.
- Steel-enabled Open Responses requests must be durable and LibreChat-managed, equivalent to `store:true`. `store:false` is outside the supported Steel native framework and does not need a Steel state path.
- `/steel/oauth-chat` is dev-only. It may be used during development for workflow smoke tests and activity-log inspection, but it is not the user workflow, not the implementation base, and not a production integration path.

## Research Conclusions Lock

These conclusions are locked from the current audit and must be treated as implementation constraints unless a later code audit updates this document.

1. Native LibreChat agent runs reconstruct context from LibreChat state. `BaseClient` / `AgentClient` load ordered Mongo `Message` history, apply LibreChat Memory, agent instructions, MCP instructions, files/RAG, skills, tools, and summarization/pruning as needed, then send the resulting messages to the model. Do not design Steel correctness around provider-only hidden history.
2. Native `useResponsesApi: true` is currently a Responses transport/model-shape switch, not a complete provider-state continuation flow. LangChain can pass a top-level `previous_response_id` call option into `this.client.responses.create(...)`, but native LibreChat does not currently persist an OpenAI `response.id` and inject it into the next run. Treat current native Responses behavior as `openai_responses_reconstructed`.
3. `openai_responses_previous_response_id` is a future optimization mode only. It requires storing the provider `response.id`, resolving it by LibreChat `conversationId/messageId`, injecting it as a top-level call option, and proving fallback to reconstructed context. OpenAI's conversation-state guide still counts previous-turn tokens as input tokens, so do not describe it as a free token or KV-cache bypass.
4. The external `/api/agents/v1/responses` route is a LibreChat Open Responses-compatible facade, not a direct OpenAI SDK proxy. Its current continuation behavior validates `previous_response_id` as a LibreChat conversation id, loads Mongo messages, merges current input, and resends reconstructed history. The generated `resp_*` response id is not yet a reliable continuation id until a response-id-to-conversation-id resolver or explicit continuation-id contract is implemented.
5. Steel-enabled Open Responses is always durable and LibreChat-managed, equivalent to `store:true`. There is no supported Steel `store:false` state path.
6. LibreChat user Memory is separate from Steel structured quote/workbook state. Steel may reuse existing services whose code names include `Memory`, but user-facing design and prompts must call that Steel structured state, not LibreChat Memory.
7. Steel context order is stable-to-dynamic: Steel rules, Steel tool policy, LibreChat agent instructions, MCP instructions, stable skills, LibreChat Memory, chat history, Steel runtime data, current-turn skill primes, current user message. Steel rules must not be appended only through `sharedRunContext`.
8. Markdown auto parse/save/update/overwrite is a required native module. Capture final assistant Markdown after assistant message persistence succeeds: native UI chat should hook around the assistant `databasePromise`; Open Responses should hook `saveResponseOutput()` after `db.saveMessage`. Do not use generic message-save methods or stream-done events as the primary capture point.
9. LibreChat file messages and attachments stay owned by LibreChat file records and permissions. Native provider vision/file inputs must still be available to the AI agent for drawing reasoning such as holes, bends, slots, and cut marks. When Steel needs structured OCR/table extraction or persisted drawing evidence, pass permitted file bytes/metadata into `run_file_ocr`; the executor defaults to PaddleOCR MCP (`PaddleOCR-VL-1.6` / `paddleocr_vl`) as the primary Steel table/drawing OCR source. Reuse persisted OCR/file-analysis state on follow-up turns unless re-OCR is explicitly requested or state is missing/incomplete.
10. `/steel/oauth-chat` remains a development probe for smoke tests and activity-log inspection. Any behavior proven there must be moved into native LibreChat hooks before it counts as product architecture.

## Architecture Boundary

Native Steel behavior must hook existing LibreChat paths:

- native UI chat path through `AgentClient` and `BaseClient`
- external Chat Completions-compatible Agents API path
- external Open Responses-compatible Agents API path
- native tool, MCP, skill, file, stream, and permission services

Do not fork LibreChat chat state or create a second user workflow. The standalone `/steel/oauth-chat` route proves behavior and exposes useful development activity logs, but production behavior must live in the native global layer.

## Module And Entrypoint Map

Use this table to find the design owner and implementation files for each native Steel integration concern. Planned files are listed before implementation so future changes have a stable target.

| Concern | Owner module | Primary files | Notes |
|---|---|---|---|
| Project framework | Steel native master framework | `docs/steel-native-librechat-master-framework.md` | Canonical architecture and module lookup document |
| Implementation plan | Steel native implementation plan | `docs/plans/2026-06-24-steel-global-native-librechat-integration.md` | Phase plan and testing checklist; must link back here |
| Normal user workflow | Native LibreChat chat | `api/server/controllers/agents/client.js`, `api/server/controllers/agents/request.js`, `api/app/clients/BaseClient.js` | Users should stay in normal LibreChat UI |
| Agent initialization | Native agent endpoint setup | `api/server/services/Endpoints/agents/initialize.js`, `packages/api/src/agents/initialize.ts` | Load agents, tools, MCP, skills, permissions, model config |
| Stable context injection | Agent context helpers | `packages/api/src/agents/context.ts`, planned `packages/api/src/steel/native/context.ts` | Steel rules and tool policy must prepend before base agent instructions |
| Dynamic runtime context | Steel runtime adapter | `packages/api/src/steel/runtime/context.ts`, planned `packages/api/src/steel/native/context.ts` | Runtime workbook/file/quote state belongs near the tail |
| LibreChat history | Native message persistence | `api/app/clients/BaseClient.js`, data-schemas message/conversation methods | LibreChat chat history remains canonical |
| LibreChat user Memory | Existing Memory module | `api/server/controllers/agents/client.js`, `packages/api/src/agents/memory.ts` | Keep separate from Steel structured quote/workbook state |
| Steel structured state | Steel state services keyed to LibreChat ids | `packages/api/src/steel/memory/service.ts`, `packages/api/src/steel/history/service.ts`, planned `packages/api/src/steel/native/context.ts` | Existing code names may say memory, but product term is structured state |
| Markdown auto parse/save/update/overwrite | Steel Markdown persistence adapter | `packages/api/src/steel/memory/service.ts`, `packages/api/src/steel/history/service.ts`, `packages/data-schemas/src/schema/steel/workingOrderMemory.ts`, planned `packages/api/src/steel/native/markdown.ts` | Parse final assistant Markdown and tool results into Steel structured state; full system-order tables overwrite active snapshots, row-change tables patch active rows |
| Tool registry merge | Native tool loading plus Steel adapter | `api/server/services/ToolService.js`, planned `packages/api/src/steel/native/tools.ts`, `packages/api/src/steel/tools/registry.ts`, `packages/api/src/steel/tools/execute.ts` | Additive merge only; do not replace user tools/MCP/actions |
| MCP integration | Native MCP services plus Steel adapter | `api/server/services/MCP.js`, `api/server/services/Tools/mcp.js`, planned `packages/api/src/steel/native/mcp.ts` | Preserve existing MCP auth/OAuth flow |
| Skills integration | Native skill catalog/primes plus Steel adapter | `packages/api/src/agents/skills.ts`, planned `packages/api/src/steel/native/skills.ts` | Preserve manual user skills and active/deactivated state |
| Native event mapping | LibreChat run events plus Steel adapter | `api/server/controllers/agents/callbacks.js`, `packages/api/src/stream/GenerationJobManager.ts`, planned `packages/api/src/steel/native/events.ts` | Map Steel progress/tool/state events into native stream surfaces |
| File/OCR bridge | Native file handling plus Steel OCR tools | `packages/api/src/files/encode/document.ts`, `packages/api/src/steel/vision/service.ts`, planned `packages/api/src/steel/native/context.ts` | Use LibreChat file records and `fileAnalysis.instructions`; route OCR/table extraction through `run_file_ocr` backed by PaddleOCR MCP |
| Provider policy | Steel provider resolver | `packages/api/src/endpoints/openai/llm.ts`, `packages/api/src/steel/ai/provider.ts`, planned `packages/api/src/steel/native/provider.ts` | OAuth stays stateless; official OpenAI Responses state is optimization only |
| Agents API Chat Completions ingress | Remote agents OpenAI-compatible route | `api/server/routes/agents/openai.js`, `packages/api/src/agents/openai/service.ts` | Must receive same Steel global behavior as UI path |
| Agents API Open Responses ingress | Remote agents Open Responses route | `api/server/controllers/agents/responses.js`, `packages/api/src/agents/responses/*` | Parallel path; needs its own thin Steel hook |
| Permissions/config | Existing LibreChat permissions/config | `packages/data-provider/src/config.ts`, `packages/api/src/app/permissions.ts`, `api/server/routes/agents/middleware.js` | Steel must not bypass role/resource checks |
| Dev-only workflow probe | Standalone Steel OAuth chat | `client/src/routes/SteelOAuthChat.tsx`, `api/server/routes/steel/index.js`, `packages/api/src/steel/handlers.ts`, `packages/api/src/steel/ai/provider.ts` | Development smoke/activity-log surface only |

## Context Ordering Contract

Use a KV-cache-friendly static-to-dynamic order for native agent context:

1. Steel rules.
2. Steel tool policy.
3. Existing LibreChat agent/system instructions.
4. Existing LibreChat MCP server instructions.
5. Stable LibreChat skill catalog and stable always-available skill instructions.
6. LibreChat user Memory.
7. Normal chat history from LibreChat `Message` records.
8. Steel runtime data: active quote/workbook state, file/OCR state, current turn state.
9. Current-turn dynamic skill primes, including manual `$` skills and any per-turn generated prime bodies.
10. Current user message.

Steel rules and stable tool policy belong near the top because they change rarely and define global behavior. Steel runtime data belongs near the tail because it is conversation/turn-specific and may change every turn.

Do not put Steel rules only into `sharedRunContext`, because native code appends `sharedRunContext` to `additional_instructions`. That would make Steel a system-tail, not the top of context. Also do not put all Steel runtime data at the top with the rules; only stable rules/tool policy should be in the cache-friendly prefix.

The Steel stable prefix order is fixed:

1. Agent rules.
2. Quote defaults and quote rules.
3. Output rules.
4. Tool policy.
5. Other rules, including OCR/file rules.
6. Reviewed agent rules.
7. Instruction packets.

Do not add conditional logic that decides whether to include OCR/file rules or other rule groups in the global prefix. The AI should use the fixed framework and decide relevance from the request and available evidence.

## Native Adapter Package

Add Steel-specific native integration code under `packages/api/src/steel/native/`.

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

## Steel Context Sources

Use existing Steel runtime context as the source of truth:

- `packages/api/src/steel/runtime/context.ts`
- `prepareSteelRuntimeContext`
- `serializeSteelRuntimeContext`
- `steelRuntimeActiveOutputSheetIds`
- `steelRuntimeAiVisibleTools`
- `steelRuntimeCompactWorkbookAiVisibleTools`

Default to `compact_workbook` unless a test or rollback path explicitly needs full context.

Runtime sources:

- reviewed Steel rules from Supabase `steel` schema repositories
- structured quote/workbook state from Mongo-backed Steel readers currently named `Output Sheet Memory` and `Working Order Memory` in code
- current LibreChat conversation and message ids
- current turn attachment metadata and file references from LibreChat file records
- existing `fileAnalysis.instructions` for native file/image/PDF guidance

Do not use `docs/reference` as runtime data.

Phase 1 native context building must not inline uploaded file bytes or base64 file bodies into Steel context. It should carry only metadata and references needed for Steel state/context. The same attachments must still flow through LibreChat's native provider file/vision pipeline so the AI agent can inspect images/PDFs directly when the selected provider supports it; OCR/tool executors read bytes later through the same permission-checked file pipeline when structured extraction is needed.

`run_file_ocr` is an AI-visible Steel tool, not an automatic file-ingestion step. Uploading or loading a LibreChat attachment must not automatically run OCR and inject OCR text into every prompt by default. The AI agent receives the attachment through native provider file/vision support and calls `run_file_ocr` when it needs structured OCR/table extraction or durable drawing evidence.

### LibreChat File Message OCR Contract

Native Steel must consume LibreChat file messages and attachments through LibreChat's existing file records and permission checks.

When a PDF/image/table file needs OCR or table text extraction:

1. LibreChat keeps passing the permitted attachment to the provider through its native file/vision support when the provider can inspect it.
2. The native Steel adapter carries attachment metadata and file references in Steel context so rules and tool calls can refer to the evidence without duplicating bytes in prompt text.
3. When the AI agent decides structured extraction is needed, it calls the `run_file_ocr` tool surface.
4. The `run_file_ocr` executor uses the configured PaddleOCR MCP implementation, currently `PaddleOCR-VL-1.6` / `paddleocr_vl`, as the primary OCR source for Steel table/drawing extraction.
5. OpenAI/provider vision may still inspect files directly for drawing reasoning, including holes, bends, slots, cut marks, dimensions, and visual cross-checks. It is not the durable structured-state writer by itself.
6. OCR output from that tool call is captured into Steel structured state and reused on later turns; do not re-OCR the same file unless the user explicitly asks to re-read/re-analyze or the stored state is missing/incomplete.

This contract is conditional. Normal non-OCR file handling, native document context, and LibreChat file permissions remain owned by LibreChat.

`fileAnalysis.instructions` is not the Steel OCR rule source of truth. The existing standalone Steel route currently prefixes that YAML text onto user messages with image/PDF attachments through `applyFileInstructionsToMessages()`, but native Steel should avoid duplicating reviewed OCR rules this way. If `fileAnalysis.instructions` remains configured for non-Steel compatibility, keep it as a short generic provider-vision hint only; conflicting or detailed OCR policy belongs in reviewed Steel rules.

## Markdown Auto Parse And Persistence

This module is required. It is not LibreChat user Memory.

### Current Implementation Pieces

The standalone Steel route already has the core pieces:

- `packages/api/src/steel/memory/service.ts` parses final assistant Markdown tables through `captureAssistantFinalMarkdown`.
- `packages/api/src/steel/memory/service.ts` captures successful Steel tool results through `captureToolResult`.
- `packages/data-schemas/src/schema/steel/workingOrderMemory.ts` stores active and superseded Steel structured state.
- `packages/api/src/steel/history/service.ts` rolls Steel turns and structured state back when an edited user message supersedes later turns.
- `packages/api/src/steel/handlers.ts` currently wires this into `/steel/oauth-chat` and emits `parse_status` / `memory_saved` events.
- `packages/data-provider/src/steel/ai.ts` defines the current standalone stream event shapes for parse/save status.

### Native Requirement

Native LibreChat integration must add `packages/api/src/steel/native/markdown.ts` as the adapter that calls those existing services from native lifecycle hooks.

It must run for:

- normal LibreChat UI chat
- Agents API Chat Completions-compatible route
- Agents API Open Responses-compatible route
- streaming and non-streaming completions
- edit, regenerate, abort, and resume paths where a final assistant message is persisted

### Behavior Contract

The Markdown persistence adapter must:

1. Parse final assistant Markdown tables after final assistant content is known.
2. Save parsed working-order rows, customer facts, calculation facts, row changes, source refs, and tool evidence into Steel structured state.
3. Treat a full system-order table as an overwrite snapshot: mark prior active `working_order_row` entries for the conversation as `superseded`, then insert the current rows.
4. Treat a row-change table as a patch update: mark only affected active rows as `superseded`, merge patch payloads with the latest active row state, then insert merged rows.
5. Save successful Steel tool result facts through the same structured state writer.
6. On edit/regenerate, call the Steel history rollback path so turns and structured state after the edited boundary are marked `superseded` and excluded from active context replay.
7. Emit native LibreChat run-step/custom events for parse/save status, but do not persist internal activity as visible assistant message text.
8. Keep all records keyed to LibreChat `conversationId`, `messageId`, `requestId`, `turnIndex`, and user scope when available.

### Native Hook Points

The adapter belongs at the assistant-message persistence boundary: after final assistant content is aggregated and the assistant message is successfully saved, but before the run is considered fully complete from the Steel state perspective.

Recommended hook points:

- Native UI chat path: add a thin optional lifecycle hook around `api/app/clients/BaseClient.js` `sendMessage()` where `responseMessage.databasePromise = this.saveMessageToDatabase(responseMessage, ...)` is assigned. The hook should run after that assistant `databasePromise` resolves, because the response message has final `messageId`, `conversationId`, parent linkage, content/text, metadata, attachments, and conversation save result. Keep Steel logic out of `BaseClient`; wire the hook from the native Steel adapter through Agent initialization/options.
- `api/server/controllers/agents/request.js`: do not make the controller final SSE event the primary capture point. In both resumable and legacy paths, the controller awaits `response.databasePromise` before sending the normal final event, so the post-save hook above runs earlier and avoids duplicating capture logic in the controller.
- `api/server/controllers/agents/responses.js`: this route does not use `BaseClient.sendMessage()`. Steel-enabled Open Responses must be treated as durable (`store:true`) before execution. Add a separate thin hook inside `saveResponseOutput()` after `db.saveMessage` succeeds, using the already extracted `responseText`, `conversationId`, and `responseId`. Run it in both streaming and non-streaming stored branches.
- Native tool execution callback path: capture successful Steel tool result facts immediately through the same structured state writer; this complements final Markdown parsing and should not wait for assistant Markdown.

Rejected hook points:

- `api/server/controllers/agents/client.js` `chatCompletion()`: content parts are final enough to format a response, but the LibreChat assistant message has not yet been persisted. Capturing here can create Steel state for a response that later fails to save.
- `packages/data-schemas/src/methods/message.ts` `saveMessage()`: this is too generic and would mix Steel behavior into every LibreChat message save, including non-Steel chats, partial saves, and unrelated endpoints.
- `packages/api/src/stream/GenerationJobManager.ts` final/done events: this is a resumable stream transport and replay layer, not the canonical assistant-message persistence boundary.

Capture rules:

- Capture only completed assistant messages. Skip partial disconnect saves, unfinished abort saves, error-only messages, and temporary responses unless a later explicit product decision says otherwise.
- The native hook must be idempotent by `conversationId` plus `messageId` / `responseId`; retries must not duplicate active rows or tool facts.
- For Open Responses, Steel-enabled requests must not run as `store:false`. The framework does not define a non-stored Steel state path.

## Stateful And Stateless Provider Policy

LibreChat chat history remains the source of truth in both modes.

### OAuth Stateless Mode

For Open OAuth API:

- Keep `responsesState: false`.
- Do not rely on provider-side `previous_response_id`.
- Reconstruct full provider prompt from LibreChat history plus Steel global context every turn.
- Persist final chat messages through LibreChat `Message` records.
- Persist Steel structured quote/workbook state through Steel services keyed by LibreChat `conversationId` and `messageId`.

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

### Native OpenAI `previous_response_id` Call Options Audit - 2026-06-25

OpenAI's Responses conversation-state guide defines `previous_response_id` as the previous Responses API response id used to continue provider-side state. The guide also says previous-turn tokens in the chain are still billed as input tokens, so this is a provider-state convenience and context-management feature, not a free token or KV-cache bypass.

LibreChat's native OpenAI provider path currently has the library capability but not the LibreChat continuation wiring:

- `packages/api/src/endpoints/openai/llm.ts` includes `previous_response_id` in `knownOpenAIParams`, so endpoint/model config will not automatically drop the key.
- `node_modules/@langchain/openai/dist/chat_models/index.js` routes to the Responses implementation when call options contain `previous_response_id`, even if `useResponsesApi` is otherwise false.
- `node_modules/@langchain/openai/dist/chat_models/responses.js` copies `options.previous_response_id` into `invocationParams()`, then calls `this.client.responses.create(request, clientOptions)`.
- Both streaming and non-streaming Responses paths send `input: convertMessagesToResponsesInput({ messages, ... })` alongside `previous_response_id` when the option exists.
- `node_modules/@librechat/agents/src/llm/invoke.ts` passes the run `RunnableConfig` to `model.stream(messages, config)` or `model.invoke(messages, config)`, so a top-level call option could reach LangChain.

Current gap: native LibreChat chat/agent runs do not synthesize or inject a provider `previous_response_id` call option from prior OpenAI response ids. `AgentClient.buildMessages()` and `createRun()` still reconstruct history from LibreChat `Message` records, `AgentContext` prepends system instructions each run, and the final model invocation receives the rebuilt message list. Therefore `useResponsesApi: true` currently means "use OpenAI Responses transport and shape" in native LibreChat; it does not yet mean "send only the latest user message and let OpenAI recover the whole conversation from `previous_response_id`."

Steel implication:

- Set `useResponsesApi: true` by default for Steel-enabled official OpenAI API-key specs, but keep LibreChat Mongo history canonical.
- Treat provider-side `previous_response_id` as a future optimization path that requires explicit persistence of the OpenAI `response.id`, resolver logic by LibreChat `conversationId/messageId`, and an invocation hook that injects that id as a call option.
- Track the difference in metadata: `openai_responses_reconstructed` for today's native behavior, and `openai_responses_previous_response_id` only after the response-id chain is actually wired and verified.
- Do not rely on provider-state continuation for Steel correctness; reconstructed context remains the fallback and the correctness baseline.

### External Open Responses Route

`api/server/controllers/agents/responses.js` has its own `previous_response_id` logic and does not call `AgentClient.buildMessages`.

Global Steel behavior must be added there too, otherwise API-key/Open Responses callers will miss Steel rules/tools/context even if the UI path works.

### Current Open Responses Route Audit - 2026-06-25

LibreChat currently exposes an Open Responses-compatible facade at `POST /api/agents/v1/responses`, mounted from `api/server/routes/agents/index.js` to `api/server/routes/agents/responses.js`.

This is not a direct OpenAI SDK `client.responses.create()` proxy. Repo search found no direct `client.responses.create()` or `.responses.create()` call in the LibreChat route code. The route builds Open Responses-shaped response objects itself through `packages/api/src/agents/responses/service.ts` and `packages/api/src/agents/responses/handlers.ts`, including `object: 'response'` and `previous_response_id`.

OpenResponses reference semantics say:

- `input` is the context for the scope of the request.
- `previous_response_id` is the ID of the prior response to use as the previous turn.
- `store` controls whether the response is stored and retrievable later.

LibreChat's current route implementation behaves differently from a pure provider-side state chain:

1. It generates a new `responseId` with `generateResponseId()`.
2. It stores that generated `responseId` in the response context and later uses it as the saved assistant `messageId`.
3. If `request.previous_response_id` exists, it validates ownership by calling `db.getConvo(userId, request.previous_response_id)`.
4. It sets `conversationId = request.previous_response_id ?? uuidv4()`.
5. It loads previous messages from Mongo with `db.getMessages({ conversationId, user })`.
6. It converts current `request.input` into internal messages.
7. It merges `allMessages = [...previousMessages, ...inputMessages]`.
8. It formats that merged history with `formatAgentMessages(allMessages, {}, toolSet)` and sends `formattedMessages` into `createRun()` / `run.processStream()`.

Therefore the current LibreChat `/responses` route reconstructs and resends LibreChat DB history on continuation. It does not rely on provider-side `previous_response_id` alone, and it does not only send the newest user message for follow-up turns.

Current ID mapping caveat:

- The response body `id` is the generated `resp_*` `responseId`.
- The saved assistant message id is also that `responseId`.
- The LibreChat conversation id is a new UUID on the first turn, or `request.previous_response_id` on continuation.
- `GET /v1/responses/:id` currently treats `:id` as a LibreChat `conversationId`; the code comment says response id may also work, but the implementation first calls `db.getConvo(userId, id)` and then loads messages by `conversationId: id`.
- Existing tests acknowledge that retrieving by the returned `resp_*` id may return 404 because storage is keyed by conversation id.

Steel implication: do not assume the current LibreChat `/responses` route can continue with `previous_response_id = prior response.id` until this mapping is normalized. For Steel-enabled Open Responses, either add a response-id-to-conversation-id resolver or explicitly return/use a durable continuation id while keeping Open Responses response ids stable for spec output.

Steel-enabled Open Responses must use LibreChat-managed durable history:

- Treat Steel-enabled requests as `store:true`.
- Preserve DB-backed continuation loading for the route, but fix or normalize the `previous_response_id` mapping before exposing it as an OpenResponses-compatible response-id chain.
- Key Steel structured state to both the LibreChat `conversationId` and saved assistant `responseId`.
- Keep the current route as a reconstructed-history path unless a later provider-state resolver explicitly proves that provider-side history is safe and compatible.
- Do not design a Steel `store:false` branch; non-stored Responses calls are outside the supported Steel workflow.

## Missing Native Modules

Main missing implementation modules:

- native Steel context adapter
- top-of-context instruction prefix
- additive Steel `toolDefinitions/toolRegistry` merge
- Steel MCP adapter
- Steel skills adapter
- native Markdown parse/save/update/overwrite adapter
- stateful/stateless provider policy
- external Responses route hook
- file/OCR bridge
- event mapping
- permissions/config defaults
- parity cleanup for `/steel/oauth-chat`

## Verification Expectations

| Scenario | Expected result |
|---|---|
| Normal LibreChat chat, Steel disabled | No Steel rules/tools/context; existing behavior unchanged |
| Native LibreChat chat, Steel enabled | Steel rules appear first; user Memory/skills/MCP/tools still appear |
| User manually invokes a skill | Manual skill preserved; Steel additions do not suppress it |
| User has MCP server selected | MCP auth/instructions/tools still work |
| OAuth provider selected | Stateless reconstructed context; no provider `previous_response_id` dependency |
| OpenAI API key Responses selected | Responses API default on for Steel spec; provider state used only when safe |
| Provider state missing | Fallback to reconstructed context with metadata |
| PDF/image turn | FileAnalysis instructions and OCR/file rules are present; native provider vision still receives permitted attachments where supported |
| Tool call writes quote data | Steel structured state captures tool evidence and output sheet state |
| Assistant emits full system-order Markdown table | Active working-order rows are overwritten by a new snapshot |
| Assistant emits row-change Markdown table | Only affected active rows are superseded and replaced by merged rows |
| Edit/regenerate | Steel structured state rolls back to the edited message boundary |
| External Responses route | Receives the same Steel global behavior as native UI chat |

## Guardrails

- Default to `compact_workbook`; use `read_active_workbook` for row details.
- Namespace or deterministically reject duplicate Steel/user tool names before the model sees them.
- Merge with existing settings; never replace whole agent/tool/skill arrays.
- Keep LibreChat user Memory separate from Steel structured quote/workbook state and reviewed Steel defaults.
- Make provider-state policy explicit and auditable.
- Keep `/steel/oauth-chat` dev-only and never let it become the owner for product behavior.
- If any Steel PostgreSQL schema changes become necessary later, update both `supabase/schema.sql` and a new migration created with `npx supabase migration new`.

## Done Definition

The integration is done when a user can use the normal LibreChat interface and get the Steel workflow globally:

- Steel rules are first in context.
- Steel tools/MCP/skills are additive.
- LibreChat user Memory, manual skills, MCP, files, settings, history, edit/regenerate, SSE, abort/resume, and message persistence still work.
- OAuth stateless and OpenAI API-key Responses modes both have explicit tested context behavior.
- Steel structured quote/workbook state and Markdown persistence are keyed to native LibreChat conversation/message lifecycle.
- `/steel/oauth-chat` remains dev-only and is no longer required for normal Steel work.
