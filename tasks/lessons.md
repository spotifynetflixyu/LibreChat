# Lessons

- Treat `npm run frontend:dev` startup separately from LibreChat app readiness. Vite can start on port 3090 while `/api/*` still fails if the backend is not running on port 3080.
- For LibreChat local dev, verify the backend path too: backend startup requires `client/dist/index.html`, so `npm run build:client` may be needed even when using the Vite dev frontend.
- When diagnosing Vite proxy errors, hit both `http://localhost:3080/api/config` and `http://localhost:3090/api/config` to distinguish backend startup failures from proxy configuration issues.
- When the user asks to write docs, create or update a real project docs file under `docs/` instead of only adding operational notes to agent-facing files.
- For the steel setup, do not assume Docker services are part of local development; the user uses cloud MongoDB and Supabase Postgres through `.env`.
- For Supabase pgvector, check the actual `pg_extension.extnamespace`; this project currently has `vector` installed in `public`, not `extensions`.
- Do not process or import files under `docs/reference/doc` until the user explicitly confirms the source data is correct.
- Do not hard-code default steel product choices as static DB fields such as `is_default`; admin-taught defaults should be modeled as flexible preference rules/memory and applied during disambiguation.
- When a customer asks price for an incomplete steel spec with multiple matches, show candidate prices while asking for the missing detail; only lead with a specific candidate when backed by a preference rule or deterministic ranking.
- For local `pg` connections to Supabase, prefer the Supavisor session pooler URL when the direct `db.<project>.supabase.co` host does not resolve or the environment lacks IPv6 support.
- Keep Steel changes isolated from upstream LibreChat hot files where possible; avoid premature root exports or core entrypoint edits until a route actually needs them.
- Every wrap-up response should include explicit next tasks so the user knows what to do next.
- With the current Node `pg` stack, `sslmode=require` alone may behave like `verify-full`; use `uselibpqcompat=true&sslmode=require` for libpq-compatible dev behavior, and plan CA-backed `verify-full` for production.
