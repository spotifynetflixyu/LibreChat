# Admin Steel Rules UI Design

Date: 2026-06-30
Status: design proposal
Scope: Steel rules administration only. No implementation or schema change is
included in this document.

## Summary

LibreChat's documented Admin and YAML surfaces can manage application config,
model specs, and MCP server configuration, but they do not provide a native,
sortable global rules registry that preloads ordered Steel rules into every AI
runtime context. The Steel implementation already has the right durable source:
the `steel.rules` table. The proposed solution is an Admin-only Steel Rules UI
backed by `steel.rules`, with explicit draft/review/publish flow, rule ordering,
preview, and import/export support.

The runtime should continue to preload reviewed active rules into the Steel
native context. Admin UI changes only how the rules are maintained; they should
not change the core runtime contract or introduce a second rule source.

## Goals

- Let admins edit Steel rule content, metadata, activation, review state, and
  ordering from UI instead of changing code or hand-editing `docs/rules`.
- Make the rendered rule prefix previewable before publish, using the same
  ordering as runtime context injection.
- Keep reviewed active rules preloaded into all Steel-native AI execution paths,
  including the native Agent path and the OpenAI Responses-compatible path.
- Preserve the existing `steel.rules` table as the source of truth for runtime
  rule loading.
- Keep the solution additive to LibreChat: use existing Admin auth/capability
  boundaries and existing Steel repository/runtime seams.

## Non-Goals

- Do not build a generic LibreChat global-prompt framework in this phase.
- Do not make `librechat.yaml`, `fileAnalysis.instructions`, MCP
  `serverInstructions`, or `modelSpecs.promptPrefix` the Steel rule source.
- Do not add Steel modelSpec opt-in, per-model enable switches, or a Steel
  disable toggle. Steel remains global native behavior for this fork.
- Do not let prompt rules control executable tool exposure. Tool availability
  stays backend-owned.
- Do not expose arbitrary SQL or a generic database editor through Admin.

## Current State

Upstream/documented LibreChat surfaces:

- Admin Panel documentation:
  <https://www.librechat.ai/docs/features/admin_panel>
- Custom YAML configuration:
  <https://www.librechat.ai/docs/configuration/librechat_yaml>
- Model Specs `promptPrefix` documentation:
  <https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/model_specs>
- MCP server instructions documentation:
  <https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers>

Repo-local Steel state:

- `supabase/schema.sql` already defines `steel.rules` with `slug`, `version`,
  `rule_kind`, `title`, `locale`, `rule_sections`, `selectors`, `prompt`,
  `tool_policy`, `output_policy`, `priority`, `active`, `review_state`,
  `source_refs`, publish/review timestamps, and audit user columns.
- `packages/api/src/steel/repositories/rules.ts` loads reviewed active rules
  from `steel.rules` and orders them by `priority ASC, id ASC`.
- `packages/api/src/steel/native/context.ts` builds the stable Steel
  instruction prefix in this order: `agent`, `quote_rules`, `output`, `other`.
- `api/server/routes/admin/steel/index.js` already exposes an Admin-only Steel
  route behind JWT auth and `SystemCapabilities.ACCESS_ADMIN`.
- `packages/data-provider/src/api-endpoints.ts` already has
  `adminSteelBase()` and an Admin Steel capability smoke endpoint helper.

The gap is maintenance UX, not runtime storage. Today the reviewed rules can be
seeded/synced from `docs/rules`, but admins cannot edit content or priority from
UI and immediately preview what all Steel AI contexts will receive.

## Source of Truth

`steel.rules` should become the canonical source for runtime rule content.

`docs/rules` should remain useful, but only as:

- initial bootstrap seed files,
- reviewed human-readable exports,
- deployment/audit snapshots,
- local fallback material for migrations or disaster recovery.

Runtime should not read `docs/rules` per turn. It should keep loading reviewed
active rows from `steel.rules` through the Steel repository.

## Rule Model

Use the existing schema for MVP:

- `rule_kind = agent` maps to the `Steel Agent Rules` prefix section.
- `rule_kind = steel` maps to the `Steel Quote Rules` prefix section.
- `rule_kind = output` maps to the `Steel Output Rules` prefix section.
- `rule_kind = other` maps to the `Steel Other Rules` prefix section.
- `priority` controls ordering within each rule kind.
- `review_state = reviewed` plus `active = true` means runtime-visible.
- Draft and rejected rules stay admin-visible but runtime-hidden.

No schema migration is required for the MVP design. If later implementation adds
separate audit-event rows, comments, approval chains, or lock metadata, update
both `supabase/schema.sql` and a new Supabase migration in the same change.

## Versioning and Publish Flow

Rules need a workflow that avoids mutating reviewed production text without an
audit trail:

1. Create: new rows start as `draft`, `active = false`, `version = 1`.
2. Edit draft: mutable until submitted or published.
3. Submit review: sets `review_state = needs_review`.
4. Publish: sets `review_state = reviewed`, `active = true`, `reviewed_by`,
   `reviewed_at`, and `published_at`.
5. Edit reviewed rule: create a new draft row with the same `slug`,
   `version + 1`, copied metadata/content, and `active = false`.
6. Publish replacement: activate the new reviewed version and set
   `invalidated_at`/`active = false` on the older active version for the same
   `slug`.
7. Deactivate/archive: set `active = false`; keep the row for audit.

This keeps Admin editing simple while preserving rollback and historical
inspection.

## Backend API

Extend the existing Admin Steel router under `/api/admin/steel`. Every endpoint
uses the existing JWT plus `ACCESS_ADMIN` boundary.

Recommended endpoints:

- `GET /rules`
  - Query: `kind`, `state`, `active`, `q`, `limit`, `cursor`.
  - Returns paginated rule summaries ordered by kind, priority, and id.
- `GET /rules/:id`
  - Returns full rule content, metadata, and version lineage.
- `POST /rules`
  - Creates a draft rule.
- `PATCH /rules/:id`
  - Updates a draft rule. If the target is reviewed, creates a next-version
    draft instead of mutating the reviewed row.
- `POST /rules/:id/submit-review`
  - Moves draft to `needs_review`.
- `POST /rules/:id/publish`
  - Publishes one reviewed active version and invalidates the previous active
    version for the same `slug`.
- `POST /rules/:id/reject`
  - Marks a pending rule rejected with optional reason metadata.
- `POST /rules/:id/archive`
  - Deactivates a rule without deleting it.
- `PATCH /rules/order`
  - Bulk updates `priority` for one `rule_kind`; validates that ids all belong
    to the requested kind.
- `POST /rules/preview`
  - Renders the effective Steel instruction prefix from selected draft/reviewed
    rule ids, or from current reviewed active rules when no ids are supplied.
- `POST /rules/import/docs`
  - Optional later phase. Dry-runs a `docs/rules` import first, then applies
    only after explicit confirmation.
- `GET /rules/export`
  - Optional later phase. Exports reviewed active rules into docs-compatible
    text/metadata for audit.

Validation requirements:

- restrict `rule_kind` and `review_state` to schema enums;
- require non-empty `slug`, `title`, and `prompt`;
- cap prompt length and reject oversized JSON policy fields;
- validate `selectors`, `tool_policy`, `output_policy`, and `source_refs` as
  JSON objects/arrays, not strings containing unchecked JSON;
- reject duplicate active reviewed versions for the same `slug`;
- keep errors free of secrets, DB URLs, OAuth tokens, or raw stack traces.

## Frontend UI

Add an Admin Steel Rules page reachable from the existing Admin surface.

Recommended layout:

- Left or top filters:
  - rule kind: `agent`, `steel`, `output`, `other`;
  - state: draft, needs review, reviewed, rejected;
  - active only;
  - text search.
- Rules table:
  - order/priority;
  - kind;
  - title;
  - slug and version;
  - sections;
  - review state;
  - active flag;
  - updated/reviewed timestamps.
- Ordering controls:
  - MVP: move up/down buttons plus numeric priority edit;
  - later: drag reorder, still backed by `PATCH /rules/order`.
- Rule editor:
  - title, slug, locale, kind, sections, active flag;
  - prompt/content editor using a large monospace textarea;
  - structured editors for `selectors`, `tool_policy`, `output_policy`;
  - read-only source refs and audit timestamps;
  - save draft, submit review, publish, reject, archive.
- Preview panel:
  - rendered prefix grouped as Agent, Quote, Output, Other;
  - approximate token/character count;
  - warning when preview includes drafts that are not runtime-visible;
  - diff against currently published prefix.

The UI should use the existing LibreChat component style. It should not create a
separate design system for Steel.

## Runtime Integration

The runtime path should stay mostly unchanged:

- Continue loading reviewed active rules through the Steel repository.
- Continue composing the prefix in the stable order:
  `agent -> quote_rules -> output -> other`.
- Continue injecting this stable prefix before volatile runtime state, user
  memory, history, and the current user turn.
- Do not add per-turn file reads from `docs/rules`.
- If a future global cache is introduced for rules, Admin publish/archive/order
  endpoints must invalidate it immediately.

The Admin preview endpoint should share the same renderer as runtime context
composition. Preview and runtime must not drift.

## Security and Permissions

- Reuse the existing Admin Steel route boundary:
  `requireJwtAuth` plus `SystemCapabilities.ACCESS_ADMIN`.
- Do not introduce Steel-specific user role gates for runtime rule loading.
  This Admin UI controls maintenance only; all Steel-native runtime paths keep
  receiving the reviewed active global rules.
- Require CSRF/session protections consistent with other Admin routes.
- Never return DB connection strings, env values, OAuth tokens, or raw stack
  traces from rule APIs.
- Treat prompt content as untrusted text for rendering; escape in preview and
  never render as HTML.
- Keep destructive actions reversible by archiving/deactivating, not deleting.

## Import and Export

Keep the existing CLI sync path for bootstrap and local maintenance, but make UI
the operational maintenance surface.

Recommended behavior:

- Admin import from `docs/rules` must default to dry-run.
- Dry-run shows create/update/deactivate candidates with source refs and hashes.
- Apply creates draft rows unless explicitly configured as a trusted bootstrap.
- Export writes the currently reviewed active rules into docs-compatible output
  for review/audit, not as a runtime dependency.

## Implementation Slices

1. Backend read and preview
   - Add repository/admin service methods for listing, reading, and rendering
     preview.
   - Add data-provider endpoint helpers and response types.
   - Add route tests for Admin auth and rule query behavior.
2. Read-only Admin UI
   - Add Admin Steel Rules page with filters, table, detail drawer, and preview.
   - Verify reviewed active ordering matches runtime.
3. Draft/edit/publish backend
   - Add create/update/version/publish/archive APIs.
   - Add tests for immutable reviewed rows and single active reviewed version.
4. Editing UI
   - Add draft editor, structured JSON field validation, review actions, and
     priority controls.
5. Import/export
   - Add dry-run import using the same parser as the existing sync script where
     practical.
   - Add export for reviewed active docs snapshots.

## Verification Plan

Minimum checks for implementation:

- API tests for Admin auth rejection and success paths.
- Repository tests for `priority ASC, id ASC` ordering and rule state filters.
- Publish/version tests proving reviewed rows are not mutated in place.
- Preview tests proving Admin preview uses the same prefix order as runtime.
- Frontend tests for table filters, editor validation, and reorder controls.
- Runtime smoke proving a newly published rule appears in the native Steel
  instruction prefix for both supported AI paths.
- `git diff --check`.

For design-only changes to this document, static review and `git diff --check`
are sufficient.

## Open Decisions

- Should publish require a second admin reviewer? Recommendation: not for MVP;
  record `reviewed_by` and leave two-person approval as a later enhancement.
- Should `docs/rules` remain canonical after UI lands? Recommendation: no.
  `steel.rules` should be canonical; docs exports are for audit/recovery.
- Should this become a generic LibreChat rules framework? Recommendation: no.
  Ship Steel-specific Admin UI first because the schema and runtime seams
  already exist.
- Should ordering be drag-and-drop in MVP? Recommendation: use move up/down and
  numeric priority first; add drag later if admins need faster bulk editing.

## Recommended Decision

Build a Steel-specific Admin Rules UI backed by `steel.rules`. Keep runtime
preload behavior DB-backed and globally active for Steel-native AI paths. Treat
`docs/rules` as bootstrap/export material, not as the operational editing
surface.
