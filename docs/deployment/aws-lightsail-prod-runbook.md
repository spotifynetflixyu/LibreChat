# AWS Lightsail Production Runbook

This runbook sets up the low-cost production host for the customized
LibreChat/Steel deployment.

## Host Shape

- AWS Lightsail Linux instance.
- Starting size: 2 vCPU, 2 GB RAM, 60 GB SSD, public IPv4.
- Open firewall ports: `22`, `80`, `443`.
- Do not expose `3080` publicly.
- Add 2-4 GB swap before first production traffic.

## Production Data Boundary

Use production-only database resources:

- `MONGO_URI`: production MongoDB Atlas connection string.
- `STEEL_POSTGRES_URL`: production Supabase Postgres connection string.

Recommended: create a separate MongoDB Atlas project/cluster and a separate
Supabase project for production. Using only a different database name in shared
dev infrastructure is acceptable only for short-lived trials where accidental
cross-environment access is an accepted risk.

The application reads the same runtime env variable names in every environment.
Production separation comes from the values in `/etc/librechat/.env.prod`, not
from alternate names such as `PROD_MONGO_URI`.

## Install Docker

Use the OS vendor's Docker Engine instructions for the selected Lightsail image.
After installation, verify:

```bash
docker --version
docker compose version
```

## Add Swap

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## Create Runtime Directories

```bash
sudo mkdir -p /srv/librechat/{uploads,images,logs,skill,caddy/data,caddy/config,app}
sudo mkdir -p /etc/librechat
sudo mkdir -p /var/secrets/openai-oauth
```

Set ownership to the deployment/runtime user used on the host:

```bash
sudo chown -R deploy:deploy /srv/librechat
```

## Copy Deployment Files

From the development machine:

```bash
scp deploy-compose.prod.yml deploy@<host>:/srv/librechat/app/deploy-compose.prod.yml
scp -r deploy/lightsail deploy@<host>:/srv/librechat/app/deploy
scp .env.prod.example deploy@<host>:/tmp/.env.prod.example
```

On the host:

```bash
sudo install -m 600 /tmp/.env.prod.example /etc/librechat/.env.prod
sudo rm /tmp/.env.prod.example
sudo editor /etc/librechat/.env.prod
```

Replace every placeholder with production values.

Create the LibreChat config:

```bash
sudo tee /etc/librechat/librechat.yaml >/dev/null <<'YAML'
version: 1.3.11
YAML
sudo chmod 644 /etc/librechat/librechat.yaml
```

## Install OpenAI OAuth Auth File

Create `auth.json` on a trusted machine with the Codex/OpenAI login flow, then
copy it to the production host:

```bash
scp ~/.codex/auth.json deploy@<host>:/tmp/openai-auth.json
ssh deploy@<host>
sudo install -m 600 /tmp/openai-auth.json /var/secrets/openai-oauth/auth.json
sudo rm /tmp/openai-auth.json
```

The application must be able to write this file. `openai-oauth-provider`
refreshes access tokens with the refresh token and writes updated token data
back to `auth.json`.

If the container runs as root, `0600 root:root` is enough. If the runtime later
switches to a non-root user, change ownership narrowly to that runtime user.

## GHCR Login

If the production image is private, log in to GHCR on the host:

```bash
echo '<ghcr-read-token>' | docker login ghcr.io -u '<github-user>' --password-stdin
```

## Start Production

```bash
cd /srv/librechat/app
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml pull
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml up -d
```

## Create Admin And Internal Users

`ALLOW_REGISTRATION=false` keeps the public registration UI closed. It does not
block LibreChat's trusted server-side user script.

For a clean production MongoDB with no existing users, create the first account
from the running API container. LibreChat assigns the first registered user the
`ADMIN` role:

```bash
cd /srv/librechat/app
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml exec api \
  npm run create-user -- admin@example.com "Admin" admin
```

Let the script prompt for the password instead of passing the password as a
shell argument.

Create the remaining internal accounts the same way. After the first account,
new users are created with the normal `USER` role:

```bash
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml exec api \
  npm run create-user -- user01@example.com "User 01" user01
```

If production MongoDB already contains users and none of them is admin, do not
rely on `create-user` to promote a new account. Promote one trusted user to
`ADMIN` with a one-time MongoDB Atlas edit or a controlled `mongosh` update,
then manage later users through the admin UI.

## Verify

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
curl -fsS http://127.0.0.1:3080/api/config >/dev/null
curl -fsS https://<domain>/api/config >/dev/null
test -d /srv/librechat/uploads
test -f /var/secrets/openai-oauth/auth.json
```

The production page `/steel/oauth-chat` should return `404` through Caddy. The
normal LibreChat `/c/new` workflow should remain available.

## Backup

At minimum, back up:

- `/srv/librechat/uploads`
- `/srv/librechat/images`
- `/srv/librechat/skill`
- `/etc/librechat/.env.prod`
- `/etc/librechat/librechat.yaml`
- `/var/secrets/openai-oauth/auth.json`

Also enable MongoDB Atlas and Supabase backup features when data outgrows free
trial assumptions.

## OAuth Refresh Failure

If native OpenAI OAuth requests start failing with an auth-category error:

1. Re-run Codex/OpenAI login on a trusted machine.
2. Replace `/var/secrets/openai-oauth/auth.json`.
3. Restart the app container:

```bash
cd /srv/librechat/app
docker compose --env-file /etc/librechat/.env.prod -f deploy-compose.prod.yml restart api
```
