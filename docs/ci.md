# Web CI

CI follows normal browser operations and the builds they need. One worker uses
real Express and a disposable Mongo replica set; external model/catalog services
use deterministic fixtures. It never connects to production databases or paid models.

| Workflow | Retained checks |
| --- | --- |
| `backend-review.yml` | Package builds; provider, schemas and API type checks |
| `frontend-review.yml` | Shared package builds; shared/client type checks; Vite build |
| `playwright-mock.yml` | Explicit normal browser flows: session, chat, upload, sidebar, Steel review and Save/reload |
| `lighthouse.yml` | Conversation loading budgets with simulated database latency |

Run `npm run e2e:mock:ci` to build and run the browser suite. Its tracked selection
is in `e2e/setup/flows.cjs`; the runner validates the exact selected test list before
execution. Missing or duplicate cases fail instead of silently shrinking coverage.
`node e2e/setup/web.cjs --list` verifies the selection without starting Mongo.

Broad Jest, Codegraph, Redis/MCP matrices, corruption/property exploration,
Docker/tool-environment smoke, static formatting and unused-code CI are retired.
Optional local unit tests and static-check commands remain available.

Deployment, publication, maintenance and translation automations retain their
existing triggers. The promotion gate requires the retained build/type-check jobs
at its exact commit; authorization, approval and fast-forward checks still apply.
These CI changes do not deploy or merge the current PR.
