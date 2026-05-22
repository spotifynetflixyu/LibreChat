# Frontend Dev Build Check

- [x] Review project workflow docs and root npm scripts.
- [x] Trace `frontend:dev` dependencies through workspace package manifests.
- [x] Identify the minimal required build command sequence.
- [x] Run the selected build commands.
- [x] Smoke-test `npm run frontend:dev` startup and document results.

# `/api/config` Proxy Check

- [x] Reproduce the `/api/config` proxy failure.
- [x] Check whether backend is listening on port 3080.
- [x] Build missing `client/dist` required by backend startup.
- [x] Start or repair the backend dev server.
- [x] Verify `/api/config` through the frontend proxy.
- [x] Document the final run commands.

# Local Dev Docs Update

- [x] Create `docs/local-dev.md` for the verified local frontend/backend dev command sequence.
- [x] Replace the detailed `CLAUDE.md` sequence with a pointer to `docs/local-dev.md`.
- [x] Verify the docs mention the `client/dist/index.html` backend startup requirement.
- [x] Record the docs update result.

# LibreChat Config Startup Fix

- [x] Confirm `librechat.yaml` is required at the repo root unless `CONFIG_PATH` is set.
- [x] Create a minimal `librechat.yaml`.
- [x] Verify backend startup passes the missing YAML error.
- [x] Note the separate MeiliSearch warning cause.

# Disable Local MeiliSearch

- [x] Confirm which env vars control MeiliSearch plugin and index sync.
- [x] Disable local MeiliSearch in `.env`.
- [x] Verify backend starts without Meili fetch errors.
- [x] Update `docs/local-dev.md` with the precise disable settings.

## Review

- `.env` contains `MONGO_URI` and `STEEL_POSTGRES_URL` keys; values were not printed.
- Minimal build path for `npm run frontend:dev`: `npm run build:data-provider && npm run build:client-package`.
- `npm run build:data-provider` completed successfully.
- `npm run build:client-package` completed successfully and recreated `packages/client/dist`.
- `npm run frontend:dev` started Vite successfully on `http://localhost:3090/`; a direct HTTP probe returned `200 OK`.
- The final npm lifecycle error came from intentionally stopping the smoke-test process after startup verification.
- Later `/api/config` proxy error root cause: backend was not listening on port 3080.
- Direct backend startup showed MongoDB connected, then backend exited because `/Users/neven/Documents/projects/LibreChat/client/dist/index.html` was missing.
- `npm run build:client` completed successfully and created `client/dist/index.html`.
- After `npm run backend:dev`, `http://localhost:3080/health`, `http://localhost:3080/readyz`, and `http://localhost:3080/api/config` returned `200`.
- With `npm run frontend:dev` running too, `http://localhost:3090/api/config` returned `200` through the Vite proxy.
- Smoke-test backend/frontend processes launched by Codex were stopped after verification.
- Added `docs/local-dev.md` with the verified command sequence and `/api/config` proxy troubleshooting note.
- Updated `CLAUDE.md` to point to `docs/local-dev.md`.
- Created a minimal root `librechat.yaml` with `version: 1.3.11`.
- Verified `npm run backend:dev` starts after adding `librechat.yaml`; `http://localhost:3080/health` and `http://localhost:3080/api/config` returned `200`.
- Documented local `librechat.yaml` and MeiliSearch log handling in `docs/local-dev.md`.
- Disabled local MeiliSearch by setting `SEARCH=false`, clearing `MEILI_HOST` and `MEILI_MASTER_KEY`, and setting `MEILI_NO_SYNC=true` in `.env`.
- Verified backend startup after disabling MeiliSearch: `http://localhost:3080/api/config` returned `200`, and captured startup logs had no `mongoMeili`, `indexSync`, or `fetch failed` lines.
