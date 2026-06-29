# Render Production Runbook

This runbook deploys the customized LibreChat/Steel production app on Render.
Render replaces the earlier Lightsail host automation: Render watches the
GitHub `master` branch, builds `Dockerfile.multi`, and redeploys automatically
when `master` is pushed.

References:

- [Render Web Services](https://render.com/docs/web-services)
- [Render Docker](https://render.com/docs/docker)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Environment Variables and Secret Files](https://render.com/docs/configure-environment-variables)
- [Render Shell Access](https://render.com/docs/ssh)

## Production Shape

- Render service type: Web Service.
- Runtime: Docker.
- Branch: `master`.
- Dockerfile path: `Dockerfile.multi`.
- Docker context directory: repository root.
- Docker Command: `sh /app/deploy/render/start.sh`.
- Public domain: Render's generated `https://<service>.onrender.com` URL.
- Persistent disk: mount at `/data`.
- Databases: external production MongoDB Atlas and production Supabase
  Postgres. Do not use Render local databases for Steel data.

Render gives every Web Service an `onrender.com` subdomain. A custom domain can
be added later, but it is not required for the first production launch.

## Persistent Data Boundary

Render's normal service filesystem is ephemeral. Attach a Persistent Disk or
uploads and OAuth refresh writes will be lost on redeploy/restart.

Use one Render disk mounted at:

```text
/data
```

The startup script maps these app paths to the disk:

| App path | Render disk path | Purpose |
|---|---|---|
| `/app/uploads` | `/data/uploads` | User uploads |
| `/app/client/public/images` | `/data/images` | Generated/public images |
| `/app/api/logs` | `/data/logs` | App logs |
| `/app/skill` | `/data/skill` | Shared deployment skills |
| `/data/librechat.yaml` | `/data/librechat.yaml` | LibreChat config via `CONFIG_PATH` |
| `/data/openai-oauth/auth.json` | `/data/openai-oauth/auth.json` | Writable OpenAI OAuth auth file |

Start with the smallest disk size that comfortably covers uploads. For an
internal 10-account deployment, 10 GB is a reasonable starting point; increase
later if uploads grow. Render disks can grow but not shrink.

## Create The Render Service

1. Push the production branch to GitHub after local verification:

   ```bash
   git push origin master
   ```

2. In Render, create a new Web Service from the GitHub repository.
3. Use these settings:

   ```text
   Name: librechat-prod
   Branch: master
   Runtime / Language: Docker
   Dockerfile Path: Dockerfile.multi
   Docker Context Directory: .
   Docker Command: sh /app/deploy/render/start.sh
   Auto-Deploy: Yes
   ```

4. Pick the lowest paid instance that supports your workload. Persistent Disks
   require a paid service, so do not use a free instance for production uploads
   or OpenAI OAuth.
5. Under advanced disk settings, add a Persistent Disk:

   ```text
   Mount Path: /data
   Size: 10 GB
   ```

6. Create the service. The first deploy can use placeholder domain values; once
   Render shows the actual URL, update the domain env values and redeploy.

## Environment Variables

Use `.env.prod` locally as your private source of truth, then paste values into
Render Dashboard > Environment. Do not commit `.env.prod`.

Required production values:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
CONFIG_PATH=/data/librechat.yaml
RENDER_DATA_DIR=/data

LIBRECHAT_DOMAIN=<service>.onrender.com
DOMAIN_CLIENT=https://<service>.onrender.com
DOMAIN_SERVER=https://<service>.onrender.com

MONGO_URI=mongodb+srv://prod_app:<password>@<prod-cluster>/prod?retryWrites=true&w=majority&appName=<app-name>
STEEL_POSTGRES_URL=postgresql://prod_app.<project-ref>:<password>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true

OPENAI_DEFAULT_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=medium
OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json

SEARCH=false
MEILI_HOST=
MEILI_MASTER_KEY=
MEILI_NO_SYNC=true

ALLOW_REGISTRATION=false
ALLOW_SOCIAL_LOGIN=false

JWT_SECRET=<generate-strong-secret>
JWT_REFRESH_SECRET=<generate-strong-secret>
CREDS_KEY=<generate-32-byte-base64>
CREDS_IV=<generate-16-byte-base64>
```

Optional production OCR value:

```bash
PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN=<optional-token>
```

Do not add `OPENAI_PROVIDER`. The frontend/provider selection distinguishes
OpenAI OAuth from the normal OpenAI API-key flow.

## Install OpenAI OAuth Auth File

`OPENAI_OAUTH_AUTH_FILE` must point to a writable file. Do not rely on a
read-only secret file as the final auth path, because `openai-oauth-provider`
refreshes access tokens and writes updated token data back to `auth.json`.

After the service is deployed and the `/data` disk exists, open Render Shell for
the service and run:

```bash
mkdir -p /data/openai-oauth
cat > /data/openai-oauth/auth.json <<'JSON'
<paste auth.json contents from the trusted machine>
JSON
chmod 600 /data/openai-oauth/auth.json
```

Then redeploy or restart the service from Render.

If OAuth calls later fail with an auth/refresh error, re-run the trusted
OpenAI/Codex login flow, replace `/data/openai-oauth/auth.json`, and restart
the service.

## Admin And Internal Users

`ALLOW_REGISTRATION=false` keeps public registration closed. It does not block
LibreChat's trusted server-side user script.

For a clean production MongoDB, create the first admin from Render Shell:

```bash
cd /app/api
npm run create-user -- admin@example.com "Admin" admin
```

Let the script prompt for the password. The first user in a clean MongoDB
becomes `ADMIN`.

Create the remaining internal users the same way:

```bash
cd /app/api
npm run create-user -- user01@example.com "User 01" user01
```

If production MongoDB already contains users and none of them is admin, promote
one trusted user to `ADMIN` with a controlled MongoDB Atlas edit before relying
on the admin UI for later user management.

## Verify Production

From the development machine:

```bash
scripts/prod-smoke.sh https://<service>.onrender.com
```

Expected:

- `/api/config` returns success.
- `/steel/oauth-chat` returns `404` in production.
- Unauthenticated `/api/steel/ai/chat` does not expose the dev-only chat route.

Also verify manually:

1. Open `https://<service>.onrender.com`.
2. Sign in with the admin account.
3. Confirm normal LibreChat chat loads.
4. Confirm the `OpenAI (OAuth)` provider/model is available.
5. Upload a small file, redeploy, then verify the upload still exists.

## Automatic Redeploy

Render handles production redeploys directly:

```bash
git push origin master
```

No production GitHub Actions SSH workflow is required. If Render auto deploy is
enabled, each push to `master` triggers a new Docker build and deploy.

Keep `main` reserved for upstream LibreChat updates. Do not merge the
customized Steel production branch into `main` unless intentionally doing
upstream reconciliation work.

## Troubleshooting

Port bind failure:

- Confirm `HOST=0.0.0.0`.
- Use Render's default `PORT=10000`, or let Render inject `PORT`.
- The app must listen on `process.env.PORT`.

Lost uploads or missing OAuth auth file after redeploy:

- Confirm a Persistent Disk is attached.
- Confirm its mount path is exactly `/data`.
- Confirm `OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json`.

Supabase connection failure:

- Use the Supabase pooler URL if the direct `db.<project-ref>.supabase.co`
  host is not reachable from the runtime.
- Keep `sslmode=require&uselibpqcompat=true` in the URL.

Out-of-memory restarts:

- Upgrade the Render instance size before changing app behavior.
- Keep Meili/search disabled in the low-cost production shape unless search is
  explicitly required.

## Backup

At minimum, back up:

- MongoDB Atlas production database.
- Supabase production project.
- Render disk paths under `/data/uploads`, `/data/images`, `/data/skill`,
  `/data/librechat.yaml`, and `/data/openai-oauth/auth.json`.

Do not store production backups or `auth.json` in git.
