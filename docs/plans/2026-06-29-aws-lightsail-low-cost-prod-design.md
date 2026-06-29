# AWS Lightsail Low-Cost Production Deployment Design

## Goal

Deploy the customized LibreChat/Steel build to a low-cost AWS Lightsail host for
internal use by about 10 accounts, while keeping upstream LibreChat updates
separate from production customizations.

## Deployment Decision

Use AWS Lightsail Small as the first production host:

- Instance: Linux, 2 vCPU, 2 GB RAM, 60 GB SSD, public IPv4.
- Expected cost: about USD 12/month before snapshots or extra storage.
- Add 2-4 GB swap on the host to reduce out-of-memory risk during short spikes.
- Treat 2 GB RAM as an observation starting point, not a high-concurrency
  guarantee.

Upgrade to a 4 GB Lightsail bundle if any of these are true:

- More than 3 users commonly stream responses at the same time.
- PDF/OCR workloads become frequent.
- The host shows repeated OOM kills, sustained swap pressure, or high CPU load.
- MeiliSearch, RAG, vector DB, or local MongoDB need to run on the same host.

## Branch Model

- `main` tracks upstream LibreChat only.
- `master` is the production branch for this customized deployment.
- Feature branches merge into `master` after review and verification.
- Upstream updates should flow from upstream `main` into an integration branch,
  then into `master` after conflict resolution and testing.

Do not merge Steel/custom production modules back into `main`.

## Runtime Shape

The Lightsail host should run only the production app surface:

- Custom LibreChat API image built from this repo.
- Built frontend served by the backend image or reverse proxy.
- Reverse proxy for `80`/`443`.
- Persistent host directories for uploads, logs, image assets, skills, and
  secrets.

The host should not run these services in the low-cost starting shape:

- Local MongoDB.
- Local Steel Postgres.
- MeiliSearch.
- RAG API.
- Vector DB.

Those services can be added later only if the host is resized or the runtime is
split across services.

## Data Services

Use managed/free-tier external databases first:

- LibreChat and Steel application state: cloud MongoDB through `MONGO_URI`.
- Steel PostgreSQL: Supabase cloud Postgres through `STEEL_POSTGRES_URL`.

Production must use production database URLs. Development database URLs must not
be copied into the production host or GitHub Actions secrets.

Recommended environment boundary:

```env
MONGO_URI=mongodb+srv://<prod-user>:<prod-password>@<prod-cluster>/<prod-db>
STEEL_POSTGRES_URL=postgresql://<prod-user>:<prod-password>@<prod-supabase-host>:5432/postgres
```

Use the Supabase direct connection when the Lightsail network supports it. Use
the Supabase pooler URL if direct connection or IPv4 behavior requires it.

## Uploads And Persistent Files

Uploads must not be stored in the Docker image or container writable layer.

Use host bind mounts:

```yaml
volumes:
  - /srv/librechat/uploads:/app/uploads
  - /srv/librechat/images:/app/client/public/images
  - /srv/librechat/logs:/app/api/logs
  - /srv/librechat/skill:/app/skill
  - /var/secrets/openai-oauth:/var/secrets/openai-oauth
```

Deployment scripts may replace containers and pull new images, but they must not
delete `/srv/librechat` or `/var/secrets/openai-oauth`.

Future object-storage migration options:

- AWS S3 if staying in AWS.
- Cloudflare R2 for low-cost object storage.
- DigitalOcean Spaces only if moving the app to DigitalOcean.

## OpenAI OAuth

Production uses the native LibreChat `openai_oauth_responses` path, not the
development `/steel/oauth-chat` page.

Store the OAuth auth material on the host:

```text
/var/secrets/openai-oauth/auth.json
```

Set production env:

```env
OPENAI_DEFAULT_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=medium
OPENAI_OAUTH_AUTH_FILE=/var/secrets/openai-oauth/auth.json
```

The OAuth file must not be committed, baked into the image, or printed in logs.

The OAuth access token inside `auth.json` expires. The current
`openai-oauth-provider` default is `ensureFresh=true`, so it uses the refresh
token in `auth.json` to obtain a fresh access token and writes the updated token
data and `last_refresh` back to `auth.json`. The production mount therefore must
allow the app container to write this file; do not mount it read-only unless a
separate token-refresh process owns the write path.

The refresh token should be treated as password-equivalent and not assumed to be
permanent. It can become unusable if the OpenAI/Codex login is revoked, the
account security state changes, the refresh token expires, or OpenAI changes the
OAuth behavior. If provider auth starts failing with an auth-category error, run
the login flow again on a trusted machine, replace
`/var/secrets/openai-oauth/auth.json`, and restart the app container.

## `/steel/oauth-chat` Production Boundary

`/steel/oauth-chat` is development-only. Production users should use normal
LibreChat chat routes such as `/c/new` with the native OpenAI OAuth provider.

Production should block or hide `/steel/oauth-chat`:

- Remove the client route from production builds, or guard it behind an explicit
  dev-only flag.
- Reject direct backend calls to the development chat endpoints unless a
  development flag is enabled.
- Keep `/api/steel/ai/oauth-usage` if it remains part of the normal authenticated
  production UI.

## Deployment Pipeline

Recommended production pipeline:

1. Push to `origin/master`.
2. GitHub Actions builds the custom Docker image from `Dockerfile.multi`.
3. GitHub Actions pushes the image to GitHub Container Registry.
4. GitHub Actions SSHes into Lightsail.
5. Lightsail pulls the new image and runs `docker compose up -d`.
6. The pipeline verifies the health endpoint after restart.

The Lightsail host should not run `npm install`, `npm run frontend`, or other
full builds during deployment.

## Production Compose Direction

Create a dedicated production compose file instead of reusing the current
development compose shape:

- Use the custom GHCR production image.
- Remove local `mongodb`, `meilisearch`, `vectordb`, and `rag_api` services.
- Read production env from a host file or Docker env file that is not committed.
- Bind persistent host directories.
- Expose only the reverse proxy on `80`/`443`; do not expose API port `3080`
  publicly.

## AWS Host Setup

Minimum host setup:

- Ubuntu LTS or Amazon Linux Lightsail instance.
- Docker Engine and Docker Compose plugin.
- Firewall open only for SSH, HTTP, and HTTPS.
- Non-root deploy user with permission to run Docker deployment commands.
- `/srv/librechat` owned by the runtime user.
- `/var/secrets/openai-oauth/auth.json` readable by the app container only.
- Swap enabled before the first production run.

## Backup Plan

Low-cost starting backup plan:

- Daily archive or sync of `/srv/librechat/uploads`.
- Periodic backup of `/srv/librechat/images`, `/srv/librechat/skill`, and
  production env files.
- Lightsail snapshots for instance recovery.
- Managed DB backup features for MongoDB Atlas and Supabase as the data grows.

Backups must be tested by restoring at least one uploaded file and checking that
the app can still read it.

## Verification Gates

Before calling production deployment complete:

- GitHub Actions successfully builds and pushes the production image.
- Lightsail pulls and starts the new image.
- `/api/config` returns a valid response through HTTPS.
- Login works for an internal account.
- Normal LibreChat chat works through `openai_oauth_responses`.
- OpenAI OAuth usage endpoint works without leaking token/account data.
- File upload writes to `/srv/librechat/uploads`.
- A redeploy preserves uploaded files.
- `/steel/oauth-chat` is not available as a production user workflow.
- `MONGO_URI` points to prod MongoDB.
- `STEEL_POSTGRES_URL` points to prod Supabase.

## Initial Cost Target

Starting monthly target:

- Lightsail Small: about USD 12/month.
- MongoDB Atlas M0: USD 0/month while within free limits.
- Supabase Free: USD 0/month while within free limits.
- Host uploads: included in the Lightsail 60 GB disk.
- Snapshots/backups: additional storage cost.

The expected starting cost is about USD 12/month plus backup storage, assuming
managed database free tiers remain sufficient.

## Open Risks

- 2 GB RAM may be tight during simultaneous streams or large file workflows.
- Host-disk uploads depend on instance backup discipline until object storage is
  introduced.
- OAuth auth material needs an operational refresh/replacement procedure.
- Free-tier MongoDB and Supabase limits may be reached faster than expected if
  chat history, files, or Steel records grow.
- If Meili/RAG/vector search is required in production, the host should be
  resized or those services should be externalized.

## Next Implementation Tasks

1. Create `master` from the current production-ready Steel branch.
2. Create a production compose file for the minimal Lightsail runtime.
3. Create a GitHub Actions workflow for `master` image build and SSH redeploy.
4. Add a host setup runbook for Docker, directories, secrets, swap, and firewall.
5. Add production environment documentation with placeholder values only.
6. Add `/steel/oauth-chat` production gating or removal.
7. Verify redeploy preserves uploads.
