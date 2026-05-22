# Lessons

- Treat `npm run frontend:dev` startup separately from LibreChat app readiness. Vite can start on port 3090 while `/api/*` still fails if the backend is not running on port 3080.
- For LibreChat local dev, verify the backend path too: backend startup requires `client/dist/index.html`, so `npm run build:client` may be needed even when using the Vite dev frontend.
- When diagnosing Vite proxy errors, hit both `http://localhost:3080/api/config` and `http://localhost:3090/api/config` to distinguish backend startup failures from proxy configuration issues.
- When the user asks to write docs, create or update a real project docs file under `docs/` instead of only adding operational notes to agent-facing files.
