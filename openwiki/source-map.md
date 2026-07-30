---
type: Source Map
title: LibreChat source map
description: Practical map of LibreChat workspace directories and high-value source entrypoints for implementation and review.
tags: [navigation, source-map, repository]
---
# Source map

Use this map to locate implementation ownership after reading [architecture](architecture/overview.md). The root workspace declares `api`, `client`, and `packages/*`; root scripts provide the canonical build/test entrypoints (`package.json`).

## High-value areas

| Area | Responsibility | Start with |
|---|---|---|
| `api/server/` | Express startup, middleware, route mounting, controllers, services | `api/server/index.js` |
| `api/server/routes/` | Domain router assembly and endpoint-level middleware | `api/server/routes/index.js`; relevant domain router |
| `api/server/controllers/agents/` | Agent request lifecycle and persistence orchestration | `api/server/controllers/agents/request.js` |
| `api/db/`, `api/models/`, `api/app/`, `api/strategies/` | Server data integration, application utilities, authentication strategies | trace imports from the entrypoint/route |
| `client/src/` | React application, routes, features, components, hooks, stores, data provider | `client/src/routes/index.tsx` |
| `client/src/hooks/Chat/`, `client/src/hooks/SSE/` | Browser chat submission and resumable stream handling | `useChatFunctions.ts`; `useResumableSSE.ts` |
| `packages/data-provider/` | Shared data-provider types/endpoints/services used by workspace consumers | package source and build script |
| `packages/data-schemas/` | Shared Mongoose model factories and schemas | `src/models/index.ts` and individual model files |
| `packages/api/` | Built API package consumed by the legacy server/runtime image | package source and build output |
| `packages/client/` | Client workspace package built before the browser app | package source and build output |
| `e2e/` | Playwright configurations, fixtures, specs, setup, recordings | `e2e/README.md`, config matching target environment |
| `config/` | Root maintenance/user/balance/migration scripts | matching root npm script |
| `deploy/`, Compose files, `Dockerfile.multi` | Host startup, reverse proxy definitions, image assembly | [operations](operations/configuration-and-deployment.md) |
| `skill/` | Deployment/runtime skill content copied into the production image | `Dockerfile.multi` |

## Request and UI navigation

`api/server/index.js` is the authoritative mount table for top-level routes. For example it mounts messages, conversations, projects, prompts, skills, endpoints, models, config, files, sharing, roles, agents, memories, tags, and MCP. The route registry exports modules but does not itself implement their behavior. For browser navigation, `client/src/routes/index.tsx` maps the authenticated root to chat, search, prompts, skills, projects, and the agent marketplace.

For agent chat specifically, trace this sequence:

1. `client/src/routes/index.tsx` → `ChatRoute` for `/c/:conversationId?`.
2. Client chat/submission and SSE hooks.
3. `api/server/index.js` → `/api/agents`.
4. `api/server/routes/agents/index.js` stream/chat endpoints.
5. `api/server/controllers/agents/request.js` job/persistence orchestration.

That path implements the workflow documented in [chat and agent execution](workflows/chat-and-agent-execution.md), which in turn creates the domain state summarized in [product and data](domain/product-and-data.md).

## Build and test navigation

`package.json` is the command map. `turbo.json` defines build dependencies and output conventions. CI workflows under `.github/workflows/` express the enforced variants: frontend review, mock Playwright, and Docker smoke are documented in [verification](testing/verification.md). When a change crosses package boundaries, inspect the package’s own `package.json` alongside the root script before assuming a standalone build works.

## Operational navigation

- `docs/local-dev.md` is the current local frontend/server startup reference.
- `librechat.example.yaml` is the non-secret feature/configuration reference; do not read local `.env` files for documentation.
- `docker-compose.yml` is the base local Compose topology and explicitly directs local overrides elsewhere.
- `deploy-compose.prod.yml` contains the inspected API+Caddy production Compose arrangement.
- `Dockerfile.multi` builds shared packages, browser distribution, then a pruned production API image.

These files configure the runtime boundaries described in [architecture](architecture/overview.md) and should be changed with the deployment/test caution in [operations](operations/configuration-and-deployment.md).

## Review heuristics

- **New endpoint:** add/inspect the domain router, entrypoint mount, auth/capability/tenant middleware, data model, and client consumer where applicable.
- **New persisted concept:** inspect an individual data-schema model, its consumers, route exposure, authorization, and migration/index implications; the registry alone is insufficient.
- **Chat/agent change:** review POST start, SSE subscribe/reconnect, ownership checks, and final persistence together.
- **Configuration change:** trace example YAML/expected environment variables, local Compose, production image, reverse proxy, and readiness impact together.
