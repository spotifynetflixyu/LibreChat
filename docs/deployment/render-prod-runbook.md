# Render Production Runbook

Status: retained as rollback and historical setup documentation. The current
selected production target is DigitalOcean Droplet with a user-owned domain;
see `docs/deployment/digitalocean-droplet-prod-runbook.md`.

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
- Root Directory: blank.
- Health Check Path: `/health`.
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

Start with the smallest disk size that comfortably covers uploads. For a
budget-first smoke deployment, 1 GB is acceptable because `auth.json` is tiny
and only uploads/images/logs consume meaningful disk space. For sustained
internal production use, 10 GB is a safer starting point. Render disks can grow
but not shrink.

## Create The Render Service

1. Push the production branch to GitHub after local verification:

   ```bash
   git push origin master
   ```

2. In Render, create a new Web Service from the GitHub repository.
3. Use these top-level settings:

   ```text
   Name: librechat-prod
   Language / Runtime: Docker
   Branch: master
   Region: US East if available; Oregon is acceptable if that is the available option
   Root Directory: leave blank
   ```

4. Choose the instance type:

   ```text
   Starter: lowest-cost paid option for initial production smoke
   Standard: upgrade target if builds or runtime are killed for memory
   Free: do not use for production, because it does not support the required disk
   ```

5. Under Environment Variables, use **Add from .env** and paste the production
   values from local `.env.prod`. Do not paste `auth.json` into environment
   variables.

6. Under Advanced > Disk, add a Persistent Disk:

   ```text
   Mount Path: /data
   Size: 1 GB for the lowest-cost smoke deployment, or 10 GB for safer production headroom
   ```

   The mount path must be exactly `/data`. Do not keep Render's default
   `/var/data`, because the app env and startup script expect `/data`.

7. Under Advanced, set:

   ```text
   Health Check Path: /health
   Registry Credential: No credential
   Docker Build Context Directory: .
   Dockerfile Path: Dockerfile.multi
   Docker Command: sh /app/deploy/render/start.sh
   Pre-Deploy Command: leave blank
   Auto-Deploy: On Commit
   Build Filters: leave blank
   ```

8. Create the service. The first deploy can use placeholder domain values; once
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

## Manual Render Sync Checklist

Render auto-deploys code from `master`, but it does not automatically receive
ignored local files or external-service allowlist changes. Keep this checklist
current whenever production settings change.

| Item | Where it lives | How to update | Restart needed |
|---|---|---|---|
| Production env vars | Render Dashboard > Environment | Paste values from local `.env.prod` | Yes, Render redeploys/restarts after env changes |
| `librechat.yaml` | Render disk `/data/librechat.yaml` | Upload from local terminal with SSH pipe | Yes |
| OpenAI OAuth `auth.json` | Render disk `/data/openai-oauth/auth.json` | Upload from local `~/.codex/auth.json` with SSH pipe | Yes |
| User uploads/images/logs/skills | Render disk under `/data` | Created by the app/start script | No, unless changing config |
| SSH public key | Render account settings | Paste local `~/.ssh/id_ed25519.pub` | No |
| MongoDB Atlas Network Access | MongoDB Atlas | Add Render outbound IPs/CIDRs and local IP for bootstrap | Retry/restart only if connection had failed |
| Supabase prod data/schema | Supabase | Apply schema/data/rules sync from local terminal | No Render restart for data-only changes |

Do not paste these into Render Environment variables:

- `auth.json` contents.
- Full `librechat.yaml` contents.
- Passwords as command arguments.
- Local-only paths such as `$HOME/.codex/auth.json`; Render needs absolute
  paths inside its container/disk, for example `/data/openai-oauth/auth.json`.

Do not rely on the Docker image for these files:

- `.env.prod` is ignored and must be represented by Render Dashboard env vars.
- Local `librechat.yaml` is ignored and must be uploaded to `/data/librechat.yaml`.
- Local `~/.codex/auth.json` is outside the repo and must be uploaded to
  `/data/openai-oauth/auth.json`.

## Upload LibreChat Config To Render

The Render startup script creates a minimal config only when the disk file does
not exist:

```yaml
version: 1.3.11
```

That file is not equivalent to your local `librechat.yaml`. If local
`librechat.yaml` contains model specs, endpoints, permissions, MCP settings,
or OpenAI OAuth display/configuration, upload it manually.

Before uploading, inspect the local file and avoid hardcoded secrets. Prefer
environment-variable references for secret values.

Upload from the local repo root. Render's Connect > SSH command gives the
target after `ssh`, for example
`srv-d9135vo0697c73b5p0u0@ssh.virginia.render.com`.

```bash
ssh <render-ssh-target> 'cat > /data/librechat.yaml && chmod 644 /data/librechat.yaml' < librechat.yaml
```

For this service, the command shape is:

```bash
ssh srv-d9135vo0697c73b5p0u0@ssh.virginia.render.com 'cat > /data/librechat.yaml && chmod 644 /data/librechat.yaml' < librechat.yaml
```

Verify:

```bash
ssh srv-d9135vo0697c73b5p0u0@ssh.virginia.render.com 'ls -l /data/librechat.yaml && sed -n "1,80p" /data/librechat.yaml'
```

Restart the Render service after replacing `/data/librechat.yaml`.

## MongoDB Atlas Network Access

If the first Render runtime log says:

```text
Could not connect to any servers in your MongoDB Atlas cluster.
One common reason is that you're trying to access the database from an IP that isn't whitelisted.
```

the Render service is running, but Atlas is blocking Render's outbound IP.

For the fastest first deploy:

1. Open MongoDB Atlas for the production project.
2. Go to Security > Network Access.
3. Add this temporary IP access list entry:

   ```text
   0.0.0.0/0
   ```

4. Comment it as `temporary Render production deploy`.
5. Wait 1-3 minutes.
6. Restart or manually redeploy the Render service.

After the service is live, tighten the rule:

1. In Render, open the service's connection or outbound networking details.
2. Copy the Render outbound IPs/CIDRs.
3. Add those IPs/CIDRs to MongoDB Atlas Network Access.
4. Remove the temporary `0.0.0.0/0` entry.

## Install OpenAI OAuth Auth File

`OPENAI_OAUTH_AUTH_FILE` must point to a writable file. Do not rely on a
read-only secret file as the final auth path, because `openai-oauth-provider`
refreshes access tokens and writes updated token data back to `auth.json`.

Preferred path: after the service is deployed, live, and the `/data` disk
exists, upload from the local terminal with SSH pipe:

```bash
ssh srv-d9135vo0697c73b5p0u0@ssh.virginia.render.com 'mkdir -p /data/openai-oauth && umask 077 && cat > /data/openai-oauth/auth.json && chmod 600 /data/openai-oauth/auth.json' < ~/.codex/auth.json
```

Verify:

```bash
ssh srv-d9135vo0697c73b5p0u0@ssh.virginia.render.com 'node -e '\''const fs=require("fs"); const p="/data/openai-oauth/auth.json"; JSON.parse(fs.readFileSync(p,"utf8")); console.log("auth.json OK", fs.statSync(p).size, "bytes")'\'''
```

Then restart the Render service so the OAuth provider reloads the file.

Render Shell fallback, if paste works in your browser:

```bash
mkdir -p /data/openai-oauth
cat > /data/openai-oauth/auth.json <<'JSON'
<paste auth.json contents from the trusted machine>
JSON
chmod 600 /data/openai-oauth/auth.json
```

Temporary bootstrap path: if the service is not live yet but the disk is
attached, use Render Secret File only as a one-time copy source:

1. Add a Secret File named `openai-auth.json`.
2. Paste the trusted-machine `auth.json` content into that secret file.
3. Temporarily set Docker Command to:

   ```bash
   sh -c 'mkdir -p /data/openai-oauth && if [ ! -f /data/openai-oauth/auth.json ] && [ -f /etc/secrets/openai-auth.json ]; then cp /etc/secrets/openai-auth.json /data/openai-oauth/auth.json && chmod 600 /data/openai-oauth/auth.json; fi; exec sh /app/deploy/render/start.sh'
   ```

4. Deploy once.
5. Change Docker Command back to:

   ```bash
   sh /app/deploy/render/start.sh
   ```

6. Remove the Secret File after confirming `/data/openai-oauth/auth.json`
   exists. The final runtime file must be the writable disk file, not the
   read-only secret file.

If OAuth calls later fail with an auth/refresh error, re-run the trusted
OpenAI/Codex login flow, replace `/data/openai-oauth/auth.json`, and restart
the service.

If local `~/.codex/auth.json` changes, Render does not know automatically.
Upload it again with the SSH pipe command and restart the service.

## Admin And Internal Users

`ALLOW_REGISTRATION=false` keeps public registration closed. It does not block
LibreChat's trusted server-side user script.

Use the local terminal bootstrap flow in
[`local-terminal-user-bootstrap.md`](./local-terminal-user-bootstrap.md). This
connects directly to production MongoDB with local `.env.prod` and avoids
running an extra Node process inside the low-memory Render Starter instance.

For a clean production MongoDB, create the first admin from the local repo root:

```bash
DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml \
  node -r dotenv/config config/create-user.js \
  admin@example.com "Admin" admin --email-verified=true
```

Let the script prompt for the password. The first user in a clean MongoDB
becomes `ADMIN`.

Create the remaining internal users the same way from the local terminal:

```bash
DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml \
  node -r dotenv/config config/create-user.js \
  user01@example.com "User 01" user01 --email-verified=true
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
- `/api/steel/ai/chat` is not registered.

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

Failed deploy with missing newer logs:

- Open the Render service Events page and inspect the latest failed deploy.
- Copy the final build/runtime log lines, redacting `MONGO_URI`,
  `STEEL_POSTGRES_URL`, tokens, and `auth.json`.
- Common causes are wrong Dockerfile path, wrong Docker Command, MongoDB Atlas
  IP access list, health check path, or instance memory.

Port bind failure:

- Confirm `HOST=0.0.0.0`.
- Use Render's default `PORT=10000`, or let Render inject `PORT`.
- The app must listen on `process.env.PORT`.

Health check failure:

- Confirm Health Check Path is `/health`, not `/healthz`.
- Confirm the app has reached the runtime stage and is not crashing before
  Express starts.

Docker build or start command failure:

- Confirm Docker Build Context Directory is `.`.
- Confirm Dockerfile Path is `Dockerfile.multi`, not `.`.
- Confirm Docker Command is `sh /app/deploy/render/start.sh`.

Lost uploads or missing OAuth auth file after redeploy:

- Confirm a Persistent Disk is attached.
- Confirm its mount path is exactly `/data`.
- Confirm `OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json`.

Supabase connection failure:

- Use the Supabase pooler URL if the direct `db.<project-ref>.supabase.co`
  host is not reachable from the runtime.
- Keep `sslmode=require&uselibpqcompat=true` in the URL.

Out-of-memory restarts:

- Upgrade from Starter to Standard before changing app behavior.
- Keep Meili/search disabled in the low-cost production shape unless search is
  explicitly required.

## Backup

At minimum, back up:

- MongoDB Atlas production database.
- Supabase production project.
- Render disk paths under `/data/uploads`, `/data/images`, `/data/skill`,
  `/data/librechat.yaml`, and `/data/openai-oauth/auth.json`.

Do not store production backups or `auth.json` in git.
