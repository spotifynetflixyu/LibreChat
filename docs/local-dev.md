# Local Frontend Development

## Required Local Files

Create a root `librechat.yaml` before starting the backend. For local development, the minimal valid file is:

```yaml
version: 1.3.11
```

Use `librechat.example.yaml` as the reference when you need to enable optional features such as custom endpoints, MCP servers, file storage, registration settings, or interface overrides.

The backend also expects `.env` to include the database URLs required by your local setup, including `MONGO_URI` and any project-specific Postgres URL such as `STEEL_POSTGRES_URL`.

For Steel development, use the Supabase Session pooler URL for `STEEL_POSTGRES_URL`
instead of the direct `db.<project-ref>.supabase.co` URL. The direct URL may
require IPv6 and fail to resolve on local networks. The local development URL
shape is:

```env
STEEL_POSTGRES_URL=postgresql://postgres.<project-ref>:<password>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

This keeps local `pg` behavior compatible with libpq `sslmode=require`.
Production should use CA-backed `verify-full` once the Supabase root
certificate is configured.

Use this sequence when starting the Vite frontend against the local backend:

```bash
npm run build:data-provider
npm run build:data-schemas
npm run build:api
npm run build:client-package
npm run build:client
npm run backend:dev
npm run frontend:dev
```

## Why This Order Matters

- `npm run build:data-provider` builds the shared API types, endpoints, and data service used by both frontend and backend packages.
- `npm run build:data-schemas` builds the shared database models and schemas consumed by the backend.
- `npm run build:api` builds `@librechat/api`, which the legacy `api/` server imports at runtime.
- `npm run build:client-package` builds `@librechat/client`, which the Vite frontend imports through the workspace package export.
- `npm run build:client` creates `client/dist/index.html`.
- `npm run backend:dev` starts the backend on `http://localhost:3080`.
- `npm run frontend:dev` starts the Vite frontend on `http://localhost:3090`.

`npm run build:client` is required before `npm run backend:dev` when `client/dist/index.html` is missing. The backend reads that file during startup even when the browser is served by `npm run frontend:dev` on port 3090.

## Troubleshooting `/api/config`

If `npm run frontend:dev` reports a Vite proxy error for `/api/config`, verify the backend first:

```bash
curl -i http://localhost:3080/api/config
```

If port 3080 is not listening, run:

```bash
npm run backend:dev
```

After the backend is healthy, verify the frontend proxy:

```bash
curl -i http://localhost:3090/api/config
curl -i http://localhost:3090/health
curl -i http://localhost:3090/readyz
```

`/health` and `/readyz` are backend health endpoints proxied by the Vite dev server. They are not standalone React routes.

## MeiliSearch Logs

Logs like these mean Meilisearch is configured but not reachable:

```text
[mongoMeili] Error checking index convos: fetch failed
[indexSync] error fetch failed
```

They are separate from `librechat.yaml` loading. If local search is not needed, disable Meilisearch in `.env`:

```env
SEARCH=false
MEILI_HOST=
MEILI_MASTER_KEY=
MEILI_NO_SYNC=true
```

`MEILI_NO_SYNC=true` only disables index synchronization. Clear `MEILI_HOST` and `MEILI_MASTER_KEY` too; otherwise the Mongo/Meili model plugin can still initialize and try to contact Meilisearch during startup.

If local search is needed, start Meilisearch with the configured `MEILI_HOST` and `MEILI_MASTER_KEY` instead.
