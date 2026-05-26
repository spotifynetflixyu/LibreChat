# openai-oauth-provider Compliance And Dependency Spike

Date: 2026-05-26

## Purpose

Evaluate whether LibreChat Steel should directly import `openai-oauth-provider`
instead of using the `openai-oauth` local HTTP `/v1` proxy.

## Packages Tested

Isolated install path: `/tmp/lc-openai-oauth-provider-spike`

Installed packages:

- `openai-oauth-provider@1.0.3`
- `ai@6.0.191`
- `@ai-sdk/openai@3.0.65`
- `typescript@6.0.3`
- `tsx@4.22.3`

Observed metadata:

- `openai-oauth-provider@1.0.3` is `AGPL-3.0-only`.
- It is ESM package type, but Node 22 can `require('openai-oauth-provider')` and dynamic import it in the isolated spike.
- It depends on `@ai-sdk/openai@3.0.41`, `@ai-sdk/provider@3.0.8`, and `@ai-sdk/provider-utils@4.0.19`.
- The app-level install also had `@ai-sdk/openai@3.0.65` and `@ai-sdk/provider@3.0.10`, creating duplicate AI SDK provider package versions.
- User correction after spike: Vercel AI SDK 6 is Apache-2.0, production-approved, and should be unified with package-manager overrides/resolutions rather than treated as a blocker.

LibreChat context:

- The repo license is MIT.
- `packages/api` currently builds CommonJS output through Rollup.
- The current Steel backend path does not already depend on Vercel AI SDK.

## Tests Run

### 1. Isolated Install

Command:

```bash
cd /tmp/lc-openai-oauth-provider-spike
npm install openai-oauth-provider@1.0.3 ai@6.0.191 @ai-sdk/openai@3.0.65 typescript@latest tsx@latest
```

Result:

- Install completed.
- `npm audit` reported no vulnerabilities in the isolated spike.

### 2. Runtime Import

Commands:

```bash
node -e "require('openai-oauth-provider')"
node -e "import('openai-oauth-provider')"
```

Result:

- CommonJS `require` worked under Node 22.
- Dynamic import worked.
- Exported keys: `createOpenAIOAuth`, `deriveAccountId`, `loadAuthTokens`, `openai`, `parseJwtClaims`.

### 3. TypeScript Compatibility

Command:

```bash
npx tsc --noEmit --module esnext --moduleResolution bundler --target es2015 --strict --skipLibCheck --allowSyntheticDefaultImports --esModuleInterop --lib es2017,dom provider-typecheck.ts
```

Result:

- Typecheck passed in the isolated project.
- `createOpenAIOAuth()` returned a model accepted by `generateText()` at compile time.

### 4. Mocked Provider Smoke

Shape:

- Created a fake local `auth.json` with fake access token and account id.
- Passed `ensureFresh: false`.
- Injected mocked `fetch`.
- Called `generateText({ model: openai('gpt-5.4') })`.

Result:

- Provider called `https://chatgpt.com/backend-api/codex/responses`.
- Request included `Authorization: Bearer ...`, `chatgpt-account-id`, and `OpenAI-Beta: responses=experimental`.
- Request body was normalized to `stream: true`, `instructions: ""`, and `store: false`.
- `maxOutputTokens` from AI SDK did not reach upstream as `max_output_tokens`.
- Mock SSE response produced `provider-mock-ok`, usage, and provider metadata.

### 5. Live Provider Smoke

Command:

```bash
node provider-live-smoke.mjs
```

Runtime:

- Used local `~/.codex/auth.json`.
- Model: `gpt-5.4`.
- Prompt requested exactly `librechat-provider-live-ok`.

Result:

- Live response text matched `librechat-provider-live-ok`.
- Usage was returned.
- Provider metadata included an OpenAI response id and service tier.
- No token material or request headers were printed.

## Findings

Direct `openai-oauth-provider` is technically viable for a local development
spike:

- It installs.
- It imports.
- It typechecks with AI SDK `generateText`.
- It can call Codex `/responses` through fake auth and mocked fetch.
- It can make a real local-auth text call from this machine.

After user correction, Vercel AI SDK 6 is not a dependency blocker:

- AI SDK 6 is Apache-2.0 and production-approved for this project.
- Version duplication is an implementation issue, not a blocker: add package-manager overrides/resolutions so `ai`, `@ai-sdk/openai`, `@ai-sdk/provider`, and `@ai-sdk/provider-utils` resolve to one approved version set.
- `openai-oauth` remains the primary provider path.

Remaining implementation constraints:

- The package's own README says it uses password-equivalent local auth material and is for trusted local/personal experimentation. Steel production use must keep auth material server-side and never expose it to users, logs, frontend storage, or raw audit payloads.
- It does not expose model discovery helpers; Steel still needs a backend-owned model-list and capability matrix path.
- It normalizes or drops some Responses settings. Steel must record unsupported settings rather than claim LibreChat defaults applied.
- `openai-oauth-provider` remains a direct dependency choice for the Steel provider layer; do not let AI SDK provider internals leak into Steel business services, workbook validation, tools, or route shells.

## Decision

Use `openai-oauth` as the primary v8.3 provider path.

Implementation should use the direct `openai-oauth-provider` adapter when
adding the provider dependency, because the spike proved install/import/type
compatibility and live text execution. Keep the local HTTP proxy only as a
manual diagnostic smoke probe, not as an env-selected runtime route.

Required implementation gates:

- Add dependency versions and overrides/resolutions in the package manager so AI
  SDK packages resolve to one approved version set.
- Build review proves `packages/api` CommonJS output and `/api` runtime can
  consume the provider after normal LibreChat packaging.
- Steel model discovery remains backend-owned and does not depend on provider
  package internals.
- Provider setting normalization is captured in `unsupportedSettings` and
  provider warning metadata.
- Auth material is stored only server-side and is never exposed through frontend
  state, logs, user-visible responses, or raw audit payloads.
