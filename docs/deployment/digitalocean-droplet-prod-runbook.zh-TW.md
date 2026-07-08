# DigitalOcean Droplet 生產環境 Runbook

繁體中文版。英文版原文在
`docs/deployment/digitalocean-droplet-prod-runbook.md`。

SSH keepalive 與 tmux 維運指南在
`docs/deployment/ssh-tmux-operations.zh-TW.md`。

這份 runbook 用來把客製化 LibreChat/Steel 生產站部署到使用者自有網域的
DigitalOcean Droplet。

DigitalOcean Droplet 是目前取代 Render 的生產路徑，主要目標是降低成本。
MongoDB Atlas 與 Supabase 仍然是託管雲端資料庫；不要在 Droplet 上安裝
MongoDB 或 Postgres。

## 生產架構

- 主機：DigitalOcean Droplet。
- OS：Ubuntu LTS。
- 最低目標規格：2 GB RAM / 1 vCPU。
- 建議網域形態：`chat.<your-domain>`。
- Reverse proxy / TLS：Caddy。
- Runtime：Docker Compose。
- 生產 branch：`master`。
- App image：GitHub Actions build，Droplet pull。
- Public ports：`80`, `443`。
- SSH port：`22`，可行時限制到可信任 IP。
- App 內部 port：`3080`。
- 持久化資料根目錄：`/data`。
- Host config 根目錄：`/etc/librechat`。
- App deploy 根目錄：`/srv/librechat/app`。

## 成本與維護取捨

2 GB Droplet 應該明顯比 Render Standard 便宜，但它是 unmanaged VPS。
專案要自行負責：

- Ubuntu security updates 與 reboot 時機。
- Docker / Docker Compose 安裝。
- Firewall rules。
- Caddy HTTPS 與 DNS。
- Host files，例如 `.env.prod`, `librechat.yaml`, OpenAI OAuth `auth.json`。
- `/data` 與 `/etc/librechat` 的 backup / snapshot。
- GitHub Actions SSH redeploy。
- Log inspection 與 disk/memory monitoring。

MongoDB Atlas 與 Supabase 仍然是託管服務，所以資料庫 server patching 與
backup 不在 Droplet 上處理。

## 建立 Droplet 前

先買好或選好網域。App 建議放在 subdomain：

```text
chat.<your-domain>
```

使用 subdomain 可以保留 root domain 給其他網站，也讓 DNS rollback 比較容易。

保留這些 production resources：

```text
MongoDB Atlas: existing prod cluster/project 裡的 production database
Supabase: production project 與 prod_app database user
Local .env.prod: production env values 的 private source of truth
Local ~/.codex/auth.json: OpenAI OAuth auth file 的 private source
Local librechat.yaml: LibreChat config 的 private source
```

不要 commit `.env.prod`, `librechat.yaml`, `auth.json`, SSH private keys,
database passwords。

## 建立 Droplet

DigitalOcean 建議設定：

```text
Image: Ubuntu LTS
Plan: Basic
CPU option: Regular / shared CPU
Size: 2 GB RAM / 1 vCPU
Datacenter: choose a region close to the production users and databases
Authentication: SSH key
Hostname: librechat-prod
```

Region 原則：

- Supabase 如果在 `us-east-1`，優先考慮 US East DigitalOcean region。
- 多數使用者如果在台灣，Singapore 對使用者較近，但離目前 Supabase pooler 較遠。
- MongoDB Atlas、Supabase、Droplet 盡量保持合理接近；若 latency 明顯再調整。

啟用 DigitalOcean Monitoring。若 production uploads 重要，啟用 DigitalOcean
Backups 或 scheduled Snapshots。

## DNS

Droplet 建好後，複製 public IPv4。

在 domain DNS provider 建立：

```text
Type: A
Name: chat
Value: <droplet-ipv4>
TTL: automatic or 300
```

若使用 apex domain：

```text
Type: A
Name: @
Value: <droplet-ipv4>
```

等待 DNS propagation 後，Caddy 才能順利簽 HTTPS certificate。

本機驗證：

```bash
dig +short chat.<your-domain>
```

預期輸出：

```text
<droplet-ipv4>
```

## Host 初始化

先用 root SSH 到 Droplet：

```bash
ssh root@<droplet-ipv4>
```

建立 deploy user：

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

安裝 Docker：

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

建立 production directories：

```bash
mkdir -p /srv/librechat/app
mkdir -p /etc/librechat
mkdir -p /data/uploads /data/images /data/logs /data/skill
mkdir -p /data/openai-oauth
chown -R deploy:deploy /srv/librechat /data
chmod 750 /etc/librechat
```

設定基本 firewall：

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

GitHub Actions deploy 正常後，可以再把 SSH 限制到可信任 IP。

## Host Files

Production host files 不進 git：

| 檔案 | Host path | Source |
|---|---|---|
| Env vars | `/etc/librechat/.env.prod` | Local `.env.prod` |
| LibreChat config | `/data/librechat.yaml` | Local `librechat.yaml` |
| OpenAI OAuth auth | `/data/openai-oauth/auth.json` | Local `~/.codex/auth.json` |

上傳 `.env.prod`：

```bash
scp .env.prod deploy@<droplet-ipv4>:/tmp/.env.prod
ssh deploy@<droplet-ipv4> 'sudo install -m 600 -o deploy -g deploy /tmp/.env.prod /etc/librechat/.env.prod && rm /tmp/.env.prod'
```

上傳 `librechat.yaml`：

```bash
scp librechat.yaml deploy@<droplet-ipv4>:/tmp/librechat.yaml
ssh deploy@<droplet-ipv4> 'install -m 644 /tmp/librechat.yaml /data/librechat.yaml && rm /tmp/librechat.yaml'
```

上傳 OpenAI OAuth `auth.json`：

```bash
scp ~/.codex/auth.json deploy@<droplet-ipv4>:/tmp/auth.json
ssh deploy@<droplet-ipv4> 'install -m 600 /tmp/auth.json /data/openai-oauth/auth.json && rm /tmp/auth.json'
```

驗證 `auth.json`，不要印出 secrets：

```bash
ssh deploy@<droplet-ipv4> 'node -e '\''const fs=require("fs"); const p="/data/openai-oauth/auth.json"; JSON.parse(fs.readFileSync(p,"utf8")); console.log("auth.json OK", fs.statSync(p).size, "bytes")'\'''
```

## Server-side Codex Login

Admin `Usage remaining` panel 是從 API server runtime 裡偵測 Codex CLI。
LibreChat 跑在 Docker 時，只在 Droplet host 安裝 Codex CLI 不夠；API container
必須能執行 `codex --version`。

`Dockerfile.multi` 會用這個方式安裝 CLI：

```bash
npm install -g @openai/codex
```

Deploy 後，在 container 裡驗證：

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api codex --version'
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api sh -lc "mkdir -p /data/openai-oauth && test -w /data/openai-oauth && echo openai-oauth-dir-writable"'
```

Login Codex admin flow 會把 `CODEX_HOME` 指到 `OPENAI_OAUTH_AUTH_FILE` 所在
目錄。用下面的 production 設定時，Codex 會把 credential 寫入並 refresh
`/data/openai-oauth/auth.json`。Browser 只會看到 device-login URL/code/status；
不能回傳 `auth.json`、access token、refresh token、account ID 或絕對 auth path。

產生的 `auth.json` 內含可 refresh 的 Codex/OpenAI OAuth credential。它是長期
operational state，但不是永久：如果帳號 login 被 revoked、workspace 設定改變、
或 OpenAI OAuth flow 改變，它仍可能失效。把這個檔案當 password 處理，不要放進
git、logs 或 public artifacts。

## Production Env Values

以 local `.env.prod` 作為 private source of truth。Droplet production 至少要有：

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

`RENDER_DATA_DIR` 目前仍被既有 startup script 名稱使用，即使現在不是 Render。
除非之後 generalize startup script，否則保持 `/data`。

不要新增 `OPENAI_PROVIDER`。OAuth vs API-key 的差異由 LibreChat frontend/provider
selection 負責。

## AWS S3 Hong Kong File Storage

Production file repository 使用 AWS S3 Hong Kong `ap-east-1`。Bucket 保持 private，
用 backend-generated presigned URL；不要把 permanent AWS keys 暴露到 browser。

PaddleOCR 或其他 backend-only integration 需要足夠時間抓 private S3 object，
所以使用：

```bash
S3_URL_EXPIRY_SECONDS=43200
```

如果 dev/test 與 production 共用 bucket，production 設：

```bash
S3_KEY_PREFIX=prod
```

新 objects 會在：

```text
prod/uploads/...
prod/images/...
```

建議 bucket：

```text
amzn-s3-longdin-ap-east
```

AWS IAM 使用 dedicated production user 或 role。最小 policy 形狀：

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

在 `/etc/librechat/.env.prod` 安裝 AWS values：

```bash
ssh deploy@<droplet-ipv4> 'sudoedit /etc/librechat/.env.prod'
```

必要值：

```bash
AWS_REGION=ap-east-1
AWS_BUCKET_NAME=amzn-s3-longdin-ap-east
AWS_ACCESS_KEY_ID=<prod-s3-access-key-id>
AWS_SECRET_ACCESS_KEY=<prod-s3-secret-access-key>
AWS_ENDPOINT_URL=
S3_URL_EXPIRY_SECONDS=43200
S3_KEY_PREFIX=prod
```

在 host-managed `/data/librechat.yaml` 啟用 S3 storage：

```yaml
version: 1.3.13
fileStrategy: "s3"
```

保留既有 MCP server config。若 YAML 其他內容已正確，只新增 `fileStrategy: "s3"`。

更新 env/YAML 後重啟 API：

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml up -d api'
```

不印 secrets 的驗證：

```bash
ssh deploy@<droplet-ipv4> 'grep -E "^(AWS_REGION|AWS_BUCKET_NAME|AWS_ENDPOINT_URL|S3_URL_EXPIRY_SECONDS|S3_KEY_PREFIX)=" /etc/librechat/.env.prod'
ssh deploy@<droplet-ipv4> 'grep -n "^fileStrategy" /data/librechat.yaml'
curl -fsS https://chat.longdin.org/health
```

既有 `/data/uploads` local files 仍是 local。重啟後的新 uploads 會走 S3，Mongo
file records 應該存 `source: s3` 和 `storageKey`。

若 dev/test 使用同 bucket，local `.env` 設 `S3_KEY_PREFIX=dev`。不要設定
`uploads/dev` 這種 `fileStrategy` path；S3 key prefix 是單一 path segment，
會套在 LibreChat 既有的 `uploads/<user>/<file>` 與 `images/<user>/<file>`
前面。

PaddleOCR MCP input resolution：

- 目前 request 的 LibreChat attachments 若存在 S3，API 會透過 storage
  strategy 的 `getDownloadURL` 產生 backend-generated S3 download URL，提供給
  `paddleocr_vl.input_data`。
- 產生的 URL 使用 `S3_URL_EXPIRY_SECONDS`，目前為 `43200` 秒。
- API 不可 log presigned URL。Log 只能說使用 storage download URL。
- Local/non-URL storage source 繼續使用 server-side download stream 與
  `data:<mime>;base64,...` 路徑。

## External Service Allowlist

MongoDB Atlas 必須允許 Droplet public IP：

```text
MongoDB Atlas > Security > Network Access > Add IP Address
```

加入：

```text
<droplet-ipv4>/32
```

本機還需要 account bootstrap scripts 時，保留本機 public IP。部署穩定後移除
temporary `0.0.0.0/0`。

Supabase pooler URL 通常不需要 Droplet IP allowlist，除非另外設定了 network
restriction。

## Docker Compose Target

Droplet 從 repo root 檔案跑最小 stack：

| 檔案 | 用途 |
|---|---|
| `deploy-compose.prod.yml` | Production Compose stack |
| `deploy/host/start.sh` | Provider-neutral container startup script，映射 `/data` |
| `deploy/host/paddleocr-smoke.sh` | 手動 PaddleOCR MCP smoke script |
| `deploy/digitalocean/Caddyfile` | Caddy HTTPS reverse proxy config |

第一版低成本 Droplet 不跑 MongoDB、Postgres、MeiliSearch、RAG API、vector DB，
除非之後有明確 product requirement。

Committed compose stack：

```text
api: customized LibreChat production image
caddy: HTTPS reverse proxy
```

驗證 compose config，不印 secrets：

```bash
ssh deploy@<droplet-ipv4> 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml config --quiet'
```

Caddy container 只接收 `LIBRECHAT_DOMAIN` 和 `PORT`，不接收完整 app
`.env.prod` secret set。

## PaddleOCR MCP Runtime

Production 和 local development 使用同一種 PaddleOCR MCP 形狀。LibreChat 從
API process environment 用 `uvx` 啟動 PaddleOCR；API startup script 不再額外準備
PaddleOCR Python environment。

API image 必須包含 Debian/glibc runtime libraries、`uv`/`uvx`、以及
`@openai/codex` CLI。MCP server 被啟動時，`uvx` 會解析 Python 3.12 與
`paddleocr-mcp` package。Provider source 固定為 AI Studio，因此 production 不需要
local PaddlePaddle inference stack。

Production `/data/librechat.yaml` 和 local `librechat.yaml` 必須使用 `uvx` command：

```yaml
mcpServers:
  PaddleOCR:
    type: stdio
    startup: false
    command: uvx
    args:
      - --python
      - "3.12"
      - --from
      - paddleocr-mcp
      - paddleocr_mcp
    timeout: 1200000
    env:
      PADDLEOCR_MCP_MODEL: PaddleOCR-VL-1.6
      PADDLEOCR_MCP_PPOCR_SOURCE: aistudio
      PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN: "${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}"
      PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT: "600"
      PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT: "1200"
      PADDLEOCR_MCP_HTTP_TIMEOUT: "1200"
```

`/etc/librechat/.env.prod` 只需要保留 PaddleOCR secret：

```bash
PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN=
```

Production 使用 PaddleOCR-VL through AI Studio API。PDF input 建議小於 100 頁，
避免 timeout；超過頁數可能被忽略。

Startup 不再安裝或 prewarm PaddleOCR。`deploy/host/start.sh` 只啟動 LibreChat
API；PaddleOCR 由 LibreChat 在 MCP tool 被使用時 lazy start。

GitHub Actions 不把 PaddleOCR OCR 當 deploy gate。Production deploy 只 gate
LibreChat container health，因為 PaddleOCR 依賴外部 AI Studio API/network。

### PaddleOCR MCP Smoke

Smoke script 會從 `CONFIG_PATH`/`/data/librechat.yaml` 讀取同一份
`PaddleOCR` server config，包含 command、args、env、token interpolation 和
timeout。第一個 argument 傳入 fresh S3 smoke PDF URL：

```bash
PROD_HOST=139.59.110.150
SMOKE_URL="https://..."
ssh deploy@"$PROD_HOST" 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api /bin/sh /app/deploy/host/paddleocr-smoke.sh "$0"' "$SMOKE_URL"
```

Live OCR smoke 不要使用 local container path。

## 部署後手動驗證

`master` push deploy 後使用這段。`/health` 只證明 LibreChat site 已啟動；
PaddleOCR 必須另外用 fresh S3 smoke PDF URL 檢查。這個 manual smoke 同時驗證
S3 URL 可讀性與 PaddleOCR `fileUrl` OCR path。

本機 terminal 先設定 production target：

```bash
PROD_HOST=139.59.110.150
PROD_URL=https://chat.longdin.org
```

檢查最新 GitHub Actions deploy：

```bash
gh run list --workflow "Deploy Production" --branch master --limit 5
LATEST_DEPLOY_RUN_ID="$(gh run list --workflow "Deploy Production" --branch master --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$LATEST_DEPLOY_RUN_ID"
```

檢查 public 與 container-local health：

```bash
curl -fsS "$PROD_URL/health" && printf '\n'
ssh deploy@"$PROD_HOST" 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml exec -T api curl -fsS http://127.0.0.1:3080/health && printf "\n"'
```

只有 `/health` 正常後才跑 S3 + PaddleOCR live smoke。以下 command 會在
production API container 裡建立 tiny PDF，用 container 的 production S3 config
上傳，signed GET 驗證 presigned URL，再把該 fresh S3 URL 傳給
`paddleocr-smoke.sh`。

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

此 smoke 會呼叫 AI Studio，刻意保持手動。它用來診斷 OCR API/runtime health，不是
production deployment gate。不要用 local container path 當 production live smoke
input。smoke script 會從 `CONFIG_PATH` / `/data/librechat.yaml` 讀 PaddleOCR MCP
的 `command`、`args`、`env`、token placeholder 和 timeout，與 LibreChat 實際
MCP server 設定保持一致。

目前 production observation：

- `workflow-smoke.pdf` 曾透過 `paddleocr_vl` 約 214 秒完成；後續檢查顯示
  Droplet 到 AI Studio 偶發 connectivity 問題。
- `/data/smoke/b.png` 的 multipart upload 曾在 Singapore Droplet timeout；
  valid AWS S3 Sydney `ap-southeast-2` presigned `fileUrl` 也曾回 AI Studio
  `HTTP 400` code `10000` with `文件 URL 访问超时`。
- AWS S3 Hong Kong `ap-east-1` 對同一個 `b.png` 曾成功：AI Studio 接受
  `fileUrl`、回 job id、到 `done`，並產生 parsed table block。
- 較小的 `d.pdf` 在 AWS S3 Hong Kong `ap-east-1` 曾成功：454,807 byte PDF
  約 19 秒回 AI Studio job id，最後產生 73 KB JSON result。Production smoke
  優先使用精簡 PDF。

## GitHub Actions Auto Deploy

Production automation 定義於：

```text
.github/workflows/deploy-prod.yml
```

流程：

1. Push 到 `master`。
2. GitHub Actions build production `Dockerfile.multi` image。
3. GitHub Actions push image 到 GHCR。
4. GitHub Actions SSH 到 Droplet as `deploy`。
5. Droplet pull 新 image，執行 `docker compose up -d`。

Production workflow 啟用前，GitHub secrets 必須存在：

```text
DO_PROD_HOST=<droplet-ipv4-or-domain>
DO_PROD_USER=deploy
DO_PROD_SSH_KEY=<private deploy key for GitHub Actions only>
```

若 GHCR image 是 private，host 也需要 read token，且 token 必須存在 git 外。

目前 `chat.longdin.org` 設定：

```text
DO_PROD_HOST=139.59.110.150
DO_PROD_USER=deploy
DO_PROD_SSH_KEY=<private key matching ~/.ssh/librechat_do_prod_deploy_ed25519.pub>
```

對應 public key 已安裝在 Droplet 的
`/home/deploy/.ssh/authorized_keys`。

Workflow 使用 job-scoped `GITHUB_TOKEN` push GHCR image，並在 deploy 期間暫時讓
Droplet login GHCR。除非 package visibility 變更，否則不要新增 long-lived
`GHCR_READ_TOKEN`。

## 初次 Smoke Checks

從 Droplet：

```bash
curl -i http://127.0.0.1:3080/health
```

DNS / HTTPS 生效後從本機：

```bash
curl -i https://chat.<your-domain>/health
curl -i https://chat.<your-domain>/api/config
```

預期：

- `/health` 回 `200 OK`。
- `/api/config` 回 production domains JSON。
- `/steel/oauth-chat` 在 production 回 `404`。
- Production admin account 可以登入。
- Normal LibreChat chat 可以選到預期的 OpenAI provider path。
- `auth.json` 保持可寫入，且不存進 Docker image。

## Rollback

Droplet smoke checks 通過前，保留 Render。

Rollback options：

- DNS 指回 Render 或前一個 host。
- Droplet 修復期間繼續使用 Render generated URL。
- 若最新 image pull 後失敗，在 Droplet redeploy 前一個 GHCR image tag。

## Backups

至少備份：

```text
/etc/librechat/.env.prod
/data/librechat.yaml
/data/openai-oauth/auth.json
/data/uploads
/data/images
/data/skill
```

不要把這些 backups 存進 git。使用 encrypted local backup、DigitalOcean
Snapshots，或 private backup target。切換新 uploads 到 S3 後，仍要備份
`/data/uploads` 的 legacy local files，直到它們被 migrated 或確認不再需要。
