# DigitalOcean Droplet Production Runbook

This runbook deploys the customized LibreChat/Steel production app on a
DigitalOcean Droplet with a user-owned domain.

DigitalOcean replaces the Render production path when cost is more important
than platform-managed deployment. MongoDB Atlas and Supabase remain managed
cloud databases; do not install MongoDB or Postgres on the Droplet.

## Production Shape

- Host: DigitalOcean Droplet.
- OS: Ubuntu LTS.
- Minimum target size: 2 GB RAM / 1 vCPU.
- Recommended first domain shape: `chat.<your-domain>`.
- Reverse proxy and TLS: Caddy.
- Runtime: Docker Compose.
- Production branch: `master`.
- App image: built by GitHub Actions and pulled by the Droplet.
- Public ports: `80`, `443`.
- SSH port: `22`, restricted to trusted IPs when possible.
- App internal port: `3080`.
- Persistent app data root: `/data`.
- Host config root: `/etc/librechat`.
- App deploy root: `/srv/librechat/app`.

## Cost And Maintenance Tradeoff

The 2 GB Droplet should be materially cheaper than Render Standard, but it is
an unmanaged VPS. The project must own:

- Ubuntu security updates and reboot timing.
- Docker and Docker Compose installation.
- Firewall rules.
- Caddy HTTPS and domain DNS.
- Host files such as `.env.prod`, `librechat.yaml`, and OpenAI OAuth
  `auth.json`.
- Backups or snapshots for `/data` and `/etc/librechat`.
- GitHub Actions SSH redeploy.
- Log inspection and disk/memory monitoring.

MongoDB Atlas and Supabase remain managed, so database server patching and
backups stay outside the Droplet.

## Before Creating The Droplet

Buy or choose the domain first. Use a subdomain for the app:

```text
chat.<your-domain>
```

Using a subdomain keeps the root domain free for other sites and makes DNS
rollback easier.

Keep these production resources:

```text
MongoDB Atlas: production database in the existing prod cluster/project
Supabase: production project and prod_app database user
Local .env.prod: private source of truth for production env values
Local ~/.codex/auth.json: private source for OpenAI OAuth auth file
Local librechat.yaml: private source for LibreChat config
```

Do not commit `.env.prod`, `librechat.yaml`, `auth.json`, SSH private keys, or
database passwords.

## Create The Droplet

In DigitalOcean:

```text
Image: Ubuntu LTS
Plan: Basic
CPU option: Regular / shared CPU
Size: 2 GB RAM / 1 vCPU
Datacenter: choose a region close to the production users and databases
Authentication: SSH key
Hostname: librechat-prod
```

Region guidance:

- If Supabase is in `us-east-1`, a US East DigitalOcean region is preferred.
- If most users are in Taiwan, Singapore may feel closer to users but farther
  from the current Supabase pooler.
- Keep MongoDB Atlas, Supabase, and the Droplet reasonably close if latency
  becomes noticeable.

Enable DigitalOcean Monitoring. Use DigitalOcean Backups or scheduled
Snapshots if production uploads matter.

## DNS

After the Droplet is created, copy its public IPv4 address.

At the domain DNS provider, create:

```text
Type: A
Name: chat
Value: <droplet-ipv4>
TTL: automatic or 300
```

If using the apex domain instead of a subdomain:

```text
Type: A
Name: @
Value: <droplet-ipv4>
```

Wait for DNS propagation before expecting Caddy to issue HTTPS certificates.

Verify from the local terminal:

```bash
dig +short chat.<your-domain>
```

Expected output:

```text
<droplet-ipv4>
```

## Host Setup

SSH to the Droplet as root first:

```bash
ssh root@<droplet-ipv4>
```

Create a deployment user:

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

Install Docker:

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
```

Create production directories:

```bash
mkdir -p /srv/librechat/app
mkdir -p /etc/librechat
mkdir -p /data/uploads /data/images /data/logs /data/skill
mkdir -p /data/openai-oauth
chown -R deploy:deploy /srv/librechat /data
chmod 750 /etc/librechat
```

Configure a basic firewall:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

After GitHub Actions deploy is working, consider restricting SSH to your trusted
IP addresses.

## Host Files

Production host files live outside git:

| File | Host path | Source |
|---|---|---|
| Env vars | `/etc/librechat/.env.prod` | Local `.env.prod` |
| LibreChat config | `/data/librechat.yaml` | Local `librechat.yaml` |
| OpenAI OAuth auth | `/data/openai-oauth/auth.json` | Local `~/.codex/auth.json` |

Upload `.env.prod`:

```bash
scp .env.prod deploy@<droplet-ipv4>:/tmp/.env.prod
ssh deploy@<droplet-ipv4> 'sudo install -m 600 -o deploy -g deploy /tmp/.env.prod /etc/librechat/.env.prod && rm /tmp/.env.prod'
```

Upload `librechat.yaml`:

```bash
scp librechat.yaml deploy@<droplet-ipv4>:/tmp/librechat.yaml
ssh deploy@<droplet-ipv4> 'install -m 644 /tmp/librechat.yaml /data/librechat.yaml && rm /tmp/librechat.yaml'
```

Upload OpenAI OAuth `auth.json`:

```bash
scp ~/.codex/auth.json deploy@<droplet-ipv4>:/tmp/auth.json
ssh deploy@<droplet-ipv4> 'install -m 600 /tmp/auth.json /data/openai-oauth/auth.json && rm /tmp/auth.json'
```

Verify `auth.json` without printing secrets:

```bash
ssh deploy@<droplet-ipv4> 'node -e '\''const fs=require("fs"); const p="/data/openai-oauth/auth.json"; JSON.parse(fs.readFileSync(p,"utf8")); console.log("auth.json OK", fs.statSync(p).size, "bytes")'\'''
```

## Production Env Values

Use local `.env.prod` as the private source of truth. For Droplet deployment,
set domain values to your real custom domain:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3080
NODE_OPTIONS=--max-old-space-size=1536
CONFIG_PATH=/data/librechat.yaml
RENDER_DATA_DIR=/data

LIBRECHAT_DOMAIN=chat.<your-domain>
DOMAIN_CLIENT=https://chat.<your-domain>
DOMAIN_SERVER=https://chat.<your-domain>

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

`RENDER_DATA_DIR` is currently used by the existing production startup script
name even on non-Render hosts. Keep it set to `/data` unless the startup script
is later generalized.

Do not add `OPENAI_PROVIDER`. LibreChat's frontend/provider selection owns the
OAuth versus API-key distinction.

## External Service Allowlist

MongoDB Atlas must allow the Droplet public IP:

```text
MongoDB Atlas > Security > Network Access > Add IP Address
```

Add:

```text
<droplet-ipv4>/32
```

Keep your local public IP allowed while using local account bootstrap scripts.
Remove temporary `0.0.0.0/0` entries after deployment is stable.

Supabase pooler URLs normally do not require a Droplet IP allowlist unless an
extra network restriction was configured manually.

## Docker Compose Target

The Droplet runs a minimal stack from the repo root files:

| File | Purpose |
|---|---|
| `deploy-compose.prod.yml` | Production Compose stack |
| `deploy/host/start.sh` | Provider-neutral container startup script that maps `/data` |
| `deploy/host/paddleocr-smoke.sh` | Manual PaddleOCR MCP `c.pdf` smoke script |
| `deploy/digitalocean/Caddyfile` | Caddy HTTPS reverse proxy config |

Do not run MongoDB, Postgres, MeiliSearch, RAG API, or vector DB on the first
low-cost Droplet unless there is a separate product requirement.

The committed compose stack runs:

```text
api: customized LibreChat production image
caddy: HTTPS reverse proxy
```

Validate without printing secrets:

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml config --quiet'
```

The Caddy container receives only `LIBRECHAT_DOMAIN` and `PORT`, not the full
application `.env.prod` secret set.

## PaddleOCR MCP Runtime

Production PaddleOCR MCP uses a persistent Python venv on the host-mounted
`/data` volume:

```text
/data/paddleocr/venv
```

The API image includes Debian/glibc runtime libraries and `uv`, but it does not
embed the full `paddleocr-mcp` Python environment. On container startup,
`deploy/host/start.sh` creates or reuses the persistent venv, installs
`paddleocr-mcp` if missing, imports `paddleocr_mcp`, and starts the MCP command
briefly to prove it does not crash.

Production `/data/librechat.yaml` must use the persistent command:

```yaml
mcpServers:
  PaddleOCR:
    type: stdio
    startup: false
    command: /data/paddleocr/venv/bin/paddleocr_mcp
    args: []
```

Keep the long LibreChat and PaddleOCR AI Studio timeouts for drawing PDFs:

```yaml
timeout: 1200000
env:
  PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT: "600"
  PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT: "1200"
  PADDLEOCR_MCP_HTTP_TIMEOUT: "1200"
```

Useful startup controls in `/etc/librechat/.env.prod`:

```bash
PADDLEOCR_PREPARE_ON_STARTUP=true
PADDLEOCR_PREWARM_STRICT=true
PADDLEOCR_MCP_STARTUP_SMOKE_TIMEOUT_SECONDS=8
PADDLEOCR_FORCE_REINSTALL=false
PADDLEOCR_UV_PYTHON_INSTALL_DIR=/data/paddleocr/python
```

GitHub Actions runs a lightweight real PaddleOCR OCR smoke after deploy with
the tracked fixture:

```text
deploy/host/fixtures/workflow-smoke.pdf -> /data/smoke/workflow-smoke.pdf
```

That smoke calls `paddleocr_vl` through the persistent MCP command and checks
for simple markers from the PDF.

For the heavier drawing smoke, upload the ignored local reference PDF manually
from your workstation:

```bash
scp docs/reference/example/c.pdf deploy@<droplet-ipv4>:/data/smoke/c.pdf
```

Then run the live production `c.pdf` smoke manually after deploy:

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api sh /app/deploy/host/paddleocr-smoke.sh /data/smoke/c.pdf'
```

Both smokes call AI Studio. The workflow uses the simple PDF to keep each
deploy check lighter; `c.pdf` remains the full drawing OCR smoke.

Current production observation:

- `workflow-smoke.pdf` completed through `paddleocr_vl` in about 214 seconds.
- `docs/reference/example/c.pdf` uploaded to `/data/smoke/c.pdf` currently
  fails through `paddleocr-mcp` AI Studio API with
  `ClientOSError: [Errno 32] Broken pipe` after several minutes, even though
  the AI Studio website may parse the same file much faster. Treat this as a
  provider/API-path issue to investigate separately, not as an MCP startup or
  host health failure.

## GitHub Actions Auto Deploy

Production automation is defined in:

```text
.github/workflows/deploy-prod.yml
```

The production automation is:

1. Push to `master`.
2. GitHub Actions builds the production `Dockerfile.multi` image.
3. GitHub Actions pushes the image to GHCR.
4. GitHub Actions SSHes to the Droplet as `deploy`.
5. The Droplet pulls the new image and runs `docker compose up -d`.

Do not enable the production workflow until these GitHub secrets exist:

```text
DO_PROD_HOST=<droplet-ipv4-or-domain>
DO_PROD_USER=deploy
DO_PROD_SSH_KEY=<private deploy key for GitHub Actions only>
```

If the GHCR image is private, the host also needs a read token stored outside
git.

Current `chat.longdin.org` setup uses:

```text
DO_PROD_HOST=139.59.110.150
DO_PROD_USER=deploy
DO_PROD_SSH_KEY=<private key matching ~/.ssh/librechat_do_prod_deploy_ed25519.pub>
```

The matching public key is installed in
`/home/deploy/.ssh/authorized_keys` on the Droplet.

The workflow uses the job-scoped `GITHUB_TOKEN` to push the GHCR image and to
temporarily log the Droplet into GHCR during deployment. Do not add a
long-lived `GHCR_READ_TOKEN` unless a later package-visibility change makes it
necessary.

## First Smoke Checks

From the Droplet:

```bash
curl -i http://127.0.0.1:3080/health
```

From local after DNS and HTTPS are live:

```bash
curl -i https://chat.<your-domain>/health
curl -i https://chat.<your-domain>/api/config
```

Expected:

- `/health` returns `200 OK`.
- `/api/config` returns JSON with production domains.
- `/steel/oauth-chat` returns `404` in production.
- Login works with the production admin account.
- Normal LibreChat chat can select the intended OpenAI provider path.
- `auth.json` remains writable and is not stored in the Docker image.

## Rollback

Keep Render available until the Droplet has passed smoke checks.

Rollback options:

- Point DNS back to Render or the previous host if a CNAME/custom domain was
  configured there.
- Keep using the Render generated URL while the Droplet is being fixed.
- On the Droplet, redeploy the previous GHCR image tag if the latest image
  fails after a pull.

## Backups

At minimum, back up:

```text
/etc/librechat/.env.prod
/data/librechat.yaml
/data/openai-oauth/auth.json
/data/uploads
/data/images
/data/skill
```

Do not store those backups in git. Use encrypted local backup, DigitalOcean
Snapshots, or a private backup target.
