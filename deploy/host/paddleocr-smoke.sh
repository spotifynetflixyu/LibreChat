#!/usr/bin/env sh
set -eu

PDF_PATH="${1:-${PADDLEOCR_SMOKE_PDF_PATH:-/data/smoke/c.pdf}}"
PADDLEOCR_DIR="${PADDLEOCR_DIR:-/data/paddleocr}"
PADDLEOCR_VENV_DIR="${PADDLEOCR_VENV_DIR:-$PADDLEOCR_DIR/venv}"
PADDLEOCR_MCP_COMMAND="${PADDLEOCR_MCP_COMMAND:-$PADDLEOCR_VENV_DIR/bin/paddleocr_mcp}"
PADDLEOCR_SMOKE_TIMEOUT_MS="${PADDLEOCR_SMOKE_TIMEOUT_MS:-1200000}"

export PADDLEOCR_MCP_COMMAND
export PADDLEOCR_SMOKE_TIMEOUT_MS

if [ ! -f "$PDF_PATH" ]; then
  printf 'PaddleOCR smoke PDF not found: %s\n' "$PDF_PATH" >&2
  exit 1
fi

if [ ! -x "$PADDLEOCR_MCP_COMMAND" ]; then
  printf 'PaddleOCR MCP command is not executable: %s\n' "$PADDLEOCR_MCP_COMMAND" >&2
  exit 1
fi

if [ -z "${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN:-}" ]; then
  printf 'PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN is required for live PaddleOCR smoke.\n' >&2
  exit 1
fi

node - "$PDF_PATH" <<'NODE'
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const pdfPath = process.argv[2];
const command = process.env.PADDLEOCR_MCP_COMMAND;
const timeoutMs = Number(process.env.PADDLEOCR_SMOKE_TIMEOUT_MS ?? 1200000);
const startedAt = Date.now();

function inheritedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  );
}

function redact(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/access[_-]?token["'=:\s]+[A-Za-z0-9._-]+/gi, 'access_token=[redacted]')
    .replace(/PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN["'=:\s]+[A-Za-z0-9._-]+/g, 'PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN=[redacted]');
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[xX＊*]/g, '×')
    .replace(/\s+/g, '');
}

function extractText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];

  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function main() {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF path does not exist: ${pdfPath}`);
  }

  const stderrChunks = [];
  const transport = new StdioClientTransport({
    command,
    args: [],
    env: {
      ...inheritedEnv(),
      PADDLEOCR_MCP_MODEL: process.env.PADDLEOCR_MCP_MODEL || 'PaddleOCR-VL-1.6',
      PADDLEOCR_MCP_PPOCR_SOURCE: process.env.PADDLEOCR_MCP_PPOCR_SOURCE || 'aistudio',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'librechat-prod-paddleocr-smoke', version: '0.0.0' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void client.close();
  }, timeoutMs);

  transport.stderr?.on('data', (chunk) => {
    stderrChunks.push(String(chunk));
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    if (!toolNames.includes('paddleocr_vl')) {
      throw new Error(`paddleocr_vl not found. Tools: ${toolNames.join(', ')}`);
    }

    const response = await client.callTool(
      {
        name: 'paddleocr_vl',
        arguments: {
          input_data: pdfPath,
          output_mode: 'detailed',
          file_type: 'pdf',
          return_images: false,
          runtime_params: {
            max_new_tokens: 12000,
            use_doc_orientation_classify: true,
            use_doc_unwarping: true,
            use_layout_detection: true,
          },
        },
      },
      undefined,
      { timeout: timeoutMs },
    );
    const text = extractText(response);
    const normalized = normalize(text);
    const requiredAnyMarkers = ['BP1', 'BP2', 'PL1', '柱底板', '連接板'];
    const matchedMarkers = requiredAnyMarkers.filter((marker) => normalized.includes(normalize(marker)));

    if (timedOut) {
      throw new Error(`PaddleOCR smoke timed out after ${timeoutMs} ms`);
    }

    if (text.length < 100) {
      throw new Error(`PaddleOCR smoke returned too little text: ${text.length} chars`);
    }

    if (/No text could be parsed/i.test(text)) {
      throw new Error('PaddleOCR smoke returned "No text could be parsed"');
    }

    if (matchedMarkers.length === 0) {
      throw new Error(`PaddleOCR smoke found no c.pdf markers from: ${requiredAnyMarkers.join(', ')}`);
    }

    const summary = {
      ok: true,
      pdfPath,
      command,
      elapsedMs: Date.now() - startedAt,
      textChars: text.length,
      matchedMarkers,
      preview: normalized.slice(0, 600),
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const stderrPreview = stderrChunks.join('').slice(-2000);

    console.error(redact(error?.stack || error?.message || error));
    if (stderrPreview) {
      console.error(redact(stderrPreview));
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

main();
NODE
