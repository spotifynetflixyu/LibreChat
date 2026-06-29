# DigitalOcean Droplet Production Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move production deployment from Render to a DigitalOcean Droplet with a user-owned domain.

**Architecture:** GitHub Actions builds the custom `Dockerfile.multi` production image from `master`, pushes it to GHCR, then SSHes into the Droplet to pull and restart a minimal Docker Compose stack. MongoDB Atlas and Supabase remain external production databases, while `/data` on the Droplet stores uploads, generated images, logs, `librechat.yaml`, shared skills, and writable OpenAI OAuth `auth.json`.

**Tech Stack:** DigitalOcean Droplet, Ubuntu LTS, Docker Compose, Caddy, GitHub Actions, GHCR, MongoDB Atlas, Supabase, LibreChat.

---

## Constraints

- Keep `main` reserved for upstream LibreChat updates.
- Keep `master` as the customized production branch.
- Do not commit `.env.prod`, `librechat.yaml`, `auth.json`, SSH keys, database passwords, OAuth tokens, or generated secrets.
- Keep production MongoDB Atlas and production Supabase separate from development.
- Do not enable an active production deploy workflow until the Droplet, SSH key, and GitHub secrets exist.
- Keep `/steel/oauth-chat` unavailable in production.

## Task 1: Document The Droplet Decision

**Files:**

- Create: `docs/deployment/digitalocean-droplet-prod-runbook.md`
- Modify: `docs/deployment/render-prod-runbook.md`
- Modify: `docs/deployment/local-terminal-user-bootstrap.md`
- Modify: `.env.prod.example`
- Modify: `tasks/todo.md`
- Modify: `tasks/lessons.md`

**Step 1: Add the DigitalOcean runbook**

Document:

- 2 GB Droplet minimum.
- User-owned domain with `chat.<domain>` preferred.
- Caddy HTTPS.
- Docker Compose runtime.
- `/data` persistent app files.
- `/etc/librechat/.env.prod`.
- MongoDB Atlas and Supabase external managed databases.
- `auth.json` and `librechat.yaml` upload commands.
- MongoDB Atlas Droplet IP allowlist.
- GitHub Actions deploy shape without enabling it yet.

**Step 2: Mark Render as rollback**

Add a short note at the top of the Render runbook saying it is retained as a
rollback/historical path and the current selected target is DigitalOcean
Droplet.

**Step 3: Generalize local user bootstrap wording**

Remove Render-only wording from `docs/deployment/local-terminal-user-bootstrap.md`
so the procedure applies to Droplet production too.

**Step 4: Update env template**

Change `.env.prod.example` placeholders from Render generated domain to custom
domain placeholders:

```env
PORT=3080
LIBRECHAT_DOMAIN=chat.<your-domain>
DOMAIN_CLIENT=https://chat.<your-domain>
DOMAIN_SERVER=https://chat.<your-domain>
```

Keep `RENDER_DATA_DIR=/data` while the current startup script still uses that
historical variable name.

**Step 5: Verify docs**

Run:

```bash
rtk rg -n -P "sk-|mongodb\\+srv://[^<]|postgresql://[^<]|refresh_token|access_token|BEGIN .*PRIVATE KEY" \
  docs/deployment docs/plans tasks/todo.md tasks/lessons.md .env.prod.example
rtk ruby -e 'files=%w[docs/deployment/digitalocean-droplet-prod-runbook.md docs/plans/2026-06-29-digitalocean-droplet-production-deployment.md docs/deployment/render-prod-runbook.md docs/deployment/local-terminal-user-bootstrap.md .env.prod.example tasks/todo.md tasks/lessons.md]; bad=files.flat_map { |f| File.readlines(f, chomp: true).each_with_index.filter_map { |line, i| "#{f}:#{i+1}" if line.match?(/[ \t]$/) } }; abort bad.join("\n") unless bad.empty?'
rtk git diff --check -- docs/deployment/digitalocean-droplet-prod-runbook.md docs/plans/2026-06-29-digitalocean-droplet-production-deployment.md docs/deployment/render-prod-runbook.md docs/deployment/local-terminal-user-bootstrap.md .env.prod.example tasks/todo.md tasks/lessons.md
```

Expected:

- Secret-pattern scan returns no real secrets.
- Trailing whitespace scan returns no output.
- `git diff --check` passes.

## Task 2: Prepare Host Runtime Files

**Files:**

- Create: `deploy-compose.prod.yml`
- Create: `deploy/digitalocean/Caddyfile`
- Optional create: `deploy/host/start.sh`
- Optional modify: `Dockerfile.multi`

**Step 1: Decide startup script shape**

Prefer a provider-neutral script:

```text
deploy/host/start.sh
```

If adding it, copy the current Render startup behavior and let it read:

```text
DATA_DIR=/data
CONFIG_PATH=/data/librechat.yaml
OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json
```

Keep `deploy/render/start.sh` available for Render rollback unless the Render
service is fully decommissioned.

**Step 2: Add Docker Compose**

The compose stack should include:

- `api` service using the GHCR production image.
- `caddy` service publishing `80` and `443`.
- bind mounts for `/data` paths.
- env file `/etc/librechat/.env.prod`.
- restart policy `unless-stopped`.

**Step 3: Add Caddyfile**

Use:

```caddyfile
{$LIBRECHAT_DOMAIN} {
  encode zstd gzip
  reverse_proxy api:3080
}
```

**Step 4: Validate compose**

Run:

```bash
LIBRECHAT_IMAGE=ghcr.io/<owner>/<image>:test \
LIBRECHAT_ENV_FILE=.env.prod.example \
rtk docker compose -f deploy-compose.prod.yml config
```

Expected:

- Compose resolves without syntax errors.
- No secrets are printed beyond placeholders.

## Task 3: Create The Droplet

**Files:**

- No repo files required unless recording the chosen domain/IP in a private
  operational note outside git.

**Step 1: Create Droplet**

Use Ubuntu LTS, Basic shared CPU, 2 GB RAM / 1 vCPU, SSH key auth, and hostname
`librechat-prod`.

**Step 2: Create DNS record**

Create:

```text
A chat.<your-domain> -> <droplet-ipv4>
```

**Step 3: Install host dependencies**

Install Docker, Docker Compose plugin, and UFW.

**Step 4: Create directories**

Create:

```text
/srv/librechat/app
/etc/librechat
/data/uploads
/data/images
/data/logs
/data/skill
/data/openai-oauth
```

**Step 5: Upload host files**

Upload:

```text
/etc/librechat/.env.prod
/data/librechat.yaml
/data/openai-oauth/auth.json
```

## Task 4: Add Production Auto Deploy

**Files:**

- Create: `.github/workflows/deploy-prod.yml`

**Step 1: Confirm GitHub secrets exist**

Required:

```text
DO_PROD_HOST
DO_PROD_USER
DO_PROD_SSH_KEY
```

Optional for private GHCR pulls:

```text
GHCR_READ_TOKEN
```

**Step 2: Add workflow**

Workflow should:

- Trigger on push to `master`.
- Build `Dockerfile.multi`.
- Push GHCR image tagged by commit SHA and `master`.
- SSH to the Droplet.
- Upload compose/Caddy files if they changed.
- Pull the new image.
- Run `docker compose up -d --remove-orphans`.
- Check `/health`.

**Step 3: Verify workflow syntax**

Run:

```bash
rtk ruby -e "require 'yaml'; YAML.load_file('.github/workflows/deploy-prod.yml'); puts 'ok'"
```

Expected:

```text
ok
```

## Task 5: Smoke Test Production

**Files:**

- Optional create: `scripts/prod-smoke.sh`

**Step 1: Host-local smoke**

Run on the Droplet:

```bash
curl -i http://127.0.0.1:3080/health
```

Expected:

```text
HTTP/1.1 200 OK
OK
```

**Step 2: Public smoke**

Run locally:

```bash
curl -i https://chat.<your-domain>/health
curl -i https://chat.<your-domain>/api/config
```

Expected:

- `/health` is 200.
- `/api/config` has the custom domain.

**Step 3: UI smoke**

Verify:

- Login with production admin.
- Registration is disabled.
- `/steel/oauth-chat` is 404 in production.
- Normal LibreChat chat loads.
- OpenAI OAuth route can read usage after login without exposing raw tokens.
- Uploads persist after container restart.

## Task 6: Decommission Or Keep Render

**Files:**

- Modify docs only after the Droplet is stable.

**Step 1: Keep Render during transition**

Do not delete Render until DNS, login, chat, uploads, OAuth, and admin actions
pass on the Droplet.

**Step 2: Decide rollback window**

After the Droplet has been stable for several days, choose:

- Keep Render paused as rollback if the account plan allows it.
- Delete Render service and disk after backing up any needed `/data` files.

**Step 3: Update docs**

If Render is decommissioned, update `docs/deployment/render-prod-runbook.md`
to say it is obsolete and no longer holds current production state.
