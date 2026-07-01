#!/usr/bin/env sh
set -eu

SMOKE_FILE_URL="${1:-}"

if [ -z "$SMOKE_FILE_URL" ]; then
  printf 'PaddleOCR live smoke skipped: pass an S3 smoke PDF URL as the first argument.\n'
  exit 0
fi

case "$SMOKE_FILE_URL" in
  http://*|https://*)
    ;;
  *)
    printf 'PaddleOCR live smoke requires an S3 PDF URL, not a local path: %s\n' "$SMOKE_FILE_URL" >&2
    exit 1
    ;;
esac

node - "$SMOKE_FILE_URL" <<'NODE'
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const smokeFileUrl = process.argv[2];
const minTextChars = Number(process.env.PADDLEOCR_SMOKE_MIN_TEXT_CHARS ?? 10);
const outputMode = process.env.PADDLEOCR_SMOKE_OUTPUT_MODE || 'markdown';
const maxNewTokens = Number(process.env.PADDLEOCR_SMOKE_MAX_NEW_TOKENS ?? 2048);
const toolName = process.env.PADDLEOCR_SMOKE_TOOL_NAME || 'paddleocr_vl';
const serverName = process.env.PADDLEOCR_SMOKE_MCP_SERVER_NAME || 'PaddleOCR';
const configPath = process.env.CONFIG_PATH || '/data/librechat.yaml';
const expectedMarkers = String(process.env.PADDLEOCR_SMOKE_EXPECT_MARKERS ?? '')
  .split(',')
  .map((marker) => marker.trim())
  .filter(Boolean);
const startedAt = Date.now();

function inheritedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
  );
}

function redact(value) {
  return String(value ?? '')
    .replace(/https:\/\/[^\s"']+/g, 'https://[redacted-s3-url]')
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

function boolEnv(name, defaultValue) {
  const value = process.env[name];

  if (value == null || value === '') {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function jsonEnv(name, defaultValue) {
  const value = process.env[name];

  if (value == null || value === '') {
    return defaultValue;
  }

  const parsed = JSON.parse(value);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }

  return parsed;
}

function extractText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];

  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function appendTail(current, chunk, limit = 2000) {
  return `${current}${String(chunk)}`.slice(-limit);
}

function getObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value;
}

function interpolateEnv(value) {
  if (typeof value !== 'string') {
    return value == null ? '' : String(value);
  }

  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? '');
}

function resolveCommand(command) {
  if (!command || typeof command !== 'string') {
    throw new Error(`${serverName}.command is required in ${configPath}`);
  }

  if (command.includes('/')) {
    fs.accessSync(command, fs.constants.X_OK);
    return command;
  }

  const match = String(process.env.PATH ?? '')
    .split(path.delimiter)
    .map((directory) => path.join(directory, command))
    .find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

  if (!match) {
    throw new Error(`${serverName}.command is not executable on PATH: ${command}`);
  }

  return command;
}

function loadPaddleOcrServerConfig() {
  const root = getObject(yaml.load(fs.readFileSync(configPath, 'utf8')), configPath);
  const servers = getObject(root.mcpServers, `${configPath}.mcpServers`);
  const serverConfig = getObject(servers[serverName], `${configPath}.mcpServers.${serverName}`);
  const serverEnv = getObject(serverConfig.env ?? {}, `${configPath}.mcpServers.${serverName}.env`);
  const env = {
    ...inheritedEnv(),
    ...Object.fromEntries(
      Object.entries(serverEnv).map(([key, value]) => [key, interpolateEnv(value)]),
    ),
  };
  const args = Array.isArray(serverConfig.args) ? serverConfig.args.map((arg) => String(arg)) : [];
  const timeoutMs = Number(process.env.PADDLEOCR_SMOKE_TIMEOUT_MS ?? serverConfig.timeout ?? 1200000);

  if (!env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN) {
    throw new Error(
      `${serverName}.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN is required in ${configPath}`,
    );
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${serverName}.timeout must be a positive number in ${configPath}`);
  }

  return {
    args,
    command: resolveCommand(serverConfig.command),
    env,
    model: env.PADDLEOCR_MCP_MODEL || '',
    provider: env.PADDLEOCR_MCP_PPOCR_SOURCE || '',
    timeoutMs,
  };
}

async function main() {
  if (!/^https?:\/\//i.test(smokeFileUrl)) {
    throw new Error(
      `PaddleOCR smoke requires an S3 file URL, not a local path: ${smokeFileUrl}`,
    );
  }

  const serverConfig = loadPaddleOcrServerConfig();
  const fileType = process.env.PADDLEOCR_SMOKE_FILE_TYPE || 'pdf';
  let stderrPreview = '';
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: serverConfig.env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'librechat-prod-paddleocr-smoke', version: '0.0.0' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void client.close();
  }, serverConfig.timeoutMs);

  transport.stderr?.on('data', (chunk) => {
    stderrPreview = appendTail(stderrPreview, chunk);
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    if (!toolNames.includes(toolName)) {
      throw new Error(`${toolName} not found. Tools: ${toolNames.join(', ')}`);
    }

    const extraRuntimeParams = jsonEnv('PADDLEOCR_SMOKE_RUNTIME_PARAMS_JSON', {});
    const runtimeParams = {
      max_new_tokens: maxNewTokens,
      use_doc_orientation_classify: boolEnv(
        'PADDLEOCR_SMOKE_USE_DOC_ORIENTATION_CLASSIFY',
        false,
      ),
      use_doc_unwarping: boolEnv('PADDLEOCR_SMOKE_USE_DOC_UNWARPING', false),
      use_layout_detection: boolEnv('PADDLEOCR_SMOKE_USE_LAYOUT_DETECTION', false),
      ...extraRuntimeParams,
    };
    const response = await client.callTool(
      {
        name: toolName,
        arguments: {
          input_data: smokeFileUrl,
          output_mode: outputMode,
          file_type: fileType,
          return_images: false,
          runtime_params: runtimeParams,
        },
      },
      undefined,
      { timeout: serverConfig.timeoutMs },
    );
    const text = extractText(response);
    const normalized = normalize(text);
    const matchedMarkers = expectedMarkers.filter((marker) => normalized.includes(normalize(marker)));
    if (timedOut) {
      throw new Error(`PaddleOCR smoke timed out after ${serverConfig.timeoutMs} ms`);
    }

    if (response?.isError === true || /Error calling tool/i.test(text)) {
      throw new Error(
        `PaddleOCR smoke tool returned an error. Preview: ${normalized.slice(0, 600)}. Stderr: ${redact(stderrPreview)}`,
      );
    }

    if (text.length < minTextChars) {
      throw new Error(
        `PaddleOCR smoke returned too little text: ${text.length} chars, minimum ${minTextChars}. Preview: ${normalized.slice(0, 600)}`,
      );
    }

    if (/No text could be parsed/i.test(text)) {
      throw new Error('PaddleOCR smoke returned "No text could be parsed"');
    }

    if (expectedMarkers.length > 0 && matchedMarkers.length === 0) {
      throw new Error(
        `PaddleOCR smoke found none of the expected markers: ${expectedMarkers.join(', ')}. Preview: ${normalized.slice(0, 600)}`,
      );
    }

    const summary = {
      ok: true,
      smokeFileUrl: '[redacted]',
      configPath,
      serverName,
      command: serverConfig.command,
      provider: serverConfig.provider,
      model: serverConfig.model,
      fileType,
      toolName,
      elapsedMs: Date.now() - startedAt,
      outputMode,
      maxNewTokens,
      runtimeParams,
      textChars: text.length,
      matchedMarkers,
      preview: normalized.slice(0, 600),
      stderrPreview: redact(stderrPreview),
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
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
