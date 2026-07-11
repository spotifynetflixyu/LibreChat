# OpenAI OAuth Model Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenAI and OpenAI OAuth share `OPENAI_MODELS`, make every plain New Chat use the env-prioritized `OPENAI_DEFAULT_MODEL`, and keep explicit UI/preset models as the OAuth request model.

**Architecture:** Retain `openai_oauth_responses` only as the internal OAuth transport/provider identity. Return the same prioritized model array for both OpenAI endpoint keys, stop using last-selected browser state when a new conversation has no explicit setup, and normalize persisted OAuth model preferences to the `openAI` property while removing the legacy OAuth property.

**Tech Stack:** React/TypeScript, LibreChat data-provider schemas, Express configuration service, Jest.

## Global Constraints

- Keep `EModelEndpoint.openAIOAuth = 'openai_oauth_responses'` for OAuth routing.
- `OPENAI_MODELS` and `OPENAI_DEFAULT_MODEL` are the only model-list/default env inputs for both OpenAI transports.
- Plain New Chat ignores `lastSelectedModel`; explicit URL, preset, model spec, or current UI selection still wins.
- Do not run Prettier.
- Do not commit or stage changes.

---

### Task 1: Shared Backend Model List

**Files:**
- Modify: `api/server/services/Config/loadDefaultModels.js`
- Test: `api/server/services/Config/loadDefaultModels.spec.js`

**Interfaces:**
- Consumes: `OPENAI_MODELS`, `OPENAI_DEFAULT_MODEL`, fetched OpenAI model list.
- Produces: identical prioritized arrays at `openAI` and `openai_oauth_responses` response keys.

- [x] **Step 1: Write a failing test** proving an explicit `OPENAI_OAUTH_MODELS` value cannot diverge the OAuth list from OpenAI.
- [x] **Step 2: Run** `cd api && rtk npx jest server/services/Config/loadDefaultModels.spec.js --runInBand --watch=false --coverage=false`; expect the new equality assertion to fail.
- [x] **Step 3: Remove the separate OAuth list resolution** and assign the prioritized OpenAI array to both endpoint keys.
- [x] **Step 4: Re-run the focused API test** and expect all cases to pass.

### Task 2: Plain New Chat Env Default

**Files:**
- Modify: `client/src/utils/buildDefaultConvo.ts`
- Test: `client/src/utils/__tests__/buildDefaultConvo.test.ts`

**Interfaces:**
- Consumes: explicit `lastConversationSetup?.model` and the ordered `/api/models` array.
- Produces: explicit setup model when present; otherwise `models[0]` for a plain New Chat.

- [x] **Step 1: Replace the current stored-model precedence test** with a failing test where legacy OpenAI/OAuth browser preferences exist but luna remains selected.
- [x] **Step 2: Add a characterization test** proving an explicit terra setup still wins.
- [x] **Step 3: Run** `cd client && rtk npx jest src/utils/__tests__/buildDefaultConvo.test.ts --runInBand --watch=false --coverage=false`; expect only the plain-chat test to fail with terra instead of luna.
- [x] **Step 4: Remove `lastSelectedModel` from default-conversation model resolution** while retaining stored tools behavior.
- [x] **Step 5: Re-run the focused client test** and expect all cases to pass.

### Task 3: Normalize Browser Model Preference

**Files:**
- Modify: `client/src/utils/convos.ts`
- Modify: `client/src/utils/endpoints.ts`
- Test: `client/src/utils/convos.spec.ts`
- Test: `client/src/utils/endpoints.spec.ts`

**Interfaces:**
- Consumes: endpoint/model pairs selected in the UI.
- Produces: `lastSelectedModel.openAI` for both OpenAI transports, with `lastSelectedModel.openai_oauth_responses` removed.

- [x] **Step 1: Add failing storage tests** for both `storeEndpointSettings` and `updateLastSelectedModel` using the OAuth endpoint.
- [x] **Step 2: Run the focused tests** and expect the new assertions to fail because the legacy OAuth property is written.
- [x] **Step 3: Add one shared endpoint-normalization helper** and use it in both storage writers; delete the stale OAuth property on write.
- [x] **Step 4: Re-run both focused suites** and expect all tests to pass.

### Task 4: Contract Verification

**Files:**
- Update: `tasks/todo.md`
- Update: `tasks/lessons.md` only if implementation reveals a new reusable correction.

**Interfaces:**
- Consumes: all completed implementation tasks.
- Produces: evidence that env defaults, UI overrides, and OAuth routing coexist.

- [x] **Step 1: Run all touched focused suites** for API model lists, default conversation, storage helpers, OpenAI config, OAuth initialization, and agent runs.
- [x] **Step 2: Build `packages/api`** with `rtk npm run build`.
- [x] **Step 3: Run runtime probes** confirming both endpoint model arrays begin with luna and `max` remains unchanged.
- [x] **Step 4: Run** `rtk git diff --check` and `git diff --cached --check`.
- [x] **Step 5: Record exact results** in `tasks/todo.md` and leave all work uncommitted.

### Task 5: Current Codex OAuth Transport

**Files:**
- Modify: `packages/api/package.json`
- Modify: `package-lock.json`
- Modify: `packages/api/src/steel/native/oauth.ts`
- Test: `packages/api/src/steel/native/oauth.spec.ts`

**Interfaces:**
- Consumes: the explicit OAuth request model, local OAuth auth-file path, and
  the current account-aware Codex model catalog.
- Produces: a Vercel AI SDK language model that preserves the selected model
  and applies model-specific Codex request metadata such as Responses Lite.

- [x] **Step 1: Add a failing adapter test** that observes the current core
  model-catalog request, invokes the following Responses request, and asserts
  the transport supplies the matching Codex `originator` and versioned
  `user-agent` identity required for luna.
- [x] **Step 2: Run**
  `cd packages/api && rtk npx jest src/steel/native/oauth.spec.ts --runInBand --watch=false --coverage=false`
  and confirm the new test fails because the response request has no current
  Codex identity metadata.
- [x] **Step 3: Replace** `openai-oauth-provider` with exact
  `@openai-oauth/ai-sdk@2.0.0-beta.2`,
  `@openai-oauth/core@2.0.0-beta.2`, and
  `@openai-oauth/local@2.0.0-beta.2`; adapt lazy provider creation to use local
  credentials and a stateless core transport, and add the narrow Codex response
  identity compatibility wrapper.
- [x] **Step 4: Re-run the focused adapter suite** and expect the model catalog,
  Responses Lite header, message conversion, streaming, and tool-call tests to
  pass.
- [x] **Step 5: Build `packages/api`**, run the related ToolService organizer
  suite, then execute a minimal live `gpt-5.6-luna` request through the shared
  provider and expect the exact smoke value instead of `Model not found`.
- [x] **Step 6: Restart localhost**, verify backend health and the organizer
  regression path, and record the evidence in `tasks/todo.md`.
