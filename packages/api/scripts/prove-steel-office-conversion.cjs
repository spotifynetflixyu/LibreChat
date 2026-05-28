#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const conversionOutputDir = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'tmp',
  'steel-office-conversion',
);

const conversionTargets = {
  '.doc': 'docx',
  '.xls': 'xlsx',
};

function printUsage() {
  console.log(`Usage:
  npm run steel:prove-office-conversion -- <legacy-file.xls> [legacy-file.doc ...]

The script proves whether this host can convert legacy Office files before
server-side Steel conversion is enabled in runtime code.

Converted files are written to:
  ${conversionOutputDir}`);
}

function findLibreOfficeBinary() {
  for (const candidate of ['soffice', 'libreoffice']) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function assertLegacyInput(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const target = conversionTargets[extension];
  if (!target) {
    throw new Error(`${filePath} is not a supported legacy input (.xls or .doc)`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} does not exist`);
  }
  return target;
}

function convertFile(binary, filePath, targetFormat) {
  const outDir = conversionOutputDir;
  fs.mkdirSync(outDir, { recursive: true });

  const baseName = path.basename(filePath, path.extname(filePath));
  const outputPath = path.join(outDir, `${baseName}.${targetFormat}`);
  fs.rmSync(outputPath, { force: true });

  const result = spawnSync(
    binary,
    ['--headless', '--convert-to', targetFormat, '--outdir', outDir, filePath],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `${binary} failed for ${filePath}: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`${binary} reported success but ${outputPath} was not created`);
  }

  return outputPath;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 0;
  }
  if (args.length === 0) {
    printUsage();
    return 64;
  }

  const binary = findLibreOfficeBinary();
  if (!binary) {
    console.error('No soffice/libreoffice binary found on PATH.');
    return 2;
  }

  for (const inputPath of args) {
    const absolutePath = path.resolve(inputPath);
    const targetFormat = assertLegacyInput(absolutePath);
    const outputPath = convertFile(binary, absolutePath, targetFormat);
    console.log(`${absolutePath} -> ${outputPath}`);
  }

  return 0;
}

process.exitCode = main();
