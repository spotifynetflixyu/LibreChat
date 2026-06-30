# PaddleOCR Persistent Venv Prewarm Plan

Date: 2026-06-29

## Goal

Make production PaddleOCR MCP reliable on the DigitalOcean Droplet without
embedding the full `paddleocr-mcp` Python environment in every API image.

## Decision

Use a persistent host-mounted venv under:

```text
/data/paddleocr/venv
```

Keep the API image on Debian/glibc with the required OpenCV runtime libraries
and `uv`, but install `paddleocr-mcp` into the persistent venv at container
startup if it is missing.

Do not split PaddleOCR into a sidecar yet. The current deployment is a
low-cost single Droplet, and a persistent venv gives the main benefits now:

- Smaller production image than image-build prewarm.
- First install persists across app redeploys because `/data` is mounted.
- Startup can fail fast if the MCP package cannot import or start.
- No extra container coordination yet.

## Runtime Contract

Production `librechat.yaml` should point PaddleOCR to:

```yaml
mcpServers:
  PaddleOCR:
    type: stdio
    startup: false
    command: /data/paddleocr/venv/bin/paddleocr_mcp
    args: []
```

The API startup script prepares the venv before `node server/index.js` starts:

1. Create `/data/paddleocr/venv` with Python 3.12 if missing.
2. Install `paddleocr-mcp` into that venv if missing or if the configured
   package marker changed.
3. Import `paddleocr_mcp` to prewarm Python/package loading.
4. Start the MCP command briefly with stdin held open, proving it does not
   crash during startup.

## Production Smoke

`deploy/host/paddleocr-smoke.sh` is the production PaddleOCR MCP smoke. It:

1. Connects to `/data/paddleocr/venv/bin/paddleocr_mcp` through the MCP SDK.
2. Confirms `paddleocr_vl` is listed.
3. Calls `paddleocr_vl` against the selected PDF path.
4. Fails if OCR returns no useful text, misses the configured marker set, or
   returns the old
   `No text could be parsed` failure.

GitHub Actions does not run this smoke as a deploy gate. The deploy gate stays
limited to LibreChat container health because PaddleOCR depends on the external
AI Studio API path and can fail due to provider or network conditions unrelated
to app rollout. Run the smoke manually when diagnosing OCR provider/runtime
health. The local `docs/reference/example/c.pdf` file is ignored by git and is
uploaded manually to `/data/smoke/c.pdf` for full drawing OCR smoke checks.

## Rollback

If persistent venv startup fails:

1. Temporarily set `PADDLEOCR_PREPARE_ON_STARTUP=false` in
   `/etc/librechat/.env.prod` to let LibreChat start without the prewarm gate.
   This is a break-glass override; normal production defaults live in
   `deploy/host/start.sh`.
2. Revert production `librechat.yaml` to the previous `uvx --python 3.12
   --from paddleocr-mcp paddleocr_mcp` command.
3. Redeploy the previous GHCR image tag if needed.

## Verification

- Shell syntax for `deploy/host/start.sh`.
- Shell syntax for `deploy/host/paddleocr-smoke.sh`.
- Docker Compose config validation.
- GitHub Actions deploy from `master`.
- Droplet health check after deploy.
- Droplet short-start MCP check logs from container startup.
- Manual Droplet live `c.pdf` smoke after uploading local
  `docs/reference/example/c.pdf` to `/data/smoke/c.pdf`.

## Current Result

The persistent venv and MCP startup check pass on the Droplet. Production
deploy no longer gates on live PaddleOCR OCR.

The full `docs/reference/example/c.pdf` smoke does not currently return usable
OCR through the AI Studio API path. The latest diagnosis shows the Droplet
cannot reliably multipart-upload the 7.6 MB PDF to
`https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`; this is an AI Studio
network/API upload-path issue to investigate separately from production host
startup.

The same API-path problem is not limited to the large PDF. A 296,377 byte
`docs/reference/example/b.png` copied to `/data/smoke/b.png` timed out during
multipart submit from the Singapore Droplet, and a valid S3 presigned `fileUrl`
for the same PNG returned AI Studio `HTTP 400` code `10000` with
`文件 URL 访问超时`.
