# PaddleOCR API `uvx` Runtime Decision

Date: 2026-07-01

This document supersedes the 2026-06-29 host-managed Python-environment plan.
The old approach prepared PaddleOCR before the LibreChat API started. The
current runtime keeps PaddleOCR as a normal LibreChat MCP server launched by
the API process when the tool is used.

## Decision

Use the API image's `uvx` binary to launch `paddleocr-mcp` directly from
LibreChat MCP config:

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

`deploy/host/start.sh` should not install, prewarm, or validate PaddleOCR at API
startup. LibreChat keeps the server registered with `startup: false` and starts
the stdio process only when the MCP tool is invoked.

## Rationale

- The selected provider path is AI Studio, hardcoded as
  `PADDLEOCR_MCP_PPOCR_SOURCE: aistudio`.
- The API image already carries `uv`/`uvx`; `uvx --python 3.12 --from
  paddleocr-mcp paddleocr_mcp` can resolve the MCP package at launch time.
- AI Studio mode does not need local PaddlePaddle inference packages in the API
  container.
- Local `npm run backend` and production now share the same `librechat.yaml`
  MCP contract.
- Operators only need to provide `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN` plus the
  existing timeout settings.

## Smoke Contract

`deploy/host/paddleocr-smoke.sh` must read the `PaddleOCR` server config from
`CONFIG_PATH` or `/data/librechat.yaml`, resolve env placeholders from the
container environment, and use the configured command/args/env/timeout. The
smoke script should not duplicate PaddleOCR MCP environment assembly.

Run live OCR smoke manually with a fresh S3 URL:

```bash
deploy/host/paddleocr-smoke.sh "https://..."
```

GitHub Actions does not run live PaddleOCR OCR as a deploy gate. Production
rollout remains gated by LibreChat health because PaddleOCR depends on the
external AI Studio API path and can fail due to provider/network conditions.

## Verification

- Shell syntax for `deploy/host/start.sh`.
- Shell syntax for `deploy/host/paddleocr-smoke.sh`.
- `librechat.yaml` parses and configures `PaddleOCR` with `command: uvx`.
- `.env.example` and `.env.prod.example` do not expose old Python-environment
  controls.
- The smoke script reads MCP server config from LibreChat YAML.
- A local MCP client can start the configured `uvx` server and list
  `paddleocr_vl`.
- A production smoke can call `paddleocr_vl` with a fresh S3 PDF URL when live
  provider verification is needed.
