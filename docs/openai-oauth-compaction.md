# Native OpenAI OAuth compaction

The trusted host module compacts OpenAI OAuth Responses context using the Codex V2
`compaction_trigger` input item. It is opt-in and applies only to agents whose source
provider or endpoint is `openai_oauth_responses`. API-key providers retain their existing
context handling. This is a host provider extension, not an executable deployment hook.

Configure `librechat.yaml`:

```yaml
oauthCompaction:
  enabled: true
  triggerRatio: 0.85
  maxContextTokens: 258400
  outputReserveTokens: 8192
  timeoutMs: 300000
  maxResponseBytes: 8388608
  retentionDays: 30
```

Omitting the section or setting `enabled: false` preserves existing behavior. Configure
`maxContextTokens` below the selected model's context capacity. The default 258,400-token
budget matches the Codex OAuth `gpt-6.1-sol` catalog's 272,000-token context window
at 95% effective capacity (verified 2026-10-01). With the default 85% trigger ratio,
automatic compaction starts at an estimated 219,640 tokens, including the output
reserve. Explicit host budgets remain supported. The host also respects the
agent's smaller context budget and reserves at least its selected output limit.

The module uses the agents SDK's public provider registration interface. Root, multi-agent,
foreground, nested and detached child model construction receives the same adapter. A child
uses its SDK execution ancestry identifier rather than an inherited root thread ID. The host
injects configuration, the OAuth transport and `OAuthCompactionStore`; it does not patch the
SDK or load arbitrary plugin code. The direct quotation and delegate OCR runners inherit
explicitly scoped compaction options from the host model-options sink.

## Persistence and refresh

MongoDB stores the exact opaque provider item privately, the hashes of the canonical covered
prefix, and optional verified input usage for the actual projected request. The opaque field
is excluded from ordinary queries and is never placed in browser state, message text, status
events or logs. Records are isolated by tenant, user, conversation, agent, execution, OAuth
account, model, instructions, tools and request options. TTL bounds retention; conversation/account deletion cleans
up owned records.

Each provider call acquires a lease and saves with a revision compare-and-swap. A fresh server
or model instance restores a matching prefix as real user/developer items, the latest opaque
item, and the new tail. Old assistant/tool results and previous opaque items are not replayed.
Edited branches, changed instructions/tools/options/models/accounts and expired state cannot borrow another
scope's state. Successful compaction is saved before generation, so cancelling generation or
refreshing before its usage arrives does not discard the compact.

The public `on_context_compaction` event reports only lifecycle IDs and phases. Its localized
message marker shows “Compacting context · This can take a few minutes” while the native
compaction request runs, then settles. Restoring an existing compact alone does not show a
new progress hint. Traditional Chinese copy is included.

Automatic compaction uses the native request and persistence path before a generation when the
projected context needs reclaiming. Its completed marker remains visible after refresh and is not
treated as a text summary checkpoint.

## Admission and failures

Budget estimates use verified provider input usage only when the account, model, instructions,
tools, request options and projected prefix match. Only new tail items are added to that count.
Otherwise the gateway initializes the bounded `o200k_base` budgeting counter. Estimate v1 counts
serialized plaintext and request structure, with 32 tokens of framing headroom per item and
envelope, plus the configured output reserve. This approximates native OAuth usage; it is not
an exact provider count. Encrypted compaction items and native media payloads have unknown costs
and are not tokenized as plaintext. UTF-8 byte limits apply to stream parsing, not context admission.

Both automatic compaction and prefix selection use this token estimate. Native compaction operates
only at closed function-call/result boundaries. If no complete group appears to fit, the shortest
complete group is sent for provider confirmation. Estimates alone never produce `context_too_large`;
that code requires a recognized provider context-length error. No calibration generation is sent.

A busy lease, failed persistence, cancellation, malformed stream or provider failure stops the
request rather than resending raw history. A smaller-prefix retry is allowed once only for a
pre-stream HTTP 400/413 with the recognized structured context-length code. Errors after
streaming starts, timeouts, quota errors and arbitrary provider messages are not retried. Repeated
recognized context-length failures stop with `context_too_large`; the UI displays capacity guidance
separately from a generic compaction failure.

This prevents refresh from inflating context with already compacted tool history. It cannot
promise every input fits: very large retained user messages, a single oversized tool group,
model capacity changes and provider quotas can still reject a request.

## Verification

Focused tests cover bounded SSE parsing, exact opaque replay, repeated compaction, cancellation,
lease fencing, safe events, configuration and localized UI. `persistence.spec.ts` uses a real
disposable MongoDB and the real SDK/provider adapter with synthetic external HTTP responses to
verify fresh-instance restoration and child isolation. The native capability probe separately
verifies the real OAuth account's compact/replay/repeated-compaction/cancellation protocol.
