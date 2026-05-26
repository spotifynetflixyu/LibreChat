# Steel openai-oauth Responses Setup

This runbook is the gate before any real `openai_oauth_responses` provider call, live provider smoke, or Steel chat UI live test. Phase 1 should create and test the OpenAI OAuth proxy route/service seam early, but it may do so with injectable clients before hitting a real provider.

## What This Binding Is

Steel uses a provider abstraction:

- Default driver: `openai_oauth_responses`, backed primarily by `openai-oauth-provider` and `/v1/responses`.
- Manual diagnostic tool: the `openai-oauth` localhost HTTP proxy can still be started by a developer for local smoke probes, but it is not a runtime provider route in LibreChat.
- Secondary driver: `openai_api`, backed by `OPENAI_API_KEY`, available only for capabilities whose live smoke test has passed.

The openai-oauth binding is not LibreChat login. It is provider authorization material used only by the server-side Steel AI driver.

## Researched Integration Decision

Research target: [`EvanZhouDev/openai-oauth`](https://github.com/EvanZhouDev/openai-oauth), observed at commit `aa526920af322568968a30fe820b2b9d55545f8a`; current npm metadata reported `openai-oauth@1.0.2` and `openai-oauth-provider@1.0.3`, both `AGPL-3.0-only`.

The project exposes two usable surfaces:

- `openai-oauth-provider`: a Vercel AI SDK provider for direct in-process use. The Vercel AI SDK 6 dependency set is Apache-2.0 and approved for production use in this project. When the dependency is added, the implementation must unify `ai`, `@ai-sdk/openai`, `@ai-sdk/provider`, and `@ai-sdk/provider-utils` through package-manager overrides/resolutions.
- `openai-oauth` CLI/local server: starts an OpenAI-compatible localhost endpoint, defaults to `http://127.0.0.1:10531/v1`, and supports `GET /v1/models`, `POST /v1/responses`, and `POST /v1/chat/completions`.

Phase 1/3 implementation should make direct `openai-oauth-provider` the only coded provider path for `openai_oauth_responses`. The local HTTP proxy remains a manual diagnostic smoke-probe tool, not an env-selected runtime route.

Spike result: `tasks/v8.3/openai-oauth-provider-spike.md` proved `openai-oauth-provider@1.0.3` can install, import, typecheck, run with mocked `fetch`, and complete a local-auth live text call from this machine. After the user correction, AI SDK 6 is not a dependency blocker. The remaining implementation work is to keep auth material server-side, unify AI SDK versions, verify LibreChat packaging, keep model discovery backend-owned, and record provider-normalized or dropped Responses settings.

Important constraints to preserve:

- The upstream project is unofficial and not affiliated with OpenAI.
- Its auth file is password-equivalent credential material.
- It is documented for trusted local/personal experimentation, not a hosted shared service.
- The CLI `/v1/responses` endpoint is stateless and rejects `previous_response_id` / `item_reference`; Steel must send full prompt/conversation context each run.
- The proxy normalizes Responses bodies, forces upstream streaming internally, aggregates SSE for non-stream callers, and does not preserve every official Responses setting. Steel must record unsupported or adapter-dropped settings instead of silently pretending they applied.

## Hard Security Rules

- Never store OAuth token material in frontend localStorage.
- Never paste OAuth token material into docs, chat, screenshots, Git commits, test fixtures, or logs.
- Store token material only in a server-side encrypted store or a local encrypted development file.
- Ensure the local token store path is ignored by Git before binding.
- Do not expose raw openai-oauth token material, OpenAI API keys, or raw provider payloads through `/api/steel/...` or `/api/admin/steel/...`.
- Do not bind the local proxy to a public interface. Use `127.0.0.1` unless a later reviewed local-network test explicitly needs otherwise.
- Do not run the openai-oauth proxy as a hosted multi-user service.
- When adding `openai-oauth-provider`, add dependency-version overrides/resolutions in the same implementation slice and keep the license/compliance note with the dependency change.
- Do not copy upstream `openai-oauth` source into LibreChat.

## Local Configuration Shape

```env
STEEL_AI_DRIVER_DEFAULT=openai_oauth_responses
STEEL_AI_DRIVER_SECONDARY=openai_api
STEEL_AI_REQUIRE_CAPABILITY_PASSED=true

STEEL_OPENAI_OAUTH_RESPONSES_ENABLED=true
STEEL_OPENAI_OAUTH_AUTO_FALLBACK=false

STEEL_OPENAI_API_KEY_REQUIRED_FOR_PRODUCTION=true
STEEL_OPENAI_API_ENABLE_ONLY_AFTER_SMOKE_TEST=true
OPENAI_API_KEY=...

STEEL_ALLOWED_MODEL_PROVIDER=openai_oauth_responses,openai_api
STEEL_ENABLE_MULTI_PROVIDER=true
```

`OPENAI_API_KEY` is still required for enabled `openai_api` fallback tests and production-safe operation. It does not replace the openai-oauth binding.

`STEEL_OPENAI_OAUTH_ALLOW_PRODUCTION=true` applies to the direct-provider path after dependency overrides/resolutions, packaging verification, server-side auth storage, and capability smoke gates pass. The local proxy remains a manual local/dev probe only and must not be hosted as a multi-user service. Direct provider mode does not need a `/v1` base URL or transport selector.

`STEEL_OPENAI_OAUTH_AUTO_FALLBACK=false` means OAuth remains the primary path and the app will not automatically reroute failed or unsupported OAuth calls to `openai_api`. Even when enabled, fallback still requires the target `openai_api` capability smoke result to be `passed`.

## Binding Flow

1. Create or choose the local LibreChat `ADMIN` account from `docs/steel-account-setup.md`.
2. Create local Codex/ChatGPT auth with the intended subscription-backed account:
   ```bash
   npx @openai/codex login
   ```
3. Add the direct-provider dependency with the approved AI SDK 6 version set and package-manager overrides/resolutions.
4. Verify the server-side direct-provider adapter can load the auth binding without printing token material.
5. For manual local proxy diagnostics only, start the `openai-oauth` localhost proxy and confirm the base URL responds without printing token material:
   ```bash
   npx openai-oauth@latest --host 127.0.0.1 --port 10531
   ```
   If a deterministic model list is needed during Steel testing, pass `--models gpt-5.4,gpt-5.3-codex` or the currently approved model list.
6. Persist token material only through the configured server-side encrypted store or local encrypted development file.
7. Store only non-secret token metadata in audit/debug records, such as provider name, account label, expiry if available, and last bind time.
8. Verify the server can load the binding without printing secrets.
9. Only after the binding is verified, run `POST /api/admin/steel/ai/capability-smoke`.
10. Only after text/tool/structured/workbook-patch smoke passes, test the Steel chat UI against `openai_oauth_responses`.

If the binding fails, classify it as an auth/provider setup error. Do not silently call OpenAI API during setup; fallback behavior is tested only after the primary failure is visible and auditable.

## Capability Smoke Order

Run smoke tests in this order:

1. Model list.
2. Text generation.
3. Streaming events.
4. Stateless full-history second turn.
5. Backend tool call.
6. Tool result round trip.
7. Structured output.
8. Workbook patch creation.
9. Image input.
10. PDF input, including text PDF and scanned/drawing PDF if supported.
11. DOCX input if quote attachments need it.
12. XLS/XLSX or spreadsheet evidence.
13. Hosted tools such as File Search, Code Interpreter, or Hosted Shell if the selected driver exposes them.

Only mark a capability supported after a real smoke passes. Unsupported or unverified capability paths return typed low-confidence/manual-review errors unless the matching `STEEL_FALLBACK_ON_*` flag is enabled and `openai_api` has a passed smoke result for that same capability.

## Local Proxy Smoke Probes

Use these probes only after the proxy is already running locally as a manual diagnostic. Do not wire these probes into the runtime provider path, and do not print request headers or auth file contents.

```bash
curl -sS http://127.0.0.1:10531/health
curl -sS http://127.0.0.1:10531/v1/models
curl -sS http://127.0.0.1:10531/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "stream": false,
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "Reply with exactly: steel-oauth-ok" }
        ]
      }
    ]
  }'
```

Steel's automated tests should not require this live proxy. They should use an injectable local-proxy client with mocked `fetch` for `/models` and `/responses`, then reserve real proxy calls for admin-triggered smoke evidence.

## Expected Evidence

Each successful or failed provider smoke should record:

- Provider driver and model.
- Capability case ID.
- Provider run/session IDs when available.
- Tool call IDs and workbook ID/version when a workbook patch is involved.
- Fallback status or unsupported reason.
- Typed error category for auth, subscription/rate, unsupported tool, unsupported file input, unsupported vision input, unsupported XLSX input, unsupported hosted tool, or invalid structured output.
- Confirmation that no secret token or raw provider payload was stored in user-visible output.

Do not run the localhost Steel Workspace live chat test until this runbook has been completed and binding evidence exists.
