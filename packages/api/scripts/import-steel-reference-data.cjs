#!/usr/bin/env node

const disabledMessage =
  'Steel reference file imports are disabled because Steel quote data is database-backed. Use the reviewed database/Admin import flow instead.';

function parseArgs(argv) {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  npm run steel:import-reference-data -- --help

${disabledMessage}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  throw new Error(disabledMessage);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  disabledMessage,
  parseArgs,
  printUsage,
};
