# Render Production Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch production deployment from AWS Lightsail host automation to Render Web Service deployment.

**Architecture:** Render builds `Dockerfile.multi` from the production `master` branch and runs one Docker Web Service. MongoDB Atlas and Supabase remain external production databases, while Render Persistent Disk mounted at `/data` stores uploads, generated images, logs, shared skills, `librechat.yaml`, and the writable OpenAI OAuth `auth.json`.

**Tech Stack:** Render Web Service, Docker, Node.js/LibreChat, MongoDB Atlas, Supabase Postgres, OpenAI OAuth auth file, GitHub `master` branch auto deploy.

---

### Task 1: Disable Lightsail Auto Deploy

**Files:**
- Delete: `.github/workflows/deploy-prod.yml`
- Modify: `tasks/todo.md`

**Steps:**
1. Remove the workflow that builds GHCR and SSH redeploys Lightsail on `master`.
2. Keep other CI workflows untouched.
3. Verify `rg -n "LIGHTSAIL_|deploy-compose.prod.yml|deploy/lightsail" .github/workflows` returns no production deploy workflow references.

### Task 2: Add Render Runtime Startup

**Files:**
- Create: `deploy/render/start.sh`
- Modify: `Dockerfile.multi`

**Steps:**
1. Add a startup script that defaults `HOST=0.0.0.0`, `CONFIG_PATH=/data/librechat.yaml`, and `OPENAI_OAUTH_AUTH_FILE=/data/openai-oauth/auth.json`.
2. Seed `/data/skill` from image `/app/skill` when the disk is empty.
3. Symlink persistent paths from `/data` to the app paths used by LibreChat.
4. Copy `deploy/render` into the final Docker image.
5. Verify with `bash -n deploy/render/start.sh`.

### Task 3: Add Render Runbook

**Files:**
- Create: `docs/deployment/render-prod-runbook.md`

**Steps:**
1. Document Render Web Service settings: branch `master`, Docker runtime, `Dockerfile.multi`, Docker Command `sh /app/deploy/render/start.sh`.
2. Document default Render domain usage and the required `DOMAIN_CLIENT` / `DOMAIN_SERVER` values.
3. Document Persistent Disk mount `/data` and why uploads/auth files cannot stay in the image or container layer.
4. Document how to install writable OpenAI OAuth `auth.json` through Render Shell.
5. Document admin bootstrap with `ALLOW_REGISTRATION=false`.
6. Document smoke verification with `scripts/prod-smoke.sh`.

### Task 4: Update Env Template And Lessons

**Files:**
- Modify: `.env.prod.example`
- Modify: `tasks/lessons.md`
- Modify: `tasks/todo.md`

**Steps:**
1. Replace Lightsail-only placeholders with Render-friendly values.
2. Keep real `.env.prod` ignored and never commit secrets.
3. Record that switching to Render requires disabling host SSH deploy automation and using a writable Persistent Disk for OAuth refresh state.

### Task 5: Verify And Commit

**Commands:**
- `bash -n deploy/render/start.sh`
- `rg -n -P '<secret-patterns>' .env.prod.example docs/deployment deploy/render tasks/todo.md tasks/lessons.md`
- `git diff --check`
- `git status --short`

**Steps:**
1. Run focused verification commands.
2. Commit the Render transition.
3. Move local `master` to the verified commit.
