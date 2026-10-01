import type {
  OpenAIOAuthTokenLoader,
  OpenAIOAuthTokens,
  OpenAIOAuthFetch,
} from '~/steel/native/credentials';
import type { OpenAIOAuthProbeTransportFactory } from './transport';
import { loadOpenAIOAuthTokens, refreshOpenAIOAuthCredentials } from '~/steel/native/credentials';
import { OpenAIOAuthCompactionProbeError, probeOpenAIOAuthCompaction } from './probe';
import { resolveOpenAIOAuthAuthFilePath } from '~/steel/ai/config';
import { createOpenAIOAuthProbeClient } from './transport';
import { probeOpenAIOAuthCompactionV2 } from './v2';

interface CommandArguments {
  help: boolean;
  refresh: boolean;
  responsesLite: boolean;
  model: string;
  mode: 'codex-v2' | 'standalone';
  timeoutMs: number;
  authFilePath?: string;
}

export interface OpenAIOAuthCompactionCommandOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  fetch: OpenAIOAuthFetch;
  createTransport: OpenAIOAuthProbeTransportFactory;
  loadTokens?: OpenAIOAuthTokenLoader;
  refreshCredentials?: typeof refreshOpenAIOAuthCredentials;
}

export interface OpenAIOAuthCompactionCommandResult {
  output: string;
  exitCode: 0 | 1 | 2;
}

function parseArguments(argv: string[]): CommandArguments | null {
  const result: CommandArguments = {
    help: false,
    refresh: false,
    responsesLite: false,
    model: 'gpt-6.1-sol',
    mode: 'codex-v2',
    timeoutMs: 120000,
  };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    if (key === '--help') {
      result.help = true;
      continue;
    }
    if (key === '--refresh' || key === '--responses-lite') {
      result[key === '--refresh' ? 'refresh' : 'responsesLite'] = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) {
      return null;
    }
    if (key === '--model' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
      result.model = value;
      continue;
    }
    if (key === '--mode' && (value === 'codex-v2' || value === 'standalone')) {
      result.mode = value;
      continue;
    }
    if (key === '--auth-file' && value.length <= 4096) {
      result.authFilePath = value;
      continue;
    }
    if (key === '--timeout-ms' && /^\d+$/.test(value)) {
      const timeoutMs = Number(value);
      if (Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000) {
        result.timeoutMs = timeoutMs;
        continue;
      }
    }
    return null;
  }
  return result;
}

const commandHelp = `OpenAI OAuth compaction protocol diagnostic (no runtime activation).
Prerequisite: npm run build:api
Usage: npm run probe:oauth-compaction -- [options]
  --model MODEL          OAuth catalog model (default: gpt-6.1-sol)
  --mode MODE            codex-v2 (default) or standalone
  --timeout-ms MS        Diagnostic deadline, 1000..300000 (default: 120000)
  --auth-file PATH       Override the configured OAuth credential file
  --refresh             Use the existing token refresh workflow before probing
  --responses-lite      Include Responses-lite headers for compact/accounting
  --help                Show this help without reading credentials
Exit: 0 protocol checks passed; 1 capability gate failed; 2 operational/argument failure.
`;

function failure(code: string, stage?: string): OpenAIOAuthCompactionCommandResult {
  return {
    output: `${JSON.stringify({ protocolCompatible: false, code, ...(stage ? { stage } : {}) })}\n`,
    exitCode: 2,
  };
}

export async function runOpenAIOAuthCompactionCommand({
  argv,
  env,
  fetch,
  createTransport,
  loadTokens = loadOpenAIOAuthTokens,
  refreshCredentials = refreshOpenAIOAuthCredentials,
}: OpenAIOAuthCompactionCommandOptions): Promise<OpenAIOAuthCompactionCommandResult> {
  const args = parseArguments(argv);
  if (!args) {
    return failure('invalid_arguments');
  }
  if (args.help) {
    return { output: commandHelp, exitCode: 0 };
  }
  const signal = AbortSignal.timeout(args.timeoutMs);
  const boundedFetch: OpenAIOAuthFetch = (input, init) =>
    fetch(input, { ...init, signal: init?.signal ?? signal });
  const credentialOptions = {
    authFilePath: args.authFilePath ?? resolveOpenAIOAuthAuthFilePath(env),
    ensureFresh: false,
    fetch: boundedFetch,
  };
  let auth: OpenAIOAuthTokens;
  try {
    auth = args.refresh
      ? (await refreshCredentials({ ...credentialOptions, force: true })).auth
      : await loadTokens(credentialOptions);
  } catch {
    return failure(signal.aborted ? 'probe_aborted' : 'credential_load_failed', 'credentials');
  }
  try {
    const client = createOpenAIOAuthProbeClient({
      auth,
      createTransport,
      fetch: boundedFetch,
      responsesLite: args.responsesLite,
      signal,
    });
    const probe =
      args.mode === 'codex-v2' ? probeOpenAIOAuthCompactionV2 : probeOpenAIOAuthCompaction;
    const result = await probe({
      client,
      model: args.model,
      signal,
      maxResponseBytes: 1024 * 1024,
    });
    return {
      output: `${JSON.stringify({ route: 'existing_codex', mode: args.mode, ...result })}\n`,
      exitCode: result.protocolCompatible ? 0 : 1,
    };
  } catch (error) {
    if (error instanceof OpenAIOAuthCompactionProbeError) {
      return failure(error.code, error.stage);
    }
    return failure(signal.aborted ? 'probe_aborted' : 'probe_operational_failure');
  }
}
