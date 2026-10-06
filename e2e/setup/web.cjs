const path = require('node:path');
const { spawn } = require('node:child_process');
const { MongoMemoryReplSet } = require(
  require.resolve('mongodb-memory-server', {
    paths: [path.join(process.cwd(), 'packages/data-schemas')],
  }),
);
const { validateList } = require('./flows.cjs');

const ROOT = process.cwd();
const CONFIG = path.resolve(ROOT, 'e2e/playwright.config.web.ts');
const PLAYWRIGHT_CLI = require.resolve('@playwright/test/cli', { paths: [ROOT] });

let activeChild;
let activeReplica;
let stopping = false;
let requestedSignal;

function parseArgs(args) {
  const result = [];
  let listOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--list') {
      listOnly = true;
      continue;
    }
    if (arg === '--project' || arg === '--reporter') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--reporter' && value !== 'line') {
        throw new Error('The normal E2E runner only supports --reporter=line');
      }
      result.push(arg, value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--project=')) {
      result.push(arg);
      continue;
    }
    if (arg === '--reporter=line') {
      result.push(arg);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unsupported normal E2E option: ${arg}`);
    }
    throw new Error(`Unsupported normal E2E argument: ${arg}`);
  }
  return { args: result, listOnly };
}

function safeEnvironment() {
  const env = {
    ...process.env,
    E2E_REPLICAS: '1',
    E2E_USE_MEMORY_MONGO: 'false',
    E2E_STREAM_STORE: 'memory',
    E2E_REQUIRE_REDIS_STREAMS: 'false',
    USE_REDIS: 'false',
    USE_REDIS_STREAMS: 'false',
    USE_REDIS_CLUSTER: 'false',
    STEEL_POSTGRES_URL: '',
  };

  const providerCredential =
    /(OPENAI|ANTHROPIC|GOOGLE|GEMINI|COHERE|MISTRAL|DEEPSEEK|OPENROUTER|GROQ|PERPLEXITY|TOGETHER|AZURE_OPENAI|VERTEX|AWS_ACCESS|AWS_SECRET|STEEL_POSTGRES|E2E_RECORD_PROVIDER)/i;
  for (const key of Object.keys(env)) {
    if (
      providerCredential.test(key) &&
      /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|URL|ID)$/i.test(key)
    ) {
      env[key] = '';
    }
  }
  return env;
}

function spawnPlaywright(args, env, captureOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', `--config=${CONFIG}`, ...args], {
      cwd: ROOT,
      env,
      stdio: captureOutput ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    });
    activeChild = child;
    let stdout = '';
    if (captureOutput) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    child.once('error', (error) => {
      if (activeChild === child) {
        activeChild = undefined;
      }
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (activeChild === child) {
        activeChild = undefined;
      }
      resolve({ code: code ?? 1, signal, stdout });
    });
  });
}

async function startReplica() {
  activeReplica = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
      dbName: 'LibreChat-e2e',
      args: ['--setParameter', 'ttlMonitorEnabled=false'],
    },
  });
  return activeReplica.getUri('LibreChat-e2e');
}

async function stopReplica() {
  if (!activeReplica) {
    return;
  }
  const replica = activeReplica;
  activeReplica = undefined;
  await replica.stop();
}

function requestStop(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  requestedSignal = signal;
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal);
  }
}

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : 143;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (process.env.E2E_MODEL_FIXTURES === 'record') {
    throw new Error('E2E_MODEL_FIXTURES=record is refused by the normal CI web runner');
  }
  const parsed = parseArgs(rawArgs);
  const args = parsed.args;
  const env = safeEnvironment();
  const listArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--reporter') {
      index += 1;
      continue;
    }
    if (args[index].startsWith('--reporter=')) {
      continue;
    }
    listArgs.push(args[index]);
  }
  const listResult = await spawnPlaywright(['--list', '--reporter=json', ...listArgs], env, true);
  if (requestedSignal) {
    process.exitCode = signalExitCode(requestedSignal);
    return;
  }
  if (listResult.code !== 0) {
    throw new Error(`Playwright list failed with exit code ${listResult.code}`);
  }

  let payload;
  try {
    payload = JSON.parse(listResult.stdout);
  } catch (error) {
    throw new Error(`Playwright list did not return JSON: ${error.message}`);
  }
  const listed = validateList(payload, args);
  process.stderr.write(`[e2e] validated ${listed.length} selected normal tests\n`);

  if (parsed.listOnly) {
    process.stdout.write(listResult.stdout);
    return;
  }

  const mongoUri = await startReplica();
  if (requestedSignal) {
    process.exitCode = signalExitCode(requestedSignal);
    return;
  }
  const runEnv = { ...env, MONGO_URI: mongoUri };
  const runResult = await spawnPlaywright(args, runEnv, false);
  if (requestedSignal) {
    process.exitCode = signalExitCode(requestedSignal);
  } else if (runResult.code !== 0) {
    process.exitCode = runResult.code || 1;
  }
}

process.once('SIGINT', () => requestStop('SIGINT'));
process.once('SIGTERM', () => requestStop('SIGTERM'));

main()
  .catch((error) => {
    console.error(`[e2e] normal web runner failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await stopReplica();
    } catch (error) {
      console.error(`[e2e] failed to stop temporary MongoDB: ${error.message}`);
      process.exitCode = 1;
    }
  });
