import { abortSteelOcrExecution, registerSteelOcrExecution, runWithSteelOcrExecution } from './control';

const scope = { userId: 'user', conversationId: 'conversation', tenantId: 'tenant' };

it('aborts every host and nested OCR controller in the exact execution epoch', () => {
  const host = new AbortController();
  const nested = new AbortController();
  const replacement = new AbortController();
  const disposeHost = registerSteelOcrExecution(scope, 'response', host, 1);
  const disposeNested = registerSteelOcrExecution(scope, '1', nested, 1);
  const disposeReplacement = registerSteelOcrExecution(scope, 'response', replacement, 2);
  try {
    abortSteelOcrExecution(scope, '1', 'user_pause', 1);
    expect(host.signal.reason).toBe('user_pause');
    expect(nested.signal.reason).toBe('user_pause');
    expect(replacement.signal.aborted).toBe(false);
  } finally {
    disposeHost();
    disposeNested();
    disposeReplacement();
  }
});

it('forwards disconnection signals and removes completed execution registrations', async () => {
  const parent = new AbortController();
  let completedSignal: AbortSignal | undefined;
  await runWithSteelOcrExecution({ scope, responseGenerationId: 'response', executionEpoch: 3,
    signal: parent.signal }, async (signal) => {
    parent.abort('connection_closed');
    expect(signal?.reason).toBe('connection_closed');
  });
  await runWithSteelOcrExecution({ scope, responseGenerationId: 'response', executionEpoch: 4 }, async (signal) => {
    completedSignal = signal;
  });
  abortSteelOcrExecution(scope, 'response', 'user_pause', 4);
  expect(completedSignal?.aborted).toBe(false);
});
