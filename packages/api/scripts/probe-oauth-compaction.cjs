#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
async function main() {
  const { runOpenAIOAuthCompactionCommand } = require('../dist/index.cjs');
  const { createOpenAIOAuthTransport } = await import('@openai-oauth/core');
  const envPath = path.resolve(__dirname, '../../../.env');
  const env = {
    ...(fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {}),
    ...process.env,
  };
  const { output, exitCode } = await runOpenAIOAuthCompactionCommand({
    argv: process.argv.slice(2),
    env,
    fetch: globalThis.fetch,
    createTransport: createOpenAIOAuthTransport,
  });
  process.stdout.write(output);
  process.exitCode = exitCode;
}

main().catch(() => {
  process.stderr.write('{"protocolCompatible":false,"code":"probe_bootstrap_failed"}\n');
  process.exitCode = 2;
});
