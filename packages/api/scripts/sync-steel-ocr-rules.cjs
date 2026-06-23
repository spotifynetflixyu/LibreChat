#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.resolve(__dirname, 'sync-steel-rules.cjs');

process.stderr.write(
  'sync-steel-ocr-rules.cjs is deprecated; delegating to unified sync-steel-rules.cjs. OCR rules now live in steel.rules with rule_kind=other.\\n',
);

const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
