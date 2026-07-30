---
type: Repository Guide
title: LibreChat code wiki quickstart
description: Entry point for the LibreChat workspace, its main runtime, engineering starting points, and evidence-grounded documentation.
tags: [librechat, onboarding, repository]
---
# LibreChat code wiki

LibreChat is a self-hosted AI chat platform. The product README describes provider selection, custom endpoints, agents, MCP tools, skills, files, search, authentication, and administration; this repository implements the web client, Express server, shared packages, and deployment assets. The root workspace is version `v0.8.7` and uses npm workspaces for `api`, `client`, and `packages/*` (`README.md`, `package.json`).

## Read this first

- [Architecture overview](architecture/overview.md) explains how the React app, Express server, shared packages, MongoDB, and server readiness fit together.
- [Chat and agent execution](workflows/chat-and-agent-execution.md) follows the resumable agent-generation path from submission to SSE completion, abort, and recovery.
- [Product and data](domain/product-and-data.md) defines the durable concepts—users, conversations, messages, agents, files, permissions, and configuration.
- [Configuration and deployment](operations/configuration-and-deployment.md) covers local prerequisites, Compose services, container build stages, probes, and configuration boundaries.
- [Verification](testing/verification.md) selects the appropriate build, unit, E2E, and production-image checks.
- [Source map](source-map.md) is the practical map from a change request to likely source areas.

## Fast orientation

| If you need to… | Start here | Then inspect |
|---|---|---|
| Change the browser UI or route behavior | `client/src/` | `client/src/routes/index.tsx`, then the relevant feature/component |
| Add or alter HTTP behavior | `api/server/` | `api/server/index.js` and its route registry |
| Change chat/agent generation semantics | agent routes and controller | [Chat and agent execution](workflows/chat-and-agent-execution.md) |
| Change shared types, schemas, or services | `packages/` | `packages/data-provider`, `packages/data-schemas`, `packages/api`, or `packages/client` |
| Change runtime configuration or hosting | root config/deployment files | [Configuration and deployment](operations/configuration-and-deployment.md) |
| Choose a test | root scripts and CI workflows | [Verification](testing/verification.md) |

## Local development path

The repository’s local-development guide requires a root `librechat.yaml` and database configuration in a local `.env`; do not copy credentials into documentation or commits. It prescribes building shared dependencies before the frontend/server: data provider, data schemas, API package, client package, then `client/dist`, followed by `backend:dev` and `frontend:dev` (`docs/local-dev.md`). The backend defaults to `localhost:3080`; the Vite client defaults to `3090` according to that guide.

```bash
npm run build:data-provider
npm run build:data-schemas
npm run build:api
npm run build:client-package
npm run build:client
npm run backend:dev
npm run frontend:dev
```

The build order matters because the legacy server imports built shared packages and it reads `client/dist/index.html` during startup, even when Vite serves the browser during development (`docs/local-dev.md`, `api/server/index.js`). See [architecture](architecture/overview.md) for the runtime boundary and [operations](operations/configuration-and-deployment.md) for configuration cautions.

## Change discipline

1. Identify the owning area in the [source map](source-map.md), then trace its runtime relationship in [architecture](architecture/overview.md).
2. Preserve the chat controller’s start-then-subscribe model and its idempotency/tenant checks when altering agent behavior; the detailed contract is in [the chat workflow](workflows/chat-and-agent-execution.md).
3. Select focused checks first, then broaden them based on changed workspace boundaries using [verification guidance](testing/verification.md).
4. Treat `librechat.example.yaml`, Compose files, and deployment files as configuration/deployment evidence. Do not document or expose local `.env` values.

## Scope and evidence limits

This wiki documents the inspected repository state. The production Compose file supplies only the API and Caddy; it does not establish who operates MongoDB, search, vector, or other external dependencies in production. Strict tenant isolation also relies on a trusted proxy or gateway to control `X-Tenant-Id` (`api/server/index.js`, `deploy-compose.prod.yml`).

## Backlog

- **External production services** — `deploy-compose.prod.yml` — external persistence/search/agent-service ownership is not established by the inspected deployment definition.
- **Edge tenant policy** — `api/server/index.js` — strict tenant isolation warns that the upstream proxy must strip or set `X-Tenant-Id`; the proxy policy itself was not inspected.
