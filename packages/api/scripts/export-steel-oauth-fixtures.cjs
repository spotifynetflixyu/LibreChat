#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';

require('ts-node/register/transpile-only');

const { exportSteelOAuthFileCapabilityFixtures } = require('../src/steel/ai/fixtures-export');

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
        if (parsed.name === 'LibreChat') {
          return current;
        }
      } catch {
        return current;
      }
    }
    current = path.dirname(current);
  }

  return process.cwd();
}

async function main() {
  const repoRoot = findRepoRoot(process.cwd());
  const outputDir = path.resolve(
    process.argv[2] ?? path.join(repoRoot, 'tmp/steel-oauth-fixtures'),
  );
  const result = await exportSteelOAuthFileCapabilityFixtures(outputDir);

  process.stdout.write(
    `${JSON.stringify(
      {
        outputDir: result.outputDir,
        files: result.files.map((file) => file.filename),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
