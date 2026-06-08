# OpenAI OAuth Provider Real Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let an authenticated LibreChat user send a message through the Steel `openai_oauth_responses` path and receive a real response from `openai-oauth-provider` using server-side OAuth auth material.

**Architecture:** Add a narrow Steel chat smoke slice rather than modifying LibreChat's global chat engine in this pass. The backend owns auth loading, provider invocation, metadata sanitization, and access checks under `/api/steel`; the frontend gets a minimal Steel OAuth chat page only for the smoke path. This proves the provider can work through LibreChat without entangling the core conversation flow before the full Steel Workspace exists.

**Tech Stack:** LibreChat monorepo, `packages/api` TypeScript, thin Express wrappers in `api/`, `packages/data-provider` DTOs/endpoints, React client route, `openai-oauth-provider@1.0.3`, AI SDK provider packages, server-side Codex auth file.

---

## Success Criteria

- A logged-in LibreChat user can open a Steel OAuth chat smoke surface in the LibreChat app.
- The user can send a text message.
- The backend calls direct `openai-oauth-provider`, using server-side auth from `STEEL_OPENAI_OAUTH_AUTH_FILE` or `~/.codex/auth.json`.
- The response text is rendered back in the LibreChat UI.
- No OAuth token, raw auth file, Authorization header, or raw provider payload is returned to the browser or written to test fixtures.
- The provider run records bounded metadata: requested/effective provider, model, unsupported settings, response ID when available, usage when available, and error category/summary.
- Local proxy remains manual diagnostics only; there is no env-selected proxy runtime path.

## Implementation Status

- [x] Baseline dependency metadata and package overrides.
- [x] Steel OpenAI runtime env parser for `STEEL_OPENAI_PROVIDER`, `STEEL_OPENAI_DEFAULT_MODEL`, and `STEEL_OPENAI_REASONING_EFFORT`.
- [x] Shared provider chat request/response DTOs.
- [x] Direct `openai-oauth-provider` adapter with sanitized fake-provider unit coverage.
- [x] Gated real-auth manual smoke spec.
- [x] Authenticated backend `POST /api/steel/ai/chat` route.
- [x] Minimal LibreChat route at `/steel/oauth-chat`.
- [x] Focused automated tests and package builds.
- [ ] Full local browser smoke through a running LibreChat server.

## Assumptions To Confirm

- "through LibreChat" means a minimal authenticated Steel route/page inside the LibreChat web app is acceptable for this phase. It does not mean rewriting the existing core `/c/new` chat endpoint yet.
- Real auth uses the local Codex auth file created by `npx @openai/codex login`, configurable through `STEEL_OPENAI_OAUTH_AUTH_FILE`.
- Default live smoke model is controlled by `STEEL_OPENAI_DEFAULT_MODEL`, defaulting to `gpt-5.5`.
- `STEEL_OPENAI_PROVIDER=OAUTH` selects direct `openai-oauth-provider` first. `STEEL_OPENAI_PROVIDER=API` is reserved for the official OpenAI API path and must not silently call OAuth.
- `STEEL_OPENAI_REASONING_EFFORT` is normalized to `none | minimal | low | medium | high | xhigh`, defaulting to `medium`.

## Implementation Checklist

### Task 0: Baseline And Dependency Metadata

**Files:**

- Modify: `tasks/todo.md`
- Modify: `.env.example`
- Modify: `tasks/lessons.md`
- Modify: `packages/api/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add active implementation checklist to `tasks/todo.md`**

Add a new top section named `V8.3 OpenAI OAuth Provider Real Auth`.

**Step 2: Add dependencies and overrides**

Add runtime dependencies where `packages/api` can bundle/import them:

- `openai-oauth-provider@1.0.3`
- `@ai-sdk/openai@3.0.65`
- `@ai-sdk/provider@3.0.10`
- `@ai-sdk/provider-utils@4.0.27`

Do not add top-level `ai@6` in this slice because the current LibreChat dependency tree includes `ai-tokenizer@1.0.6` with an optional peer on `ai@^5`. Call the direct provider's `LanguageModelV3` interface instead of using `generateText()` from `ai`.

**Step 3: Install and inspect**

Run:

```bash
rtk npm install
rtk npm ls openai-oauth-provider @ai-sdk/openai @ai-sdk/provider @ai-sdk/provider-utils
```

Expected: one coherent AI SDK provider package set, with no duplicate provider internals that would cause provider runtime mismatch. `ai@6` should not be installed in the workspace for this slice.

### Task 0.5: Steel OpenAI Runtime Env Contract

**Files:**

- Modify: `packages/api/src/steel/ai/config.ts`
- Create: `packages/api/src/steel/ai/config.spec.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Write failing config tests**

Add tests for:

- Missing env defaults to `provider: 'OAUTH'`, `model: 'gpt-5.5'`, `reasoningEffort: 'medium'`.
- `STEEL_OPENAI_PROVIDER=API` selects API provider.
- Invalid provider/model/reasoning effort throws a typed configuration error.
- `STEEL_OPENAI_DEFAULT_MODEL` accepts only `gpt-5.5`.

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/config.spec.ts
```

Expected: fail because `config.ts` does not exist.

**Step 2: Implement config parser**

Create explicit union types for:

- `SteelOpenAIProviderPreference = 'OAUTH' | 'API'`
- `SteelOpenAIDefaultModel = 'gpt-5.5'`
- `SteelOpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`

**Step 3: Verify**

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/config.spec.ts
```

### Task 1: Provider Contract And Sanitized Result Types

**Files:**

- Modify: `packages/data-provider/src/steel/ai.ts`
- Test: `packages/data-provider/src/steel/ai.spec.ts`

**Step 1: Write failing contract tests**

Add tests for:

- `SteelAIProviderErrorCategory` includes `auth`, `subscription_or_rate_limit`, `provider_timeout`, `structured_output_invalid`, and `unknown`.
- `SteelProviderChatResponse` or equivalent public DTO exposes only safe fields: `text`, `provider`, `model`, `responseId`, `usage`, `unsupportedSettings`, `warnings`.
- `SteelProviderChatResponse` has no token/header/raw payload fields.

Run:

```bash
rtk npm run test:packages:data-provider -- --runTestsByPath src/steel/ai.spec.ts
```

Expected: fail because the chat response DTO does not exist yet.

**Step 2: Implement minimal DTOs**

Add named Zod schemas and exported types. Keep arbitrary metadata wrapped in explicit value schemas, not broad `Record<string, unknown>`.

**Step 3: Verify**

Run:

```bash
rtk npm run test:packages:data-provider -- --runTestsByPath src/steel/ai.spec.ts
rtk npm run build:data-provider
```

### Task 2: Direct Provider Adapter With Fake Auth Tests

**Files:**

- Create: `packages/api/src/steel/ai/provider.ts`
- Create: `packages/api/src/steel/ai/provider.spec.ts`
- Modify or replace: `packages/api/src/steel/oauth.ts`
- Modify or replace: `packages/api/src/steel/oauth.spec.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Write failing fake-auth provider test**

Test behavior:

- Creates a temporary fake `auth.json`.
- Injects mocked `fetch`.
- Calls the provider with model `gpt-5.5` and message `Reply exactly: steel-provider-mock-ok`.
- Asserts the adapter returns `steel-provider-mock-ok`.
- Asserts request headers were used internally but not exposed in the adapter return shape.
- Asserts `responsesState: false` or equivalent stateless full-history setting is used.

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/provider.spec.ts
```

Expected: fail because the provider module does not exist.

**Step 2: Implement adapter**

Create a small adapter around:

```ts
import { createOpenAIOAuth } from 'openai-oauth-provider';
```

Call `openai(model).doGenerate(...)` directly with a `LanguageModelV3CallOptions` prompt. Do not import `generateText` from `ai` in this repo slice.

Required implementation shape:

- `createSteelOpenAIOAuthProvider({ authFilePath, fetch, ensureFresh })`
- `sendSteelOAuthChat({ model, messages, requestedSettings })`
- Default auth path: `STEEL_OPENAI_OAUTH_AUTH_FILE` or `${HOME}/.codex/auth.json`
- Default model: parsed `STEEL_OPENAI_DEFAULT_MODEL` or `gpt-5.5`
- Reasoning effort: parsed `STEEL_OPENAI_REASONING_EFFORT` or `medium`
- Always pass full prompt/message context.
- Do not pass `previous_response_id` or `item_reference`.
- Capture unsupported/dropped runtime settings, starting with stateful replay and unsupported output-token controls if not actually applied.

**Step 3: Verify**

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/provider.spec.ts src/steel/oauth.spec.ts
rtk npm run build:api
```

### Task 3: Real Auth Smoke Script

**Files:**

- Create: `packages/api/src/steel/ai/smoke.ts`
- Create: `packages/api/src/steel/ai/smoke.spec.ts`
- Add script if useful: `packages/api/package.json`

**Step 1: Write failing smoke helper test**

Test behavior:

- Uses the adapter with an injected fake provider call.
- Returns a structured smoke result with `status`, `provider`, `model`, `text`, `responseId`, `usage`, and `errorCategory`.
- Redacts all secret-bearing data.

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/smoke.spec.ts
```

Expected: fail because smoke helper does not exist.

**Step 2: Implement smoke helper**

Add a callable function used by admin smoke routes and optional manual CLI/dev scripts.

**Step 3: Manual real-auth command**

After `npx @openai/codex login` has created auth material, run:

```bash
STEEL_OPENAI_OAUTH_AUTH_FILE="$HOME/.codex/auth.json" \
STEEL_OPENAI_PROVIDER=OAUTH \
STEEL_OPENAI_DEFAULT_MODEL=gpt-5.5 \
STEEL_OPENAI_REASONING_EFFORT=medium \
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/provider.real-auth.manual.spec.ts
```

Manual spec should be skipped unless `STEEL_OPENAI_OAUTH_REAL_AUTH_TEST=true`.

Expected when enabled: response text matches the deterministic prompt and no token material is printed.

### Task 4: Backend Chat Endpoint

**Files:**

- Create: `packages/api/src/steel/chat/service.ts`
- Create: `packages/api/src/steel/chat/handlers.ts`
- Create: `packages/api/src/steel/chat/service.spec.ts`
- Modify: `packages/api/src/steel/handlers.ts` only if keeping the current flat handler export is simpler
- Modify: `api/server/routes/steel/index.js`
- Test: `api/server/routes/__tests__/steel.spec.js`

**Step 1: Write failing service tests**

Test behavior:

- Logged-in user with Steel access can send a message.
- Service calls the provider adapter with full message history.
- Response shape is sanitized.
- Auth failures map to `auth` category.
- Provider errors map to typed categories without exposing raw payloads.

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/chat/service.spec.ts
```

Expected: fail because chat service does not exist.

**Step 2: Implement service**

Use service-level guard. Keep `/api` wrapper thin. Store or prepare provider run metadata through the Phase 1 AI run model when available; do not block the chat smoke on the full workbook engine.

**Step 3: Write failing route test**

Add route test for:

```text
POST /api/steel/ai/chat
```

Expected request:

```json
{
  "model": "gpt-5.5",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

Expected response:

```json
{
  "provider": "openai_oauth_responses",
  "model": "gpt-5.5",
  "text": "...",
  "unsupportedSettings": []
}
```

Run:

```bash
rtk npm run test:api -- --runTestsByPath server/routes/__tests__/steel.spec.js
```

Expected: fail until route is wired.

**Step 4: Implement route**

Add authenticated route:

```js
router.post('/ai/chat', requireJwtAuth, handlers.chat);
```

**Step 5: Verify**

Run:

```bash
rtk npm run test:packages:api -- --runTestsByPath src/steel/chat/service.spec.ts
rtk npm run test:api -- --runTestsByPath server/routes/__tests__/steel.spec.js
rtk npm run build:api
```

### Task 5: Minimal LibreChat Steel OAuth Chat Surface

**Files:**

- Create: `client/src/features/steel/OAuthChat.tsx`
- Create: `client/src/features/steel/index.ts`
- Create: `client/src/features/steel/__tests__/OAuthChat.spec.tsx`
- Create or modify: `client/src/data-provider/Steel/index.ts`
- Create or modify: `client/src/data-provider/Steel/mutations.ts`
- Modify: `client/src/data-provider/index.ts`
- Modify: `client/src/routes/index.tsx`
- Modify: `client/src/locales/en/translation.json`

**Step 1: Write failing UI test**

Test behavior:

- Renders textarea/input and send button.
- Sends the message to `/api/steel/ai/chat`.
- Renders assistant text from the response.
- Renders provider warning text inline when returned.
- Does not render raw provider metadata or secrets.

Run:

```bash
rtk npm run test:client -- --runTestsByPath src/features/steel/__tests__/OAuthChat.spec.tsx
```

Expected: fail because the component does not exist.

**Step 2: Implement data-provider mutation**

Use existing React Query patterns. Use `useLocalize()` for visible text.

**Step 3: Implement route**

Add a dev/internal authenticated route such as:

```text
/steel/oauth-chat
```

This is the first minimal Steel chat surface. It is not the final seven-tab Workbook Preview.

**Step 4: Verify**

Run:

```bash
rtk npm run test:client -- --runTestsByPath src/features/steel/__tests__/OAuthChat.spec.tsx
rtk npm run build:client-package
```

### Task 6: End-To-End Local Real Auth Verification

**Files:**

- Modify: `docs/steel-openai-oauth-responses-setup.md`
- Modify: `tasks/todo.md`

**Step 1: Build runtime packages**

Run:

```bash
rtk npm run build:data-provider
rtk npm run build:data-schemas
rtk npm run build:api
rtk npm run build:client-package
```

**Step 2: Ensure local auth exists**

Run only if auth is missing:

```bash
npx @openai/codex login
```

Do not print token material.

**Step 3: Start backend and frontend**

Use the documented local sequence in `docs/local-dev.md`.

Backend:

```bash
STEEL_OPENAI_OAUTH_AUTH_FILE="$HOME/.codex/auth.json" \
STEEL_OPENAI_PROVIDER=OAUTH \
STEEL_OPENAI_DEFAULT_MODEL=gpt-5.5 \
STEEL_OPENAI_REASONING_EFFORT=medium \
rtk npm run backend:dev
```

Frontend:

```bash
rtk npm run frontend:dev
```

**Step 4: Browser smoke**

Open:

```text
http://localhost:3090/steel/oauth-chat
```

Log in as a LibreChat user, send:

```text
Reply exactly: steel-librechat-oauth-ok
```

Expected:

- UI renders `steel-librechat-oauth-ok`.
- Network response comes from `/api/steel/ai/chat`.
- Backend logs do not print token material.

**Step 5: Record evidence**

Update `tasks/todo.md` with:

- Verification commands run.
- Manual smoke result.
- Any skipped checks and why.
- Remaining risks.

## Verification Matrix

Run before claiming implementation complete:

```bash
rtk npm run test:packages:data-provider -- --runTestsByPath src/steel/ai.spec.ts
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/provider.spec.ts src/steel/chat/service.spec.ts
rtk npm run test:api -- --runTestsByPath server/routes/__tests__/steel.spec.js
rtk npm run test:client -- --runTestsByPath src/features/steel/__tests__/OAuthChat.spec.tsx
rtk npm run build:data-provider
rtk npm run build:data-schemas
rtk npm run build:api
rtk npm run build:client-package
rtk git diff --check
```

Manual real-auth verification:

```bash
STEEL_OPENAI_OAUTH_REAL_AUTH_TEST=true \
STEEL_OPENAI_OAUTH_AUTH_FILE="$HOME/.codex/auth.json" \
STEEL_OPENAI_PROVIDER=OAUTH \
STEEL_OPENAI_DEFAULT_MODEL=gpt-5.5 \
STEEL_OPENAI_REASONING_EFFORT=medium \
rtk npm run test:packages:api -- --runTestsByPath src/steel/ai/provider.real-auth.manual.spec.ts
```

Browser verification:

```text
http://localhost:3090/steel/oauth-chat
```

## Stop Conditions

- Stop and re-plan if `openai-oauth-provider` cannot bundle into `packages/api` CommonJS output.
- Stop and re-plan if adding AI SDK overrides breaks existing LibreChat package builds.
- Stop and re-plan if real auth requires printing, copying, or storing token material outside a server-side path.
- Stop and re-plan if the minimal Steel route would require rewriting the global LibreChat chat store before the Steel Workspace phase.
