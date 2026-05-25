# Steel ChatGPT OAuth Binding Setup

This runbook is the gate before any real OpenHarness ChatGPT/Codex OAuth provider call, live provider smoke, or Steel chat UI live test. Phase 1 may create route contracts and persistence shapes without hitting a real provider.

## What This Binding Is

Steel uses a provider abstraction:

- Default local/dev driver: `openharness_chatgpt_oauth`.
- Fallback and production-safe driver: `openai_api`, backed by `OPENAI_API_KEY`.

The ChatGPT OAuth binding is not LibreChat login. It is provider authorization material used only by the server-side Steel AI driver.

## Hard Security Rules

- Never store OAuth token material in frontend localStorage.
- Never paste OAuth token material into docs, chat, screenshots, Git commits, test fixtures, or logs.
- Store token material only in a server-side encrypted store or a local encrypted development file.
- Ensure the local token store path is ignored by Git before binding.
- Do not expose raw OpenHarness OAuth tokens, OpenAI API keys, or raw provider payloads through `/api/steel/...` or `/api/admin/steel/...`.

## Local Configuration Shape

The exact package API must be confirmed when Phase 3 pins OpenHarness versions, but the Steel environment contract is:

```env
STEEL_AI_DRIVER_DEFAULT=openharness_chatgpt_oauth
STEEL_AI_DRIVER_FALLBACK=openai_api
STEEL_OPENHARNESS_CHATGPT_ENABLED=true
STEEL_OPENHARNESS_CHATGPT_PROVIDER_VERSION_PIN=0.1.x
STEEL_OPENHARNESS_TOKEN_STORE=local_encrypted_file
OPENAI_API_KEY=...
```

`OPENAI_API_KEY` is still required for fallback tests and production-safe operation. It does not replace the ChatGPT OAuth binding.

## Binding Flow

1. Create or choose the local LibreChat `ADMIN` account from `docs/steel-account-setup.md`.
2. Confirm `@openharness/core` and `@openharness/provider-chatgpt` are pinned before writing adapter code.
3. Implement the OpenHarness ChatGPT OAuth login/bind action as an admin-only or local-dev-only backend action. Do not bind from browser-only frontend code.
4. Complete the ChatGPT/Codex OAuth browser authorization with the intended subscription-backed account.
5. Persist the returned token material only through the configured server-side encrypted store or local encrypted development file.
6. Store only non-secret token metadata in audit/debug records, such as provider name, account label, expiry if available, and last bind time.
7. Verify the server can load the binding without printing secrets.
8. Only after the binding is verified, run `POST /api/admin/steel/ai/capability-smoke`.
9. Only after at least text/tool/structured/workbook-patch smoke passes, test the Steel chat UI against the OAuth driver.

If the binding fails, classify it as an auth/provider setup error. Do not silently fall back during the setup step; fallback behavior is tested after the primary failure is visible and auditable.

## Capability Smoke Order

Run smoke tests in this order:

1. Text generation.
2. Streaming events.
3. Backend tool call.
4. Structured output.
5. Workbook patch creation.
6. Image/PDF input.
7. XLSX or spreadsheet evidence.
8. Hosted tools such as File Search, Code Interpreter, or Hosted Shell if the pinned provider exposes them.

Only mark a capability supported after a real smoke passes. If file, vision, XLSX, or hosted-tool capability is unsupported or unverified, route that workflow to `openai_api` or return a typed low-confidence/manual-review error.

## Expected Evidence

Each successful or failed provider smoke should record:

- Provider driver and model.
- Provider run/session IDs when available.
- Tool call IDs and workbook ID/version when a workbook patch is involved.
- Fallback status and fallback reason.
- Typed error category for auth, subscription/rate, unsupported tool, unsupported file input, unsupported vision input, unsupported XLSX input, unsupported hosted tool, or invalid structured output.
- Confirmation that no secret token or raw provider payload was stored in user-visible output.

Do not run the localhost Steel Workspace live chat test until this runbook has been completed and the binding evidence exists.
