# Project Agent Instructions

Read `CLAUDE.md` before making project changes. It is the canonical project
agent document for this repository.

## Conversation Wrap-Up

Every final or wrap-up response must include a `Next Tasks` section with
concrete options for the user to choose from. Keep the options short,
actionable, and specific to the current work.

## Text-Only Changes

Do not create or modify tests for prose-only changes to documentation, prompts,
or rule text. Verify these changes with the relevant parser or dry run, sync
readback when applicable, and `git diff --check`. Add tests only when executable
behavior changes or the user explicitly requests tests.

## Rule Synchronization

Use the repository's existing synchronization scripts for runtime rule updates;
do not create ad hoc or temporary update scripts when an existing project script
covers the workflow. For unified Steel rules under `docs/rules`, use
`packages/api/scripts/sync-steel-rules.cjs` for dry-run, apply, and database
readback, with the repository rule files remaining the source of truth.
Always pass the intended target explicitly: `--target dev` loads `.env`, while
`--target prod` loads `.env.prod`. Run `--dry-run` against the same target before
`--apply`; do not infer the destination database from an ambient
`STEEL_POSTGRES_URL`.

## Supabase Schema Rule

Steel PostgreSQL schema changes must always update both files:

- `supabase/schema.sql` is the complete current Steel Supabase schema snapshot.
- `supabase/migration/*.sql` files are one-change migration records.

Do not update one without the other. Create new migration files automatically
with `npx supabase migration new <change_name>` instead of asking the user to
create them manually. Keep Steel database setup on Supabase cloud Postgres
through `.env` `STEEL_POSTGRES_URL` and cloud MongoDB through `MONGO_URI`; do
not introduce Docker-dependent setup for Steel database work.

## Frontend theming and styling

For frontend work, compose existing `@librechat/client` primitives and variants before adding
feature-local styles. Use semantic theme/Tailwind roles for color and shared appearance; do not
introduce raw palette utilities, hard-coded colors, or arbitrary theme CSS. If the system cannot
express a reusable design need, deepen the shared primitive or versioned theme-token registry
instead of copying classes into a feature. Keep genuine layout and behavior local, and document
why any new custom CSS cannot be expressed by the shared system. See the detailed policy in
`CLAUDE.md` under “Theming and styling.”

When adding or changing code that mutates user documents, invalidate the auth user document cache for affected users. This includes single-user updates and bulk role/user mutations; otherwise OpenID JWT request burst caching can serve a stale `req.user` until its TTL expires.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
