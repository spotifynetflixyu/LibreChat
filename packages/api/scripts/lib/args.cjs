/**
 * Parses `--help`/`-h`, boolean `--flag`s and `--name <value>` options.
 * Unknown arguments and options without a value throw.
 */
function parseScriptArgs(argv, { flags = [], options = [] }) {
  const parsed = { help: false, flags: {}, options: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const name = arg.startsWith('--') ? arg.slice(2) : undefined;
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (name && options.includes(name)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      parsed.options[name] = value;
      index += 1;
    } else if (name && flags.includes(name)) {
      parsed.flags[name] = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

module.exports = { parseScriptArgs };
