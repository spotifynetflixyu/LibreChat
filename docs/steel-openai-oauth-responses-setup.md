# Steel openai-oauth Responses Setup

This runbook is the gate before any real `openai_oauth_responses` provider call, live provider smoke, or Steel chat UI live test. Phase 1 may create route contracts and persistence shapes without hitting a real provider.

## What This Binding Is

Steel uses a provider abstraction:

- Default local/dev driver: `openai_oauth_responses`, backed by the `openai-oauth` localhost proxy and `/v1/responses`.
- Secondary driver: `openai_api`, backed by `OPENAI_API_KEY`, available only for capabilities whose live smoke test has passed.

The openai-oauth binding is not LibreChat login. It is provider authorization material used only by the server-side Steel AI driver.

## Hard Security Rules

- Never store OAuth token material in frontend localStorage.
- Never paste OAuth token material into docs, chat, screenshots, Git commits, test fixtures, or logs.
- Store token material only in a server-side encrypted store or a local encrypted development file.
- Ensure the local token store path is ignored by Git before binding.
- Do not expose raw openai-oauth token material, OpenAI API keys, or raw provider payloads through `/api/steel/...` or `/api/admin/steel/...`.

## Local Configuration Shape

```env
STEEL_AI_DRIVER_DEFAULT=openai_oauth_responses
STEEL_AI_DRIVER_SECONDARY=openai_api
STEEL_AI_REQUIRE_CAPABILITY_PASSED=true

STEEL_OPENAI_OAUTH_RESPONSES_ENABLED=true
STEEL_OPENAI_OAUTH_RESPONSES_BASE_URL=http://127.0.0.1:10531/v1
STEEL_OPENAI_OAUTH_RESPONSES_ENDPOINT=/v1/responses
STEEL_OPENAI_OAUTH_RESPONSES_STATE_MODE=stateless_full_history
STEEL_OPENAI_OAUTH_AUTH_FILE_STORE=server_side_encrypted_file
STEEL_OPENAI_OAUTH_ALLOW_PRODUCTION=false

STEEL_OPENAI_API_ENABLED=false
STEEL_OPENAI_API_KEY_REQUIRED_FOR_PRODUCTION=true
STEEL_OPENAI_API_ENABLE_ONLY_AFTER_SMOKE_TEST=true
OPENAI_API_KEY=...

STEEL_ALLOWED_MODEL_PROVIDER=openai_oauth_responses,openai_api
STEEL_ENABLE_MULTI_PROVIDER=true
STEEL_FALLBACK_REQUIRE_CAPABILITY_PASSED=true
STEEL_FALLBACK_ON_FILE_INPUT_UNSUPPORTED=false
STEEL_FALLBACK_ON_VISION_INPUT_UNSUPPORTED=false
STEEL_FALLBACK_ON_XLSX_INPUT_UNSUPPORTED=false
STEEL_FALLBACK_ON_HOSTED_TOOL_UNSUPPORTED=false
```

`OPENAI_API_KEY` is still required for enabled `openai_api` fallback tests and production-safe operation. It does not replace the openai-oauth binding.

## Binding Flow

1. Create or choose the local LibreChat `ADMIN` account from `docs/steel-account-setup.md`.
2. Start the `openai-oauth` localhost proxy and confirm the base URL responds without printing token material.
3. Complete the provider authorization flow with the intended subscription-backed account.
4. Persist token material only through the configured server-side encrypted store or local encrypted development file.
5. Store only non-secret token metadata in audit/debug records, such as provider name, account label, expiry if available, and last bind time.
6. Verify the server can load the binding without printing secrets.
7. Only after the binding is verified, run `POST /api/admin/steel/ai/capability-smoke`.
8. Only after text/tool/structured/workbook-patch smoke passes, test the Steel chat UI against `openai_oauth_responses`.

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
