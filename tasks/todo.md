# Active: Production PaddleOCR persistent venv and c.pdf smoke

Goal: move production PaddleOCR MCP from image-build `uvx` prewarm to a
persistent `/data/paddleocr/venv` on the Droplet, prove the MCP server starts
without crashing, and run a live `c.pdf` smoke check.

Plan - 2026-06-29:

- [x] Remove the Docker build-time `uvx` PaddleOCR prewarm layer while keeping
      Debian/glibc, `uv`, Python 3.12 defaults, and OpenCV runtime libraries.
- [x] Add production startup preparation for `/data/paddleocr/venv`, including
      install-on-missing, import prewarm, and a short MCP server start check.
- [x] Add a host-run `c.pdf` smoke script that connects to the persistent MCP
      server command through stdio and calls `paddleocr_vl`.
- [x] Update the deploy workflow to upload the smoke script and allow the
      longer first startup caused by venv creation.
- [x] Update local/host-managed MCP config and deployment docs for the
      persistent venv boundary.
- [x] Verify locally, push `master`, update the Droplet config, wait for
      production deploy, then run short-start and `c.pdf` smoke checks on the
      Droplet.

Local review - 2026-06-29:

- Removed the build-time `uvx --python 3.12 --from paddleocr-mcp` prewarm from
  `Dockerfile.multi`; the image still includes Debian/glibc runtime libraries
  and `uv`.
- Added `/data/paddleocr/venv` startup preparation to `deploy/host/start.sh`,
  including install-on-missing, import prewarm, and a short MCP server startup
  smoke.
- Added `deploy/host/paddleocr-smoke.sh` for manual live `c.pdf` MCP smoke on
  the Droplet.
- Updated the production workflow to upload the smoke script and `c.pdf`, and
  extended the health loop for first-time venv creation.
- First GitHub Actions deploy run `28376451869` built and pushed the image, but
  failed in the upload step because `docs/reference/example/c.pdf` is ignored
  by git and unavailable in a clean checkout.
- Updated after user correction: workflow still runs a real PaddleOCR OCR smoke
  after deploy, but uses the tracked lightweight
  `deploy/host/fixtures/workflow-smoke.pdf`; the full `c.pdf` drawing smoke
  uses the local ignored `docs/reference/example/c.pdf` uploaded manually to
  `/data/smoke/c.pdf`.
- Updated `deploy-compose.prod.yml` health start period, `.env.prod.example`,
  `.mcp.json`, ignored local `librechat.yaml`, deployment docs, plan docs, and
  lessons for the persistent venv production boundary.
- Local verification passed:
  - `rtk sh -n deploy/host/start.sh && rtk sh -n deploy/host/paddleocr-smoke.sh`
  - `.mcp.json` JSON parse
  - `librechat.yaml` and workflow YAML parse
  - `docker compose -f deploy-compose.prod.yml config --quiet`
  - `rtk actionlint .github/workflows/deploy-prod.yml`
  - `rtk git diff --check`
- Droplet verification:
  - Uploaded host-managed `/data/librechat.yaml` with
    `command: /data/paddleocr/venv/bin/paddleocr_mcp` and required `args: []`.
  - Added a host bind mount for `deploy/host` so startup and smoke scripts can
    be hotfixed without waiting for a full image rebuild.
  - Fixed startup prewarm env so direct MCP startup uses AI Studio instead of
    defaulting to local PaddleOCR inference.
  - Persisted uv's Python install dir under `/data/paddleocr/python`; verified
    `/data/paddleocr/venv/bin/python` resolves there and `import paddleocr_mcp`
    succeeds.
  - Verified startup creates/reuses `/data/paddleocr/venv` and the short MCP
    server smoke survives until timeout status `124`.
  - Verified container and public health return `OK`.
  - Verified lightweight real PaddleOCR OCR smoke on
    `/data/smoke/workflow-smoke.pdf` passes in `213519` ms and matches
    `Workflow` / `Upload`.
  - Uploaded local ignored `docs/reference/example/c.pdf` to
    `/data/smoke/c.pdf` and verified SHA256
    `85797cab1061081acbd03ad3ea94bef7c7fce2cc7b155b8f5229ed829dd234a2`.
  - Full `c.pdf` smoke does not pass through `paddleocr-mcp` AI Studio API:
    lighter markdown mode returned `Error calling tool 'paddleocr_vl'` after
    about `190450` ms, and detailed error capture showed aiohttp
    `ClientOSError: [Errno 32] Broken pipe`.

---

# Previous: Fix production PaddleOCR MCP runtime

Goal: make the DigitalOcean production API image able to start PaddleOCR MCP
reliably for Steel PDF/image OCR instead of falling back to native PDF text
parsing only.

Plan - 2026-06-29:

- [x] Confirm the production failure mode from host/container state and logs.
- [x] Move the production API runtime image off Alpine/musl so
      `opencv-contrib-python` can use prebuilt wheels.
- [x] Pin PaddleOCR MCP to Python 3.12 and prewarm the `uvx` environment during
      image build to avoid first-request connection timeout.
- [x] Upload the updated `librechat.yaml` to the Droplet because `/data` config
      is intentionally host-managed.
- [x] Build/deploy through GitHub Actions and verify PaddleOCR MCP can start.
- [x] Smoke-check `https://chat.longdin.org/health` after deploy.
- [x] Raise PaddleOCR AI Studio request/poll/http timeouts after `c.pdf`
      exceeded the package default request timeout.

Review - 2026-06-29:

- Production logs showed the original startup failure was Alpine/musl forcing
  `opencv-contrib-python` source builds inside `paddleocr-mcp`.
- Switched the production API runtime stage in `Dockerfile.multi` to Debian
  bookworm slim and prewarmed `uvx --python 3.12 --from paddleocr-mcp`.
- Uploaded host-managed `/data/librechat.yaml` with `--python 3.12`.
- GitHub Actions production deploy `28371678489` completed successfully for
  commit `ee1a63974`.
- Verified `https://chat.longdin.org/health` returned `OK`.
- Verified the production container imports `paddleocr_mcp` and can start the
  MCP stdio command without OpenCV/distutils errors.
- Follow-up `paddleocr_vl` call reached AI Studio but timed out around the
  package default `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT=120` seconds on
  `c.pdf`.
- Raised host-managed PaddleOCR timeout config to request `600` seconds,
  poll `1200` seconds, and HTTP `1200` seconds, then recreated the API
  container and verified health returned `OK`.

---

# Previous: GitHub Actions production deploy workflow

Goal: add a `master` push workflow that builds the customized LibreChat
production image, pushes it to GHCR, SSHes to the DigitalOcean Droplet, and
redeploys the Compose stack.

Plan - 2026-06-29:

- [x] Add `.github/workflows/deploy-prod.yml`.
- [x] Build `Dockerfile.multi` target `api-build` for `linux/amd64`.
- [x] Push GHCR tags `master` and `${{ github.sha }}`.
- [x] Use the existing Droplet SSH secrets to upload Compose/Caddy/start files.
- [x] Use the job-scoped `GITHUB_TOKEN` for remote GHCR login instead of adding
      a long-lived `GHCR_READ_TOKEN`.
- [x] Redeploy the Droplet with `docker compose up -d --remove-orphans`.
- [x] Verify local Droplet health and run a best-effort public URL smoke check.
- [x] Validate workflow syntax and action semantics before commit.

Review - 2026-06-29:

- Added `.github/workflows/deploy-prod.yml` with `push` on `master` and manual
  `workflow_dispatch`.
- Workflow permissions are limited to `contents: read` and `packages: write`.
- Workflow builds/pushes `ghcr.io/spotifynetflixyu/librechat-prod-api:master`
  and `ghcr.io/spotifynetflixyu/librechat-prod-api:${{ github.sha }}`.
- Workflow uploads `deploy-compose.prod.yml`, `deploy/host/start.sh`, and
  `deploy/digitalocean/Caddyfile` to `/srv/librechat/app` on the Droplet.
- Workflow logs the Droplet into GHCR with the job-scoped `GITHUB_TOKEN` for
  the immediate pull, avoiding a long-lived `GHCR_READ_TOKEN`.
- Workflow checks `http://127.0.0.1:3080/health` on the Droplet as the required
  deploy gate from inside the API container and runs
  `https://chat.longdin.org/health` as a best-effort public smoke check.
- Updated `docs/deployment/digitalocean-droplet-prod-runbook.md` to reference
  the workflow and its GHCR token behavior.
- Verification:
  - `rtk ruby -e "require 'yaml'; YAML.load_file('.github/workflows/deploy-prod.yml'); puts 'yaml-ok'"`
    returned `yaml-ok`.
  - `rtk actionlint .github/workflows/deploy-prod.yml` passed.
  - `rtk env LIBRECHAT_ENV_FILE=.env.prod.example LIBRECHAT_IMAGE=ghcr.io/spotifynetflixyu/librechat-prod-api:test PORT=3080 docker compose -f deploy-compose.prod.yml config --quiet`
    passed.
  - `rtk sh -n deploy/host/start.sh && rtk bash -n deploy/host/start.sh`
    passed.
  - First workflow run proved build/push/upload/deploy worked, but exposed that
    host port `3080` is intentionally not published. The workflow health gate
    was corrected to run `docker compose exec -T api curl ...` inside the API
    container.
  - `https://chat.longdin.org/health` returned `OK` after the first deploy.

---

# Previous: GitHub Actions production deploy secrets

Goal: configure GitHub Actions repository secrets so the future production
workflow can SSH to the DigitalOcean Droplet as `deploy`.

Plan - 2026-06-29:

- [x] Install GitHub CLI.
- [x] Log out of the wrong GitHub account and log in as `spotifynetflixyu`.
- [x] Confirm `spotifynetflixyu` has admin permission on
      `spotifynetflixyu/LibreChat`.
- [x] Generate a GitHub Actions-only SSH deploy key.
- [x] Install the deploy key public key on the Droplet `deploy` user.
- [x] Create required GitHub Actions secrets.
- [x] Verify the deploy key can SSH and run remote Compose config.

Review - 2026-06-29:

- Installed GitHub CLI `gh` with Homebrew.
- Logged out `nevenhsu` and logged in as `spotifynetflixyu`.
- Confirmed `spotifynetflixyu/LibreChat` permission is `ADMIN`.
- Generated local private key
  `~/.ssh/librechat_do_prod_deploy_ed25519` and installed the matching public
  key on the Droplet `deploy` user's `authorized_keys`.
- Created GitHub Actions secrets in `spotifynetflixyu/LibreChat`:
  `DO_PROD_HOST`, `DO_PROD_USER`, and `DO_PROD_SSH_KEY`.
- Did not create `GHCR_READ_TOKEN` yet; decide after the production workflow
  confirms whether the package pull needs a private GHCR token.
- Verification:
  - `gh secret list --repo spotifynetflixyu/LibreChat --app actions` shows the
    three required secrets.
  - SSH with `~/.ssh/librechat_do_prod_deploy_ed25519` to
    `deploy@139.59.110.150` succeeded.
  - Remote `docker compose -f deploy-compose.prod.yml config --quiet` passed.

---

# Previous: DigitalOcean Droplet host bootstrap

Goal: prepare the DigitalOcean Droplet at `139.59.110.150` to run the
customized LibreChat production app under `chat.longdin.org`.

Plan - 2026-06-29:

- [x] Verify root SSH access to the Droplet.
- [x] Create the `deploy` user, copy SSH access, and grant sudo/docker access.
- [x] Install Docker Engine, Docker Compose plugin, and UFW.
- [x] Create `/srv/librechat/app`, `/etc/librechat`, and `/data` runtime
      directories with production-safe ownership.
- [x] Enable firewall rules for SSH, HTTP, and HTTPS only.
- [x] Add a 2 GB swap file for the 2 GB RAM Droplet.
- [x] Upload local `.env.prod`, `librechat.yaml`, and OpenAI OAuth `auth.json`
      to the host without printing secret contents.
- [x] Add and upload production Compose, Caddy, and provider-neutral startup
      files.
- [x] Verify Docker, deploy-user SSH, firewall status, host resources,
      `auth.json` JSON validity, and remote Compose config.

Review - 2026-06-29:

- Root SSH to `139.59.110.150` succeeded; host reports `librechat-prod`.
- Created `deploy` user, copied authorized SSH keys, and added it to `sudo` and
  `docker` groups.
- Installed Docker `29.6.1` and Docker Compose plugin `v5.2.0`.
- Enabled UFW with only `OpenSSH`, `80/tcp`, and `443/tcp` allowed.
- Created a persistent 2 GB `/swapfile` and added it to `/etc/fstab`.
- Created `/srv/librechat/app`, `/etc/librechat`, `/data/uploads`,
  `/data/images`, `/data/logs`, `/data/skill`, and `/data/openai-oauth`.
- Uploaded `/etc/librechat/.env.prod`, `/data/librechat.yaml`, and
  `/data/openai-oauth/auth.json`; verified `auth.json` parses as JSON without
  printing secret contents.
- Added `deploy-compose.prod.yml`, `deploy/host/start.sh`, and
  `deploy/digitalocean/Caddyfile`; copied them to `/srv/librechat/app`.
- Updated `Dockerfile.multi` so the production image includes
  `deploy/host/start.sh`.
- Updated `.env.prod.example` and the host `.env.prod` with
  `NODE_OPTIONS=--max-old-space-size=1536` and Droplet `PORT=3080`.
- Verification:
  - `deploy@139.59.110.150` can SSH and run Docker commands.
  - `systemctl is-active docker` returned `active`.
  - `docker compose -f deploy-compose.prod.yml config --quiet` passed on the
    Droplet.
  - Public DNS is still propagating: DigitalOcean authoritative DNS has
    `chat.longdin.org -> 139.59.110.150`, while public resolvers still showed
    Namecheap nameservers at check time.

---

# Previous: DigitalOcean Droplet production deployment

Goal: move the approved production host from Render to a DigitalOcean Droplet
with a user-owned domain, while keeping MongoDB Atlas and Supabase as managed
production databases.

Plan - 2026-06-29:

- [x] Document the DigitalOcean Droplet production shape, including Droplet
      size, domain/DNS, Caddy HTTPS, Docker Compose, persistent data paths,
      external databases, and manual secret files.
- [x] Add an implementation plan for the future compose/workflow/host setup
      work without enabling a broken GitHub Actions production deploy before
      the Droplet exists.
- [x] Mark the Render runbook as a rollback/historical option so it is not
      mistaken for the current production target.
- [x] Update the local account-bootstrap and env-template wording away from
      Render-specific assumptions.
- [x] Capture the provider correction in lessons and verify docs for secret
      leaks and whitespace.

Review - 2026-06-29:

- Added `docs/deployment/digitalocean-droplet-prod-runbook.md` as the current
  production deployment runbook for a DigitalOcean Droplet with a user-owned
  domain, Caddy HTTPS, Docker Compose, `/data` persistence, host-side
  `.env.prod`, uploaded `librechat.yaml`, uploaded OpenAI OAuth `auth.json`,
  MongoDB Atlas IP allowlist, and GitHub Actions deploy shape.
- Added `docs/plans/2026-06-29-digitalocean-droplet-production-deployment.md`
  with the follow-up implementation plan for compose, Caddy, host setup,
  GitHub Actions, smoke checks, and Render decommission timing.
- Marked `docs/deployment/render-prod-runbook.md` as rollback/historical
  documentation because the selected production target is now DigitalOcean
  Droplet.
- Updated `docs/deployment/local-terminal-user-bootstrap.md` so local account
  creation applies to Render, DigitalOcean Droplet, or another production host.
- Updated `.env.prod.example` away from Render generated-domain placeholders
  and toward `chat.<your-domain>` with `PORT=3080` for the Droplet app.
- Updated `tasks/lessons.md` with the Render-to-Droplet correction and the rule
  to delay enabling SSH auto-deploy until Droplet/GitHub secrets exist.
- Verification:
  - Secret-pattern scan over deployment docs, the new implementation plan,
    `.env.prod.example`, and task files returned only placeholders and the
    documented scan command itself, not real secrets.
  - Trailing-whitespace scan over the updated files returned no output.
  - `rtk git diff --check -- docs/deployment/digitalocean-droplet-prod-runbook.md docs/plans/2026-06-29-digitalocean-droplet-production-deployment.md docs/deployment/render-prod-runbook.md docs/deployment/local-terminal-user-bootstrap.md .env.prod.example tasks/todo.md tasks/lessons.md`
    passed.

---

# Previous: Render manual state sync documentation

Goal: document every production value/file that must be manually configured in
Render or external services, including `librechat.yaml` and OpenAI OAuth
`auth.json`.

Plan - 2026-06-29:

- [x] Add a Render manual sync checklist that separates dashboard env vars,
      persistent-disk files, SSH setup, and external-service allowlists.
- [x] Document that Render auto-creates only a minimal `/data/librechat.yaml`;
      the real local `librechat.yaml` must be uploaded to Render manually after
      local changes.
- [x] Document that OpenAI OAuth `auth.json` must be uploaded to the writable
      Render disk and refreshed manually when local OAuth auth changes.
- [x] List what should not be pasted to Render, and what is managed outside
      Render such as Steel rules sync and Mongo/Supabase data.
- [x] Update lessons and verify the docs for secret leaks and whitespace.

Review - 2026-06-29:

- Added `Manual Render Sync Checklist` to
  `docs/deployment/render-prod-runbook.md`, separating Render Dashboard env
  vars, `/data` persistent-disk files, SSH setup, MongoDB Atlas allowlist, and
  Supabase-managed data/schema/rules.
- Documented that Render's startup script only creates a minimal
  `/data/librechat.yaml`; the real local `librechat.yaml` must be uploaded to
  Render manually with SSH pipe and followed by a service restart.
- Documented that local `~/.codex/auth.json` must be uploaded to
  `/data/openai-oauth/auth.json`, verified as JSON, and followed by a service
  restart whenever local OAuth auth changes.
- Added a "do not paste into Render Environment" list for `auth.json`,
  full `librechat.yaml`, password command arguments, and local-only paths.
- Clarified that Steel rules/data sync and MongoDB/Supabase state are managed
  outside Render rather than pasted into the Render dashboard.
- Updated `tasks/lessons.md` with the manual Render state-sync boundary.
- Verification:
  - Secret-pattern scan over the updated deployment docs and task files
    returned no matches.
  - Trailing-whitespace scan over the updated deployment docs and task files
    returned no matches.
  - `rtk git diff --check -- docs/deployment/render-prod-runbook.md tasks/todo.md tasks/lessons.md`
    passed.
  - `rtk rg` confirmed the runbook contains the manual sync checklist,
    `/data/librechat.yaml`, `/data/openai-oauth/auth.json`, Render Environment,
    MongoDB Atlas, and Supabase-managed state entries.

---

# Previous: Local terminal account bootstrap documentation

Goal: document how to create production LibreChat accounts from the local
terminal using `.env.prod`, instead of relying on Render SSH on the low-cost
Starter instance.

Plan - 2026-06-29:

- [x] Add a standalone local-terminal user bootstrap runbook with prerequisites,
      first-admin creation, internal-user creation, verification, and
      troubleshooting.
- [x] Update the Render production runbook to point admin/internal user
      creation at the local-terminal workflow.
- [x] Capture the Render Starter SSH failure lesson and the safer local
      `create-user` command shape.
- [x] Verify the updated docs for secret leaks, command accuracy, and diff
      hygiene.

Review - 2026-06-29:

- Added `docs/deployment/local-terminal-user-bootstrap.md` with the local Mac
  terminal procedure for creating production accounts through `.env.prod` and
  `config/create-user.js`.
- Updated `docs/deployment/render-prod-runbook.md` so admin/internal user
  creation points to the local-terminal workflow instead of Render SSH.
- Documented the safer command shape:
  `DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml node -r dotenv/config config/create-user.js ...`.
- Documented that passwords should be entered at the prompt, not passed as
  command arguments.
- Updated `tasks/lessons.md` with the Render Starter/SSH account-bootstrap
  correction.
- Verification:
  - Secret-pattern scan over the new/updated docs and task files returned no
    matches.
  - `rtk git diff --check -- docs/deployment/render-prod-runbook.md tasks/todo.md tasks/lessons.md`
    passed for tracked files, and trailing-whitespace scan over the new/updated
    docs and task files returned no matches.
  - `rtk rg` confirmed the local bootstrap command, password warning, runbook
    link, and Render SSH troubleshooting text are present.

---

# Previous: Render service creation documentation update

Goal: update the production deployment documentation with the actual Render
service creation and troubleshooting steps used during setup.

Plan - 2026-06-29:

- [x] Add exact Render UI field values for service creation, Docker settings,
      health checks, auto deploy, and build filters.
- [x] Document the low-budget 1 GB disk option while keeping `/data` as the
      required mount path and explaining upgrade limits.
- [x] Add MongoDB Atlas Network Access guidance for Render outbound access.
- [x] Clarify OpenAI OAuth `auth.json` installation: prefer Render Shell after
      the service is live, and use Secret File only as a temporary bootstrap
      copy into `/data`.
- [x] Update lessons for the Render setup corrections and verify docs for
      secret leaks and whitespace issues.

Review - 2026-06-29:

- Updated `docs/deployment/render-prod-runbook.md` with the actual Render Web
  Service creation fields used during setup: `Docker`, `master`, blank Root
  Directory, `/health`, Docker context `.`, `Dockerfile.multi`, Docker Command
  `sh /app/deploy/render/start.sh`, blank Pre-Deploy Command, Auto-Deploy
  `On Commit`, and blank Build Filters.
- Documented that Starter plus a 1 GB `/data` disk is acceptable for a
  budget-first smoke deployment, while 10 GB remains the safer sustained
  production starting point.
- Added MongoDB Atlas Network Access recovery for Render outbound IP blocking,
  including temporary `0.0.0.0/0` unblock and later tightening to Render
  outbound IPs/CIDRs.
- Clarified OpenAI OAuth `auth.json`: use Render Shell after the service is
  live when possible; use Render Secret File only as a temporary copy source
  into `/data/openai-oauth/auth.json`, then restore the normal Docker Command.
- Updated `tasks/lessons.md` with the Render UI/setup corrections.
- Verification:
  - Secret-pattern scan over the updated runbook, todo, and lessons returned no
    matches.
  - `rtk git diff --check -- docs/deployment/render-prod-runbook.md tasks/todo.md tasks/lessons.md`
    passed.
  - `rtk rg` confirmed the updated runbook contains the required Render field
    values and Mongo/OAuth troubleshooting entries.

---

# Previous: Render production deployment transition

Goal: switch the approved production deployment path from AWS Lightsail host
automation to Render Web Service deployment while keeping the already-created
production MongoDB, Supabase, and `.env.prod` decisions.

Plan - 2026-06-29:

- [x] Disable the Lightsail SSH GitHub Actions production redeploy path so
      `master` pushes do not target a missing VPS.
- [x] Add a Render runtime startup script that maps uploads, generated images,
      logs, skills, and OpenAI OAuth `auth.json` to Render Persistent Disk.
- [x] Add a Render production runbook covering Web Service setup, default
      `onrender.com` domain, environment variables, persistent disk, OpenAI
      OAuth auth-file installation, admin bootstrap, auto deploy, and smoke
      verification.
- [x] Update `.env.prod.example` so placeholders match Render and keep real
      production values in ignored `.env.prod` / Render dashboard secrets.
- [x] Record the deployment-provider correction in `tasks/lessons.md`.
- [x] Verify script syntax, committed-secret patterns, diff hygiene, commit the
      transition, and move local `master` to the verified commit.

Review - 2026-06-29:

- Removed `.github/workflows/deploy-prod.yml`; production `master` pushes no
  longer run the Lightsail/GHCR/SSH redeploy workflow.
- Added `deploy/render/start.sh` and copied `deploy/render` into the final
  `Dockerfile.multi` image so Render can use
  `sh /app/deploy/render/start.sh` as the Docker Command.
- Render startup now defaults `HOST=0.0.0.0`,
  `CONFIG_PATH=/data/librechat.yaml`, and
  `OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json`; it creates a minimal
  `librechat.yaml`, seeds `/data/skill` once from image `/app/skill`, and maps
  uploads/images/logs/skills/OAuth state to the `/data` Persistent Disk.
- Added `docs/deployment/render-prod-runbook.md` with Render Web Service
  setup, generated `onrender.com` domain usage, env vars, disk mount,
  OpenAI OAuth auth-file installation, admin bootstrap, auto deploy, smoke
  verification, troubleshooting, and backup notes.
- Added `docs/plans/2026-06-29-render-production-deployment.md` to capture the
  implementation plan.
- Updated `.env.prod.example` for Render placeholders and kept real production
  values out of git.
- Updated `tasks/lessons.md` with the Render/VPS deployment-provider
  correction.
- Verification:
  - `rtk sh -n deploy/render/start.sh` passed.
  - `rtk bash -n deploy/render/start.sh` passed.
  - `rtk rg -n "LIGHTSAIL_|Redeploy on Lightsail|deploy-compose.prod.yml|deploy/lightsail" .github/workflows`
    returned no matches.
  - Secret-pattern scan over `.env.prod.example`, Render deploy docs/scripts,
    and task files returned no matches.
  - `rtk git diff --check` passed.

---

# Previous: AWS Lightsail production deployment implementation

Goal: implement the approved AWS Lightsail low-cost production deployment path,
verify it locally, then create `master` for production use.

Plan - 2026-06-29:

- [x] Re-read the production design, route shells, current compose, Dockerfile,
      existing workflow patterns, project instructions, and lessons.
- [x] Add backend production gating for standalone `/steel/oauth-chat` backing
      APIs while keeping OpenAI OAuth usage endpoints available.
- [x] Add frontend production route registration gating for `/steel/oauth-chat`.
- [x] Add minimal production compose and Caddy config for Lightsail.
- [x] Add production env template, Lightsail runbook, OpenAI OAuth auth-file
      instructions, and separate-prod-DB guidance.
- [x] Add GitHub Actions workflow for `master` production image build and host
      redeploy.
- [x] Add production smoke script for `/api/config`, `/steel/oauth-chat`, and
      `/api/steel/ai/chat`.
- [x] Run final focused tests, builds, compose validation, Docker image sanity
      check, secret scan, and diff hygiene.
- [x] Commit the implementation and create `master` after verification.

Review - 2026-06-29:

- Added backend production gating so standalone `/steel/oauth-chat` backing APIs
  return 404 when `NODE_ENV=production`; authenticated OAuth usage stays
  available.
- Added frontend route registration gating so production does not register the
  `/steel/oauth-chat` route.
- Added `deploy-compose.prod.yml` with only `api` and `caddy`, external
  production DB env values, host-persisted uploads/images/logs/skills, and a
  writable OpenAI OAuth auth-file mount.
- Added Caddy config that returns 404 for `/steel/oauth-chat*` before proxying
  normal LibreChat traffic.
- Added `.env.prod.example` and
  `docs/deployment/aws-lightsail-prod-runbook.md`, including the recommendation
  to use separate production MongoDB Atlas and Supabase resources.
- Kept the real production env as ignored `/etc/librechat/.env.prod`, tracked
  only the placeholder `.env.prod.example`, and removed the unnecessary
  `OPENAI_PROVIDER` value because the frontend distinguishes OAuth/API-key
  providers.
- Documented first-admin bootstrap with `npm run create-user` from the running
  API container while keeping `ALLOW_REGISTRATION=false`.
- Added `.github/workflows/deploy-prod.yml` so pushes to `master` build the
  production GHCR image and redeploy the Lightsail compose stack over SSH.
- Added `scripts/prod-smoke.sh` for `/api/config`, `/steel/oauth-chat`, and
  `/api/steel/ai/chat` production checks.
- Verification:
  - `cd api && rtk npx jest server/routes/__tests__/steel.spec.js --runInBand --watch=false --coverage=false`
    passed, 15 tests.
  - `cd client && rtk npx jest src/routes/__tests__/skillsRoutes.spec.tsx --runInBand --watch=false --coverage=false`
    passed, 3 tests.
  - `rtk npm run build:api` passed.
  - `rtk npm run build:client` passed with existing bundle-size,
    `vm-browserify` eval, and PWA glob warnings.
  - Workflow YAML parsed with Ruby YAML.
  - Production compose rendered services `api` and `caddy` only.
  - `rtk bash -n scripts/prod-smoke.sh` passed.
  - Secret-pattern scan found no committed production secrets.
  - `rtk git diff --check` passed.
  - Local Docker image build was attempted but could not run because the Docker
    daemon was not available at `/Users/neven/.docker/run/docker.sock`; GitHub
    Actions remains the authoritative image build path.

---

# Previous: AWS Lightsail low-cost production deployment design

Goal: document the selected low-cost production deployment shape for internal
LibreChat/Steel use: AWS Lightsail host, external prod databases, host-persisted
uploads, OpenAI OAuth setup, `master` production branch, and automatic redeploy
on `master` pushes.

Plan - 2026-06-29:

- [x] Capture the selected AWS Lightsail low-cost host design.
- [x] Record prod DB boundaries: cloud MongoDB through `MONGO_URI` and Supabase
      cloud Postgres through `STEEL_POSTGRES_URL`.
- [x] Document host-persisted uploads so files are not stored in Docker images
      or container writable layers.
- [x] Document OpenAI OAuth host-secret setup and keep `/steel/oauth-chat`
      development-only.
- [x] List next implementation tasks for prod compose, GitHub Actions redeploy,
      host setup, and verification.

Review - 2026-06-29:

- Added `docs/plans/2026-06-29-aws-lightsail-low-cost-prod-design.md`.
- The design starts with AWS Lightsail Small, 2 vCPU / 2 GB RAM / 60 GB SSD,
  plus swap, and defines 4 GB upgrade triggers.
- Production app runtime is intentionally minimal: custom image, reverse proxy,
  persistent host directories, external MongoDB, external Supabase, and no local
  Meili/RAG/vector DB in the low-cost starting shape.
- Uploads are bound to `/srv/librechat/uploads`, not stored in the image.
- OpenAI OAuth uses `/var/secrets/openai-oauth/auth.json` via
  `OPENAI_OAUTH_AUTH_FILE`; product traffic uses native LibreChat chat rather
  than `/steel/oauth-chat`.
- OAuth access tokens expire; `openai-oauth-provider` refreshes with the
  refresh token and writes updated token data back to `auth.json`, so the
  production mount must allow app-container writes and the file must be replaced
  when refresh auth fails.
- `master` is the production branch; `main` remains upstream-only.

---

# Previous: search_price_candidates tier output cleanup

Goal: keep `search_price_candidates` AI-visible candidate pricing data on
`tierPrices` only, remove duplicated `tierRatios` from tool output, and fix the
output boundary that let internal tier-ratio fields leak into responses.

Follow-up goal - 2026-06-27:

Remove `tierRatios` / `ratio_a` / `ratio_b` / `ratio_c` / `ratio_f` from the
internal import/repository model and from the Steel Supabase `steel.prices`
table. `unit_price_a` / `unit_price_b` / `unit_price_c` / `unit_price_f`
remain the only persisted tier price fields.

Plan - 2026-06-27:

- [x] Read project instructions, `CLAUDE.md`, current lessons, and relevant
      Steel price-lookup memory.
- [x] Add a regression test that fails while `search_price_candidates` returns
      `tierRatios` beside `tierPrices`.
- [x] Fix the tool output boundary so repository internals do not expose
      `tierRatios` in `search_price_candidates` results.
- [x] Run focused Steel tool/repository tests and `git diff --check`.
- [x] Record the review result and root cause here.

Review - 2026-06-27:

- Root cause: `search_price_candidates` returned deduped `SteelPriceItem`
  repository rows directly, and that internal row model includes both
  `tierPrices` and DB ratio fields mapped as `tierRatios`.
- Fix: added an explicit public price-candidate projection in
  `packages/api/src/steel/tools/execute.ts`; AI-visible results now keep
  `tierPrices` and no longer expose `tierRatios`.
- Follow-up correction below removes repository/import/DB `tierRatios` entirely;
  this first pass was tool-output-only and is superseded for internal storage.
- Verification:
  - Red test failed before the fix:
    `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "does not expose internal tier ratios"`.
  - `cd packages/api && rtk npx jest src/steel/tools/execute.spec.ts --runInBand --watch=false --coverage=false`
    passed, 15 tests.
  - `cd packages/api && rtk npx jest src/steel/repositories/prices.spec.ts --runInBand --watch=false --coverage=false`
    passed, 27 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `34257`,
    server PID `34353`, and `curl` returned `200`.

Follow-up plan - 2026-06-27:

- [x] Add failing tests proving repository/import/schema no longer accept or
      expose `tierRatios` / `ratio_*`.
- [x] Remove `tierRatios` from `SteelPriceItem`, repository SQL selection,
      import parser output, and import script insert columns.
- [x] Add an explicit code/schema note that `比率A-F` source columns are
      intentionally ignored and tier prices are stored only as `unit_price_*`.
- [x] Create a Supabase migration with `npx supabase migration new`, update
      `supabase/schema.sql`, and apply the migration to cloud `STEEL_POSTGRES_URL`.
- [x] Verify tests, build, schema readback, and `git diff --check`.

Follow-up review - 2026-06-27:

- Removed import parser fields `ratioA-F`; source `比率A-F` remains present in
  fixtures only to prove it is ignored.
- Removed `ratio_a-f` from the price import script insert/update column list.
- Removed repository `tierRatios`, `ratio_a-f` row fields, and SQL selection.
- Removed `比率A-F` from schema mapping and added an ignored-source-column note.
- Created `supabase/migration/20260627120916_drop_steel_price_ratio_columns.sql`
  with `DROP COLUMN IF EXISTS ratio_a-f` and a `steel.prices` table comment.
- Updated `supabase/schema.sql` so current schema contains only
  `unit_price_a/b/c/f` for tier prices.
- Applied migration to cloud `STEEL_POSTGRES_URL`; readback columns are
  `unit_price_a,unit_price_b,unit_price_c,unit_price_f`, and migration history
  contains version `20260627120916`.
- Verification:
  - Red tests failed before implementation for import `ratioA` and repository
    SQL `ratio_a` selection.
  - `cd packages/api && rtk npx jest src/steel/pricing/import.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/schema/mapping.spec.ts --runInBand --watch=false --coverage=false`
    passed, 50 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - `rtk node packages/api/scripts/import-steel-price-v3.cjs --help` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `75981`,
    server PID `76067`, and `curl` returned `200`.

Current simplify pass - 2026-06-27:

- [x] Re-scanned the current working tree diff through code reuse, quality, and
      efficiency angles.
- [x] Removed the now-redundant public price-candidate projection in
      `packages/api/src/steel/tools/execute.ts`; internal `tierRatios` no
      longer exists in the import/repository/DB model, so the extra projection
      was only duplicating `SteelPriceItem`.
- [x] Updated PaddleOCR MCP initialization after user correction: conditionally
      inject it only when the current request has OCR-capable files.
- [x] Run targeted Steel/OCR/MCP tests, build, and diff checks after this
      simplification.

Current simplify review - 2026-06-27:

- Removed the redundant `search_price_candidates` output projection that had
  been added only to hide `tierRatios`; after the import/repository/DB cleanup,
  direct deduped `SteelPriceItem` output no longer contains that field.
- Applied the latest user correction for OCR MCP loading: no OCR-capable file
  means no `PaddleOCR` MCP injection; current-turn PDF/image files and request
  PDF/image attachments still inject it.
- Updated `tasks/lessons.md` so future OCR MCP changes use conditional loading
  instead of the earlier every-turn assumption.
- Verification:
  - Red test failed before the conditional-loading fix:
    `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false --testNamePattern "does not inject PaddleOCR MCP during initialization without OCR-capable files"`.
  - Same focused test passed after the fix.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed, 63 tests.
  - `cd packages/api && rtk npx jest src/steel/pricing/import.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/schema/mapping.spec.ts src/mcp/__tests__/utils.test.ts src/mcp/tools.spec.ts src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed, 177 tests.
  - `cd api && rtk npx jest server/services/MCP.spec.js app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed, 73 tests.
  - `cd client && rtk npx jest src/utils/__tests__/validateFiles.spec.ts src/components/Chat/Input/Files/__tests__/AttachFileMenu.spec.tsx --runInBand --watch=false --coverage=false`
    passed, 49 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `cd client && rtk npm run typecheck` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `31376`,
    server PID `31412`, and `curl` returned `200`.
  - Backend log still shows configured MCP registry startup for `PaddleOCR`;
    the conditional change is scoped to per-turn Agent tool injection.

PaddleOCR MCP process lazy-load plan - 2026-06-27:

- [x] Verify the existing MCP startup/config/reinit paths and confirm
      `startup:false` keeps a YAML server known while skipping startup
      capability/tool inspection.
- [x] Add a red MCP initialization regression test proving `PaddleOCR` is
      forced to process lazy loading before manager startup.
- [x] Force `mcpServers.PaddleOCR.startup: false` before MCP manager
      initialization, without mutating the loaded base config.
- [x] Verify the red test turns green and focused OCR/MCP tool-loading tests
      still pass.
- [x] Rebuild/restart backend and confirm startup no longer launches the
      PaddleOCR MCP stdio process before an OCR-capable turn.

PaddleOCR MCP process lazy-load review - 2026-06-27:

- Added `withLazyLoadedSteelMCPServers()` in
  `api/server/services/initializeMCPs.js` so the `PaddleOCR` MCP server is
  passed to `createMCPManager()` with `startup:false`, while other MCP servers
  are left unchanged and the original app config object is not mutated.
- This preserves the MCP registry/config entry but skips startup stdio
  inspection, so `paddleocr_mcp` is not launched until an OCR-capable request
  injects and uses the tool.
- Kept the ignored local `librechat.yaml` aligned with `startup:false`, but the
  tracked runtime guard does not depend on that local file being versioned.
- Verification:
  - Red test failed before implementation:
    `cd api && rtk npx jest server/services/initializeMCPs.spec.js --runInBand --watch=false --coverage=false --testNamePattern "should force PaddleOCR MCP process lazy loading"`.
  - Same focused test passed after implementation.
  - `cd api && rtk npx jest server/services/initializeMCPs.spec.js server/services/__tests__/ToolService.spec.js server/services/MCP.spec.js app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed, 152 tests.
  - `cd packages/api && rtk npx jest src/mcp/registry/__tests__/MCPServerInspector.test.ts src/mcp/__tests__/MCPManager.test.ts src/mcp/tools.spec.ts src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed, 117 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`; detached npm PID `92630`,
    server PID `92667`, and `curl` returned `200`.
  - Startup log shows `[MCP] Initialized with 1 configured server and 0 tools.`
    and the check returned `hasFastMcpBanner=false`,
    `hasPaddleOcrToolsAtStartup=false`, `hasZeroToolInit=true`.

# Active: Steel Direct MCP OCR

Goal: remove `run_file_ocr` as an AI-visible/executable Steel tool and remove
the rules that instruct the AI to call it, while keeping direct PaddleOCR MCP
OCR and assistant OCR Markdown auto-save to database.

Implementation plan:
`docs/plans/2026-06-27-steel-direct-mcp-ocr.md`.

Simplify pass - 2026-06-27:

- [x] Review the current working tree diff under `/simplify`.
- [x] Run parallel reuse, quality, and efficiency checks over changed code.
- [x] Apply only local simplifications that preserve public APIs and keep OCR
      rules unchanged.
- [x] Run targeted verification and record results.

Simplify review - 2026-06-27:

- Consolidated duplicated PaddleOCR request-file resolver tests in
  `api/server/services/MCP.spec.js` with a local helper for filename and
  `file_id` cases.
- Tightened PaddleOCR resolver safety: request-supplied file refs are now used
  only to collect current-turn file ids; downloadable records must come from
  owner/tenant-checked `db.getFiles()` results.
- Kept uploaded PDF media type precise when records are stored as
  `application/octet-stream`; file extension fallback now produces
  `data:application/pdf` for `.pdf`.
- Added shared `splitMCPToolKey()` and reused it in legacy MCP tool loading /
  execution so tool names containing `_mcp_` are parsed by the final delimiter.
- Reused the existing MCP server-name fallback hash helper in both MCP server
  name normalizers.
- Updated after user correction: PaddleOCR MCP is injected only when the
  current request has OCR-capable Steel files. The no-file case stays clean,
  while PDF/image current-turn files and request attachments still trigger MCP
  loading.
- Verification:
  - `cd packages/api && rtk npx jest src/mcp/__tests__/utils.test.ts --runInBand --watch=false --coverage=false`
    passed, 79 tests.
  - `cd packages/api && rtk npx jest src/mcp/tools.spec.ts src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed, 48 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
    passed, 57 tests.
  - `cd api && rtk npx jest app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed, 16 tests.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed, 63 tests.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `29803`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `[MCP][PaddleOCR] Tools: paddleocr_vl` and
    `[MCP] Initialized with 1 configured server and 1 tool.`

Frontend PaddleOCR upload UI limits - 2026-06-27:

- [x] Add chat file-input accept hints for PaddleOCR-supported UI formats.
- [x] Add client-side preflight validation for PaddleOCR UI limits without
      backend/YAML changes or PDF page-count checks.
- [x] Run focused frontend validation tests and `git diff --check`.

Frontend PaddleOCR upload UI limits review - 2026-06-27:

- Scoped the change to frontend UI only. No backend validator,
  `librechat.yaml`, or PDF page-count check was added.
- OCR/Text upload selection now sets the file chooser accept hint to PDF, PNG,
  JPG/JPEG, BMP, and CIF.
- `validateFiles()` now applies PaddleOCR UI limits only when
  `toolResource === context`: max 20 selected/attached files, max 200MB per
  file, max 10MB for image files, and the same PDF/image format allowlist.
- Normal provider upload, file search, and code environment upload still use
  the existing endpoint file config path.
- Verification:
  - Initial repo-root Jest command failed because root Jest did not use the
    client TypeScript transform; reran the same spec from `client/`.
  - `cd client && rtk npx jest src/utils/__tests__/validateFiles.spec.ts --runInBand --watch=false --coverage=false`
    passed, 23 tests.
  - `cd client && rtk npx jest src/components/Chat/Input/Files/__tests__/AttachFileMenu.spec.tsx --runInBand --watch=false --coverage=false`
    passed, 26 tests.
  - `rtk git diff --check` passed.
  - `curl http://localhost:3090/` returned `200`.

Current correction - 2026-06-27 - PaddleOCR filename input and server key:

- [x] Reproduce the reported `paddleocr_vl` failure pattern with a red test:
      `input_data: "c.pdf"` was passed through unchanged, so MCP had no
      downloadable file bytes.
- [x] Rename the configured LibreChat MCP server key from `PaddleOCR-VL-1.6`
      to `PaddleOCR` while keeping `PADDLEOCR_MCP_MODEL=PaddleOCR-VL-1.6`.
- [x] Resolve filename-only PaddleOCR `input_data` from current request
      LibreChat attachments before calling MCP, using owner/tenant-checked file
      records and existing storage download strategies.
- [x] Keep the generic provider-safe dotted-server-name tests, because they
      still protect other MCP server names even though current PaddleOCR uses
      the simpler `PaddleOCR` key.
- [x] Run full focused verification, direct `c.pdf` PaddleOCR manual check,
      `git diff --check`, restart backend, and record evidence.

Correction review - 2026-06-27 - PaddleOCR filename input and server key:

- Root cause: the latest `paddleocr_vl` failure was a real MCP tool failure,
  not an AI result-parsing failure. The model passed `input_data: "c.pdf"`;
  PaddleOCR MCP supports absolute paths, URLs, raw Base64, or data URLs, and
  does not know LibreChat attachment display names.
- Runtime fix: `createMCPTool()` now captures the Express request. Before
  `paddleocr_vl` calls MCP, filename-only `input_data` is matched against the
  current request's LibreChat file refs, owner/tenant-checked through
  `db.getFiles()`, downloaded through the existing file storage strategy, and
  converted to a `data:<media-type>;base64,...` input.
- Naming fix: `librechat.yaml` now uses MCP server key `PaddleOCR`; the actual
  model setting remains `PADDLEOCR_MCP_MODEL=PaddleOCR-VL-1.6`.
- Verification:
  - Red/green filename-only regression:
    `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "filename-only"`.
  - Full focused suites passed:
    `MCP.spec.js` 53 tests, `handleTools.test.js` 16 tests,
    `ToolService.spec.js` 63 tests.
  - Direct `docs/reference/example/c.pdf` PaddleOCR MCP manual spec passed, 1
    test in 16.2s.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `47359`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `PaddleOCR.timeout: 1200000`,
    `[MCP][PaddleOCR] Tools: paddleocr_vl`, and `[MCP] Initialized with 1
    configured server and 1 tool.`

Current correction - 2026-06-27 - PaddleOCR file_id input:

- [x] Reproduce the reported `paddleocr_vl` failure shape with a red test:
      `input_data` was a LibreChat file id UUID, so the previous filename-only
      resolver passed it through unchanged.
- [x] Extend backend PaddleOCR argument resolution to match current-turn
      attachments by `file_id` / `fileId` / `id` before falling back to filename
      and filepath matching.
- [x] Revert the attempted OCR rule wording change per user correction; this
      issue is handled in backend tool argument normalization, not by changing
      rules.
- [x] Run focused verification, restart backend, and record evidence.

Correction review - 2026-06-27 - PaddleOCR file_id input:

- Root cause: the AI passed LibreChat file id
  `48322107-fb71-4d2c-970a-669e15d14821` as `input_data`. PaddleOCR MCP does
  not natively understand LibreChat UUIDs, and the previous backend resolver
  only matched filenames / filepaths.
- Runtime fix: PaddleOCR `input_data` normalization now matches current-turn
  attachments by `file_id`, `fileId`, or `id`, then resolves the authorized
  file record and converts it to a data URL before the MCP call.
- Rule boundary: the attempted OCR rule wording change was reverted after the
  user said not to change rules.
- Verification:
  - Red/green file-id regression:
    `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false --testNamePattern "file_id input_data"`.
  - Full `MCP.spec.js` passed, 54 tests.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `66358`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `[MCP][PaddleOCR] Tools: paddleocr_vl` and
    `[MCP] Initialized with 1 configured server and 1 tool.`

Current correction - 2026-06-27:

- [x] Prove the screenshot "PaddleOCR 回傳 No text could be parsed" was not a
      real `paddleocr_vl` result: the UI turn did not call PaddleOCR MCP.
- [x] Add failing coverage for tool loading before `AgentClient` has populated
      `req.steelNativeContext.currentTurnFiles`.
- [x] Pass resolved request attachments from `initializeAgent()` into
      `loadAgentTools()` for logging/context, and inject PaddleOCR MCP during
      tool initialization on every turn so AI can use `paddleocr_vl` anytime.
- [x] Update OCR rules from PaddleOCR-only stop behavior to
      PaddleOCR-first with explicit AI OCR/vision fallback only after
      PaddleOCR fails or returns no usable result.
- [x] Run targeted ToolService / initializeAgent / AgentClient tests, sync
      Steel rules, run direct `c.pdf` PaddleOCR manual verification, restart
      backend, and record evidence.

Correction review - 2026-06-27:

- Root cause: the screenshot text `PaddleOCR 回傳 No text could be parsed` was
  not a real PaddleOCR result. That UI turn never called `paddleocr_vl`; the
  model attributed provider PDF/native parsing failure to PaddleOCR.
- Runtime fix: `ToolService` now injects the PaddleOCR MCP server token during
  initialization tool loading on every turn, even when there is no PDF/image
  attachment. Resolved request attachments are still passed from
  `initializeAgent()` to `loadAgentTools()` for logging/context.
- Rule fix: OCR rules now say PaddleOCR MCP is always loaded, AI must call
  `paddleocr_vl` first for OCR/PDF/image/file-content parsing, and AI
  OCR/vision fallback is allowed only after PaddleOCR fails or returns no
  usable text. Approximate values such as `約 600 × 300` remain forbidden.
- Verification:
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed, 63 tests.
  - `cd packages/api && rtk npx jest src/agents/__tests__/initialize.test.ts --runInBand --watch=false --coverage=false --testNamePattern "attachment scoping|allowed-tools|does not invoke loadTools twice when the agent has no tools"`
    passed, 11 focused tests.
  - `cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --testNamePattern "keeps OCR-capable request attachments|buildMessages with request and agent-scoped context attachments|titleConvo"`
    passed, 84 tests.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --apply` passed and
    read back `steel-drawing-ocr-policy` SHA
    `03f49e9eb428a3f3ac4112824ff876a978c8f89674387ab80ea27554d2137ab6`.
  - Direct `docs/reference/example/c.pdf` PaddleOCR MCP manual OCR spec passed,
    1 test in 16.2s.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Restarted backend on `http://localhost:3080/`, new PID `78767`, and
    `curl` returned `200`; frontend dev server on `http://localhost:3090/`
    also returned `200`.
  - Backend log after restart shows `PaddleOCR-VL-1.6.timeout: 1200000`,
    `Tools: paddleocr_vl`, and `[MCP] Initialized with 1 configured server and
    1 tool.`

Plan:

- [x] Read project instructions, `CLAUDE.md`, memory, lessons, and current OCR
      tool/rule paths.
- [x] Dispatch focused explorer agents for tool exposure, OCR Markdown
      autosave, and rule/document references.
- [x] Write failing tests proving `run_file_ocr` is no longer exposed.
- [x] Remove `run_file_ocr` from Steel tool schemas, registry, execution, and
      runtime/native policy.
- [x] Update AI-facing OCR rules and canonical docs to direct PaddleOCR MCP
      semantics.
- [x] Preserve assistant OCR Markdown auto-save and `read_markdown(scope:
      "ocr")` recovery.
- [x] Run targeted Jest tests, rules sync dry-run/apply where credentials
      allow, `docs/reference/example/c.pdf` MCP verification where credentials
      allow, and `git diff --check`.
- [x] Add review evidence here before wrap-up.

Check-in - 2026-06-27:

- User decision locked: use PaddleOCR MCP directly, delete the
  `run_file_ocr` tool path, delete `run_file_ocr` related AI-facing rules, and
  keep AI-produced OCR Markdown auto-saving to the database.
- Boundary: keep low-level PaddleOCR MCP helper code for direct/manual OCR
  execution, but remove `run_file_ocr` from AI-visible provider tools and
  executable `executeSteelTool` dispatch.

Review - 2026-06-27:

- Removed `run_file_ocr` from Steel provider schemas, registry, executable
  dispatch, native/runtime tool policy, OAuth provider special handling, and
  ToolService file-to-tool plumbing.
- Updated OCR rules and canonical docs to explicitly require PaddleOCR MCP OCR
  (`PaddleOCR-VL-1.6` / `paddleocr_vl`) for PDF/image text and table parsing.
- Preserved assistant OCR Markdown persistence by saving detected OCR Markdown
  tables as current `ocr_extract` rows with `kind:
  "assistant_ocr_markdown"`; legacy `run_file_ocr` results no longer overwrite
  active OCR Markdown.
- Synced reviewed DB rules with
  `rtk node packages/api/scripts/sync-steel-rules.cjs --apply`; updated
  `steel-drawing-ocr-policy` source hash:
  `3ed2158f480c9c1a36e7d5b5d4dda9ba04797e9cc252955bd840f8e4e5743a1a`.
- Verification passed:
  `rtk npm run build` in `packages/api`;
  targeted Steel Jest suite, 12 suites / 112 tests;
  `rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand`,
  60 tests;
  `docs/reference/example/c.pdf` direct PaddleOCR MCP manual spec, 1 test;
  `rtk git diff --check`.

# Active: Markdown Table Cell Comments

Goal: add cell-level comments to expanded Markdown table modals so users can
mark table corrections, keep those comments visible as pending composer
context, and append the structured comments to the next chat turn without
changing normal chat layout, Markdown parsing output, Steel storage, or export
payloads.

Independent implementation plan:
`docs/plans/2026-06-27-markdown-table-cell-comments.md`.

Planning status:

- [x] Read project instructions, `CLAUDE.md`, RTK rule, current lessons, and
      the existing Markdown table modal implementation.
- [x] Locate the current table wrapper/modal surface:
      `client/src/components/Chat/Messages/Content/MarkdownTableActions.tsx`
      and `client/src/style.css`.
- [x] Locate the composer submit path:
      `client/src/components/Chat/Input/ChatForm.tsx`,
      `client/src/components/Chat/Input/SendButton.tsx`,
      `client/src/hooks/Messages/useSubmitMessage.ts`, and
      `client/src/hooks/Chat/useChatFunctions.ts`.
- [x] Confirm the open product questions below before implementation.
- [x] Write focused tests for formatter grouping, cell comment input behavior,
      inline comment display behavior, composer helper text, send-button
      enablement, and submit payload formatting.
- [x] Add the minimal shared pending-comment type/state.
- [x] Add modal-only cell comment controls and input popover.
- [x] Add composer helper text and make pending comments count as sendable
      content.
- [x] Add hover/focus preview on the composer helper showing the exact Markdown
      comments block that will be appended to the next user message.
- [x] Drain pending comments on fresh submit and append them after typed chat
      input text in stable Markdown format.
- [x] Make the modal cell comment input viewport-aware so it cannot overflow
      the visible browser window near modal/table edges.
- [x] Run targeted Jest tests, client typecheck, and `rtk git diff --check`.
- [x] Add review evidence here before wrap-up.

Proposed architecture:

- Keep this as a client-side pending-submit feature, similar to
  `pendingQuotesByConvoId` and `pendingManualSkillsByConvoId`.
- Add a typed Recoil atom family such as `pendingMarkdownTableCommentsByConvoId`
  keyed by conversation id. Each item should carry:
  - markdown identity: conversation id, assistant message id, assistant message
    timestamp label, content part index / markdown index within that message,
    table source fingerprint, and a user-visible markdown label. A rendered
    Markdown table is treated as one Markdown unit containing one table. The
    role is always AI for this feature and should not be included in the label.
  - cell identity: row index, column index, column header/field name, row label
    when available, and old cell value.
  - comment text: the user-entered correction or note.
- Treat `(markdown identity, row index, column index)` as a
  unique key. One cell can have only one pending comment; saving that cell again
  updates/replaces the existing comment instead of appending a second entry.
- Keep comment UI inside the expanded Markdown table modal only. Normal inline
  chat tables keep existing copy/download/expand behavior unchanged.
- Render a small top-right `MessageCircle` icon button inside each modal
  cell. Empty cells show the button only on cell hover/focus. Commented cells
  keep the button visible, show the comment text directly in the cell, and
  fade the original cell value.
- On click, open a compact text input/popover styled with existing LibreChat
  surface, border, text, and focus classes. Saving blank text removes that
  pending comment.
- Add a composer helper row below the textarea area, showing grouped counts such
  as `Markdown table comments: 2026-06-27 14:32 / Markdown 2: 2`.
  The helper must be localized through `useLocalize()`.
- Treat pending comments as submit content without mutating the visible textarea:
  update form validation/send-button logic to consider `pendingComments.length`
  so the user can send with no typed text.
- On fresh submit only, drain pending comments atomically in `useChatFunctions`
  or immediately before `ask()`, append formatted Markdown after the typed user
  text, then clear the pending queue. The composer helper text/count under chat
  input must disappear immediately after successful submit because the next turn
  has zero pending comments. Regenerate/edit/continue should not drain unrelated
  composer comments.

Proposed submit format:

```markdown
<typed user message, if any>

---

Markdown table comments:

### <message timestamp> / Markdown <m>

1. Cell: row <n>, column "<header>"
   Old value: <old cell value>
   Comment: <comment text>

2. Cell: row <n>, column "<header>"
   Old value: <old cell value>
   Comment: <comment text>

### <message timestamp> / Markdown <m>

1. Cell: row <n>, column "<header>"
   Old value: <old cell value>
   Comment: <comment text>

請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。
```

This format keeps comments model-visible as normal user text, ordered after the
typed message as requested, visible on the submitted user message, and avoids a
backend schema change in the first slice. Comments from the same
message/Markdown must be grouped under one heading before listing the cell-level
comments. The final instruction tells the AI to output each affected Markdown as
a separate complete updated table, not partial changed cells/rows.

Verification plan:

- Unit/UI tests in
  `client/src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx`:
  open modal, hover/focus a cell, add a comment, verify icon visibility and
  inline comment display, edit the same cell and verify it replaces the old
  comment rather than creating a duplicate, edit to blank, and verify removal.
- Composer tests in `client/src/components/Chat/Input/__tests__/...`: pending
  comments render helper text, enable send with empty textarea, and the helper
  text/count clears to zero immediately after submit.
- Submit-path tests in `client/src/hooks/Chat/__tests__/...` or
  `client/src/hooks/Messages/__tests__/useSubmitMessage.spec.ts`: typed text
  plus comments are appended in order; empty typed text still sends only the
  comment block; the submitted user message shows the appended comment list;
  comments from the same message/Markdown are grouped under one heading;
  multiple Markdown tables in the same message can be distinguished by their
  `Markdown <m>` labels; the final instruction asks for separate complete new
  tables for each affected Markdown; regenerate/edit/continue do not drain
  pending comments.
- Localization check: add only English keys in
  `client/src/locales/en/translation.json`.
- Run:
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false`
  - targeted composer/submit Jest tests added by the implementation
  - `cd client && rtk npm run typecheck`
  - `rtk git diff --check`

Locked decisions:

- User-visible labels use message timestamp plus Markdown index, e.g.
  `2026-06-27 14:32 / Markdown 2`; internal state still carries message id,
  part index or markdown index, and source fingerprint. The role is always AI
  and is not shown.
- The comment button appears only inside the expanded modal.
- Comment input is single-line. Enter and blur save; Escape cancels.
- Pending comments survive closing/reopening the modal and conversation
  navigation during the same app session, but successful chat submit clears the
  pending queue and the chat-input helper/count.
- Scope is all rendered Markdown tables, not only Steel/OCR/workbook-looking
  tables.
- The stored old cell value is the value at the moment the comment is created.
  If the AI replies with a complete updated Markdown table later, that reply is
  treated as the latest table.
- First version sends comments as appended normal user text, not separate
  message metadata. Therefore the submitted user message should visibly include
  the appended comments list.
- Submitted comments list must group comments by message/Markdown. Multiple
  comments from the same Markdown table appear under one
  `<message timestamp> / Markdown <m>` heading instead of repeating the label
  per cell.
- The appended comments list must end with an explicit instruction asking the AI
  to output complete updated tables separately for each affected Markdown.
- A single cell can have only one comment. Editing a commented cell replaces
  that cell's existing pending comment; clearing the input removes it.

Check-in - 2026-06-27:

- This is a planning-only pass. No implementation files were changed.
- The simple/elegant path is to reuse the existing pending-submit pattern and
  avoid backend schema work until there is a clear need to persist comment
  metadata beyond the next send.
- Implementation should stay additive to the current modal and composer paths,
  preserving existing table copy/download/XLSX behavior and normal LibreChat
  chat layout.
- User decisions locked on 2026-06-27: modal-only comment button, single-line
  Enter/blur-save input, Escape cancel, all Markdown tables in scope, old value
  captured at comment creation, pending comments retained only until successful
  submit, appended comments visible in the submitted user message, and comments
  grouped by message timestamp/Markdown in the appended list. Same-cell comments
  are one-to-one and use replace/remove semantics, not duplicate entries. The
  appended list ends by asking the AI to output each affected Markdown as a
  separate complete updated table. Role is not shown because comments only
  target AI Markdown tables.

Review - 2026-06-27:

- Added client-only `MarkdownTableComment` formatting helpers and Recoil
  pending state keyed by conversation.
- Added a Markdown table index provider so multiple tables in the same AI
  message label as separate `Markdown <n>` units while keeping the user-visible
  label as message timestamp plus Markdown index.
- Added modal-only cell comment controls inside expanded Markdown tables. The
  `MessageCircle` button stays hidden until hover/focus for empty cells, stays
  visible for commented cells, opens a single-line input, saves on Enter/blur,
  cancels on Escape, replaces same-cell comments, and removes the comment when
  saved blank.
- The comment controls use LibreChat shared UI components: `Button` for the
  icon action and `Input` for the compact single-line editor. Saved comments
  are rendered directly in the cell, while the original cell value is faded.
- Kept comment controls AI-only. User-authored Markdown tables can still use
  normal table actions, but they do not render cell comment buttons.
- Content-part messages now carry a Markdown table base index so multiple text
  parts in the same AI message keep distinct `Markdown <n>` labels.
- Added composer helper text grouped by message timestamp/Markdown label, and
  made pending comments count as sendable content without mutating the visible
  textarea.
- Pending Markdown table comments now persist to `localStorage` by conversation
  id, so refresh/back-forward mistakes do not drop the queue before submit.
- Fresh submits now drain pending Markdown table comments, append the grouped
  comments list after typed user text, and clear the helper/count plus
  `localStorage` entry for the next turn. Regenerate/edit/continue leave
  pending composer comments untouched.
- LibreChat now mounts a router-level browser unload warning independent of
  pending comments. It uses `beforeunload` only, so same-site route navigation
  stays uninterrupted.
- The submitted list ends with the locked instruction asking the AI to output
  each affected Markdown as a separate complete updated table.
- Verification:
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx src/components/Chat/Input/__tests__/SendButton.spec.tsx src/components/Chat/Messages/Content/table/comments.test.tsx src/common/markdown.test.ts src/hooks/Messages/__tests__/useSubmitMessage.spec.ts src/hooks/Chat/__tests__/useChatFunctions.regenerate.spec.tsx --runInBand --watch=false --coverage=false` passed: 7 suites, 36 tests.
  - `cd client && rtk npm run typecheck` passed.
  - `cd client && rtk npm run build:ci` passed, with existing Vite/PWA warnings
    about direct eval in `vm-browserify`, large chunks, and missing icon globs.
  - `rtk git diff --check -- <markdown-comment-related files>` passed.
  - `git diff --no-index --check /dev/null <new markdown-comment files>` passed
    for untracked/new files.
  - Follow-up UI correction removed saved-comment hover popups in favor of inline
    cell comment text with faded original values. `cd client && rtk npx jest
    src/components/Chat/Messages/Content/table/comments.test.tsx
    src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
    --runInBand --watch=false --coverage=false` passed: 2 suites, 19 tests.
    `cd client && rtk npm run typecheck` passed.
  - Follow-up data-loss protection added `localStorage` persistence for pending
    comments and a global browser-unload-only LibreChat leave warning.
    `cd client && rtk npx jest
    src/components/System/__tests__/LeaveSiteWarning.test.tsx
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    src/common/markdown.test.ts src/routes/__tests__/skillsRoutes.spec.tsx
    --runInBand --watch=false --coverage=false` passed: 4 suites, 13 tests.
    `cd client && rtk npm run typecheck` passed.
  - Follow-up route-navigation correction keeps the global leave warning on
    browser unload only, so same-site route changes such as `/c` to `/c/:id` do
    not prompt. `cd client && rtk npx jest
    src/components/System/__tests__/LeaveSiteWarning.test.tsx
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    src/common/markdown.test.ts src/routes/__tests__/skillsRoutes.spec.tsx
    --runInBand --watch=false --coverage=false` passed: 4 suites, 13 tests.
    `cd client && rtk npm run typecheck` passed. `rtk git diff --check` passed
    for the leave-warning correction files.
  - Follow-up viewport correction moved the cell comment editor from
    cell-relative absolute positioning into a Radix Popover portal with
    collision padding. This reuses the existing LibreChat/Radix positioning
    pattern so the input can shift/flip inside the viewport near modal/table
    edges. `cd client && rtk npx jest
    src/components/Chat/Messages/Content/table/comments.test.tsx
    src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
    --runInBand --watch=false --coverage=false` passed: 2 suites, 20 tests.
    `cd client && rtk npm run typecheck` passed. `rtk git diff --check` passed
    for the viewport correction files.
  - Follow-up blur-save correction handles Radix Popover outside-dismiss as a
    save path, so clicking away from the comment editor preserves the draft just
    like input blur. Enter, blur, and outside-dismiss are guarded against
    duplicate commits, while Escape still cancels. `cd client && rtk npx jest
    src/components/Chat/Messages/Content/table/comments.test.tsx
    src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
    --runInBand --watch=false --coverage=false` passed: 2 suites, 21 tests.
  - Follow-up composer helper correction keeps the helper line as grouped
    counts but shows the exact appended Markdown comments block on hover/focus,
    using the same formatter as submit. `cd client && rtk npx jest
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    --runInBand --watch=false --coverage=false` passed: 1 suite, 4 tests.
    `cd client && rtk npx jest
    src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx
    src/common/markdown.test.ts
    src/hooks/Messages/__tests__/useSubmitMessage.spec.ts --runInBand
    --watch=false --coverage=false` passed: 3 suites, 16 tests. `cd client &&
    rtk npm run typecheck` passed. `rtk git diff --check` passed for the helper
    preview correction files.

# Active: Markdown Table Modal UX

Goal: improve Markdown table review in the expanded modal by making large
tables easier to scan without changing Markdown parsing, Steel storage, export
payloads, or normal chat layout.

Plan:

- [x] Add focused frontend tests for zebra rows, sticky header cells, and the
      selected sticky-left modal column.
- [x] Read table headers from the rendered modal table and add a selector UI
      that can pin one header column to the left.
- [x] Style expanded Markdown tables with alternating row backgrounds, sticky
      header row, and sticky selected column with readable overlap layering.
- [x] Run targeted Jest tests, frontend typecheck, and `git diff --check`.
- [x] Add review evidence here before wrap-up.

Check-in - 2026-06-27:

- Scope is limited to the existing Markdown table action/modal component and
  stylesheet.
- No backend, parser, export, database, or Steel business-rule contracts should
  change.
- Selector applies only in the expanded modal so normal chat table rendering
  remains lightweight.

Review - 2026-06-27:

- Expanded Markdown table modals now render zebra data rows and apply sticky
  header styling for the header row.
- Modal cell colors now use a localized light/dark palette for odd/even rows,
  header cells, and pinned columns so large tables scan more clearly.
- Sticky selected columns no longer change cell color; the selected column now
  keeps the row background and uses only a subtle divider/shadow. Zebra row
  contrast was reduced.
- Added a modal-only column selector populated from rendered table header text.
  Selecting a header pins that column to the left; selecting the empty option
  clears pinned-column state.
- Replaced the modal selector's native `<select>` with LibreChat's shared
  `ControlCombobox`, matching the Agent Builder category selector style and
  keeping searchable column selection.
- Fixed the selector popup not appearing inside the Markdown modal. Root cause:
  `ControlCombobox` portals its popover to `body` with the default `z-40`, which
  rendered behind the `z-index: 1000` modal. `ControlCombobox` now accepts a
  scoped `popoverClassName`, and the Markdown modal selector uses
  `markdown-table-selector-popover` at `z-index: 1001`.
- Simplify pass:
  - Reused one normalized cell-text helper for copy, selector headers, and wide
    column detection.
  - Removed duplicate JS row striping/header-sticky class ownership and left
    those static table styles to CSS selectors.
  - Split static modal table decoration from sticky-column updates so changing
    the pinned column no longer recomputes long-column widths.
  - Avoided building modal-only sticky selector labels/items in collapsed table
    toolbars.
  - Tightened the Markdown table combobox mock so selector options only appear
    after the trigger is clicked.
- Kept copy Markdown and XLSX download behavior on the rendered table matrix,
  so export output remains unchanged.
- Verification:
  - `cd packages/client && rtk npx jest src/components/ControlCombobox.spec.tsx --runInBand --watch=false --coverage=false` passed: 1 suite, 8 tests.
  - `cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false` passed: 1 suite, 9 tests.
  - `cd client && rtk npm run typecheck` passed.
  - `rtk git diff --check` passed.

Previous active work:

# Active: Simplify Steel Native And OAuth Latest Changes

Goal: review and simplify every module/file changed by
`cfc463093b2178e8a921de91d26^..HEAD`, covering commits `cfc463093`,
`c38550e2`, `f3b64adf`, and `3bf4f51d`, without changing public APIs,
runtime contracts, database schema contracts, route payloads, event names, or
Steel business rules.

Target:

- Git range: `cfc463093b2178e8a921de91d26^..HEAD`.
- Scope size: 198 changed files, including docs/task cleanup, Steel native
  backend modules, OpenAI OAuth provider modules, frontend Steel/OAuth UI, SSE
  activity handling, data-provider contracts, E2E/mock fixtures, and focused
  tests.
- Constraints: no branch checkout/rebase/reset, no Prettier, preserve public
  APIs and externally visible behavior, prefer deletion/local simplification
  over new layers.

Plan:

- [x] Read repo instructions, `CLAUDE.md`, RTK rules, current lessons, and the
      `/simplify` skill.
- [x] Identify the exact changed-file target from the requested commits.
- [x] Run three focused review passes for code reuse, code quality, and
      efficiency across the target.
- [x] Consolidate findings and inspect the directly affected code before each
      edit.
- [x] Apply local simplifications, deletions, and cleanup where benefit clearly
      exceeds risk.
- [x] Run targeted tests/build checks plus `git diff --check`; fix regressions
      caused by this work.
- [x] Add a review/results section here with what changed, what was skipped,
      and verification evidence.

Check-in - 2026-06-26:

- This is a non-trivial simplify pass over the current `steel/v8.3` HEAD.
- I will use the commit range itself as the explicit review target, not the
  current working-tree diff.
- I will not resurrect deleted planning docs or task packages unless a live
  code/doc reference proves a deletion broke the current entrypoint contract.
- I will treat existing Steel lessons as active constraints: native work starts
  from the master framework, compact workbook/read_markdown contracts stay
  intact, OpenAI OAuth names avoid new Steel prefixes, and no Prettier runs.

Review - 2026-06-26 simplify pass:

- Reviewed the full requested range `cfc463093^..HEAD` and applied local
  simplifications in the changed Steel native/OAuth/backend/client/E2E test
  surface without changing public event names, route payloads, workbook
  contracts, database schema, or Steel business rules.
- Removed duplicated Steel native text extraction in OpenAI Chat Completions and
  Responses controllers by using the shared `extractSteelNativeMarkdownText`
  helper, with tests for nested text payloads.
- Removed attachment prompt pollution from `ChatForm`: file uploads no longer
  prefill the visible OCR default prompt, while the submit fallback still
  supports file-only OCR submission.
- Preserved graph system context after OpenAI OAuth tools are bound, ignored
  invalid image URLs instead of throwing during prompt conversion, and added
  best-effort stream cancellation for early-exit provider/native OAuth readers.
- Reworked OpenAI OAuth usage caching so cache entries are keyed by auth file,
  unavailable auth responses are short-cached, and concurrent usage lookups are
  coalesced.
- Cached native Steel tool JSON schema conversion by tool name instead of
  converting schemas on every request.
- Tightened Steel saved-count event validation to finite positive numbers and
  raised the client activity retention cap from 12 to 100 events.
- Simplified Markdown table action state by clearing timers on unmount and only
  attaching the theme observer while the expanded table modal is open.
- Consolidated repeated Playwright mock upload helpers into
  `e2e/specs/mock/helpers.ts` and replaced the fixed upload sleep with a
  deterministic wait for the uploaded file chip.
- Removed the dead `contextMode: 'compact_workbook'` argument from
  `ToolService`.
- Items intentionally not folded into this simplify pass because they need a
  separate contract or data-model migration guardrail: moving the shared Steel
  SSE event contract into data-provider, adding global-rule TTL/invalidation
  caching, making delete/insert rule writes transactional/versioned, and
  redesigning the client Steel activity atom-family registry.

Verification:

- `packages/api`: `rtk npx jest src/steel/native/oauth.spec.ts
  src/steel/native/usage.spec.ts src/steel/native/events.spec.ts
  src/steel/native/tools.spec.ts src/steel/ai/provider.spec.ts
  --coverage=false --runInBand ...` passed: 5 suites, 42 tests.
- `api`: `rtk npx jest
  server/controllers/agents/__tests__/openai.spec.js
  server/controllers/agents/__tests__/responses.unit.spec.js
  server/services/__tests__/ToolService.spec.js --coverage=false --runInBand
  ...` passed: 3 suites, 97 tests.
- `client`: `rtk npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx
  src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx
  src/hooks/Messages/__tests__/useSubmitMessage.spec.ts
  src/components/Chat/Input/__tests__/SendButton.spec.tsx --runInBand
  --watch=false --coverage=false` passed: 4 suites, 19 tests.
- `rtk npm run build:api` passed.
- `client`: `rtk npm run typecheck` passed.
- `rtk npx tsc --noEmit --pretty false --skipLibCheck --esModuleInterop
  --moduleResolution node --target es2022 --module commonjs
  e2e/specs/mock/helpers.ts e2e/specs/mock/chat.spec.ts
  e2e/specs/mock/steel-native.spec.ts` passed.
- `client`: `rtk npm run build` passed; existing direct-eval, large-chunk, and
  PWA glob warnings remain build warnings.
- `git diff --check` passed.

Previous completed work:

# Active: Compact Steel Runtime And Markdown Table Actions

Goal: make compact workbook the only Steel runtime mode so `read_markdown` is
always available, prove compact context is not the full workbook payload, and
add Markdown table actions for copy, XLSX download, and full-viewport review
without changing LibreChat's broader layout.

Plan:

- [x] Remove runtime mode switching from Steel context/tool exposure and keep
      compact workbook behavior as the only path.
- [x] Verify serialized compact context contains sheet row counts/anchors, not
      complete workbook rows, and capture an example for user review.
- [x] Add assistant Markdown table controls above rendered tables: copy
      Markdown, download XLSX, and expand.
- [x] Add a full-viewport table modal with the same copy/download actions and a
      close control.
- [x] Add focused runtime/frontend regression tests and run builds/checks.
- [x] Record review evidence and lessons.

Review - 2026-06-26 compact runtime and Markdown table actions:

- Steel runtime context is now compact-only. `PrepareSteelRuntimeContextInput`
  no longer accepts `mode`; handler/native context no longer pass
  `runtimeContextMode`; registry/native/provider tool surfaces no longer accept
  `contextMode` switches.
- `read_markdown` is always in the AI-visible Steel tool surface:
  `search_customers`, `search_price_candidates`, `run_file_ocr`,
  `read_markdown`.
- Serialized compact context example shape:

```json
{
  "outputSheets": {
    "contextMode": "compact_workbook",
    "previousOutputSheets": {
      "system_order": { "sheetId": "system_order", "rowCount": 1 },
      "customer_quote": { "sheetId": "customer_quote", "rowCount": 1 }
    },
    "compactWorkbook": {
      "sheets": {
        "system_order": {
          "sheetId": "system_order",
          "rowCount": 1,
          "rows": [
            {
              "rowId": "system_order:1",
              "rowIndex": 1,
              "anchors": {
                "項次": "1",
                "型號": "CCG075",
                "品名規格": "錏輕型鋼 75x45"
              }
            }
          ]
        }
      },
      "unresolvedCount": 1
    }
  }
}
```

- This is not the workbook Markdown and not the full workbook rows. Runtime
  tests prove serialized context omits full `cells`, `derivedIndex`, and the
  fixture-only value `full-row-only-note`.
- Markdown tables now render with action buttons above the table: copy Markdown,
  download XLSX, and expand. Expanded table opens a full-viewport modal with
  copy/download/close controls and explicitly syncs the root theme class and
  `data-theme`.
- Updated `docs/rules/agent規則.txt` and
  `docs/steel-native-librechat-master-framework.md` to describe compact-only
  runtime behavior.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/runtime/context.spec.ts src/steel/tools/registry.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts --coverage=false --runInBand` passed: 69 tests.
  - `cd client && npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false` passed: 7 tests.
  - `rtk npm run build:api` passed.
  - `cd client && rtk npm run typecheck` passed.
  - `cd client && rtk npm run build` passed; Vite reported existing eval,
    large chunk, and PWA glob warnings.
  - `git diff --check` passed.
  - Backend dev server restarted and `http://localhost:3080/health` returned
    `OK`.

Previous completed work:

# Active: OpenAI OAuth Native Chat Follow-Up

Goal: align the native `/c` OpenAI (OAuth) Steel quote flow with the user
corrections from the UI smoke: OAuth context accounting must use the 258K
provider limit, chat Markdown tables must be readable for OCR/system_order
workbooks, and database rules must match `docs/rules`.

Plan:

- [x] Root-cause the 947.6K context-window display and patch the shared token
      lookup path so OpenAI (OAuth) uses a 258K context source.
- [x] Add focused token-config/runtime tests proving OAuth context accounting
      no longer inherits the normal OpenAI gpt-5.5 1M window.
- [x] Widen native chat Markdown table cells and preserve horizontal scrolling
      without changing LibreChat's page layout.
- [x] Compare `steel.rules` readback with `docs/rules`, apply the existing
      sync script only where mismatched, and read back evidence.
- [x] Simplify native Steel rule prefix sections so each prompt rule section
      maps to a `docs/rules/*.txt` source in `steel.rules`.
- [x] Remove empty/legacy native prompt sections that are not DB-backed rules:
      `reviewed_agent_rules`, `instruction_packets`, and prompt-level
      `tool_policy`.
- [x] Rename `quote_defaults_and_rules` to the shorter `quote_rules`.
- [x] Rename `createSteelNativeRuntimeContextDependencies` to the shorter
      `createSteelContextDependencies`.
- [x] Rebuild/restart only what changed and run focused verification.

Review - 2026-06-26 rules and native context:

- Cloud `steel.rules` now matches all 8 repo rule files under `docs/rules`:
  `agent規則.txt`, `輸出規則.txt`, `其他規則/OCR規則.txt`, and the five
  `鋼材規則/*.txt` files.
- Native prompt prefix now has only DB-backed rule sections:
  `agent` = 1, `quote_rules` = 5, `output` = 1, `other` = 1.
- Removed native prompt sections that were misleading or empty:
  `reviewed_agent_rules` was a duplicate of the agent rule, `instruction_packets`
  points at a legacy cloud table that does not exist, and prompt-level
  `tool_policy` was runtime executable configuration rather than a rule txt.
- `quote_defaults_and_rules` is now `quote_rules`.
- `createSteelNativeRuntimeContextDependencies()` is now
  `createSteelContextDependencies()`. Built exports include the new function and
  no longer export the old long name.
- Runtime `toolPolicy` is still used as backend executable configuration and is
  serialized in runtime JSON, not as a prompt rule section. Current values:
  - visible tools: `search_customers`, `search_price_candidates`,
    `run_file_ocr`, `read_markdown`.
  - removed tools: none.
  - OCR correction policy: user OCR/table corrections update complete Markdown
    directly; do not call `run_file_ocr` again unless the user explicitly asks
    to rerun OCR or provides new/changed file evidence.
  - `read_markdown` usage policy: use only when history lacks complete
    OCR/workbook Markdown; forbid when history already has needed Markdown;
    allowed scopes are `workbook` and `ocr`; always active-conversation scoped.
- DB row `tool_policy` metadata readback:
  - `steel-default-agent-instruction`: available tools
    `search_customers`, `search_price_candidates`, `run_file_ocr`,
    `read_markdown`.
  - `steel-workbook-output-policy`: same available tools.
  - `steel-drawing-ocr-policy`: `run_file_ocr`, required before
    drawing evidence extraction, must mark low confidence.
  - five steel quote rules: empty `tool_policy`.
- No new txt file is needed for runtime `toolPolicy`: the AI-facing behavior is
  already present in `docs/rules/agent規則.txt`, `docs/rules/輸出規則.txt`, and
  `docs/rules/其他規則/OCR規則.txt`; the remaining runtime field controls actual
  backend tool exposure and should stay code-owned.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/native/context.spec.ts src/steel/native/metadata.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts --coverage=false --runInBand` passed with 24 tests.
  - `rtk npm run build:api` passed.
  - Built-dist smoke confirmed 8 rule markers are present in prompt, sections
    are `agent`, `quote_rules`, `output`, `other`, prompt `Steel Tool Policy`
    is absent, and `instructionPackets` is absent from runtime prompt text.
  - `git diff --check` passed.
  - `curl http://localhost:3080/health` returned `OK`.
  - A direct `tsc --noEmit` remains blocked by existing repo-wide type issues
    in unrelated Redis/manual-spec/OAuth test files; package build still passes.

Previous completed work:

# OpenAI OAuth Native Chat Runtime Bugfix

Goal: fix the native `/c` OpenAI (OAuth) path so a user can attach
`docs/reference/example/PL.pdf`, run OCR, see the OCR table, confirm it, and
let the AI continue into quotation without the LangChain graph rejecting the
OAuth model adapter.

Plan:

- [x] Reproduce the reported `Expected a Runnable, function or object` error
      with a focused native OAuth graph pipeline test.
- [x] Make the OpenAI OAuth model and graph model conform to LangChain
      `Runnable` so native system context piping works.
- [x] Run focused OAuth/runtime regression tests.
- [x] Check API build and whitespace/diff sanity.
- [x] Record review evidence and any lessons learned.

Review - 2026-06-26 OpenAI OAuth native chat runtime:

- Root cause: `createOpenAIOAuthModel()` / `createOpenAIOAuthGraphModel()`
  returned plain class instances with `invoke()` and `stream()`, but LibreChat
  agents calls `AgentContext.systemRunnable.pipe(model)`. LangChain only accepts
  real `Runnable` instances, functions, or runnable maps, so the native `/c`
  OAuth path failed with `Expected a Runnable, function or object`.
- Fix: `OpenAIOAuthModel` and `OpenAIOAuthGraphModel` now extend LangChain
  `Runnable`, keep `bindTools()` behavior, and implement streaming through
  `_streamIterator()`.
- Follow-up fix: `OpenAIOAuthGraphModel` can apply the native agent
  `systemRunnable` itself when LibreChat invokes `overrideModel` directly,
  preserving native Steel context/rules without changing the LibreChat UI/UX
  layout.
- Regression coverage:
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts --coverage=false --runInBand --testNamePattern "system context runnable"` first reproduced the reported unsupported-type error, then passed after the fix.
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts src/steel/native/title.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand` passed with 73 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand` passed with 87 tests.
  - `npm run build:api` passed after adding explicit `lc_namespace: string[]`
    declarations.
  - `git diff --check` passed.

Follow-up - 2026-06-26 live retry:

- User retried `/c` and still saw `Expected a Runnable, function or object`.
  Root cause of the retry: the backend on port 3080 was still the old
  `api/server/index.js` child process started at 16:31, before the fixed
  `@librechat/api` dist was built.
- Restarted the actual 3080 backend process. New startup reached readiness at
  `2026-06-26T08:58:22Z`, and `curl http://localhost:3080/health` returned
  `OK`.
- Runtime package smoke verified the built `createOpenAIOAuthGraphModel()` is
  `lc_runnable: true` and can be piped by
  `@librechat/agents/langchain/runnables`.
- Real DB native context smoke against `.env` `STEEL_POSTGRES_URL` succeeded:
  the current schema uses `steel.rules` / `steel.prices`, not legacy
  `steel.agent_rules` / `steel.quote_defaults`; native context fail-opened the
  missing legacy tables and loaded 5 quote/steel rules, 1 output rule, and 1
  OCR/other rule.
- Full live smoke passed:
  `cd packages/api && NODE_OPTIONS=--experimental-vm-modules STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_TIMEOUT_MS=900000 npx jest --coverage=false --runInBand --runTestsByPath src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --testPathIgnorePatterns 'a^'`
  passed in 192.38s.
- Live evidence file:
  `tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json`
  shows first turn called `run_file_ocr` on `PL.pdf` and returned an OCR
  confirmation table; confirmed quote turn did not rerun OCR, called
  `search_price_candidates`, and returned `system_order`, `customer_quote`, and
  `manual_review` Markdown tables.
- After the restart, scanning `api/logs/error-2026-06-26.log` from
  `2026-06-26T08:58:14Z` found zero new matches for
  `Expected a Runnable`, `generateOpenAIOAuthTitle is not a function`, or
  `Missing credentials`.

Previous completed work:

# Phase 14 OpenAI OAuth UI Provider And Usage Remaining

Goal: add a first/default `OpenAI (OAuth)` provider option to the normal
LibreChat model selector and show ChatGPT OAuth usage remaining under the OAuth
model list without changing the existing LibreChat UI layout or duplicating
Steel tool/OCR/quote flows.

Follow-up goal: allow a file-only chat submit by auto-filling the native
composer with the Steel OCR review prompt when attachments are present and the
message text is empty.

Plan:

- [x] Research how the local `openai-oauth-provider` can retrieve usage
      remaining.
- [x] Add focused backend tests for OAuth usage parsing, sanitization, caching,
      and unavailable-state behavior.
- [x] Add shared data-provider types/endpoints for sanitized OAuth usage
      remaining.
- [x] Add a thin authenticated backend route that calls ChatGPT WHAM OAuth
      usage with the bearer token and returns only UI-safe remaining/reset data.
- [x] Add `OpenAI (OAuth)` as the first/default model-provider UI option while
      reusing the shared Steel native context/tools/OCR/quote modules.
- [x] Add Usage remaining rows under the OAuth model list only, with loading and
      unavailable states.
- [x] Run focused Jest tests, data-provider build, frontend build or smoke
      checks, backend restart if needed, and `git diff --check`.
- [x] Record review evidence.
- [x] Auto-fill the composer with `OCR檔案內容，逐一列表給我核對。` when a file
      is attached and the text area is empty.
- [x] Let the send button submit when attachments exist even if text is still
      empty.
- [x] Add a submit-time fallback so keyboard/programmatic submits send the same
      default prompt with file-only messages.
- [x] Add focused regression tests and run client checks.
- [x] Fix `OpenAI (OAuth)` native chat runtime so SDK graph creation does not
      fall back to the API-key OpenAI client without the OpenAI OAuth override.
- [x] Disable unsupported OAuth title generation until the title path has its
      own OAuth-backed model.
- [x] Add focused regression tests for the OAuth graph override and title skip.
- [x] Rebuild/verify backend packages and restart the local backend for testing.
- [x] Implement OAuth-backed title generation for `OpenAI (OAuth)` without
      using the normal API-key OpenAI title path.
- [x] Add focused regression tests for OAuth title generation, usage recording,
      and prompt isolation from Steel runtime context.
- [x] Rename generic OpenAI OAuth transport/model/title symbols so they no
      longer use `Steel` as a prefix.
- [x] Keep `Steel` naming only for quote/OCR/rules/context/tooling modules and
      behavior, while preserving external provider ids/routes/UI labels.
- [x] Run focused OAuth/title/runtime tests, API build, and health checks after
      the rename.

Research lock:

- The local `openai-oauth-provider` package exposes `loadAuthTokens()` and
  wraps ChatGPT Codex Responses calls, but it does not expose a public usage
  helper.
- The live-verified usage endpoint is
  `GET https://chatgpt.com/backend-api/wham/usage` with the Codex OAuth bearer
  access token. The previously assumed `/backend-api/codex/usage` returns 403.
- The response contains `rate_limit.primary_window` and
  `rate_limit.secondary_window` with `used_percent`, `limit_window_seconds`,
  `reset_after_seconds`, and `reset_at`. UI remaining percent is
  `100 - used_percent`.
- A 5-hour primary window maps to the screenshot's `5h` row, and the 604800
  second secondary window maps to the weekly row.
- Backend responses must not expose OAuth access tokens, refresh tokens,
  account IDs, emails, auth file paths, or raw ChatGPT usage JSON. The frontend
  receives only sanitized window labels, remaining/used percentages, reset
  timestamps, and availability metadata.
- Usage fetch is best-effort and should be cached briefly in backend memory so
  opening the model selector does not hammer the OAuth endpoint.
- This is provider/model UI work only. Steel tools, OCR, quote parsing, runtime
  context, and Markdown recovery remain the shared native Steel modules.

Review - 2026-06-26:

- Added normal LibreChat endpoint support for `openai_oauth_responses` as
  `OpenAI (OAuth)`, first in the default endpoint list and backed by the
  existing native OpenAI OAuth provider path.
- Added a sanitized authenticated route at `/api/steel/ai/oauth-usage`. It uses
  `openai-oauth-provider` only to load/refresh the local Codex OAuth token,
  calls live-verified `https://chatgpt.com/backend-api/wham/usage`, caches the
  result briefly, and returns only `remainingPercent`, `usedPercent`, window
  seconds, reset timestamps, and availability metadata.
- Added shared data-provider usage schemas, endpoint keys, data-service method,
  and React Query hook.
- Added a small `Usage remaining` footer under the OAuth model list only. It
  keeps the existing selector layout and shows the 5h/weekly windows with
  loading/unavailable states.
- Live sanitized probe from the built API returned `chatgpt_wham_usage` with
  available primary and secondary windows; no token/account/email/auth path was
  printed.
- Verification:
  - `npm run build:data-provider` passed.
  - `cd packages/api && npx jest src/steel/native/usage.spec.ts src/endpoints/openai/oauth.spec.ts src/steel/native/provider.spec.ts --coverage=false --runInBand` passed with 10 tests.
  - `cd packages/data-provider && npx jest src/config.spec.ts src/steel/ai.spec.ts --coverage=false --runInBand` passed with 130 tests.
  - `cd api && npx jest server/routes/__tests__/steel.spec.js --coverage=false --runInBand` passed with 13 tests.
  - `cd client && npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx src/utils/__tests__/getDefaultEndpoint.test.ts --coverage=false --runInBand` passed with 5 tests.
  - `npm run build:api` passed.
  - `cd client && npm run typecheck` passed.
  - `npm run build:client` passed with existing Vite/PWA warnings about
    `vm-browserify` eval, large chunks, and unmatched icon glob patterns.
  - `git diff --check` passed.

Correction - 2026-06-26:

- The original `OpenAI` API-key endpoint must remain visible separately from
  `OpenAI (OAuth)`. When `OPENAI_API_KEY` is not set server-side, it should
  fall back to LibreChat's existing user-provided key mode so the selector can
  open the API-key settings dialog.
- `Usage remaining` should not hide all failure modes behind a plain
  `Unavailable` label. The UI now surfaces the sanitized backend reason and
  retries unavailable usage checks while the OAuth model list is open.
- Added focused regression coverage for the OpenAI API-key fallback and the
  OAuth usage unavailable reason label.
- Follow-up: the OpenAI API-key fallback also had to be wired into the runtime
  `initializeOpenAI()` path. Without `OPENAI_API_KEY=user_provided`, the UI
  could save a user key but the runtime would not read it. `initializeOpenAI()`
  now treats a missing `OPENAI_API_KEY` for the original `OpenAI` endpoint as
  user-provided, matching the selector config fallback.
- File-only submit follow-up: when the user attaches a file and the composer is
  empty, native LibreChat now auto-fills `OCR檔案內容，逐一列表給我核對。`. The send
  button also treats attached files as submit-ready, and `useSubmitMessage()`
  applies the same default prompt as a submit-time fallback for keyboard or
  programmatic submits.
- Verification:
  - `cd api && npx jest server/services/Config/__tests__/EndpointService.spec.js server/services/Config/loadDefaultEConfig.spec.js server/routes/__tests__/steel.spec.js --coverage=false --runInBand` passed with 23 tests.
  - `cd client && npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx src/utils/__tests__/getDefaultEndpoint.test.ts --coverage=false --runInBand` passed with 5 tests.
  - `cd packages/api && npx jest src/endpoints/openai/initialize.spec.ts src/endpoints/openai/oauth.spec.ts --coverage=false --runInBand` passed with 11 tests.
  - `cd api && npx jest server/services/Config/__tests__/EndpointService.spec.js server/services/Config/loadDefaultEConfig.spec.js --coverage=false --runInBand` passed with 10 tests.
  - `cd client && npx jest src/hooks/Messages/__tests__/useSubmitMessage.spec.ts src/components/Chat/Input/__tests__/SendButton.spec.tsx src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx src/utils/__tests__/getDefaultEndpoint.test.ts --coverage=false --runInBand` passed with 11 tests.
  - `npm run build:api` passed.
  - `cd client && npm run typecheck` passed after the file-only submit changes.
  - `npm run build:client` passed with the same Vite/PWA warnings already
    noted above.
  - Built API live usage probe returned `status: available`,
    `source: chatgpt_wham_usage`, primary remaining 56%, and weekly remaining
    51%.

Correction - 2026-06-26 runtime:

- Root cause of the `Missing credentials` error: native chat correctly mapped
  `openai_oauth_responses` to SDK provider `openAI`, but the Steel OAuth
  override was checking the mapped graph `provider` instead of the original
  initialized agent endpoint/provider. The SDK then initialized the normal
  OpenAI client without an API key.
- `createRun()` now decides whether to attach the OpenAI OAuth graph override
  from the original initialized agent (`endpoint` or `provider` equals
  `openai_oauth_responses`) while leaving the SDK graph provider as `openAI`.
- Auto title generation initially had to avoid `run.generateTitle()` because it
  constructs a normal title LLM from provider/options and does not use the Steel
  OAuth override model.
- Verification:
  - `cd packages/api && npx jest src/agents/__tests__/run-summarization.test.ts src/endpoints/openai/oauth.spec.ts --coverage=false --runInBand` passed with 66 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand` passed with 87 tests.
  - `npm run build:api` passed.
  - `curl -sS http://localhost:3080/health` returned `OK`.
  - Built `packages/api/dist/index.cjs` contains the new `sourceAgent` OAuth
    override path, and nodemon restarted the backend at `16:08:19`.
  - `git diff --check` passed.

Correction - 2026-06-26 OAuth title:

- Added `generateOpenAIOAuthTitle()` in `packages/api/src/steel/native`.
  It uses the existing `openai-oauth-provider` transport through
  `createOpenAIOAuthModel()` and returns only title text plus usage
  metadata.
- `AgentClient.titleConvo()` now routes `OpenAI (OAuth)` title generation to
  that helper instead of `run.generateTitle()`. The normal API-key OpenAI title
  path is still used for the original `OpenAI` endpoint and other providers.
- The OAuth title prompt uses only the current user text, assistant text parts,
  and title prompt/template settings. It does not inject Steel runtime context,
  workbook/OCR state, or tools.
- Verification:
  - Red tests failed before implementation:
    `cd packages/api && npx jest src/steel/native/title.spec.ts --coverage=false --runInBand`
    failed because `./title` did not exist; `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand --testNamePattern "OpenAI OAuth title"`
    failed because the OAuth branch returned `undefined`.
  - `cd packages/api && npx jest src/steel/native/title.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand` passed with 6 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js --coverage=false --runInBand` passed with 87 tests.
  - `npm run build:api` passed.
  - Built `packages/api/dist/index.cjs` and `packages/api/dist/index.d.cts`
    export `generateOpenAIOAuthTitle`.
  - Nodemon restarted the backend and readiness checks passed at `16:19:00`.

Correction - 2026-06-26 OpenAI OAuth naming:

- Renamed generic OAuth transport/model/title symbols away from `Steel`:
  `createOpenAIOAuthModel()`, `OpenAIOAuthModel`,
  `createOpenAIOAuthGraphModel()`, `OpenAIOAuthGraphModel`,
  `generateOpenAIOAuthTitle()`, and the OpenAI OAuth graph override helpers.
- Renamed OpenAI OAuth config and usage helper symbols away from `Steel`:
  `parseOpenAIConfig()`, `resolveOpenAIOAuthAuthFilePath()`,
  `OpenAIOAuthUsageRemaining`, `getOpenAIOAuthUsage()`, and
  `useGetOpenAIOAuthUsageQuery()`.
- Preserved external contracts: provider id remains `openai_oauth_responses`,
  UI label remains `OpenAI (OAuth)`, usage URL remains
  `/api/steel/ai/oauth-usage`, and legacy `STEEL_OPENAI_*` env names remain as
  fallback aliases. `.env.example` now documents the preferred `OPENAI_*`
  names.
- Restored `steelProviderMetadata` after the broad rename pass; that metadata
  still belongs to Steel structured response state, not generic OAuth provider
  transport.
- Verification:
  - `cd packages/api && npx jest src/steel/ai/config.spec.ts src/steel/native/oauth.spec.ts src/steel/native/title.spec.ts src/steel/native/usage.spec.ts src/agents/__tests__/run-summarization.test.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand` passed with 6 suites / 98 tests.
  - `cd api && npx jest server/controllers/agents/client.test.js server/routes/__tests__/steel.spec.js --coverage=false --runInBand` passed with 2 suites / 100 tests.
  - `cd client && npx jest src/components/Chat/Menus/Endpoints/components/__tests__/OpenAIOAuthUsageRemaining.test.tsx --coverage=false --runInBand` passed with 3 tests.
  - `npm run build:api` passed.
  - `cd packages/data-provider && npm run build` passed and rebuilt the shared
    dist/type exports.
  - `cd client && npm run typecheck` passed.
  - `git diff --check` passed.
  - `curl -sS http://localhost:3080/health` returned `OK`.
  - `curl -I -sS http://localhost:3090` returned `HTTP/1.1 200 OK`.
  - Targeted grep over source/client/server files found no remaining old
    Steel-prefixed OpenAI OAuth model/title/usage/config helper names, and no
    accidental provider metadata rename.

# Active: search_price_candidates Material Keyword Lookup

Goal: make `search_price_candidates` treat lookup `material` as a material
keyword, with query-facing material choices simplified to oral lookup terms.

Plan:

- [x] Write failing schema/repository tests for simplified material keywords while keeping
      import storage variants unchanged.
- [x] Change AI-facing material input handling so storage variants collapse to
      simple query keywords for tool calls only.
- [x] Change price lookup SQL so `material` filters use keyword matching instead
      of exact equality.
- [x] Update rule/schema docs that expose Steel material choices.
- [x] Run focused Jest tests and `git diff --check`.
- [x] Record review evidence.
- [x] Add regression coverage for broad `鐵板/鋼板` + `鋅` lookup.
- [x] Relax `鐵板/鋼板` + `鋅` query filters so sparse zinc plate data is not
      over-constrained by thickness or keyword terms.
- [x] Re-run focused repository/tool/provider tests and record verification.
- [x] Correct related cutting whitelist: only rail/H/I/angle/channel/flat/round
      bar/square bar/pipe/tube categories attach `切工/切割` rows.
- [x] Remove the wrong Steel plate cutting-price assumption from task lessons
      and rule-facing docs.
- [x] Re-run focused tests after the whitelist correction.

Design lock:

- AI-facing `material` should expose simple query keywords: `黑鐵`, `白鐵`,
  `錏`, `鋁`, and `鋅`.
- Import/storage material values remain canonical source values; do not collapse
  `OT 黑鐵`, `No1 白鐵3t以上含`, `BA 白鐵亮面`, `錏/鍍鋅`, `鋁鋅`, or other source
  labels into query keywords in the import path.
- Price search should find existing rows whose `material`, product name, spec
  key, ERP code, or source spec carries the requested material marker.
- `鐵板/鋼板` lookup queries should not be related to separate `切工/切割`
  rows, and Steel plate has no separate cutting price lookup.
- Only `鐵軌`/鋼軌, `H型鋼`, `工字鐵/I字鐵`, `角鐵/角鋼`, `槽鐵`,
  `平鐵/扁鐵`, `圓鐵/圓鋼`, `方鋼/方鐵`, `圓管/鋼管`, `方管`, and
  `扁方管` attach related `切工/切割` rows.
- `鐵板/鋼板` with lookup material `鋅` should stay broad because there are only
  a few zinc-family plate rows; category plus material is enough and should not
  be narrowed by thickness or extra keyword terms.
- This is a behavior change only; no Steel PostgreSQL table migration is needed.

Review - 2026-06-25:

- Added query-only material enum values `黑鐵`, `白鐵`, `錏`, `鋁`, and `鋅`.
  Import/storage `materialKinds` and Steel PostgreSQL material checks remain
  unchanged.
- `searchSteelPriceItems` now applies lookup `material` as an `ILIKE` keyword
  against `material`, `product_name`, `spec_key`, `erp_item_code`, and
  `source_spec` instead of `material = $n`.
- Category discovery keyword matching now includes `material`, so split terms
  such as `白鐵 方管` can match across material and product/spec fields.
- Plate lookups stay within `鐵板/鋼板` category data; they do not OR in
  separate `切工/切割` related rows.
- Corrected the plate cutting assumption: `鐵板/鋼板` has no separate cutting
  price lookup. Related `切工/切割` rows are attached only for the explicit
  rail/H/I/angle/channel/flat/round bar/square bar/pipe/tube category whitelist.
- `鐵板/鋼板` + `鋅` lookup now stays broad and ignores thickness/keyword
  narrowing, so sparse zinc-family plate rows are searched by category plus
  material keyword only.
- Updated the AI-visible tool schema, tool description, agent rule doc, and
  provider/tool/repository tests to use the simplified query enum.
- Verification:
  - `cd packages/api && npx jest src/steel/pricing/import.spec.ts src/steel/tools/registry.spec.ts src/steel/repositories/prices.spec.ts src/steel/tools/execute.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand` passed with 68 tests after the related-cutting whitelist correction.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still fails
    on existing unrelated TypeScript errors in cache/openai/langchain/manual
    Steel specs/rules/vision files; no current touched file remains in the
    error list.

# Active: Phase 1 Native Steel Context Adapter Interface

Goal: create the first native Steel context adapter contract at
`packages/api/src/steel/native/context.ts` using the master framework as the
only architecture entrypoint.

Plan:

- [x] Read project instructions, current lessons, master framework, and active
      implementation plan.
- [x] Inspect existing Steel runtime context and native AgentClient context
      seams.
- [x] Add the Phase 1 native context adapter interface and minimal render
      helpers.
- [x] Add focused tests for fixed prefix ordering, compact mode defaults, global
      OCR/file rule inclusion, and metadata-only attachment references.
- [x] Export the native adapter through `@librechat/api`.
- [x] Run focused verification and record review evidence.

Design lock:

- Steel native context is global. Do not add modelSpec opt-in, ordinary-chat
  classifier, YAML Steel enablement switches, or Phase 1 runtime disable paths.
- `instructionPrefix` uses the fixed user-confirmed order: agent rules, quote
  defaults/rules, output rules, tool policy, other rules including OCR/file
  rules, reviewed agent rules, instruction packets.
- Runtime context defaults to `compact_workbook`.
- Attachments enter Phase 1 Steel context as LibreChat file metadata/references
  only. File bytes/base64 stay in LibreChat provider/file pipelines; OCR bytes
  are fetched later by the AI-visible `run_file_ocr` tool executor.
- `fileAnalysis.instructions` is not a duplicate Steel OCR policy source for
  native context. Reviewed Steel OCR/file rules are authoritative.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/context.ts` with the Phase 1 native
  adapter contract:
  - `buildSteelGlobalAgentContext(input)` returns `instructionPrefix`,
    `runtimeContextText`, raw `runtimeContext`, diagnostic metadata, context
    slot labels, attachment references, and prefix section metadata.
  - `SteelNativeFileReference` carries LibreChat file metadata/references only;
    it has no byte/base64 field.
  - Native context metadata records `nativeContextVersion: 1`,
    `globalApplied: true`, `contextMode`, `renderProfile`, byte policy, OCR
    execution policy, and fixed prefix order.
- Added `packages/api/src/steel/native/index.ts` and exported the native adapter
  through `packages/api/src/steel/index.ts` and `packages/api/src/index.ts`.
- Native adapter loads other global rules directly; OCR rules are a fixed
  `otherGlobalRules` subset and do not use an `includeOcrRules` runtime gate.
- Verification:
  - `cd packages/api && npx jest src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `git diff --check` for the touched files passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still fails on
    existing project errors in cache/openai endpoint/manual Steel specs/rules
    tooling, but the native context files are no longer in the TypeScript error
    list after fixing the readonly attachment evidence mismatch.

Review - 2026-06-27 OCR rule loading correction:

- Confirmed `steel-drawing-ocr-policy` is an active reviewed `other` rule in
  `steel.rules`, with `file_ocr`, `drawing_ocr`, and `vision_evidence`
  sections.
- Removed the `includeOcrRules` runtime gate from Steel runtime context,
  handlers, and native context injection. `listOtherGlobalRules()` is now a
  no-argument dependency. OCR rules are not loaded through a separate path; they
  are classified from the loaded `otherGlobalRules` rows into the fixed
  `otherGlobalRules.ocrRules` subset.
- Confirmed the existing OCR persistence path stores `run_file_ocr` output as
  current conversation `ocr_extract` memory rows, replaces prior active OCR
  extracts for the conversation, and reads them back through
  `derivedIndex.ocrExtracts`.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed.
  - `cd packages/api && rtk npx jest src/steel/ai/provider.spec.ts src/steel/handlers.spec.ts src/steel/memory/service.spec.ts src/steel/tools/execute.spec.ts --coverage=false --runInBand`
    passed.
  - `rtk npm run build:api` passed.
  - `git diff --check` passed.

# Active: OpenAI OAuth API Native Chat Plan Documentation

Goal: update the Steel native LibreChat master framework and implementation
plan so normal LibreChat chat explicitly supports OpenAI OAuth API through a
native provider adapter.

Plan:

- [x] Inspect existing provider-state and OAuth policy wording.
- [x] Update the master framework with native OpenAI OAuth chat support as a
      product target.
- [x] Update the implementation plan Phase 5 and verification checklist.
- [x] Run documentation diff checks and record review evidence.

Design lock:

- OpenAI OAuth API support belongs in the normal LibreChat chat path through
  `packages/api/src/steel/native/provider.ts`, not through `/steel/oauth-chat`.
- OAuth mode remains stateless/reconstructed: `responsesState: false`, no
  provider `previous_response_id` dependency, LibreChat Mongo history remains
  canonical.
- Native OAuth support must preserve LibreChat stream, abort, files/vision,
  tools, permissions, and Steel context/tool policy.

Review - 2026-06-25:

- Updated `docs/steel-native-librechat-master-framework.md` so normal
  LibreChat chat explicitly supports OpenAI OAuth API through
  `packages/api/src/steel/native/provider.ts`.
- Updated the provider policy to require `openai_oauth_stateless`,
  `responsesState: false`, reconstructed LibreChat context, and no provider
  `previous_response_id` dependency.
- Updated `docs/plans/2026-06-24-steel-global-native-librechat-integration.md`
  Phase 5 from only provider-state resolution to native provider adapter plus
  provider-state resolver.
- Added plan/test coverage for native OpenAI OAuth API preserving stream,
  abort/resume, files/vision, tool execution, message persistence, permissions,
  and text/PDF/image Steel fixture smoke.
- Replaced old "Steel disabled" verification wording with ordinary non-quote
  chat behavior under the global Steel framework.
- Verification: `git diff --check` passed for the touched docs/task files, and
  `rg` confirms both master framework and implementation plan now name native
  OpenAI OAuth API support and keep `/steel/oauth-chat` dev-only.

# Active: Phase 2 Native Steel Top Prefix Seam

Goal: add the native Agent context seam that lets Steel put stable global rules
before base agent instructions without moving existing LibreChat dynamic
context.

Plan:

- [x] Inspect current `packages/api/src/agents/context.ts` behavior and tests.
- [x] Add tests for `globalInstructionPrefix` ordering.
- [x] Implement optional `globalInstructionPrefix` in `buildAgentInstructions`
      and `applyContextToAgent`.
- [x] Run focused Jest and diff checks.

Design lock:

- `globalInstructionPrefix` is for stable top-of-context Steel rules only.
- Existing agent instructions and MCP instructions remain after the prefix.
- Existing `additional_instructions`, shared run context, Memory, RAG, file
  context, and agent-scoped context remain in the dynamic additional-instruction
  path.

Review - 2026-06-25:

- Added optional `globalInstructionPrefix` to
  `packages/api/src/agents/context.ts`:
  - `buildAgentInstructions()` now orders stable instructions as Steel/global
    prefix, base agent instructions, then MCP instructions.
  - `applyContextToAgent()` forwards the prefix in both normal and fallback
    paths.
  - Existing `additional_instructions` and `sharedRunContext` remain in
    `buildAgentAdditionalInstructions()`.
- Added regression coverage in `packages/api/src/agents/context.spec.ts` for
  prefix-only, prefix-before-base/MCP, and preservation of existing dynamic
  additional instructions.
- Verification:
  - `cd packages/api && npx jest src/agents/context.spec.ts --coverage=false --runInBand`
    passed with 35 tests.
  - `cd packages/api && npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand`
    passed with 13 tests.
  - `git diff --check` passed for touched implementation/task files.
  - Full `tsc` still has existing project errors, but filtering the full output
    for touched `agents/context` and `steel/*/context` files returned no
    errors.

# Active: Phase 2 Native AgentClient Steel Context Hook

Goal: wire the Phase 1 native Steel context adapter into normal LibreChat
`AgentClient.buildMessages()` so every native agent run receives Steel global
instructions and compact runtime context without moving LibreChat file bytes.

Plan:

- [x] Add a regression test for native Steel prefix/runtime-tail injection in
      `api/server/controllers/agents/client.test.js`.
- [x] Add a default native Steel dependency builder for JS callers in
      `packages/api/src/steel/native/context.ts`.
- [x] Convert LibreChat message/file records into metadata-only Steel native
      references inside `AgentClient.buildMessages()`.
- [x] Pass Steel stable rules through `globalInstructionPrefix` and append
      Steel runtime context to the dynamic shared context tail.
- [x] Run focused package tests, JS syntax check, TypeScript filtered check,
      and diff checks.

Design lock:

- The JS controller remains a thin bridge: it maps LibreChat conversation
  history and file records to native Steel metadata references, then calls the
  TypeScript native context builder.
- Current-turn file bodies stay in LibreChat's existing request/file context
  path. Steel native context only receives file identifiers and metadata.
- Steel stable prefix is injected at the top of agent instructions through
  `globalInstructionPrefix`.
- Steel compact runtime context is appended to the existing dynamic
  `additional_instructions` tail with other run-level context.

Review - 2026-06-25:

- Added `buildDefaultSteelGlobalAgentContext()` and
  `createSteelNativeRuntimeContextDependencies()` in
  `packages/api/src/steel/native/context.ts`.
- The default dependency builder reads reviewed Steel agent rules, quote
  defaults/rules, output rules, other file/OCR rules, instruction packets, and
  output-sheet workbook state from the existing Steel repositories/services.
- Updated `AgentClient.buildMessages()` to:
  - capture current-turn LibreChat attachment metadata after normal attachment
    processing;
  - pass active conversation history, current user turn, and current file
    references into the native Steel context adapter;
  - append `runtimeContextText` to the shared dynamic context;
  - pass `instructionPrefix` to `applyContextToAgent()` as the global prefix.
- Added a controller regression test asserting Steel prefix/tail injection while
  keeping current request file body content in the user prompt path.
- Verification:
  - `cd packages/api && npx jest src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts src/agents/context.spec.ts --coverage=false --runInBand`
    passed with 49 tests.
  - `node -c api/server/controllers/agents/client.js` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched context files
    returned no errors.
  - `git diff --check -- api/server/controllers/agents/client.js api/server/controllers/agents/client.test.js packages/api/src/steel/native/context.ts packages/api/src/steel/native/context.spec.ts tasks/todo.md`
    passed.
  - `cd api && npx jest server/controllers/agents/client.test.js --runInBand --coverage=false --testNamePattern "injects native Steel prefix"`
    is currently blocked before test execution by the existing root dependency
    state: `Cannot find module '@langchain/core/errors'` from
    `@langchain/openai`.

# Active: Phase 3 Additive Steel Native Tools

Goal: merge Steel business tools into native LibreChat agent tool loading and
execution without removing user tools, MCP tools, actions, web search, file
search, or code execution.

Plan:

- [x] Add native Steel tool adapter tests for additive merge, compact workbook
      gating, deterministic name collisions, and executable wrapper behavior.
- [x] Create `packages/api/src/steel/native/tools.ts` and export it through
      the native Steel barrel.
- [x] Convert Steel provider tool definitions into native `LCTool`
      definitions with JSON schemas.
- [x] Merge Steel tools into `ToolService` definitions-only loading while
      preserving existing user-selected tools.
- [x] Intercept Steel tool calls in `loadToolsForExecution()` and execute them
      through `executeSteelTool()` instead of the generic LibreChat tool
      loader.
- [x] Run focused package tests, TypeScript filtered check, JS syntax checks,
      and diff checks.

Design lock:

- Steel tools are additive native tools. They do not replace user tools, MCP,
  actions, web/file search, code execution, or deferred/programmatic tool
  behavior.
- Tool visibility follows the Steel runtime tool policy and defaults to
  `compact_workbook`; Markdown-derived state recovery uses `read_markdown`
  only, scoped to the active conversation.
- If a native tool name already exists, the Steel adapter deterministically
  exposes the Steel version as `steel_<toolName>` and maps execution back to the
  canonical Steel tool name.
- `ToolService.js` remains a thin bridge. Steel tool schema conversion and
  name mapping live in TypeScript under `packages/api/src/steel/native/tools.ts`.
- Native execution uses existing Steel repositories and Mongo-backed structured
  state readers keyed by LibreChat `conversationId`. Successful native Steel
  tool results are captured through the Phase 8 Markdown/state adapter.

Review - 2026-06-25:

- Added `mergeSteelToolDefinitions()` to convert `getSteelToolDefinitions()`
  into native `LCTool` definitions.
- Added `createSteelNativeTool()` and `resolveSteelProviderToolName()` so
  native tool calls can execute canonical Steel tools even when the visible name
  is namespaced after a collision.
- Exported native Steel tools through `packages/api/src/steel/native/index.ts`.
- Updated `api/server/services/ToolService.js` so definitions-only loading:
  - no longer returns early before Steel global tools are considered;
  - filters legacy pseudo-tools and Steel tool names out of the generic loader;
  - merges Steel tool definitions into the returned `toolDefinitions` and
    `toolRegistry`.
- Updated `loadToolsForExecution()` so Steel tool calls are handled by native
  executable wrappers backed by `executeSteelTool()`, `createSteelPostgresPool()`,
  and Mongo Steel structured-state readers.
- Verification:
  - `cd packages/api && npx jest src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts src/agents/context.spec.ts --coverage=false --runInBand`
    passed with 54 tests.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched Steel native,
    Steel tools, Steel runtime, and agent context files returned no errors.
  - `node -c api/server/services/ToolService.js` passed.
  - `node -c api/server/controllers/agents/client.js` passed.
  - `git diff --check` passed for touched implementation, docs, and task files.
  - `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "loadAgentTools"`
    is currently blocked before test execution by the existing root dependency
    state: `Cannot find module '@langchain/core/errors'` from
    `@langchain/openai`.

# Active: Phase 8 Native Markdown And Tool State Capture

Goal: connect native LibreChat assistant persistence and native Steel tool
execution to the existing Steel structured quote/workbook state writer without
moving Steel parsing logic into generic LibreChat persistence code.

Plan:

- [x] Add native Markdown/state adapter tests for text extraction, final
      assistant Markdown capture, skip reasons, successful tool-result capture,
      and failed tool-result skips.
- [x] Add `packages/api/src/steel/native/markdown.ts` and export it from the
      native Steel barrel.
- [x] Add a thin optional post-save hook around `BaseClient` assistant
      `databasePromise`.
- [x] Wire `AgentClient` initialization to capture final assistant Markdown
      after the LibreChat assistant message saves successfully.
- [x] Share native assistant turn metadata from `AgentClient.buildMessages()`
      to the request-scoped ToolService execution path.
- [x] Capture successful native Steel tool results immediately after
      `executeSteelTool()` succeeds.
- [x] Run focused native tests, JS syntax checks, TypeScript filtered check,
      and diff checks.

Design lock:

- `BaseClient.js` only exposes a generic `onResponseMessageSaved` lifecycle
  seam and preserves the original `databasePromise` contract.
- Steel parsing and writer calls live in `packages/api/src/steel/native/markdown.ts`.
- Native UI final Markdown capture runs after the assistant message save
  resolves; it skips user, temporary, unfinished, error, missing metadata, and
  blank-content messages.
- Native Steel tool result capture uses the same Mongo-backed Steel writer and
  request-scoped turn metadata so tool evidence and assistant Markdown state
  share a turn/checkpoint boundary.
- Open Responses post-save capture is tracked in the next Phase 8 slice; native
  event mapping remains pending Phase 8 work.

Review - 2026-06-25:

- Added `captureSteelNativeAssistantMarkdown()`,
  `captureSteelNativeToolResult()`, and `extractSteelNativeMarkdownText()` in
  `packages/api/src/steel/native/markdown.ts`.
- Updated `api/app/clients/BaseClient.js` with
  `withResponseMessageSavedHook()` so endpoint-specific clients can attach
  post-save side effects without duplicating controller finalization logic.
- Updated `api/server/services/Endpoints/agents/initialize.js` to wire the
  native Steel Markdown capture hook with
  `createMongooseSteelWorkingOrderMemoryWriter(mongoose)`.
- Updated `api/server/controllers/agents/client.js` to publish
  request-scoped `steelNativeContext` metadata with `conversationId`,
  `requestId`, `assistantTurnIndex`, and `memoryCheckpointTurnIndex`.
- Updated `api/server/services/ToolService.js` so native Steel tool execution
  captures successful tool results through `captureSteelNativeToolResult()`
  using the same writer contract.
- Updated the master framework and implementation plan to reflect that native
  UI Markdown/tool-result state capture is implemented; Open Responses capture
  was tracked as the next Phase 8 slice, and event mapping remains pending.
- Verification:
  - `cd packages/api && npx jest src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 14 tests.
  - `node -c api/app/clients/BaseClient.js` passed.
  - `node -c api/server/services/Endpoints/agents/initialize.js` passed.
  - `node -c api/server/services/ToolService.js` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, including
    `src/steel/memory/service.spec.ts(725,27): error TS2589`, but filtering full
    output for touched native/agent/runtime/tool files returned no errors.
  - `git diff --check` passed for touched native UI persistence, Steel native
    Markdown/tool adapter, docs, and task files.

# Active: Phase 8 Open Responses Steel Markdown Capture

Goal: wire `api/server/controllers/agents/responses.js` to the same native
Steel Markdown/state adapter so stored Open Responses API calls capture final
assistant Markdown after `db.saveMessage()` succeeds.

Plan:

- [x] Add a failing native adapter test for Open Responses output extraction
      and capture metadata.
- [x] Implement an Open Responses output capture helper in
      `packages/api/src/steel/native/markdown.ts`.
- [x] Wire `saveResponseOutput()` to call the helper after assistant message
      persistence succeeds.
- [x] Run focused package tests, JS syntax check, TypeScript filtered check,
      and diff check.

Design lock:

- `responses.js` remains a thin JS bridge. Steel parsing/writer conversion
  stays in `packages/api/src/steel/native/markdown.ts`.
- Capture must happen after `db.saveMessage()` succeeds, not before and not at
  stream finalization.
- Both streaming and non-streaming stored branches already call
  `saveResponseOutput()`, so the hook belongs there.
- `store:false` Open Responses calls do not create Steel structured state.

Review - 2026-06-25:

- Added failing tests in `packages/api/src/steel/native/markdown.spec.ts` for:
  - extracting Markdown from Open Responses `output_text` parts;
  - capturing a stored Open Responses assistant response with
    `conversationId`, `responseId`, `turnIndex`, and checkpoint metadata.
- The red test run failed as expected because
  `extractSteelNativeResponseOutputText()` and
  `captureSteelNativeResponseOutput()` did not exist.
- Implemented both helpers in `packages/api/src/steel/native/markdown.ts`.
- Updated `api/server/controllers/agents/responses.js` so:
  - request-scoped `steelNativeContext` is created from
    `previousMessages + inputMessages`;
  - `saveResponseOutput()` calls `captureSteelNativeResponseOutput()` after
    `db.saveMessage()` succeeds;
  - streaming and non-streaming stored branches share the same hook because
    both already call `saveResponseOutput()`.
- Updated the master framework and implementation plan to mark Open Responses
  persistence hook as implemented while keeping event mapping pending.
- Verification:
  - Red test:
    `cd packages/api && npx jest src/steel/native/markdown.spec.ts --coverage=false --runInBand`
    failed because the two new exports were missing.
  - Green test:
    `cd packages/api && npx jest src/steel/native/markdown.spec.ts --coverage=false --runInBand`
    passed with 7 tests.
  - Focused native suite:
    `cd packages/api && npx jest src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 16 tests.
  - `node -c api/server/controllers/agents/responses.js` passed.
  - `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false`
    passed with 14 tests.
  - `git diff --check` passed for touched Open Responses persistence,
    Steel native Markdown adapter, docs, and task files.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched
    native/responses/agent/runtime/tool files returned no errors.

# Active: Phase 6 Agents API Chat Completions Steel Context Hook

Goal: make the remote OpenAI-compatible
`/api/agents/v1/chat/completions` route receive the same global Steel context
as the normal native UI path.

Plan:

- [x] Add a focused regression test for the OpenAI-compatible controller
      applying Steel global instructions and runtime context before `createRun`.
- [x] Keep `api/server/controllers/agents/openai.js` as a thin bridge and put
      reusable Steel context application logic in `packages/api`.
- [x] Apply the Steel prefix/runtime tail to the primary agent and discovered
      handoff agents.
- [x] Preserve existing remote-agent permissions, skill primes, MCP/tool
      execution, streaming/non-streaming response behavior, and usage billing.
- [x] Update the master framework/implementation plan and run focused
      verification.

Design lock:

- This is the OpenAI-compatible Agents API ingress, not the normal UI
  `AgentClient` path and not `/steel/oauth-chat`.
- The route already performs its own initialize/discover/createRun flow, so it
  must explicitly apply Steel context after agent initialization and before
  `formatAgentMessages()` / `createRun()`.
- Stable Steel rules belong in `agent.instructions`; dynamic Steel runtime
  context belongs in `agent.additional_instructions`.
- Request-scoped Steel metadata should be available to native Steel tool
  execution and Markdown/state capture where this route later persists output.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/agents.ts` with reusable helpers that
  prepend Steel global instructions and append Steel runtime context to
  initialized native agent configs.
- Exported the helper through the native Steel barrel.
- Updated `api/server/controllers/agents/openai.js` so
  `/api/agents/v1/chat/completions`:
  - converts OpenAI-compatible system/user/assistant messages into Steel
    runtime conversation input while leaving tool messages in the original
    LibreChat model flow;
  - builds `agents_chat_completions` Steel global context after primary and
    handoff agent initialization;
  - applies the Steel prefix/runtime tail to every run agent before
    `formatAgentMessages()` and `createRun()`;
  - sets request-scoped Steel context metadata for native Steel tool/state
    boundaries.
- Updated the master framework and implementation plan with Phase 6A for the
  OpenAI-compatible Chat Completions ingress.
- Verification:
  - Red test:
    `cd api && npx jest server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false --testNamePattern "Steel native context"`
    failed because `buildDefaultSteelGlobalAgentContext` was not called.
  - Green controller suite:
    `cd api && npx jest server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
    passed with 13 tests.
  - Native package suite:
    `cd packages/api && npx jest src/steel/native/agents.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/markdown.spec.ts src/steel/native/provider.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    passed with 27 tests.
  - `node -c api/server/controllers/agents/openai.js` passed.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis typing, OpenAI config
    specs, missing `@langchain/core/messages`, manual Steel specs, rules
    repository typing, and PaddleOCR manual specs; no current touched file is
    in the TypeScript error list after fixing the new helper spec typing.

# Active: Phase 5 Native OpenAI OAuth Transport Adapter

Goal: make standard native LibreChat agent chat able to execute
`openai_oauth_responses` through `openai-oauth-provider` without routing product
traffic through `/steel/oauth-chat`.

Plan:

- [x] Inspect the `@librechat/agents` model factory and provider registry seam.
- [x] Add failing native OAuth adapter tests for stateless provider creation,
      message/file conversion, tool-call mapping, and streaming chunks.
- [x] Add failing `createRun()` contract coverage for standard native OAuth
      chat injecting an OpenAI OAuth override model.
- [x] Implement `packages/api/src/steel/native/oauth.ts` and export it through
      the native Steel barrel.
- [x] Wire `packages/api/src/agents/run.ts` so standard single-agent
      `openai_oauth_responses` runs use the native OAuth adapter.
- [x] Run focused native/provider/run tests and TypeScript/diff checks.

Design lock:

- Product traffic still stays in normal LibreChat native chat; `/steel/oauth-chat`
  remains dev-only.
- OAuth transport is stateless: `responsesState:false`, no
  `previous_response_id`, and full prompt reconstruction from LibreChat history
  plus Steel global context.
- The OAuth adapter wraps `openai-oauth-provider` as a LangChain-compatible
  native chat model. It converts LangChain messages to AI SDK v3 prompt
  messages, preserves native image/PDF file parts, forwards native tool schemas,
  maps OAuth provider tool calls back to `AIMessageChunk.tool_calls`, streams
  text deltas, and records response/usage metadata.
- `createRun()` injects the adapter through the existing Graph `overrideModel`
  seam only for standard single-agent native chat. The injected model resolves
  tools from the live Graph agent context on every invoke/stream, so tool schema
  discovery is not frozen at run creation.
- Multi-agent/per-agent OAuth model support remains a later seam. Do not claim
  it complete until `@librechat/agents` exposes a per-agent model adapter or an
  equivalent tested hook.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/oauth.spec.ts`.
- Red adapter test:
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    failed because `./oauth` did not exist.
- Implemented `OpenAIOAuthModel` and
  `OpenAIOAuthGraphModel` in
  `packages/api/src/steel/native/oauth.ts`.
- The adapter:
  - lazy-loads `openai-oauth-provider` unless a test injects
    `createOpenAIOAuth`;
  - creates the provider with `responsesState:false`;
  - converts system/user/assistant/tool LangChain messages to AI SDK v3 prompt
    messages;
  - converts `image_url`, `input_file`, and OpenAI-style `file` parts into AI
    SDK file parts;
  - forwards native tool schemas as AI SDK function tools;
  - maps generated tool calls back into LangChain `AIMessageChunk.tool_calls`;
  - streams text/tool/finish parts as `AIMessageChunk` values with usage and
    response metadata.
- Updated `packages/api/src/agents/run.ts` so standard single-agent
  `openai_oauth_responses` runs receive the OAuth graph override model after
  `Run.create()`.
- Updated `packages/api/src/agents/__tests__/run-summarization.test.ts` with
  a focused native run contract test and a minimal `@librechat/agents` mock so
  the suite no longer loads the unavailable `@langchain/core/errors` path.
- Updated the master framework and Phase 5 implementation plan to mark the
  standard native OAuth transport adapter as implemented while keeping
  multi-agent/provider-factory and live fixture smoke as later proof work.
- Verification:
  - `cd packages/api && npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 25 tests.
  - `cd packages/api && npx jest src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand`
    passed with 65 tests.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis, OpenAI config specs,
    missing `@langchain/core/messages`, manual Steel specs, rules repository,
    and PaddleOCR manual specs; no touched Phase 5 OAuth/native/run files remain
    in the TypeScript error list.
  - `cd api && npx jest server/routes/agents/__tests__/responses.spec.js --runInBand --coverage=false`
    is blocked before route assertions by the existing root dependency state:
    `Cannot find module '@langchain/core/errors'` from `@langchain/openai`.

Dependency unblock addendum - 2026-06-25:

- Added root `@langchain/core@^1.2.1` to satisfy the hoisted LangChain provider
  peer imports used by `@librechat/agents`, `@langchain/openai`, and nested
  OAuth/provider dependencies during native API tests.
- Kept the npm-generated `package-lock.json` sync because the narrower manual
  lock edit failed `npm ci --dry-run`; the generated lock also reconciles
  existing package/lock drift around peer/dev dependency placement.
- Rebuilt ignored `packages/api/dist` locally with `cd packages/api && npm run
  build` so API Jest consumed the current `packages/api/src/agents/context.ts`
  global-prefix implementation.
- Verification:
  - `npm ls @langchain/core --depth=0` reports `@langchain/core@1.2.1`.
  - `npm ci --dry-run --ignore-scripts --cache /private/tmp/librechat-npm-cache`
    passed, with existing Node engine warnings under local Node `v22.17.1`.
  - `cd api && npx jest server/controllers/agents/client.test.js --runInBand --coverage=false --testNamePattern "injects native Steel prefix"` passed.
  - `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"` passed.

# Active: Phase 5 Native Provider Policy Resolver

Goal: add the native Steel provider policy resolver and wire provider-policy
metadata into native AgentClient runs without pretending the OAuth transport
adapter is complete.

Plan:

- [x] Add failing provider policy tests for OpenAI OAuth stateless mode,
      API-key Responses reconstructed mode, explicit `useResponsesApi:false`,
      and guarded `previous_response_id` usage.
- [x] Implement `packages/api/src/steel/native/provider.ts` and export it from
      the native Steel barrel.
- [x] Apply the policy in native agent initialization for OpenAI/OAuth provider
      branches only.
- [x] Persist provider policy metadata on native assistant messages.
- [x] Run focused tests, JS syntax checks, TypeScript filtered check, and diff
      check.

Design lock:

- `openai_oauth_responses` resolves to `openai_oauth_stateless`,
  `responsesState:false`, and strips unsupported `previous_response_id`.
- Official OpenAI API-key specs default to `useResponsesApi:true` and
  `openai_responses_reconstructed`.
- Explicit `useResponsesApi:false` is preserved unless
  `enforceResponsesApi:true` is passed by an admin-enforced Steel spec.
- `openai_responses_previous_response_id` is only selected when a persisted
  provider response id is supplied and previous-response-id mode is explicitly
  allowed.
- Non-OpenAI providers are not touched by the Steel provider policy resolver.
- This slice does not yet make `openai_oauth_responses` executable through the
  native LangGraph/model factory; that transport adapter remains the next Phase
  5 gap.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/provider.spec.ts`.
- Added `packages/api/src/steel/native/provider.ts` with:
  - `resolveSteelNativeProviderPolicy()`;
  - `toSteelNativeProviderMetadata()`;
  - `isSteelNativeProviderPolicyTarget()`.
- Exported the provider module from `packages/api/src/steel/native/index.ts`.
- Updated `api/server/services/Endpoints/agents/initialize.js` to:
  - apply provider policy only for OpenAI API/OAuth branches;
  - update `primaryConfig.model_parameters` with the policy-cleaned model
    parameters;
  - pass provider policy metadata into `AgentClient`.
- Updated `api/server/controllers/agents/client.js` to persist provider policy
  metadata under `metadata.steel.provider`.
- Updated the master framework and Phase 5 plan to mark provider policy
  resolver/metadata as implemented while keeping the native OAuth transport
  adapter pending.
- Verification:
  - Red test:
    `cd packages/api && npx jest src/steel/native/provider.spec.ts --coverage=false --runInBand`
    failed because `./provider` did not exist.
  - Green test:
    `cd packages/api && npx jest src/steel/native/provider.spec.ts --coverage=false --runInBand`
    passed with 5 tests.
  - Focused native suite:
    `cd packages/api && npx jest src/steel/native/provider.spec.ts src/steel/native/markdown.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 21 tests.
  - `node -c api/server/services/Endpoints/agents/initialize.js` passed.
  - `node -c api/server/controllers/agents/client.js` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json` still has
    existing project errors, but filtering full output for touched
    native/responses/agent/runtime/tool files returned no errors.

# Active: Phase 6B Open Responses Steel Context Hook

Goal: make the remote Open Responses-compatible
`/api/agents/v1/responses` route receive the same global Steel context as the
normal native UI and Chat Completions ingress paths.

Plan:

- [x] Add a focused regression test for the Responses controller building
      Steel global context from reconstructed previous + current input messages.
- [x] Apply Steel stable prefix through `applyContextToAgent()` before
      `createRun`.
- [x] Append Steel runtime context after existing per-agent attachment context.
- [x] Preserve existing Open Responses continuation loading, streaming and
      non-streaming branches, tool execution, usage billing, and post-save
      Markdown/state capture.
- [x] Resolve generated `resp_*` response ids back to the durable LibreChat
      conversation for continuation and retrieval.
- [x] Normalize Steel-enabled Open Responses storage so incoming `store:false`
      requests still use durable LibreChat history/state.
- [x] Update master framework/implementation plan and run focused verification.

Design lock:

- This is the Open Responses-compatible Agents API ingress, not the normal UI
  `AgentClient` path and not `/steel/oauth-chat`.
- The route reconstructs history from LibreChat messages and current input; the
  Steel context builder must see that same merged message set.
- Stable Steel rules belong in `globalInstructionPrefix`; dynamic Steel runtime
  context belongs at the end of the route's shared run context.
- Incoming `store:false` is normalized to durable `store:true`; there is no
  supported non-stored Steel structured-state path.

Review - 2026-06-25:

- Updated `api/server/controllers/agents/responses.js` so the Open
  Responses-compatible route:
  - converts the merged `previousMessages + inputMessages` reconstruction into
    Steel native conversation messages;
  - builds `open_responses` Steel global context before
    `formatAgentMessages()` and `createRun()`;
  - passes Steel stable rules through `applyContextToAgent()` as
    `globalInstructionPrefix`;
  - appends Steel runtime context after existing per-agent attachment context in
    `sharedRunContext`;
  - keeps request-scoped Steel turn metadata for post-save Markdown/state
    capture.
- Updated `api/server/controllers/agents/__tests__/responses.unit.spec.js` with
  regression coverage for reconstructed-history Steel context, generated
  `resp_*` continuation/retrieval, and streaming native tool execution callback
  parity.
- Added a shared Open Responses resolver that:
  - keeps direct conversation-id continuation compatible;
  - resolves generated `resp_*` ids through the saved assistant
    `Message.messageId` to the durable `conversationId`;
  - supports `GET /responses/:id` with the returned response id.
- Normalized Steel-enabled Open Responses storage in
  `api/server/controllers/agents/responses.js` so both streaming and
  non-streaming `store:false` requests still call `saveConvo()`,
  `saveInputMessages()`, and `saveResponseOutput()`. Non-streaming responses
  return `store: true`.
- Added `packages/api/src/steel/native/metadata.ts` and wired
  `saveResponseOutput()` to persist auditable Open Responses metadata under
  `metadata.steel.native`, including ingress, native context version, context
  mode, render profile, provider-state mode, conversation/response ids, turn
  indexes, and normalized durable storage state.
- Updated the master framework and implementation plan to mark the Open
  Responses context hook, generated `resp_*` resolver, `store:true`
  normalization, and saved Steel metadata as implemented.
- Verification:
  - Red metadata helper test:
    `cd packages/api && npx jest src/steel/native/metadata.spec.ts --coverage=false --runInBand`
    failed because `./metadata` did not exist.
  - Red response metadata test:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "auditable Steel metadata"`
    failed because the Open Responses assistant message did not call the Steel
    metadata builder.
  - Red storage test:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "normalizes .*store false"`
    failed because `store:false` did not call `saveConvo()`/`saveMessage()`.
  - Red test:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "Steel global context"`
    failed because `buildDefaultSteelGlobalAgentContext` was not called.
  - Green route suite:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false`
    passed with 21 tests.
  - Combined route controller suites:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
    passed with 34 tests.
  - Route integration attempt:
    `cd api && npx jest server/routes/agents/__tests__/responses.spec.js --runInBand --coverage=false --testNamePattern "Response Storage"`
    is still blocked before route assertions by the existing dependency state:
    `Cannot find module '@langchain/core/errors'` from `@langchain/openai`.
  - Native package suite:
    `cd packages/api && npx jest src/steel/native/agents.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/markdown.spec.ts src/steel/native/metadata.spec.ts src/steel/native/provider.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    passed with 28 tests.
  - `node -c api/server/controllers/agents/responses.js` passed.
  - `git diff --check` passed.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis typing, OpenAI config
    specs, missing `@langchain/core/messages`, manual Steel specs, rules
    repository typing, and PaddleOCR manual specs; no current touched file is
    in the TypeScript error list.

Open Responses bridge addendum - 2026-06-25:

- [x] Add failing package coverage proving Open Responses `input_file` blocks
      stay as file inputs instead of becoming text placeholders.
- [x] Preserve `input_file` blocks in
      `packages/api/src/agents/responses/service.ts` with `file_id`,
      `file_data`, and `filename` fields.
- [x] Add failing controller coverage proving Open Responses current-turn
      `input_file.file_id` references enter `req.steelNativeContext.currentTurnFiles`.
- [x] Collect Open Responses current-turn file references in
      `api/server/controllers/agents/responses.js`, attach them to native Steel
      context, and reuse the existing ToolService `run_file_ocr` file-resolution
      path. Inline `file_data` remains provider-visible and is not copied into
      Steel context bytes.
- [x] Update the master framework and implementation plan Phase 7 status.

Open Responses bridge verification:

- Red package test:
  `cd packages/api && npx jest src/agents/responses/__tests__/service.test.ts --coverage=false --runInBand --testNamePattern "input_file"`
  failed before implementation because `input_file` became a text placeholder.
- Green package tests:
  `cd packages/api && npx jest src/agents/responses/__tests__/service.test.ts --coverage=false --runInBand`
  passed with 24 tests.
- Red controller test:
  `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false --testNamePattern "passes Open Responses input_file"`
  failed before implementation because `req.steelNativeContext.currentTurnFiles`
  was `undefined`.
- Green controller tests:
  `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand --coverage=false`
  passed with 22 tests.
- Combined route controller suites:
  `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
  passed with 35 tests.
- Focused native package suite:
  `cd packages/api && npx jest src/agents/responses/__tests__/service.test.ts src/steel/tools/execute.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/metadata.spec.ts src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/agents.spec.ts src/steel/native/markdown.spec.ts --coverage=false --runInBand`
  passed with 67 tests.
- `node -c api/server/controllers/agents/responses.js` passed.
- `git diff --check` passed.
- `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
  still fails on existing project errors in Redis typing, OpenAI config specs,
  missing `@langchain/core/messages`, manual Steel specs, rules repository
  typing, and PaddleOCR manual specs; no Open Responses/Steel native file
  touched in this slice is in the TypeScript error list.

# Active: Phase 7 Native AgentClient OCR File Bridge

Goal: let the normal native LibreChat AgentClient path pass permitted current
PDF/image attachment bytes into Steel `run_file_ocr` only when the AI agent
explicitly calls that tool.

Plan:

- [x] Add package-level regression coverage for `executeSteelTool()` dispatching
      `run_file_ocr` to an injected OCR runner with uploaded file bytes.
- [x] Add request-scoped current-turn Steel file references in AgentClient after
      LibreChat native attachment processing.
- [x] Resolve those file refs inside ToolService through LibreChat Mongo file
      records and configured storage download streams.
- [x] Pass resolved OCR files into `executeSteelTool({ ocrFiles })` only for
      `run_file_ocr` calls.
- [x] Update implementation plan status and run focused verification.

Design lock:

- File upload/loading alone does not auto-run OCR or inject OCR text.
- Native provider file/vision inputs remain in the existing LibreChat
  attachment pipeline; the Steel context only carries metadata references.
- `run_file_ocr` uses LibreChat-owned file records and storage streams, then
  reaches the PaddleOCR-backed runner through `executeSteelTool()`.
- This slice covers normal native AgentClient current-turn attachments. Open
  Responses `input_file` bridging is covered by the addendum above. Runtime
  context prior OCR evidence reuse is covered by the addendum below; live
  no-re-OCR follow-up behavior remains a Phase 7 smoke/evidence gap.

Review - 2026-06-25:

- Added `run_file_ocr` dispatch support to
  `packages/api/src/steel/tools/execute.ts` with injectable `runFileOcr` and
  `ocrFiles` dependencies for deterministic tests.
- Updated `api/server/controllers/agents/client.js` so the request-scoped
  `steelNativeContext` includes `currentTurnFiles` after LibreChat attachment
  processing.
- Updated `api/server/services/ToolService.js` so native Steel OCR execution:
  - reads `req.steelNativeContext.currentTurnFiles`;
  - resolves each file through `resolveEvidenceFileForProvider()`;
  - uses LibreChat `getFiles()` and `getStrategyFunctions(...).getDownloadStream`
    to read permitted file bytes;
  - passes the resulting files into `executeSteelTool()` only when the native
    Steel tool call is `run_file_ocr`.
- Verification:
  - Red package test:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts --coverage=false --runInBand --testNamePattern "runs OCR only"`
    failed because the OCR runner was not called.
  - Green package test:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts --coverage=false --runInBand --testNamePattern "runs OCR only"`
    passed.
  - Green tools suite:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts --coverage=false --runInBand`
    passed with 15 tests.
  - Focused native/tool suite:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
    passed with 24 tests.
  - Focused native package suite:
    `cd packages/api && npx jest src/steel/tools/execute.spec.ts src/steel/native/agents.spec.ts src/steel/native/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/markdown.spec.ts src/steel/native/metadata.spec.ts src/steel/native/provider.spec.ts src/steel/native/oauth.spec.ts --coverage=false --runInBand`
    passed with 43 tests.
  - Combined route controller suites:
    `cd api && npx jest server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --runInBand --coverage=false`
    passed with 34 tests.
  - `node -c api/server/services/ToolService.js` passed.
  - `node -c api/server/controllers/agents/client.js` passed.
  - ToolService red/integration test attempt:
    `cd api && npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"`
    originally failed before assertions with `Cannot find module
    '@langchain/core/errors'` from `@langchain/openai`; after the root
    `@langchain/core@^1.2.1` dependency fix and API package rebuild, this
    focused test now passes.
  - AgentClient focused test attempt:
    `cd api && npx jest server/controllers/agents/client.test.js --runInBand --coverage=false --testNamePattern "native Steel prefix"`
    originally hit the same missing `@langchain/core/errors` dependency; after
    rebuilding ignored `packages/api/dist`, the focused native Steel prefix test
    passes with the current source implementation.
  - `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
    still fails on existing project errors in Redis typing, OpenAI config
    specs, missing `@langchain/core/messages`, manual Steel specs, rules
    repository typing, and PaddleOCR manual specs; no current touched file is
    in the TypeScript error list.

Prior OCR evidence reuse addendum - 2026-06-25:

- [x] Add a failing runtime context test proving active OCR extracts from Steel
      structured state are reused on follow-up turns.
- [x] Update `prepareSteelRuntimeContext()` so it reads `Output Sheet Memory`
      before deriving `attachments.priorActiveFileEvidence` from active
      `derivedIndex.ocrExtracts`, and still keeps explicit prior evidence.
- [x] Keep current-turn file bytes out of runtime context; this change only
      replays persisted structured OCR evidence.
- [x] Update the master framework and implementation plan Phase 7 status.

Prior OCR evidence reuse verification:

- Red runtime test:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --coverage=false --runInBand --testNamePattern "reuses active OCR extracts"`
  failed because `context.attachments.priorActiveFileEvidence` was empty.
- Green runtime test:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --coverage=false --runInBand --testNamePattern "reuses active OCR extracts"`
  passed.
- Full runtime context suite:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts --coverage=false --runInBand`
  passed with 11 tests.
- Focused native/tool suite:
  `cd packages/api && npx jest src/steel/native/context.spec.ts src/steel/tools/execute.spec.ts src/steel/native/tools.spec.ts --coverage=false --runInBand`
  passed with 24 tests.
- Focused native/runtime package suite:
  `cd packages/api && npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts src/steel/tools/execute.spec.ts src/steel/native/tools.spec.ts src/steel/native/metadata.spec.ts src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/agents.spec.ts src/steel/native/markdown.spec.ts src/agents/responses/__tests__/service.test.ts --coverage=false --runInBand`
  passed with 78 tests.
- `git diff --check` passed.
- `cd packages/api && npx tsc --noEmit --project tsconfig.json --pretty false`
  still fails on existing project errors in Redis typing, OpenAI config specs,
  missing `@langchain/core/messages`, manual Steel specs, rules repository
  typing, and PaddleOCR manual specs; no runtime context file touched in this
  slice is in the TypeScript error list.

# Active: Phase 8 Native Steel Event Mapping

Goal: expose persisted Steel parse/save/tool capture status through native
LibreChat stream surfaces without persisting internal activity as assistant
message text.

Plan:

- [x] Add package-level regression coverage for mapping Steel native capture
      results into stream event envelopes.
- [x] Emit native `steel_event` envelopes after native UI assistant Markdown
      capture succeeds.
- [x] Emit native `steel_event` envelopes after native Steel tool-result capture
      succeeds.
- [x] Keep Open Responses Markdown capture durable and protocol-compatible; do
      not inject custom SSE into the Open Responses-compatible stream yet.
- [x] Re-run focused verification under Node 24 after the local shell PATH was
      corrected.

Design lock:

- `packages/api/src/steel/native/events.ts` owns event mapping.
- Native UI assistant Markdown capture emits `parse_status` and `memory_saved`
  envelopes when capture results have parse status or persisted state counts.
- Native Steel tool-result capture emits `memory_saved` envelopes after
  persisted tool evidence has saved counts.
- Skipped captures and zero saved-count captures emit no Steel events.
- Open Responses route capture stays in `saveResponseOutput()` after
  `db.saveMessage`; custom Steel events for that protocol require a future
  LibreChat-owned side channel.

Review - 2026-06-25:

- Added `packages/api/src/steel/native/events.ts` and
  `packages/api/src/steel/native/events.spec.ts`.
- Updated `packages/api/src/steel/native/index.ts` to export the event mapper.
- Updated `api/server/services/Endpoints/agents/initialize.js` to emit native
  Steel events after `captureSteelNativeAssistantMarkdown()`.
- Updated `api/server/services/ToolService.js` to emit native Steel events after
  `captureSteelNativeToolResult()`.
- Updated focused Jest coverage in:
  - `api/server/services/Endpoints/agents/initialize.spec.js`
  - `api/server/services/__tests__/ToolService.spec.js`
- Added root `unrun@0.3.1` devDependency because `packages/api` `tsdown`
  build requires that optional peer in this checkout.
- Node 24 verification used:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH`.

Verification:

- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm ci --dry-run --ignore-scripts --cache /private/tmp/librechat-npm-cache`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm ls unrun --depth=0`
  passed and reported `unrun@0.3.1`.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/events.spec.ts src/steel/native/markdown.spec.ts --coverage=false --runInBand`
  passed with 10 tests.
- `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/Endpoints/agents/initialize.spec.js --runInBand --coverage=false --testNamePattern "emits native Steel parse"`
  passed.
- `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node -c api/server/services/ToolService.js`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node -c api/server/services/Endpoints/agents/initialize.js`
  passed.

Frontend live activity addendum - 2026-06-25:

- [x] Add failing frontend coverage for native `steel_event` activity storage.
- [x] Add failing frontend coverage for assistant-message Steel activity
      rendering.
- [x] Add focused resumable SSE coverage so `steel_event` routes to Steel
      activity handling instead of the generic run-step handler.
- [x] Implement client live activity state and rendering without mutating
      assistant message text/content.
- [x] Route both legacy SSE and resumable SSE `steel_event` envelopes to the
      Steel activity handler.

Frontend design lock:

- `client/src/store/steel.ts` owns live native Steel activity state keyed by
  assistant `messageId`.
- `client/src/hooks/SSE/useSteelEventHandler.ts` validates native event
  envelopes, falls back tool-result events without `messageId` to the current
  assistant response, deduplicates replayed envelopes, and bounds the activity
  list.
- `client/src/components/Chat/Messages/Content/SteelActivity.tsx` renders
  localized parse/save status under assistant messages only.
- Activity is live UI state, not persisted assistant text and not an injected
  content part.
- `packages/client` was rebuilt under Node 24 because its prior local `dist`
  lacked `index.cjs`, which made client Jest fail to resolve
  `@librechat/client`.

Frontend verification:

- Red frontend tests:
  - `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx --runInBand --coverage=false`
    first failed because `~/store/steel` did not exist.
  - `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx --runInBand --coverage=false`
    first failed because `~/store/steel` did not exist.
- `cd packages/client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed and restored `@librechat/client` CJS/ESM outputs for client Jest.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Messages/Content/__tests__/ContentParts.test.tsx --runInBand --coverage=false`
  passed with 13 tests.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --testNamePattern "routes native Steel"`
  passed.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit --project tsconfig.json --pretty false`
  passed.
- `git diff --check` passed.

Phase 9 decision correction - 2026-06-25:

- [x] Locked user correction: all Steel-related native modules are globally
      open by default.
- [x] Do not add Steel-specific role, capability, or permission gates for Steel
      rules, context, quote/OCR behavior, or read-only AI tools.
- [x] Preserve only existing LibreChat-owned permission paths for files, MCP
      auth, provider/model config, and admin settings.
- [x] Re-verified Steel model/default provider contracts under Node 24.

Phase 9 verification:

- `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --runInBand --coverage=false --testNamePattern "request-scoped Steel OCR files"`
  passed after the access-gate direction was removed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/provider.spec.ts src/steel/models.spec.ts --coverage=false --runInBand`
  passed with 7 tests.
- `cd packages/data-provider && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/ai.spec.ts --coverage=false --runInBand`
  passed with 9 tests.
- `git diff --check` passed.

# Active: Phase 10 Native Steel UI Smoke And Rule Sync Check

Goal: verify the normal LibreChat chat path has global Steel context/tools,
captures Steel quote state from assistant Markdown, renders native Steel
activity, and follows the ERP `system_order` item numbering rule.

Plan:

- [x] Check whether the `10、20、30` item-number rule exists in local/global
      Steel rule content.
- [x] Query the cloud Steel `rules` table through `.env` `STEEL_POSTGRES_URL`
      without exposing secrets.
- [x] Update the mock Steel native fixture so successful output requires the
      `10、20、30` rule marker and emits `項次=10`.
- [x] Add E2E coverage that asserts the rendered system-order row uses
      `項次=10`, not sequential `1`.
- [x] Fix native Markdown extraction for persisted content-part text shaped as
      `{ text: { value } }`.
- [x] Rebuild the production frontend bundle before judging Playwright UI
      activity assertions.
- [x] Run focused frontend/backend tests and the native Steel mock E2E.

Findings:

- Cloud `steel.rules` contains the reviewed active
  `steel-workbook-output-policy` rule with `項次 採主項 / 次項：材料主項為
  10、20、30；附屬加工為 11、12、21、22。`
- The missing activity assertion was not a cloud rule sync issue. The backend
  SSE trace already emitted `steel_event` envelopes with the same final
  assistant `messageId`; the failing run served an old `client/dist` bundle
  from before the native Steel activity UI was built.

Review - 2026-06-26:

- Updated `e2e/setup/fake-model.js` so the Steel native smoke fixture requires
  the `10、20、30` context marker and returns a `system_order` table row with
  `項次=10`.
- Updated `e2e/specs/mock/steel-native.spec.ts` to assert the first rendered
  table row has `項次=10`.
- Updated `packages/api/src/steel/native/markdown.ts` and spec coverage so
  Markdown capture reads both string text parts and persisted
  `{ text: { value } }` content parts.
- Rebuilt production frontend assets with `npm run frontend`; mock Playwright
  uses those assets via the backend, so direct Playwright runs must not skip
  this step after client changes.

Verification:

- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run frontend`
  passed.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium`
  passed with 1 test.
- `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Messages/Content/__tests__/ContentParts.test.tsx src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --testNamePattern "Steel|steel"`
  passed with 7 matching tests; the unrelated non-Steel tests in that command
  were skipped by the test-name filter.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/markdown.spec.ts src/steel/native/context.spec.ts --coverage=false --runInBand`
  passed with 12 tests.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node --check e2e/setup/fake-model.js`
  passed.

# Active: Phase 10 Native Steel Attachment Smoke Closeout

Goal: extend the normal LibreChat mock smoke so a Steel native quote turn with a
PDF provider attachment proves the file stays in LibreChat's provider-visible
file path while Steel context/tools/activity remain globally available.

Plan:

- [x] Add a failing Playwright mock assertion for Steel native context plus a
      PDF provider attachment.
- [x] Update the fake model harness so the assertion fails unless the Steel
      global context/tools are model-visible and the requested filename is
      still present in the latest provider file content.
- [x] Rebuild the production frontend bundle before judging Playwright UI
      behavior.
- [x] Re-run the focused mock E2E, frontend Steel activity tests, native
      package tests, JS syntax check, and `git diff --check`.
- [x] Record review evidence.

Design lock:

- This is a credential-free mock smoke for the normal LibreChat chat path.
- Do not call the real PaddleOCR/OCR runner from this smoke; package-level
  coverage already proves `run_file_ocr` receives permitted file bytes through
  injected dependencies.
- Do not change LibreChat layout. Steel activity stays under the assistant
  message through the existing content rendering slot.
- Native OpenAI OAuth API live smoke remains credential-dependent; contract
  coverage for the adapter/run seam remains the default non-secret proof unless
  a valid local OAuth auth file is available for a live run.

Review - 2026-06-26:

- Added a normal LibreChat mock E2E that uploads a provider PDF and requires
  Steel global context/tools plus the latest provider-visible filename before
  returning a `system_order` quote table.
- The first red run failed before final text because the mock endpoint context
  budget was too small for the native Steel prefix plus provider PDF message;
  `e2e/config/librechat.e2e.yaml` now gives `mock-model-a` a static 200000
  context window for this smoke fixture only.
- The second red run failed because the fake model harness did not yet know the
  Steel native PDF assertion marker.
- Green evidence is covered by the full `steel-native.spec.ts` Playwright run
  below, which now includes both the existing native smoke and provider-PDF
  smoke.

# Active: Phase 10 PL.pdf Two-Round OCR Quote Gate

Goal: prove the normal LibreChat chat path can handle the required Steel OCR
quote flow for `docs/reference/example/PL.pdf`: first assistant turn returns
OCR confirmation only, and the second turn after user confirmation returns a
quote from the confirmed OCR table without changing the existing LibreChat
layout.

Plan:

- [x] Add a failing normal-chat Playwright mock flow using `PL.pdf`:
      first turn uploads the PDF and asks for OCR confirmation, then asserts no
      `system_order` quote table is rendered.
- [x] Extend the fake model harness so first-turn PL OCR assertions require
      Steel global context/tools plus the requested provider filename.
- [x] Add a second-turn mock assertion that fails unless the previous assistant
      OCR confirmation table is visible in reconstructed conversation history.
- [x] Make the second turn return a `system_order` quote table only after user
      confirmation, keeping item numbering at `10` and activity under the
      assistant message.
- [x] Rebuild the production frontend bundle before Playwright judgment.
- [x] Re-run focused mock E2E, frontend Steel activity tests, native package
      tests, OAuth adapter/run tests, JS syntax check, and `git diff --check`.
- [x] Record review evidence and remaining live-OAuth/PaddleOCR manual smoke
      gaps.

Design lock:

- The product behavior is normal LibreChat chat with global Steel context, not
  `/steel/oauth-chat`.
- Credential-free mock E2E must not call the real PaddleOCR runner. Real
  OpenAI OAuth + PaddleOCR validation remains a manual/live smoke gated by
  local secrets and long timeouts.
- OCR first turn must not output `system_order` or `customer_quote` and must
  not imply final pricing.
- The confirmation turn must reuse the prior OCR confirmation from history and
  must not require a second file upload or a second OCR pass.
- Do not change LibreChat UI/UX layout; only assert existing message content,
  attachment chips, and Steel activity placement.

Review - 2026-06-26:

- Added `PL.pdf` as the real fixture upload source in
  `e2e/specs/mock/steel-native.spec.ts`.
- Added the two-turn normal-chat mock flow:
  - first turn uploads `PL.pdf`, requires Steel global context/tools and the
    provider-visible filename, renders only an OCR confirmation table, and
    asserts no `system_order` / `customer_quote` output;
  - second turn sends explicit user confirmation, requires the prior assistant
    OCR confirmation table in reconstructed history, and only then renders a
    `system_order` table with item number `10`.
- Extended `e2e/setup/fake-model.js` with PL OCR and PL quote markers so the
  test fails if normal chat history reconstruction loses the first OCR table.
- Synced reviewed cloud Steel rules from repo `docs/rules/*.txt` through
  `node packages/api/scripts/sync-steel-rules.cjs --apply`, then read back the
  active reviewed `steel-default-agent-instruction` and
  `steel-workbook-output-policy` rules. The readback confirms the required
  OCR gate fragments are present, including first-turn OCR confirmation,
  no price lookup before confirmation, no second `run_file_ocr` after
  confirmation, required `孔數 / 件` and `總孔數`, and `10/11/20/21` item
  numbering.
- OpenAI OAuth + real PaddleOCR live smoke was not run in this environment:
  `.env` has `STEEL_POSTGRES_URL`, but no `OPENAI_OAUTH_AUTH_FILE` and no
  PaddleOCR endpoint/API-key variables were configured.

Verification:

- Red test:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
  failed because `E2E Steel native PL OCR confirmation passed` was not rendered.
- Green focused PL flow:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
  passed with 1 test.
- Full Steel native mock E2E:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium`
  passed with 3 tests.
- Frontend Steel activity tests:
  `cd client && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/hooks/SSE/__tests__/useSteelEventHandler.spec.tsx src/components/Chat/Messages/Content/__tests__/SteelActivity.test.tsx src/components/Chat/Messages/Content/__tests__/ContentParts.test.tsx src/hooks/SSE/__tests__/useResumableSSE.spec.ts --runInBand --coverage=false --testNamePattern "Steel|steel"`
  passed with 7 matching tests.
- Native package/OAuth/runtime tests:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/markdown.spec.ts src/steel/native/context.spec.ts src/steel/runtime/context.spec.ts src/steel/tools/execute.spec.ts --coverage=false --runInBand`
  passed with 47 tests.
- Native OAuth run seam:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth"`
  passed with 1 matching test.
- `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH node --check e2e/setup/fake-model.js`
  passed.
- `git diff --check` passed.

# Active: Phase 10 Prompt-Only OCR Strategy Research

Goal: realign the Steel OCR quote flow so `/steel/oauth-chat` and normal
LibreChat Steel chat are guided by prompt/rule context only. Do not add runtime
workflow gates such as `ocrWorkflow`, `policy_blocked`, or hidden tool blockers.

Correction lock:

- User correction: `/steel/oauth-chat` has no runtime gate; the first-turn OCR
  and second-turn quote behavior must come from agent prompt/rule guidance.
- Superseded direction: explicit OCR workflow phase signals, provider-side tool
  blocking, and activity UI for blocked calls.
- UI/UX lock: no LibreChat layout changes.

Plan:

- [x] Record the correction in `tasks/lessons.md`.
- [x] Remove the code-level `ocrWorkflow` and `policy_blocked` residues from
      runtime/native/provider/tool result paths.
- [x] Trace `/steel/oauth-chat` routing, history reconstruction, runtime
      context serialization, OpenAI OAuth prompt construction, and tool loop.
- [x] Reframe the strategy around prompt/rule/history/evidence rather than
      backend phase gates.
- [x] Run focused Jest/build/diff checks proving no runtime gate residues remain.
- [x] Record verification results and remaining live OpenAI OAuth / PaddleOCR
      smoke gap.

Research - 2026-06-26:

- `/steel/oauth-chat` routes `POST /ai/chat` and `POST /ai/chat/stream` through
  `createSteelHandlers`; file bytes are resolved as provider evidence files,
  not as a separate OCR workflow state machine.
- `prepareChatContext` reconstructs the active conversation history and appends
  the current user turn. The second user confirmation therefore reaches the
  provider together with the first assistant OCR confirmation table.
- `buildSteelRuntimeContext` passes `activeHistory`, `currentUserTurn`,
  `currentTurnFiles`, and Output Sheet Memory into `prepareSteelRuntimeContext`.
  It does not need to decide an OCR phase.
- `prepareSteelRuntimeContext` includes OCR-related reviewed rules whenever the
  current turn, prior history, or prior active file evidence indicates PDF/image
  OCR context. It also serializes prior OCR extracts from Output Sheet Memory.
- `sendSteelOAuthChat` creates the OpenAI OAuth Responses provider with
  `responsesState: false`, prepends `Steel Runtime Context` as a system
  instruction, passes file parts to the model, exposes Steel business tools, and
  uses `toolChoice: auto`.
- The provider loop executes whatever Steel tool calls the model selects, then
  appends assistant tool-call messages and tool-result messages back into the
  prompt for the next round. This is an agent loop, not a gate.
- Successful tool results are captured into Working Order Memory / Output Sheet
  Memory. That gives the next user turn prompt-visible OCR evidence without
  requiring another file upload or another `run_file_ocr` call.

Prompt-only strategy:

- First turn with a PDF: reviewed Steel rules plus current file evidence should
  guide the model to call `run_file_ocr`, then answer with an OCR confirmation
  table only.
- Before user confirmation: reviewed output rules should tell the model not to
  produce `system_order` or `customer_quote` quote tables.
- Second turn after user confirmation: reconstructed history plus prior OCR
  evidence should guide the model to reuse the confirmed OCR table, call
  pricing/search tools as needed, and produce ERP-facing quote tables.
- Verification should assert visible behavior, tool-call sequence, persisted
  OCR evidence, and rule availability. It should not add backend blockers that
  prevent `search_price_candidates` or `run_file_ocr` from executing.

Verification:

- Runtime gate residue scan:
  `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src`
  returned no matches.
- Focused backend Jest:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/runtime/context.spec.ts src/steel/native/context.spec.ts src/steel/ai/provider.spec.ts src/steel/tools/execute.spec.ts --coverage=false --runInBand`
  passed with 48 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- Real OpenAI OAuth + PaddleOCR live smoke was not run in this correction pass;
  this pass proves the prompt-only code path compiles and the removed runtime
  gate names are absent from code.

# Active: Phase 10 OAuth Chat Prompt-Only Two-Round Regression

Goal: add a handler-level regression for the `/steel/oauth-chat` dev probe that
proves the second confirmation turn is reconstructed from conversation history
and prompt-visible prior OCR evidence, without adding `ocrWorkflow`,
`policy_blocked`, or any runtime tool gate.

Plan:

- [x] Add a failing `packages/api/src/steel/handlers.spec.ts` test for a
      two-turn `PL.pdf` conversation where the second user message confirms the
      first OCR table.
- [x] Verify the red attempt. It exposed a test setup import error rather than
      a production behavior gap.
- [x] Implement the smallest needed change: fix the test import/helper and keep
      production runtime unchanged.
- [x] Run focused handler/runtime/provider tests and `git diff --check`.
- [x] Record review evidence and whether real OpenAI OAuth + PaddleOCR live
      smoke remains pending.

Design lock:

- `/steel/oauth-chat` remains a dev/smoke surface; product behavior still lives
  in normal LibreChat global native hooks.
- The regression must prove prompt-only behavior: second-turn provider input
  has the prior assistant OCR table in `messages`, prior OCR evidence in
  runtime context, AI-visible Steel tools, and no runtime OCR phase/gate field.
- Do not assert exact human-authored rule wording. Assert stable metadata,
  message reconstruction, tool visibility, and absence of gate fields.

Review - 2026-06-26:

- Added a two-call handler regression in `packages/api/src/steel/handlers.spec.ts`:
  - first call uploads `PL.pdf`, receives a mocked `run_file_ocr` tool-status
    result, returns an OCR confirmation table, and persists OCR evidence through
    the real Mongo-backed Working Order Memory writer;
  - second call sends a user confirmation in the same conversation and verifies
    provider input contains the prior assistant OCR table, prior OCR evidence in
    runtime context, AI-visible Steel tools, and no `ocrWorkflow` /
    `policy_blocked` runtime gate fields.
- The first red run failed because the new test missed the
  `createMongooseSteelOutputSheetMemoryReader` import. That was a test setup
  issue, not a product behavior gap.
- After fixing the test import/helper, no production code change was required:
  the existing prompt-only history + memory reconstruction path satisfies the
  contract.
- Environment check found `.env` contains database connection keys, but no
  `OPENAI_OAUTH_AUTH_FILE` and no PaddleOCR endpoint/API-key/MCP command
  variables, so real OpenAI OAuth + PaddleOCR `PL.pdf` live smoke remains
  pending.

Verification:

- Red/setup run:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts --coverage=false --runInBand --testNamePattern "reconstructs confirmed PL.pdf OCR follow-up"`
  failed with `ReferenceError: createMongooseSteelOutputSheetMemoryReader is not defined`.
- Green focused regression:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts --coverage=false --runInBand --testNamePattern "reconstructs confirmed PL.pdf OCR follow-up"`
  passed with 1 matching test.
- Focused backend suites:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts src/steel/runtime/context.spec.ts src/steel/ai/provider.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts --coverage=false --runInBand`
  passed with 65 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- Runtime gate residue scan:
  `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src`
  now returns only the new negative assertions in
  `packages/api/src/steel/handlers.spec.ts`.
- Normal LibreChat PL.pdf mock E2E:
  `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
  passed with 1 test.

# Active: Phase 10 Native OAuth Follow-Up Prompt Regression

Goal: protect the normal LibreChat OpenAI OAuth adapter path so reconstructed
native chat history can carry the first OCR confirmation table into the second
user confirmation turn while preserving `PL.pdf` provider file parts and
AI-visible Steel tools.

Plan:

- [x] Add a `packages/api/src/steel/native/oauth.spec.ts` regression
      covering system Steel context, prior assistant OCR table, current
      confirmation text, current `PL.pdf` file part, and Steel tool schema in
      one native OpenAI OAuth invoke.
- [x] Verify the run. The regression passed immediately, so the adapter already
      satisfied this prompt reconstruction contract.
- [x] Implement the smallest native OAuth adapter change if the red run exposes
      a real gap. No production change was needed.
- [x] Run focused native OAuth/provider/run tests, API build, and
      `git diff --check`.
- [x] Record review evidence and the remaining real OpenAI OAuth + PaddleOCR
      `PL.pdf` live smoke gap.

Design lock:

- This is normal LibreChat native chat coverage, not `/steel/oauth-chat`.
- OpenAI OAuth stays stateless with `responsesState: false`.
- The test should assert stable provider call structure: roles, OCR table
  history text, confirmation text, `PL.pdf` file part, `toolChoice:auto`, and
  tool names. Do not assert reviewed rule wording.

Review - 2026-06-26:

- Added native OpenAI OAuth adapter regression coverage in
  `packages/api/src/steel/native/oauth.spec.ts`.
- The regression invokes the adapter with:
  - system Steel Runtime Context text;
  - a prior assistant OCR confirmation markdown table;
  - the current user confirmation turn;
  - a current `PL.pdf` `input_file` part;
  - `run_file_ocr` and `search_price_candidates` tool schemas.
- The assertion verifies the OpenAI OAuth provider call receives the full
  reconstructed prompt, keeps the assistant OCR table as assistant history,
  converts the current `PL.pdf` into an AI SDK file part, and uses
  `toolChoice: auto` with both Steel tools.
- The new regression passed on the first valid run, so the existing adapter
  already satisfied this contract; no production code change was required.
- Checked the new native OAuth spec for banned wording-fragment matchers:
  no `stringContaining`, `toContain`, or `toMatch` remain in that spec.
- `.env` currently exposes `MONGO_URI` and `STEEL_POSTGRES_URL`, but not
  `OPENAI_OAUTH_AUTH_FILE` or PaddleOCR endpoint/API-key/MCP command
  variables, so real OpenAI OAuth + PaddleOCR `PL.pdf` live smoke remains
  pending.

Verification:

- Focused native OAuth/provider/run pattern:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native"`
  passed with 11 matching tests.
- Full relevant native OAuth/provider/run suites:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand`
  passed with 75 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- `rg -n "stringContaining|toContain|toMatch" packages/api/src/steel/native/oauth.spec.ts`
  returned no matches.

# Active: Phase 10 PL.pdf Live Smoke Harness

Goal: add a direct manual live smoke target for the final fixture
`docs/reference/example/PL.pdf`, using OpenAI OAuth `gpt-5.5` and the
prompt-only two-round OCR confirmation flow.

Plan:

- [x] Add a gated manual Jest spec for `PL.pdf` live smoke, separate from the
      existing PB-specific manual spec.
- [x] Keep user prompts simple and free of embedded rule/tool instructions.
- [x] Assert first turn runs OCR and does not call price lookup before user
      confirmation.
- [x] Assert second turn uses the confirmed OCR table, does not rerun OCR, calls
      price lookup, and returns a quote table.
- [x] Run the spec in default skipped mode, focused backend checks, API build,
      and `git diff --check`.
- [x] Record the exact env gap if the real live run still cannot execute.

Design lock:

- Manual live smoke is gated by `STEEL_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true`
  so normal local test runs stay deterministic.
- Do not copy PB.pdf's full fixture-specific ERP assertions; keep this target
  focused on the final requested `PL.pdf` two-round quote behavior.
- Do not add OCR runtime gates. The model is guided by reviewed runtime rules,
  prompt history, confirmed OCR evidence, and tool availability.

Review - 2026-06-26:

- Added `packages/api/src/steel/ai/provider.pl-pdf-quote.manual.spec.ts`, a
  gated manual live smoke for `docs/reference/example/PL.pdf`.
- The live spec uses two plain user turns:
  - first: `請處理附檔 PL.pdf。`
  - second: `確認上一輪 OCR 表格正確，請依 OCR 表單給出報價。`
- The spec verifies the strategy through provider/tool behavior rather than a
  backend workflow gate:
  - OpenAI OAuth model must be `gpt-5.5`;
  - first turn must complete `run_file_ocr`;
  - first turn must not call `search_price_candidates`;
  - first assistant response must include an OCR confirmation table;
  - second turn includes the previous assistant OCR table and OCR tool evidence;
  - second turn must not rerun OCR;
  - second turn must call `search_price_candidates`;
  - second assistant response must include a quote table.
- No `ocrWorkflow` or `policy_blocked` runtime gate was added. The AI agent is
  guided by serialized Steel runtime context, reviewed OCR/output rules,
  reconstructed conversation history, confirmed OCR evidence, and visible tools.
- The manual spec avoids exact human-wording match assertions; the local grep
  check found no `stringContaining`, `toContain`, or `toMatch` in the new file.
- Live run env gap remains:
  - `.env` has `MONGO_URI` and `STEEL_POSTGRES_URL`;
  - `.env` does not expose `OPENAI_OAUTH_AUTH_FILE`;
  - `.env` does not expose PaddleOCR endpoint/API key or MCP command variables.

Verification:

- Manual spec readiness with live env disabled:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/ai/provider.pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  passed with 1 skipped test. This override is required because repo Jest
  config intentionally ignores `*.manual.spec.ts`.
- Focused backend behavior:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/ai/provider.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand`
  passed with 43 tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `git diff --check` passed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit --project tsconfig.spec.json --pretty false`
  still fails on existing unrelated errors in Redis cache typing,
  `provider.pb-pdf-quote.manual.spec.ts`, `provider.pricing-live.manual.spec.ts`,
  Steel memory service spec, rule repository typing, and PaddleOCR manual specs;
  the new `provider.pl-pdf-quote.manual.spec.ts` is not in the error list.

# Active: Phase 10 Native OpenAI OAuth PL.pdf Live Smoke Harness

Goal: add a gated live smoke target for the normal LibreChat native OpenAI OAuth
adapter path, using `docs/reference/example/PL.pdf`, `gpt-5.5`, visible Steel
tools, and the prompt-only two-round OCR confirmation quote flow.

Plan:

- [x] Add a native OpenAI OAuth manual spec that uses the native LangChain
      message/file/tool adapter shape, not `/steel/oauth-chat`.
- [x] Keep first and second user prompts simple and free of embedded tool/rule
      instructions.
- [x] In the first turn, assert the model calls `run_file_ocr`, does not call
      `search_price_candidates`, and returns an OCR confirmation table.
- [x] In the second turn, assert the prompt carries the prior assistant OCR
      table and prior OCR evidence, does not re-upload or re-OCR by default,
      calls `search_price_candidates`, and returns a quote table.
- [x] Run the new manual spec in default skipped mode, focused native/OAuth
      suites, API build, matcher grep, runtime-gate grep, and `git diff --check`.
- [x] Record the remaining real live run env gap if credentials/PaddleOCR are
      still absent.

Design lock:

- This harness is native adapter evidence for normal LibreChat chat parity; it
  must not make `/steel/oauth-chat` a product dependency.
- Do not add `ocrWorkflow`, `policy_blocked`, or hidden runtime blockers. The
  strategy remains model-guided by serialized Steel runtime context, reviewed
  rules, prompt history, prior OCR evidence, and auto-selected tools.
- Do not change LibreChat UI/UX layout.

Review - 2026-06-26:

- Added `packages/api/src/steel/native/oauth-pl-pdf-quote.manual.spec.ts`, a
  gated live smoke for the native OpenAI OAuth adapter path.
- The spec uses `buildSteelGlobalAgentContext()` and
  `createOpenAIOAuthModel()`, then runs native-style LangChain
  messages through a small manual tool loop:
  - first turn sends `PL.pdf` as a provider `input_file`, binds native Steel
    tool definitions, executes returned Steel tool calls through
    `executeSteelTool()`, and writes JSON tool results back as `ToolMessage`;
  - second turn sends no provider file part, includes the prior assistant OCR
    table in reconstructed history, includes prior OCR evidence in native
    runtime context, and runs the same native OAuth/tool loop.
- Real live smoke passed using `gpt-5.5`, `/Users/neven/.codex/auth.json`, and
  the repo `.env` PaddleOCR MCP token:
  - first turn took 2 model/tool rounds and called only `run_file_ocr`;
  - second turn took 2 model/tool rounds and called only
    `search_price_candidates`;
  - reusable OCR evidence count was 1;
  - first assistant response returned an OCR confirmation table;
  - second assistant response returned a quote table with ERP-style `項次`,
    `型號`, and `品名規格` headers.
- Evidence was written to
  `tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json`; a local scan
  found no `access_token`, `authorization`, `Bearer`, or `authFile` marker.
- No `ocrWorkflow`, `policy_blocked`, runtime blocker, or UI/UX layout change
  was added. The live pass is still adapter/harness-level native evidence; a
  full browser UI live run remains a separate Phase 10 parity check.

Verification:

- First live attempt without ESM VM support:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true OPENAI_OAUTH_AUTH_FILE=/Users/neven/.codex/auth.json npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  failed before provider execution with Jest dynamic import error:
  `A dynamic import callback was invoked without --experimental-vm-modules`.
- Live native OpenAI OAuth + PaddleOCR PL.pdf smoke:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH NODE_OPTIONS=--experimental-vm-modules STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true OPENAI_OAUTH_AUTH_FILE=/Users/neven/.codex/auth.json npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  passed with 1 test in 201103 ms.
- Manual spec readiness with live env disabled:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
  passed with 1 skipped test.
- Focused native OAuth/tool/run suites:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/steel/native/tools.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native|tool adapter"`
  passed with 16 tests and 64 skipped tests.
- API build:
  `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
  passed.
- `rg -n "stringContaining|toContain|toMatch" packages/api/src/steel/native/oauth-pl-pdf-quote.manual.spec.ts`
  returned no matches.
- `rg -n "ocrWorkflow|policy_blocked" packages/api/src/steel/native/oauth-pl-pdf-quote.manual.spec.ts packages/api/src/steel/native packages/api/src/steel/ai/provider.ts packages/api/src/steel/handlers.ts`
  returned no matches.
- `git diff --check` passed.
- `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit --project tsconfig.spec.json --pretty false`
  still fails on existing unrelated Redis/manual-spec/rule-repository errors;
  the new native PL OAuth manual spec is not in the error list.

# Active: Phase 10 OAuth Chat Agent Strategy Re-Review

Goal: re-study `/steel/oauth-chat` as a development probe and lock how it guides
the AI agent without runtime OCR workflow gates, so the same strategy can be
carried into normal LibreChat native chat.

Plan:

- [x] Re-read `/steel/oauth-chat` route, handler, runtime context, provider loop,
      native context, and native tool merge call sites.
- [x] Separate prompt/rule guidance from runtime blockers.
- [x] Compare the standalone OAuth chat path against native LibreChat agent,
      Responses, OpenAI-compatible, ToolService, and provider-policy seams.
- [x] Record the strategy lock and remaining browser UI parity gap.

Research - 2026-06-26:

- `/steel/oauth-chat` is still a dev-only route. It enters through
  `api/server/routes/steel/index.js`, then `createSteelHandlers()` in
  `packages/api/src/steel/handlers.ts`.
- The route reconstructs conversation history in `prepareChatContext()`, then
  calls `prepareSteelRuntimeContext()` through `buildSteelRuntimeContext()`.
  The second confirmation turn therefore includes the prior assistant OCR
  table as normal chat history.
- `prepareSteelRuntimeContext()` decides whether OCR/file rules are present
  from current files, active history, current turn, and persisted OCR evidence.
  This is context selection, not a runtime workflow phase.
- `sendSteelOAuthChat()` prepends `Steel Runtime Context` as a system
  instruction, uses `openai-oauth-provider` with `responsesState: false`,
  exposes Steel tools with `toolChoice: auto`, and appends assistant tool calls
  plus JSON tool-result messages back into the next provider round.
- The apparent "OCR confirmation gate" lives in reviewed rule text such as
  `docs/rules/agent規則.txt`; it is a prompt contract. It must not become
  `ocrWorkflow`, `policy_blocked`, or provider-side tool blocking.
- Normal LibreChat already follows the same shape through native seams:
  `AgentClient`, Responses, and OpenAI-compatible controllers build
  `buildDefaultSteelGlobalAgentContext()`, place stable rules in agent
  instructions, place runtime workbook/context text in `additional_instructions`,
  and let `ToolService` merge executable Steel tools into normal LibreChat tool
  loading.
- OpenAI OAuth API support in normal LibreChat is owned by the native provider
  policy / graph override path, not by routing product traffic through
  `/steel/oauth-chat`.

Strategy lock:

- Keep `/steel/oauth-chat` only as a comparator for prompt construction, live
  OAuth/PaddleOCR behavior, and activity-log inspection.
- Preserve the prompt-only two-turn flow:
  first turn with PDF/image -> model calls `run_file_ocr` and returns OCR
  confirmation table only; user confirms or corrects; second turn -> model
  reuses confirmed OCR/history/evidence, calls pricing tools, and returns quote
  tables.
- Do not add hidden runtime blockers for wrong tool choice. Improve behavior by
  tightening reviewed rules, context ordering, tool descriptions, persisted OCR
  evidence, and verification fixtures.
- Native parity proof should verify prompt-visible prior OCR table/evidence,
  tool-call sequence, quote output, and no UI/UX layout change. The remaining
  work is a full browser UI live smoke for normal LibreChat with OpenAI OAuth
  API and `PL.pdf`.

# Active: Phase 10 LibreChat Native Context De-Duplication

Goal: split LibreChat native Steel context preparation from `/steel/oauth-chat`
context preparation so normal LibreChat chat history remains the only source of
prompt-visible user/assistant text, while Steel runtime context carries only
non-chat-content state and metadata before browser UI live smoke work continues.

Plan:

- [x] Compare `/steel/oauth-chat` `prepareChatContext()` with normal LibreChat
      native agent history construction.
- [x] Identify whether prior assistant OCR Markdown is already sent through
      normal provider messages.
- [x] Add focused coverage proving LibreChat native runtime context does not
      carry chat message text or prior assistant OCR Markdown.
- [x] Add LibreChat-native `prepareChatContext` and `prepareRuntimeContext`
      seams instead of reusing `/steel/oauth-chat` `prepareChatContext()` or the
      generic `prepareSteelRuntimeContext()` directly.
- [x] Replace serialized native history content with metadata/reference fields
      while preserving rule selection, tool policy, workbook state, and file
      metadata.
- [x] Run focused Steel context/provider/handler checks and grep for forbidden
      runtime OCR gates.

Research - 2026-06-26:

- `/steel/oauth-chat` still needs `prepareChatContext()`. It owns the dev-only
  endpoint's DB-backed history window, edit handling, queued steer source,
  assistant turn index, and workbook/state checkpoint indices.
- Standard LibreChat native chat already builds provider history from
  `orderedMessages` in `AgentClient`; OpenAI OAuth native adapter converts
  those BaseMessages into provider user/assistant/tool messages.
- The duplicate is not `prepareChatContext()` by itself. The duplicate is
  `serializeSteelRuntimeContext()`, which currently serializes
  `conversation.activeHistory[].content` and `currentUserTurn.content` into the
  runtime context that is also prepended as system/additional instructions.
- For the PL.pdf two-turn flow, the prior assistant OCR table should appear via
  normal chat history only. Runtime context may keep role/message/file
  references for diagnostics and rule selection, but should not include the
  assistant OCR Markdown body again.
- LibreChat native also needs a dedicated runtime preparer. It should not pass
  raw LibreChat chat text through the generic Steel runtime context path. Its
  context contract is non-chat-content state: reviewed rules, tool policy,
  Markdown-derived workbook/quote summary and indexes, OCR/file evidence
  references, attachment metadata, request IDs, and diagnostic metadata.
- Workbook/quote state originates from assistant response Markdown that is auto
  parsed and saved. Native context should not inline full saved Markdown tables.
  Full information should be the assistant Markdown in chat history, with a
  read-Markdown style tool available to recover parsed/saved quote or workbook
  content from the database when token compression loses it.
- One LibreChat conversation maps to one current Steel workbook and one current
  OCR dataset. `read_markdown` must read by backend conversation id and
  explicit `scope: "workbook"` or `scope: "ocr"` only; it should not require
  semantic row queries, expose standalone quote/all scopes, or expose multiple
  datasets per chat.
- Assistant updates to workbook/quote tables must output complete tables.
  Auto parse/save should whole-table overwrite the current conversation data
  from the complete Markdown table. It should not infer row deletions, row
  updates, or retained rows by applying partial patches.
- Backend auto parse merges at workbook/quote sheet level: latest assistant
  Markdown tables replace the corresponding current sheet in the singleton
  workbook/quote; omitted sheets carry forward from the database. This is parse
  and sheet merge only, not backend business reasoning.
- In OCR confirmation/correction turns, AI should not call `run_file_ocr`
  again unless the user explicitly requests rerun OCR or supplies new/changed
  file evidence. It should update the OCR/quote Markdown from chat history and
  user corrections, return the complete latest table, and let backend auto
  parse/save update the current conversation state.

Review - 2026-06-26:

- Added LibreChat-native chat/context preparation:
  `prepareLibreChatSteelChatContext()` and
  `prepareLibreChatSteelRuntimeContext()` keep provider chat history as the
  only prompt-visible source of user/assistant text, and serialize native
  runtime messages as metadata references with `contentSource:
  provider_messages`.
- Native AgentClient, Open Responses, and OpenAI-compatible controller paths now
  call the LibreChat-specific chat context preparer before building Steel global
  context.
- Replaced workbook row keyword recovery with `read_markdown` only. The legacy
  active-workbook reader was removed from schema, registry, executor, tests,
  rule sync script, and reviewed rule docs. `rg` over the repo for the old tool
  identifier now returns no matches.
- `read_markdown` is strict scope-only (`workbook` or `ocr`) and reads the
  active conversation's current Markdown-derived singleton dataset from the
  output-sheet memory reader. It converts DB JSON rows/evidence into Markdown
  text for the AI, and rejects row queries, quote/all scopes, and conversation
  ids before reading DB state.
- Auto parse/save now treats backend parsing as sheet-level merge only: latest
  complete assistant Markdown tables replace the matching current sheet by
  deleting overwritten rows and inserting the latest current rows, while omitted
  sheets carry forward. Partial row-change Markdown is saved as
  calculation/manual-review evidence and does not patch active rows. OCR tool
  capture similarly replaces the current OCR dataset for the conversation.
- Tool and rule policy now says OCR confirmation/correction turns should update
  and return complete latest OCR/quote Markdown directly; `run_file_ocr` is for
  explicit rerun requests or new/changed file evidence.
- Verification:
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 73 tests.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 121 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build` passed.
  - Repo-wide grep for legacy active-workbook tool identifiers returned no
    matches.
  - `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src` returned only negative assertions in `packages/api/src/steel/handlers.spec.ts`.
  - `git diff --check` passed.

## Phase 11 Native read_markdown History-First Usage Limit

Goal:

- Add an AI-visible `read_markdown` usage limit for native LibreChat Steel:
  the agent must inspect provider chat history first, and must not call
  `read_markdown` when the needed OCR/workbook Markdown is already present and
  complete enough in chat history.
- Keep this as prompt/tool-policy guidance only. Do not add a runtime gate,
  `ocrWorkflow`, or hidden backend blocker.
- Preserve the existing `read_markdown` scope contract: only `workbook` and
  `ocr`; no standalone quote/all scopes, row queries, or conversation ids.

Plan:

- [x] Add failing tests for structured `read_markdown` usage policy metadata in
  the Steel tool registry and serialized runtime context.
- [x] Implement the structured policy and mirror it into the AI-visible tool
  description / runtime context.
- [x] Update reviewed agent rules and lessons so future changes keep the same
  history-first behavior.
- [x] Run focused registry/runtime tests plus `git diff --check` and targeted
  greps.

Review - 2026-06-26:

- Added structured `read_markdown` usage policy metadata:
  `requiresMissingMarkdownInHistory`, `forbiddenWhenHistoryHasNeededMarkdown`,
  `allowedScopes`, and `currentConversationScoped`.
- Serialized the same policy into Steel runtime `toolPolicy` so native
  LibreChat context tells the agent to inspect provider chat history first and
  avoid `read_markdown` when the needed OCR/workbook Markdown is already present
  and complete enough.
- Updated reviewed agent rules and lessons with the same history-first
  restriction. This remains prompt/tool-policy guidance only; no runtime gate or
  OCR workflow blocker was added.
- Verification:
  - RED: `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` failed because `usagePolicy` and `readMarkdownUsagePolicy` were undefined.
  - GREEN: the same command passed with 2 suites / 17 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 7 suites / 75 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build` passed.
  - `git diff --check` passed.
  - Targeted grep found the new history-first policy in registry/runtime/rules
    and only negative assertions for `ocrWorkflow` / `policy_blocked`.

## Phase 12 Delete Duplicate Steel Read/Rule Tools

Goal:

- Delete `lookup_quote_rules` and `read_working_order_items` from the Steel
  tool surface entirely.
- `lookup_quote_rules` is redundant because reviewed quote rules are injected
  into runtime context.
- `read_working_order_items` is redundant with `read_markdown`, which recovers
  current workbook/OCR Markdown for the active conversation.
- Keep internal auto parse/save storage intact; this phase deletes the AI/tool
  execution surface, not workbook/OCR persistence.

Plan:

- [x] Add failing tests proving both tool names are no longer schema keys,
  executable tools, or runtime `removedTools`.
- [x] Remove schema entries, registry definitions, executor dispatch cases, and
  read event handling for the deleted tools.
- [x] Update docs/lessons to point to context injection and `read_markdown`
  instead.
- [x] Run focused Steel tests, build, targeted grep, and `git diff --check`.

Review - 2026-06-26:

- Deleted `lookup_quote_rules` and `read_working_order_items` from
  `steelToolArgsSchemas`, executable registry definitions, executor dispatch,
  runtime `removedTools`, and stream memory-read event handling.
- Removed `lookup_quote_rules` tool-result memory capture and stale
  `read_working_order_items` executor wiring. Internal Working Order Memory
  persistence/reader code remains for auto parse/save verification and DB-backed
  current workbook state; it is no longer exposed as a Steel tool.
- Updated legacy instruction sanitization to reference runtime-context reviewed
  quote rules instead of `lookup_quote_rules`.
- Verification:
  - RED: `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/runtime/context.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` failed because schema keys and runtime `removedTools` still contained the deleted names.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 7 suites / 73 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build` passed.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/handlers.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 1 suite / 22 tests.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testNamePattern "Steel|OCR|native" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 1 focused test.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 1 suite / 60 tests after updating generic MCP assertions to compare non-Steel tool definitions separately from globally injected Steel native tools.
  - Targeted grep over non-test source/docs found no
    `lookup_quote_rules`, `read_working_order_items`,
    `ReadWorkingOrderItemsInput`, `createWorkingOrderMemoryReader`, or
    `memoryReader:` matches.
  - `git diff --check` passed.

Review update - 2026-06-26:

- Tightened `read_markdown` to the final AI-facing contract:
  - only `scope: "workbook"` or `scope: "ocr"` is accepted;
  - standalone quote/all scopes are rejected because quote data belongs inside
    workbook;
  - DB JSON rows/evidence are converted into Markdown text before returning to
    the AI;
  - workbook Markdown includes strict workbook/quote sheets, while OCR Markdown
    preserves free-form OCR/drawing text and metadata for the AI to organize.
- Changed structured storage overwrite behavior to current-only for workbook
  and OCR:
  - emitted complete workbook/quote sheets delete overwritten rows and insert
    the latest current rows;
  - OCR capture deletes the previous current OCR extract dataset for the
    conversation before inserting the latest OCR result;
  - partial row-change Markdown remains calculation/manual-review evidence and
    does not patch workbook rows.
- Updated reviewed agent rule docs, sync script tool policy, master framework,
  and implementation plan to match the `read_markdown` Markdown-output and
  current-only workbook/OCR contract.
- Verification:
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 75 tests.
  - `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 121 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'` passed with 11 focused tests.
  - `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run frontend` passed.
  - `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"` passed.
  - Native OpenAI OAuth + PaddleOCR live smoke was first blocked by provider
    quota, then re-run successfully after quota became available:
    `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH NODE_OPTIONS=--experimental-vm-modules STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_LIVE_TEST=true STEEL_NATIVE_OPENAI_OAUTH_PL_PDF_QUOTE_TIMEOUT_MS=1200000 npx jest src/steel/native/oauth-pl-pdf-quote.manual.spec.ts --coverage=false --runInBand --testNamePattern "returns OCR confirmation first, then quotes from confirmed OCR evidence" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 1 live test in 188.53s.
  - Live evidence was written to
    `tmp/steel-native-openai-oauth-pl-pdf-quote-live-evidence.json`: first turn
    called only `run_file_ocr` and returned OCR confirmation Markdown; second
    turn included prior assistant OCR Markdown in normal chat history, called
    `search_price_candidates`, did not call `run_file_ocr`, did not call
    `read_markdown`, and returned `system_order`, `customer_quote`, and
    `manual_review`.
  - Repo-wide grep for legacy active-workbook tool identifiers returned no
    matches.
  - `rg -n "ocrWorkflow|policy_blocked|SteelRuntimeOcrWorkflow|resolveSteelRuntimeOcrWorkflow|mustNotSearchPricesBeforeConfirmation|mustNotRunFileOcrAgain" packages/api/src api/server client/src` returned only negative assertions in `packages/api/src/steel/handlers.spec.ts`.
  - `git diff --check` passed.

Completion review - 2026-06-26:

- `lookup_quote_rules` and `read_working_order_items` are deleted from the
  provider-visible Steel tool surface. Quote rules are injected through context,
  and current workbook/OCR recovery is handled by `read_markdown`.
- `read_markdown` remains the only AI-visible DB recovery read tool for
  workbook/OCR Markdown, with the history-first usage limit preserved in tool
  metadata, runtime context, and reviewed rules.
- Normal LibreChat native chat now has global Steel context/tools, OpenAI OAuth
  provider support, and the two-turn PL.pdf OCR confirmation then quote flow
  without adding `ocrWorkflow`, `policy_blocked`, or hidden OCR runtime gates.
- LibreChat UI/UX layout was not restructured. Client changes add SSE handling,
  Recoil state, and a small Steel activity line inside existing assistant
  message content; sidebar, composer, navigation, and message container layout
  are unchanged.
- Final verification:
  - Steel focused suite:
    `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/tools/registry.spec.ts src/steel/tools/execute.spec.ts src/steel/runtime/context.spec.ts src/steel/native/tools.spec.ts src/steel/native/context.spec.ts src/steel/memory/service.spec.ts src/steel/ai/provider.spec.ts --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 7 suites / 73 tests.
  - API focused suite:
    `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/controllers/agents/client.test.js server/controllers/agents/__tests__/responses.unit.spec.js server/controllers/agents/__tests__/openai.spec.js server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 4 suites / 181 tests.
  - Full ToolService spec:
    `cd api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest server/services/__tests__/ToolService.spec.js --coverage=false --runInBand --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 1 suite / 60 tests.
  - `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run build`
    passed.
  - `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npm run frontend`
    passed.
  - OAuth focused suite:
    `cd packages/api && PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx jest src/steel/native/oauth.spec.ts src/steel/native/provider.spec.ts src/agents/__tests__/run-summarization.test.ts --coverage=false --runInBand --testNamePattern "OpenAI OAuth|OAuth|reconstructed PL.pdf|Steel native" --testPathIgnorePatterns='node_modules|dist|\\.dev\\.ts$|\\.helper\\.ts$|\\.helper\\.d\\.ts$|__tests__/helpers/'`
    passed with 11 focused tests.
  - Native OpenAI OAuth + PaddleOCR live PL.pdf smoke passed with model
    `gpt-5.5`, using `docs/reference/example/PL.pdf`.
  - Mock UI E2E:
    `PATH=/Users/neven/.nvm/versions/node/v24.18.0/bin:$PATH npx playwright test --config=e2e/playwright.config.mock.ts e2e/specs/mock/steel-native.spec.ts --project=chromium --grep "gates PL.pdf"`
    passed.
  - Targeted grep over non-test source/docs found no
    `lookup_quote_rules`, `read_working_order_items`,
    `ReadWorkingOrderItemsInput`, `createWorkingOrderMemoryReader`, or
    `memoryReader:` matches.
  - `git diff --check` passed.

## OpenAI OAuth File OCR Title Generation - 2026-06-27

- [x] Reproduced the title-input issue at the backend title-generation seam:
  file-only OCR turns submit the generic OCR review prompt, so immediate title
  generation can lose the uploaded filename.
- [x] Updated `AgentClient#titleConvo` OpenAI OAuth path to pass the current
  OCR attachment filename plus a title-generation rule to the AI, without
  changing the actual chat message text.
- [x] Kept `generateOpenAIOAuthTitle` model-driven: it now returns the model
  title directly and does not apply a `preferredTitle` override.
- [x] Added regression tests for:
  - passing `PL.pdf` and the file-review title rule into OpenAI OAuth title
    generation;
  - preserving model-driven title output while verifying the filename guidance
    is present in the prompt.
- Verification:
  - `cd packages/api && rtk npx jest src/steel/native/title.spec.ts --runInBand --watch=false --coverage=false` passed with 2 tests.
  - `cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false` passed with 88 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.

## PaddleOCR MCP Live Server Check - 2026-06-27

- [x] Raised PaddleOCR MCP timeout to 20 minutes (`1200000` ms) for both
  LibreChat MCP config and Steel direct OCR helper defaults.
- [x] Restarted the backend for local testing on port `3080`.
- [x] Verified the running backend is serving `http://localhost:3080/`.
- [x] Verified backend logs initialize `PaddleOCR-VL-1.6` and expose the
  `paddleocr_vl` MCP tool.
- [x] Started the Vite frontend dev server for browser testing on port `3090`.
- Verification:
  - `rtk lsof -nP -iTCP:3080 -sTCP:LISTEN` showed PID `18428` listening on
    `[::1]:3080`.
  - `rtk curl -sS -o /tmp/librechat-root.html -w "%{http_code}\n" http://localhost:3080/`
    returned `200`.
  - Backend log showed `PaddleOCR-VL-1.6.timeout: 1200000`, `Tools:
    paddleocr_vl`, and `[MCP] Initialized with 1 configured server and 1 tool.`
  - `rtk lsof -nP -iTCP:3090 -sTCP:LISTEN` showed PID `24348` listening on
    `[::1]:3090`.
  - `rtk curl -sS -o /tmp/librechat-vite.html -w "%{http_code}\n" http://localhost:3090/`
    returned `200`.
  - `rtk git diff --check` passed.

## PaddleOCR MCP Env and Exact OCR Rules - 2026-06-27

- [x] Trace whether the running backend and MCP subprocess receive
  `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN` without printing the secret.
- [x] Verify whether LibreChat expands `${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}`
  in `librechat.yaml` before spawning the PaddleOCR MCP server.
- [x] Fix PaddleOCR MCP tool exposure so it is loaded during initialization
  every turn, not only after current-turn file propagation detects PDFs/images.
- [x] Update OCR rules so dimensions/quantities/thicknesses must be exact from
  OCR evidence and may not be written as approximate values such as `約 600 x
  300`.
- [x] Sync the updated OCR rule into cloud `steel.rules`.
- [x] Rebuild/restart the local stack and verify both MCP availability and OCR
  rule sync.
- Evidence:
  - `.env` readback showed `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN=SET` with a
    non-placeholder value; parsing `librechat.yaml` without dotenv leaves the
    placeholder literal, so the token must be present before config parsing.
  - `api/db/connect.js` loads dotenv during backend module import, so the
    remaining live failure path was missing current-turn OCR file references,
    not a missing repo `.env` value.
  - Added AgentClient fallback from processed files to original request
    attachments, covering uploaded PDFs reported as `application/octet-stream`
    but named `*.pdf`.
  - Added ToolService debug log when PaddleOCR MCP is injected during tool
    initialization; OCR-capable file references are logged when present.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --dry-run` passed.
  - `rtk node packages/api/scripts/sync-steel-rules.cjs --apply` passed and
    read back `steel-drawing-ocr-policy` SHA
    `555f69058d36413996372006bdec58ec37c51f8734e9ccb86a6edfb0268fccec`.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed with 63 tests.
  - `cd api && rtk npx jest server/controllers/agents/client.test.js --runInBand --watch=false --coverage=false --testNamePattern "buildMessages with request and agent-scoped context attachments"`
    passed with 9 focused tests.
  - Restarted backend on port `3080`; `rtk lsof -nP -iTCP:3080 -sTCP:LISTEN`
    showed PID `54802`, and `curl http://localhost:3080/` returned `200`.
  - Frontend dev server on port `3090` remained live and returned `200`.
  - Backend log showed `PaddleOCR-VL-1.6` initialized with `Tools:
    paddleocr_vl` and `[MCP] Initialized with 1 configured server and 1 tool.`
  - Direct `docs/reference/example/c.pdf` PaddleOCR MCP manual OCR spec passed:
    `cd packages/api && rtk env DOTENV_CONFIG_PATH=../../.env STEEL_PADDLEOCR_MCP_C_PDF_OCR_TEST=true node -r dotenv/config ../../node_modules/.bin/jest --runTestsByPath src/steel/vision/paddleocr.c-pdf-ocr.manual.spec.ts --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/dist/ --testPathIgnorePatterns='\\.dev\\.ts$' --testPathIgnorePatterns='\\.helper\\.ts$' --testPathIgnorePatterns='\\.helper\\.d\\.ts$' --testPathIgnorePatterns=/__tests__/helpers/ --runInBand`
    passed with 1 manual OCR test in 15.3s.

## PaddleOCR MCP Provider Tool Name Fix - 2026-06-27

- [x] Reproduce the provider rejection where the initialized PaddleOCR tool is
  sent as `paddleocr_vl_mcp_PaddleOCR-VL-1.6`, which violates OpenAI tool-name
  validation because of the `.` in the raw server name.
- [x] Add provider-safe MCP tool-key tests so definitions use only
  `^[a-zA-Z0-9_-]+$` names while keeping the raw MCP server name for config
  lookup.
- [x] Add execution-path coverage proving a safe provider suffix maps back to
  the raw MCP server name before calling MCP config/connection code.
- [x] Implement the smallest shared helper needed for provider-facing MCP tool
  names and apply it to cached definitions plus runtime tool instances.
- [x] Rebuild/restart the backend and verify the local UI still runs on
  `http://localhost:3090/`.
- Evidence:
  - Red tests failed before the fix for `src/mcp/tools.spec.ts` and
    `app/clients/tools/util/handleTools.test.js`; after the fix, the focused
    provider-safe tests passed.
  - `cd packages/api && rtk npx jest src/mcp/tools.spec.ts --runInBand --watch=false --coverage=false`
    passed with 21 tests.
  - `cd packages/api && rtk npx jest src/tools/definitions.spec.ts --runInBand --watch=false --coverage=false`
    passed with 27 tests.
  - `cd api && rtk npx jest app/clients/tools/util/handleTools.test.js --runInBand --watch=false --coverage=false`
    passed with 16 tests.
  - `cd api && rtk npx jest server/services/MCP.spec.js --runInBand --watch=false --coverage=false`
    passed with 52 tests.
  - `cd api && rtk npx jest server/services/__tests__/ToolService.spec.js --runInBand --watch=false --coverage=false`
    passed with 63 tests.
  - `cd packages/api && rtk npm run build` passed.
  - `rtk git diff --check` passed.
  - Runtime helper check returned `paddleocr_vl_mcp_PaddleOCR-VL-1_6` and
    regex `true` for `^[a-zA-Z0-9_-]+$`.
  - Backend restarted on `http://localhost:3080/` and returned `200`;
    frontend dev UI remained on `http://localhost:3090/` and returned `200`.
  - Live backend log after restart showed PaddleOCR MCP initialized, the LLM
    call accepted tool definitions, `ON_TOOL_EXECUTE` loaded 1 MCP tool, and
    `PaddleOCR-VL-1.6` received `tools/call`. No new `Invalid 'tools[0].name'`
    error appeared after the fix; the remaining invalid-name log entry is from
    the pre-fix 09:27 UTC request.
