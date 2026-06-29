# AWS Lightsail Production Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the production deployment path for the customized LibreChat/Steel app on AWS Lightsail with a minimal runtime, host-persistent uploads, OpenAI OAuth host secrets, automatic redeploy from `master`, and production gating for `/steel/oauth-chat`.

**Architecture:** GitHub Actions builds the custom `Dockerfile.multi` `api-build` image from `master`, pushes it to GHCR, then SSHes into Lightsail to pull and restart a minimal compose stack. The Lightsail host runs only the custom app image plus a reverse proxy; MongoDB and Steel Postgres stay external through production `MONGO_URI` and `STEEL_POSTGRES_URL`. `/steel/oauth-chat` remains available in non-production only, with backend route gates and frontend route registration both keyed from production environment behavior.

**Tech Stack:** Docker Compose, GitHub Actions, GHCR, AWS Lightsail Linux, Caddy reverse proxy, MongoDB Atlas, Supabase cloud Postgres, OpenAI OAuth `auth.json`, Jest, Vite/React Router.

---

## Reference Inputs

- Design doc: `docs/plans/2026-06-29-aws-lightsail-low-cost-prod-design.md`
- Current compose to avoid copying directly: `deploy-compose.yml`
- Current Docker image target: `Dockerfile.multi` target `api-build`
- Current backend Steel route shell: `api/server/routes/steel/index.js`
- Current backend route tests: `api/server/routes/__tests__/steel.spec.js`
- Current frontend route registry: `client/src/routes/index.tsx`
- Existing frontend route test pattern: `client/src/routes/__tests__/skillsRoutes.spec.tsx`

## Non-Negotiable Boundaries

- Do not store uploads in Docker images or container writable layers.
- Do not commit production secrets, `.env` files, OAuth `auth.json`, GHCR tokens, DB passwords, or SSH keys.
- Do not use local MongoDB, local Steel Postgres, MeiliSearch, RAG API, or vector DB in the low-cost starting production compose.
- Keep `main` upstream-only. `master` is the production custom branch.
- Product traffic must use normal LibreChat chat and native `openai_oauth_responses`, not `/steel/oauth-chat`.
- `auth.json` must be writable by the app container because `openai-oauth-provider` refreshes access tokens and writes updated token data back to the file.

---

### Task 1: Lock Production Branch And Deployment Naming

**Files:**
- No file changes required.

**Step 1: Verify current branch and remotes**

Run:

```bash
rtk git status --short --branch
rtk git remote -v
```

Expected:

- Current work is on the Steel/custom branch that should seed production.
- `origin` points to `git@github.com:spotifynetflixyu/LibreChat.git`.
- `upstream` points to `https://github.com/danny-avila/LibreChat.git`.

**Step 2: Create or update `master` only after the current worktree is clean**

Run only after unrelated local changes are either committed or intentionally left out:

```bash
rtk git switch -c master
rtk git push -u origin master
```

If `master` already exists:

```bash
rtk git switch master
rtk git merge --ff-only <production-ready-branch>
rtk git push origin master
```

Expected:

- `origin/master` exists and points to the current production-ready Steel build.
- `main` is not modified.

**Step 3: Commit**

No commit is needed for this operational task unless branch metadata changes are documented elsewhere.

---

### Task 2: Add Backend Production Gate For Standalone Steel OAuth Chat APIs

**Files:**
- Modify: `api/server/routes/steel/index.js`
- Modify: `api/server/routes/__tests__/steel.spec.js`

**Step 1: Write failing backend route tests**

Add tests proving production blocks standalone `/steel/oauth-chat` backing APIs while preserving normal production Steel APIs.

In `api/server/routes/__tests__/steel.spec.js`, add helpers:

```js
async function withNodeEnv(value, testFn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await testFn();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}
```

Add failing tests:

```js
it('blocks standalone Steel OAuth chat APIs in production', async () =>
  withNodeEnv('production', async () => {
    const app = createApp();

    const chatRes = await request(app)
      .post('/api/steel/ai/chat')
      .send({ messages: [{ role: 'user', content: 'dev probe' }] });
    const streamRes = await request(app)
      .post('/api/steel/ai/chat/stream')
      .send({ messages: [{ role: 'user', content: 'dev probe' }] });
    const createRes = await request(app)
      .post('/api/steel/conversations/authenticated')
      .send({ libreChatConversationId: 'lc_1' });
    const guestRes = await request(app)
      .post('/api/steel/conversations/guest')
      .send({ libreChatConversationId: 'lc_guest_1' });
    const readRes = await request(app).get('/api/steel/conversations/steel_meta_1');
    const messagesRes = await request(app).get('/api/steel/conversations/steel-chat-1/messages');

    expect(chatRes.status).toBe(404);
    expect(streamRes.status).toBe(404);
    expect(createRes.status).toBe(404);
    expect(guestRes.status).toBe(404);
    expect(readRes.status).toBe(404);
    expect(messagesRes.status).toBe(404);
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockStreamChat).not.toHaveBeenCalled();
    expect(mockCreateAuthenticatedConversation).not.toHaveBeenCalled();
    expect(mockCreateGuestConversation).not.toHaveBeenCalled();
    expect(mockReadConversation).not.toHaveBeenCalled();
    expect(mockReadConversationMessages).not.toHaveBeenCalled();
  }));

it('keeps OpenAI OAuth usage available in production', async () =>
  withNodeEnv('production', async () => {
    const app = createApp();

    const res = await request(app).get('/api/steel/ai/oauth-usage');

    expect(res.status).toBe(200);
    expect(mockReadOpenAIOAuthUsage).toHaveBeenCalledTimes(1);
  }));
```

Run:

```bash
cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false --testNamePattern "production"
```

Expected:

- The new production block test fails because the routes still reach handlers.
- The usage endpoint test passes or fails only because the production gate has not been implemented yet.

**Step 2: Implement the backend gate**

In `api/server/routes/steel/index.js`, add:

```js
function isSteelOAuthChatDevRouteEnabled(env = process.env) {
  return env.NODE_ENV !== 'production';
}

function requireSteelOAuthChatDevRoute(req, res, next) {
  if (isSteelOAuthChatDevRouteEnabled()) {
    next();
    return;
  }

  res.status(404).json({ message: 'Not found' });
}
```

Apply the middleware only to the standalone dev-chat surface:

```js
router.post(
  '/conversations/authenticated',
  requireSteelOAuthChatDevRoute,
  requireJwtAuth,
  handlers.createAuthenticatedConversation,
);
router.post(
  '/conversations/guest',
  requireSteelOAuthChatDevRoute,
  handlers.createGuestConversation,
);
router.get(
  '/conversations/:conversationId/messages',
  requireSteelOAuthChatDevRoute,
  requireJwtAuth,
  handlers.readConversationMessages,
);
router.get(
  '/conversations/:conversationMetaId',
  requireSteelOAuthChatDevRoute,
  requireJwtUnlessGuestToken,
  handlers.readConversation,
);
router.post('/ai/chat', requireSteelOAuthChatDevRoute, requireJwtAuth, handlers.chat);
router.post(
  '/ai/chat/stream',
  requireSteelOAuthChatDevRoute,
  requireJwtAuth,
  steelAsyncRoute(handlers.streamChat),
);
```

Do not gate these routes:

- `GET /api/steel/ai/oauth-usage`
- `GET /api/steel/ai/models`
- `POST /api/steel/rule-proposals`
- `/api/admin/steel/*`

**Step 3: Verify backend route tests pass**

Run:

```bash
cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false
```

Expected:

- All Steel route shell tests pass.
- Production standalone chat routes return 404.
- OAuth usage remains available.

**Step 4: Commit**

```bash
rtk git add api/server/routes/steel/index.js api/server/routes/__tests__/steel.spec.js
rtk git commit -m "fix: gate Steel OAuth chat in production"
```

---

### Task 3: Add Frontend Production Gate For `/steel/oauth-chat`

**Files:**
- Modify: `client/src/routes/index.tsx`
- Modify: `client/src/routes/__tests__/skillsRoutes.spec.tsx`

**Step 1: Write failing frontend route tests**

In `client/src/routes/__tests__/skillsRoutes.spec.tsx`, add a pure route-gate import after the existing router import:

```ts
import { shouldRegisterSteelOAuthChatRoute } from '../index';
```

Add tests:

```ts
describe('Steel OAuth chat route gate', () => {
  it('registers the route in development', () => {
    expect(shouldRegisterSteelOAuthChatRoute(true)).toBe(true);
  });

  it('does not register the route in production', () => {
    expect(shouldRegisterSteelOAuthChatRoute(false)).toBe(false);
  });
});
```

Run:

```bash
cd client && rtk npx jest src/routes/__tests__/skillsRoutes.spec.tsx --runInBand --watch=false --coverage=false --testNamePattern "Steel OAuth chat route gate"
```

Expected:

- Test fails because `shouldRegisterSteelOAuthChatRoute` does not exist.

**Step 2: Implement frontend route gate and remove static production import**

In `client/src/routes/index.tsx`:

Remove:

```ts
import SteelOAuthChat from './SteelOAuthChat';
```

Add:

```ts
const loadSteelOAuthChat = () =>
  import('./SteelOAuthChat').then((m) => ({
    Component: m.default,
  }));

export function shouldRegisterSteelOAuthChatRoute(isDevelopment = import.meta.env.DEV): boolean {
  return isDevelopment;
}

const steelOAuthChatRoutes = shouldRegisterSteelOAuthChatRoute()
  ? [
      {
        path: 'steel/oauth-chat',
        lazy: loadSteelOAuthChat,
      },
    ]
  : [];
```

Replace the inline route:

```ts
{
  path: 'steel/oauth-chat',
  element: <SteelOAuthChat />,
},
```

with:

```ts
...steelOAuthChatRoutes,
```

This keeps the development page available during Vite dev and Jest development mode, but excludes it from production route registration and avoids a static production bundle import.

**Step 3: Verify frontend route tests**

Run:

```bash
cd client && rtk npx jest src/routes/__tests__/skillsRoutes.spec.tsx --runInBand --watch=false --coverage=false
```

Expected:

- Existing skills route test still passes.
- New gate tests pass.

**Step 4: Verify production client build**

Run:

```bash
rtk npm run build:client
```

Expected:

- Vite production build succeeds.
- No route registration error for `/steel/oauth-chat`.

**Step 5: Commit**

```bash
rtk git add client/src/routes/index.tsx client/src/routes/__tests__/skillsRoutes.spec.tsx
rtk git commit -m "fix: hide Steel OAuth chat route in production"
```

---

### Task 4: Add Minimal Production Compose Stack

**Files:**
- Create: `deploy-compose.prod.yml`
- Create: `deploy/lightsail/Caddyfile`

**Step 1: Create production compose file**

Create `deploy-compose.prod.yml`:

```yaml
services:
  api:
    image: ${LIBRECHAT_IMAGE:-ghcr.io/spotifynetflixyu/librechat-prod-api:master}
    container_name: librechat-prod-api
    restart: unless-stopped
    env_file:
      - ${LIBRECHAT_ENV_FILE:-/etc/librechat/.env.prod}
    environment:
      - HOST=0.0.0.0
      - NODE_ENV=production
      - PORT=3080
      - SEARCH=false
      - MEILI_HOST=
      - MEILI_MASTER_KEY=
      - MEILI_NO_SYNC=true
      - OPENAI_OAUTH_AUTH_FILE=/var/secrets/openai-oauth/auth.json
    expose:
      - "3080"
    volumes:
      - /etc/librechat/librechat.yaml:/app/librechat.yaml:ro
      - /srv/librechat/uploads:/app/uploads
      - /srv/librechat/images:/app/client/public/images
      - /srv/librechat/logs:/app/api/logs
      - /srv/librechat/skill:/app/skill
      - /var/secrets/openai-oauth:/var/secrets/openai-oauth

  caddy:
    image: caddy:2.8-alpine
    container_name: librechat-prod-caddy
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - "80:80"
      - "443:443"
    environment:
      - LIBRECHAT_DOMAIN=${LIBRECHAT_DOMAIN}
    volumes:
      - ./deploy/lightsail/Caddyfile:/etc/caddy/Caddyfile:ro
      - /srv/librechat/caddy/data:/data
      - /srv/librechat/caddy/config:/config
```

Do not include services for `mongodb`, `meilisearch`, `vectordb`, or `rag_api`.

**Step 2: Create Caddyfile**

Create `deploy/lightsail/Caddyfile`:

```caddyfile
{$LIBRECHAT_DOMAIN} {
	encode zstd gzip

	respond /steel/oauth-chat* 404

	reverse_proxy api:3080
}
```

**Step 3: Verify compose config parses**

Run with placeholder env only:

```bash
LIBRECHAT_DOMAIN=example.com \
LIBRECHAT_IMAGE=ghcr.io/spotifynetflixyu/librechat-prod-api:test \
LIBRECHAT_ENV_FILE=.env.prod.example \
rtk docker compose -f deploy-compose.prod.yml config
```

Expected:

- Compose renders successfully.
- Rendered services include only `api` and `caddy`.

**Step 4: Commit**

```bash
rtk git add deploy-compose.prod.yml deploy/lightsail/Caddyfile
rtk git commit -m "chore: add Lightsail production compose stack"
```

---

### Task 5: Add Host Setup Runbook And Production Env Template

**Files:**
- Create: `docs/deployment/aws-lightsail-prod-runbook.md`
- Create: `.env.prod.example`

**Step 1: Create production env example**

Create `.env.prod.example` with placeholders only:

```env
LIBRECHAT_DOMAIN=chat.example.com
LIBRECHAT_IMAGE=ghcr.io/spotifynetflixyu/librechat-prod-api:master
LIBRECHAT_ENV_FILE=/etc/librechat/.env.prod

NODE_ENV=production
HOST=0.0.0.0
PORT=3080

DOMAIN_CLIENT=https://chat.example.com
DOMAIN_SERVER=https://chat.example.com

# Use production-only database resources. Prefer a separate MongoDB Atlas
# project/cluster and a separate Supabase project for production. Do not point
# production at development data.
MONGO_URI=mongodb+srv://<prod-user>:<prod-password>@<prod-cluster>/<prod-db>
STEEL_POSTGRES_URL=postgresql://<prod-user>:<prod-password>@<prod-supabase-host>:5432/postgres

OPENAI_DEFAULT_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=medium
OPENAI_OAUTH_AUTH_FILE=/var/secrets/openai-oauth/auth.json

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

Do not include real secrets.

**Step 2: Create host setup runbook**

Create `docs/deployment/aws-lightsail-prod-runbook.md` with these sections:

- Lightsail instance: 2 vCPU / 2 GB RAM / 60 GB SSD / public IPv4.
- Firewall: open `22`, `80`, `443`; do not expose `3080`.
- Docker install.
- Swap setup:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

- Directory setup:

```bash
sudo mkdir -p /srv/librechat/{uploads,images,logs,skill,caddy/data,caddy/config,app}
sudo mkdir -p /etc/librechat
sudo mkdir -p /var/secrets/openai-oauth
```

- Copy files to host:

```bash
scp deploy-compose.prod.yml deploy@<host>:/srv/librechat/app/deploy-compose.prod.yml
scp -r deploy/lightsail deploy@<host>:/srv/librechat/app/deploy
scp .env.prod.example deploy@<host>:/tmp/.env.prod.example
```

- Create `/etc/librechat/.env.prod` from the example using real production values.
- Create `/etc/librechat/librechat.yaml` with at least:

```yaml
version: 1.3.11
```

- Install OAuth auth file:

```bash
scp ~/.codex/auth.json deploy@<host>:/tmp/openai-auth.json
sudo install -m 600 /tmp/openai-auth.json /var/secrets/openai-oauth/auth.json
sudo rm /tmp/openai-auth.json
```

- Make the OAuth file writable by the container runtime user. If the image runs as root, `0600 root:root` works. If the image later runs as a non-root user, update ownership explicitly and keep permissions narrow.
- Log into GHCR on the host if the image is private:

```bash
echo '<ghcr-read-token>' | docker login ghcr.io -u '<github-user>' --password-stdin
```

- Start:

```bash
cd /srv/librechat/app
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml up -d
```

- Create the first admin account:

```bash
cd /srv/librechat/app
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml exec api \
  npm run create-user -- admin@example.com "Admin" admin
```

- Keep `ALLOW_REGISTRATION=false`; the trusted server-side script can create
  accounts without opening public registration. The first registered user in a
  clean production MongoDB becomes `ADMIN`; later accounts become `USER`.

- Verify:

```bash
curl -fsS http://127.0.0.1:3080/api/config >/dev/null
curl -fsS https://<domain>/api/config >/dev/null
```

**Step 3: Verify documentation does not contain real secrets**

Run:

```bash
rtk rg -n "sk-|mongodb\\+srv://[^<]|postgresql://[^<]|refresh_token|access_token|BEGIN .*PRIVATE KEY" docs/deployment docs/plans/2026-06-29-aws-lightsail-prod-implementation.md
```

Expected:

- No real secrets found.
- Placeholder URLs with `<...>` may be present.

**Step 4: Commit**

```bash
rtk git add docs/deployment/aws-lightsail-prod-runbook.md .env.prod.example
rtk git commit -m "docs: add Lightsail production host runbook"
```

---

### Task 6: Add GitHub Actions Production Build And Redeploy Workflow

**Files:**
- Create: `.github/workflows/deploy-prod.yml`

**Step 1: Create workflow**

Create `.github/workflows/deploy-prod.yml`:

```yaml
name: Deploy Production

on:
  workflow_dispatch:
  push:
    branches:
      - master
    paths:
      - api/**
      - client/**
      - packages/**
      - config/**
      - skill/**
      - Dockerfile.multi
      - deploy-compose.prod.yml
      - deploy/lightsail/**
      - package.json
      - package-lock.json

permissions:
  contents: read
  packages: write

concurrency:
  group: deploy-production-${{ github.ref }}
  cancel-in-progress: true

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/librechat-prod-api

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Prepare build env
        run: cp .env.example .env

      - name: Compute build metadata
        run: |
          echo "BUILD_COMMIT=${GITHUB_SHA}" >> "$GITHUB_ENV"
          echo "BUILD_BRANCH=${GITHUB_REF_NAME}" >> "$GITHUB_ENV"
          echo "BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$GITHUB_ENV"

      - name: Build and push production image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile.multi
          target: api-build
          platforms: linux/amd64
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:${{ github.sha }}
            ${{ env.IMAGE_NAME }}:master
          build-args: |
            BUILD_COMMIT=${{ env.BUILD_COMMIT }}
            BUILD_BRANCH=${{ env.BUILD_BRANCH }}
            BUILD_DATE=${{ env.BUILD_DATE }}

      - name: Install SSH key
        uses: shimataro/ssh-key-action@v2
        with:
          key: ${{ secrets.LIGHTSAIL_SSH_PRIVATE_KEY }}
          known_hosts: ${{ secrets.LIGHTSAIL_KNOWN_HOSTS }}

      - name: Redeploy on Lightsail
        env:
          LIGHTSAIL_HOST: ${{ secrets.LIGHTSAIL_HOST }}
          LIGHTSAIL_USER: ${{ secrets.LIGHTSAIL_USER }}
        run: |
          ssh "${LIGHTSAIL_USER}@${LIGHTSAIL_HOST}" <<'EOF'
          set -euo pipefail
          cd /srv/librechat/app
          docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml pull api
          docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml up -d --remove-orphans
          docker image prune -f
          curl -fsS http://127.0.0.1:3080/api/config >/dev/null
          EOF
```

Required GitHub secrets:

- `LIGHTSAIL_HOST`
- `LIGHTSAIL_USER`
- `LIGHTSAIL_SSH_PRIVATE_KEY`
- `LIGHTSAIL_KNOWN_HOSTS`

Production app secrets are intentionally not stored in GitHub Actions. They live on the host in `/etc/librechat/.env.prod` and `/var/secrets/openai-oauth/auth.json`.

**Step 2: Verify workflow syntax**

Run:

```bash
rtk ruby -e "require 'yaml'; YAML.load_file('.github/workflows/deploy-prod.yml'); puts 'ok'"
```

Expected:

- Workflow YAML parses.

**Step 3: Commit**

```bash
rtk git add .github/workflows/deploy-prod.yml
rtk git commit -m "ci: deploy production from master"
```

---

### Task 7: Add Deployment Smoke Verification Script

**Files:**
- Create: `scripts/prod-smoke.sh`

**Step 1: Create smoke script**

Create `scripts/prod-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?usage: scripts/prod-smoke.sh https://chat.example.com}"

curl -fsS "${base_url}/api/config" >/dev/null

status="$(curl -s -o /dev/null -w '%{http_code}' "${base_url}/steel/oauth-chat")"
if [ "$status" != "404" ]; then
  echo "expected /steel/oauth-chat to be unavailable, got HTTP ${status}" >&2
  exit 1
fi

api_status="$(
  curl -s -o /dev/null -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"dev probe"}]}' \
    "${base_url}/api/steel/ai/chat"
)"
if [ "$api_status" != "404" ]; then
  echo "expected /api/steel/ai/chat to be unavailable, got HTTP ${api_status}" >&2
  exit 1
fi
```

Make it executable:

```bash
chmod +x scripts/prod-smoke.sh
```

**Step 2: Verify local shell syntax**

Run:

```bash
rtk bash -n scripts/prod-smoke.sh
```

Expected:

- No shell syntax errors.

**Step 3: Commit**

```bash
rtk git add scripts/prod-smoke.sh
rtk git commit -m "chore: add production smoke script"
```

---

### Task 8: End-To-End Verification Before First Production Deploy

**Files:**
- No new files.

**Step 1: Run focused backend tests**

Run:

```bash
cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false
```

Expected:

- All Steel route shell tests pass.

**Step 2: Run focused frontend route tests**

Run:

```bash
cd client && rtk npx jest src/routes/__tests__/skillsRoutes.spec.tsx --runInBand --watch=false --coverage=false
```

Expected:

- Skills route test and Steel OAuth route gate tests pass.

**Step 3: Build API package and client**

Run:

```bash
rtk npm run build:api
rtk npm run build:client
```

Expected:

- Both builds pass.

**Step 4: Render production compose**

Run:

```bash
LIBRECHAT_DOMAIN=example.com \
LIBRECHAT_IMAGE=ghcr.io/spotifynetflixyu/librechat-prod-api:test \
LIBRECHAT_ENV_FILE=.env.prod.example \
rtk docker compose -f deploy-compose.prod.yml config
```

Expected:

- Compose config includes only `api` and `caddy`.
- No local database/search/RAG services are present.

**Step 5: Docker build sanity check**

Run:

```bash
rtk docker build --target api-build -f Dockerfile.multi -t librechat-prod-api:test .
```

Expected:

- Image builds locally, or if local Docker resources are insufficient, record that GH Actions is the authoritative build verification.

**Step 6: Diff hygiene**

Run:

```bash
rtk git diff --check
```

Expected:

- No whitespace errors.

**Step 7: First remote deploy verification**

After pushing `master`, verify on the host:

```bash
ssh deploy@<host> 'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"'
ssh deploy@<host> 'test -d /srv/librechat/uploads && test -f /var/secrets/openai-oauth/auth.json'
curl -fsS https://<domain>/api/config >/dev/null
scripts/prod-smoke.sh https://<domain>
```

Expected:

- `librechat-prod-api` and `librechat-prod-caddy` are running.
- `/api/config` is healthy.
- `/steel/oauth-chat` is unavailable in production.
- `/api/steel/ai/chat` is unavailable in production.
- Upload directory and OAuth auth file exist.

**Step 8: Commit**

No commit if this task only verifies previously committed implementation.

---

## Rollback Plan

If production deploy fails after image pull:

```bash
ssh deploy@<host>
cd /srv/librechat/app
LIBRECHAT_IMAGE=ghcr.io/spotifynetflixyu/librechat-prod-api:<previous-sha> \
  docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml up -d
```

If OAuth auth fails:

1. Re-run Codex/OpenAI OAuth login on a trusted machine.
2. Copy the new `auth.json` to `/var/secrets/openai-oauth/auth.json`.
3. Restart the API container:

```bash
docker compose --env-file /etc/librechat/.env.prod -f /srv/librechat/app/deploy-compose.prod.yml restart api
```

If uploads disappear after deploy:

1. Stop deploy rollout.
2. Confirm compose still binds `/srv/librechat/uploads:/app/uploads`.
3. Restore from `/srv/librechat` backup or Lightsail snapshot.

## Security Review Checklist

- No secrets committed in repo files.
- `.env.prod.example` contains placeholders only.
- GitHub Actions secrets contain only deploy SSH material, not database URLs or OAuth tokens.
- Production DB URLs live only on the host in `/etc/librechat/.env.prod`.
- OAuth `auth.json` lives only on the host and is writable only by the runtime path that refreshes it.
- API port `3080` is not exposed publicly.
- Lightsail firewall exposes only SSH, HTTP, and HTTPS.
- `/steel/oauth-chat` frontend route and backing chat APIs are blocked in production.
- Normal authenticated OAuth usage endpoint remains available and sanitized.

## Completion Criteria

This plan is complete when:

- `master` exists on `origin`.
- Pushing `master` builds and deploys the production image.
- Production compose uses the custom GHCR image and no local DB/search/RAG services.
- Production host stores uploads in `/srv/librechat/uploads`.
- Production host uses prod `MONGO_URI` and prod `STEEL_POSTGRES_URL`.
- OpenAI OAuth works through native LibreChat chat.
- `/steel/oauth-chat` is unavailable in production.
- A redeploy preserves an uploaded file.
