# DigitalOcean Droplet Production Runbook

Traditional Chinese version:
`docs/deployment/digitalocean-droplet-prod-runbook.zh-TW.md`.

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

## Server-side Codex Login

The admin `Usage remaining` panel detects Codex CLI from inside the API server
runtime. Installing Codex CLI on the Droplet host is not enough when LibreChat
runs in Docker; the API container must be able to run `codex --version`.

`Dockerfile.multi` installs the CLI with:

```bash
npm install -g @openai/codex
```

After deploy, verify the container runtime:

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api codex --version'
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api sh -lc "mkdir -p /data/openai-oauth && test -w /data/openai-oauth && echo openai-oauth-dir-writable"'
```

The Login Codex admin flow sets `CODEX_HOME` to the directory that contains
`OPENAI_OAUTH_AUTH_FILE`. With the production value below, Codex writes and
refreshes credentials at `/data/openai-oauth/auth.json`. The browser only sees
device-login URL/code/status; it must never receive `auth.json`, access tokens,
refresh tokens, account IDs, or the absolute auth path.

The resulting `auth.json` contains refreshable Codex/OpenAI OAuth credentials.
It is long-lived operational state, but not permanent: it can stop working if
the account login is revoked, workspace settings change, or OpenAI changes the
OAuth flow. Treat the file like a password and keep it off git, logs, and
public artifacts.

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

AWS_REGION=ap-east-1
AWS_BUCKET_NAME=amzn-s3-longdin-ap-east
AWS_ACCESS_KEY_ID=<prod-s3-access-key-id>
AWS_SECRET_ACCESS_KEY=<prod-s3-secret-access-key>
AWS_ENDPOINT_URL=
S3_URL_EXPIRY_SECONDS=43200
S3_KEY_PREFIX=prod
```

`RENDER_DATA_DIR` is currently used by the existing production startup script
name even on non-Render hosts. Keep it set to `/data` unless the startup script
is later generalized.

Do not add `OPENAI_PROVIDER`. LibreChat's frontend/provider selection owns the
OAuth versus API-key distinction.

## AWS S3 Hong Kong File Storage

Use AWS S3 Hong Kong `ap-east-1` as the production file repository. Keep the
bucket private and use backend-generated presigned URLs; do not expose permanent
AWS keys to the browser.
Use `S3_URL_EXPIRY_SECONDS=43200` for 12-hour presigned URLs when PaddleOCR or
other backend-only integrations need enough time to fetch private S3 objects.
Use `S3_KEY_PREFIX=prod` when production shares a bucket with dev/test so new
objects are stored under `prod/uploads/...`, `prod/images/...`, and related
paths.

Recommended bucket:

```text
amzn-s3-longdin-ap-east
```

AWS IAM should use a dedicated production user or role. Minimum policy shape:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListLibreChatBucket",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::amzn-s3-longdin-ap-east"
    },
    {
      "Sid": "ManageLibreChatObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::amzn-s3-longdin-ap-east/*"
    }
  ]
}
```

Install AWS values in `/etc/librechat/.env.prod`:

```bash
ssh deploy@<droplet-ipv4> 'sudoedit /etc/librechat/.env.prod'
```

Required values:

```bash
AWS_REGION=ap-east-1
AWS_BUCKET_NAME=amzn-s3-longdin-ap-east
AWS_ACCESS_KEY_ID=<prod-s3-access-key-id>
AWS_SECRET_ACCESS_KEY=<prod-s3-secret-access-key>
AWS_ENDPOINT_URL=
S3_URL_EXPIRY_SECONDS=43200
S3_KEY_PREFIX=prod
```

Enable S3 storage in host-managed `/data/librechat.yaml`:

```yaml
version: 1.3.13
fileStrategy: "s3"
```

Preserve the existing MCP server configuration in that file. Add only
`fileStrategy: "s3"` if the rest of the YAML is already correct.

Restart the API service after both files are updated:

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml up -d api'
```

Verify without printing secrets:

```bash
ssh deploy@<droplet-ipv4> 'grep -E "^(AWS_REGION|AWS_BUCKET_NAME|AWS_ENDPOINT_URL|S3_URL_EXPIRY_SECONDS|S3_KEY_PREFIX)=" /etc/librechat/.env.prod'
ssh deploy@<droplet-ipv4> 'grep -n "^fileStrategy" /data/librechat.yaml'
curl -fsS https://chat.longdin.org/health
```

Existing local files in `/data/uploads` remain local. New uploads after the
restart use S3 and Mongo file records should store `source: s3` plus
`storageKey`.

If dev/test uses the same bucket, set its local `.env` to `S3_KEY_PREFIX=dev`.
Do not set `fileStrategy` paths such as `uploads/dev`; S3 key prefixes are
validated as a single path segment and applied before LibreChat's existing
`uploads/<user>/<file>` and `images/<user>/<file>` layout.

PaddleOCR MCP input resolution:

- For current-request LibreChat attachments stored in S3, the API resolves
  `paddleocr_vl.input_data` to a backend-generated S3 download URL through the
  storage strategy's `getDownloadURL`.
- The generated URL uses `S3_URL_EXPIRY_SECONDS`, currently `43200` seconds.
- The API must not log the presigned URL. Logs should mention only that a
  storage download URL was used.
- Local/non-URL storage sources continue to resolve through the existing
  server-side download stream and `data:<mime>;base64,...` path.

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
| `deploy/host/paddleocr-smoke.sh` | Manual PaddleOCR MCP smoke script |
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

Production and local development use the same PaddleOCR MCP shape. LibreChat
starts PaddleOCR eagerly during MCP initialization so the first OCR request does
not pay the MCP cold-start cost.

The API image must include Debian/glibc runtime libraries, `uv`/`uvx`, and
the `@openai/codex` CLI. The image build installs Python 3.12 and
`paddleocr-mcp` with `uv tool install`, exposing `paddleocr_mcp` on `PATH`
before deploy/start. Because the provider source is fixed to AI Studio,
production does not require a local PaddlePaddle inference stack.

Production `/data/librechat.yaml` and local `librechat.yaml` must use the
preinstalled `paddleocr_mcp` command:

```yaml
mcpServers:
  PaddleOCR:
    type: stdio
    startup: true
    initTimeout: 60000
    command: paddleocr_mcp
    args: []
    timeout: 600000
    env:
      PADDLEOCR_MCP_MODEL: PaddleOCR-VL-1.6
      PADDLEOCR_MCP_PPOCR_SOURCE: aistudio
      PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN: "${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}"
      PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT: "120"
      PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT: "600"
      PADDLEOCR_MCP_HTTP_TIMEOUT: "600"
```

The only required PaddleOCR secret in `/etc/librechat/.env.prod` is:

```bash
PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN=
```

Production uses PaddleOCR-VL through the AI Studio API. OCR tool execution is
bounded to 10 minutes; individual connection/request timeouts are intentionally
shorter so startup failures surface quickly. PaddleOCR supports PDF and image
inputs such as PNG, JPG/JPEG, BMP, and CIF. Treat this as a single API path: do
not expose source/provider selection in env or host scripts.

PaddleOCR API limits: after a model reaches its daily parsing limit, exceeded
requests return `429`. There is no documented single-file size limit, but keep
PDF inputs within 100 pages to avoid timeout; pages beyond the limit are
ignored.

Container startup no longer installs PaddleOCR packages. The production image
already contains the `paddleocr_mcp` tool environment, and LibreChat starts the
PaddleOCR MCP server eagerly during API initialization.

GitHub Actions does not run PaddleOCR OCR as a deploy gate. Production deploy
is gated only by LibreChat container health because PaddleOCR depends on the
external AI Studio API path and can fail due to API or network conditions that
should not block app rollout.

### PaddleOCR MCP Smoke

The smoke script reads the same `PaddleOCR` server config from
`CONFIG_PATH`/`/data/librechat.yaml`, including command, args, env, token
interpolation, and timeout. Pass a fresh S3 smoke PDF URL as the first argument:

```bash
PROD_HOST=139.59.110.150
SMOKE_URL="https://..."
ssh deploy@"$PROD_HOST" 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api /bin/sh /app/deploy/host/paddleocr-smoke.sh "$0"' "$SMOKE_URL"
```

Do not use local container paths for live OCR smoke.

## Post-Deploy Manual Verification

Use this after a `master` push deploy. `/health` only proves the LibreChat site
started. PaddleOCR must be checked separately with a freshly generated S3 smoke
PDF URL so the same manual smoke verifies both S3 URL readability and the
PaddleOCR `fileUrl` OCR path.

Set the production target once in your local terminal:

```bash
PROD_HOST=139.59.110.150
PROD_URL=https://chat.longdin.org
```

Check the latest GitHub Actions deploy:

```bash
gh run list --workflow "Deploy Production" --branch master --limit 5
LATEST_DEPLOY_RUN_ID="$(gh run list --workflow "Deploy Production" --branch master --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$LATEST_DEPLOY_RUN_ID"
```

Check public and container-local health:

```bash
curl -fsS "$PROD_URL/health" && printf '\n'
ssh deploy@"$PROD_HOST" 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api curl -fsS http://127.0.0.1:3080/health && printf "\n"'
```

Run the combined S3 + PaddleOCR live smoke only after `/health` is good. The
command creates a tiny PDF in the production API container, uploads it with the
container's production S3 config, validates the presigned URL with a signed GET,
then passes that fresh S3 URL as the first argument to `paddleocr-smoke.sh`.

```bash
ssh deploy@"$PROD_HOST" 'bash -se' <<'REMOTE'
set -euo pipefail
cd /srv/librechat/app

SMOKE_URL="$(docker compose -f deploy-compose.prod.yml exec -T api sh -lc 'cd /app/api && node' <<'NODE'
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const required = ['AWS_BUCKET_NAME', 'AWS_REGION'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required S3 env: ${missing.join(', ')}`);
}

const bucket = process.env.AWS_BUCKET_NAME;
const region = process.env.AWS_REGION;
const endpoint = process.env.AWS_ENDPOINT_URL || undefined;
const forcePathStyle = /^(1|true|yes|on)$/i.test(process.env.AWS_FORCE_PATH_STYLE || '');
const expiresIn = Number(process.env.S3_URL_EXPIRY_SECONDS || 43200);
const keyPrefix = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : '';
const key = `${keyPrefix}uploads/smoke/paddleocr-smoke-${Date.now()}-${crypto.randomUUID()}.pdf`;
const marker = `LibreChat PaddleOCR smoke OK ${new Date().toISOString()}`;

function escapePdfText(value) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function createPdf(text) {
  const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  const offsets = [0];
  let pdf = '%PDF-1.4\n';
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  const s3 = new S3Client({ region, endpoint, forcePathStyle });
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createPdf(marker),
    ContentType: 'application/pdf',
    ContentDisposition: 'inline; filename="paddleocr-smoke.pdf"',
    Metadata: { purpose: 'paddleocr-smoke' },
  }));

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
  const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Signed S3 GET failed with HTTP ${response.status}`);
  }

  console.error(`Uploaded smoke PDF to s3://${bucket}/${key}`);
  console.error(`Validated signed S3 GET with HTTP ${response.status}`);
  console.log(url);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
NODE
)"

case "$SMOKE_URL" in
  http://*|https://*)
    ;;
  *)
    printf 'Did not receive an S3 smoke PDF URL from the API container.\n' >&2
    exit 1
    ;;
esac

docker compose -f deploy-compose.prod.yml exec -T api sh /app/deploy/host/paddleocr-smoke.sh "$SMOKE_URL"
REMOTE
```

The smoke calls AI Studio and is intentionally manual. Keep it for diagnosing
OCR API/runtime health after deploy; do not treat it as the production
deployment gate. Do not use local container paths as the production live smoke
input. The smoke script reads the PaddleOCR MCP `command`, `args`, `env`, token
placeholder, and timeout from `CONFIG_PATH` / `/data/librechat.yaml`, matching
LibreChat's own MCP server configuration.

Current production observation:

- `workflow-smoke.pdf` previously completed through `paddleocr_vl` in about
  214 seconds, but later checks showed intermittent AI Studio connectivity from
  the Droplet.
- `docs/reference/example/b.png` uploaded to `/data/smoke/b.png` also fails
  before OCR job creation. The 296,377 byte PNG timed out during multipart
  upload from the Singapore Droplet, and a valid AWS S3 Sydney
  `ap-southeast-2` presigned `fileUrl` returned AI Studio `HTTP 400` code
  `10000` with `文件 URL 访问超时`.
- AWS S3 Hong Kong `ap-east-1` succeeded for the same `b.png`: AI Studio
  accepted the `fileUrl`, returned a job id, reached `done`, and exposed a JSON
  result with one parsed table block.
- A smaller `d.pdf` in AWS S3 Hong Kong `ap-east-1` did work: the 454,807 byte
  PDF returned an AI Studio job id in about 19 seconds, reached `done`, and
  produced a 73 KB JSON result with parsed table/text blocks. This makes
  PDF-size reduction the preferred next production path.

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
Snapshots, or a private backup target. After switching new uploads to S3, keep
backing up `/data/uploads` for legacy local files until they are migrated or no
longer needed.
