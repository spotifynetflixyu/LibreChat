import type { Agents } from 'librechat-data-provider';
import type { RunSteelOcrTurnWithRetriesInput } from './retry';
import {
  SteelOcrChunkError,
  STEEL_OCR_MAX_ATTEMPTS,
  runWithSteelOcrRetries,
  isSteelOcrPreflightTurn,
  STEEL_OCR_RETRY_DELAY_MS,
  runSteelOcrTurnWithRetries,
} from './retry';

const ocrTurn = { ocrTurnActive: true };

function createTurn(overrides: Partial<RunSteelOcrTurnWithRetriesInput> = {}) {
  const contentParts: Agents.MessageContentComplex[] = [{ type: 'text', text: 'steer' }];
  const stepMap = new Map<string, { index: number }>([['earlier-step', { index: 0 }]]);
  const resetStepText = jest.fn(async () => undefined);
  let attempt = 0;
  /** Each attempt streams into a new step at index 1, then fails until `succeedOn`. */
  const runAttempt = (succeedOn: number) =>
    jest.fn(async () => {
      attempt += 1;
      stepMap.set(`step-${attempt}`, { index: 1 });
      contentParts[1] = { type: 'text', text: `attempt ${attempt}` };
      if (attempt < succeedOn) {
        throw new Error('stream disconnected');
      }
    });
  const input = (run: () => Promise<void>): RunSteelOcrTurnWithRetriesInput => ({
    context: ocrTurn,
    contentParts,
    stepMap,
    resetStepText,
    getIndexOffset: () => 0,
    run,
    isRetryable: () => true,
    ...overrides,
  });
  return { contentParts, stepMap, resetStepText, runAttempt, input };
}

describe('isSteelOcrPreflightTurn', () => {
  it.each([
    ['an OCR preflight turn', ocrTurn, true],
    ['an ordinary turn', {}, false],
    ['a delegate_ocr turn', { ...ocrTurn, delegateOcrPolicy: { allowed: true } }, false],
    ['a delegate_ocr resume', { ...ocrTurn, delegateOcrResume: {} }, false],
    ['a quotation resume', { ...ocrTurn, quotation: { resume: true } }, false],
  ])('%s retries: %s', (_label, context, expected) => {
    expect(isSteelOcrPreflightTurn(context)).toBe(expected);
  });
});

/** Settles a promise while its retry waits run on fake timers. */
async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = Promise.allSettled([promise]);
  await jest.runAllTimersAsync();
  return (await settled)[0];
}

describe('runWithSteelOcrRetries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits the retry delay before each of its three attempts', async () => {
    const run = jest.fn(async (attemptNumber: number) => {
      if (attemptNumber < 3) {
        throw new Error(`attempt ${attemptNumber} failed`);
      }
      return 'ok';
    });
    const onRetry = jest.fn();
    const promise = runWithSteelOcrRetries({ run, onRetry });

    await jest.advanceTimersByTimeAsync(STEEL_OCR_RETRY_DELAY_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(STEEL_OCR_RETRY_DELAY_MS);

    await expect(promise).resolves.toBe('ok');
    expect(onRetry.mock.calls).toEqual([[2], [3]]);
  });

  it('throws the last error after the final attempt', async () => {
    const run = jest.fn(async (attemptNumber: number) => {
      throw new Error(`attempt ${attemptNumber} failed`);
    });

    const result = await settle(runWithSteelOcrRetries({ run }));

    expect(result).toMatchObject({ status: 'rejected', reason: new Error('attempt 3 failed') });
    expect(run).toHaveBeenCalledTimes(STEEL_OCR_MAX_ATTEMPTS);
  });

  it.each([
    ['an OCR chunk failure', new SteelOcrChunkError('OCR failed')],
    ['a terminal client error', Object.assign(new Error('forbidden'), { status: 403 })],
  ])('does not retry %s', async (_label, error) => {
    const run = jest.fn(async () => {
      throw error;
    });

    const result = await settle(runWithSteelOcrRetries({ run }));

    expect(result).toMatchObject({ status: 'rejected', reason: error });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries a rate limit', async () => {
    const run = jest
      .fn<Promise<string>, [number]>()
      .mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }))
      .mockResolvedValueOnce('ok');

    const result = await settle(runWithSteelOcrRetries({ run }));

    expect(result).toEqual({ status: 'fulfilled', value: 'ok' });
  });

  it('stops waiting when the request is stopped', async () => {
    const controller = new AbortController();
    const run = jest.fn(async () => {
      throw new Error('stream disconnected');
    });
    const promise = runWithSteelOcrRetries({ run, signal: controller.signal });
    const settled = Promise.allSettled([promise]);

    await jest.advanceTimersByTimeAsync(1);
    controller.abort();

    expect((await settled)[0]).toMatchObject({ status: 'rejected' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('runSteelOcrTurnWithRetries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reruns a failed main agent over a cleared attempt and keeps earlier parts', async () => {
    const { contentParts, stepMap, resetStepText, runAttempt, input } = createTurn();
    const run = runAttempt(2);

    await expect(settle(runSteelOcrTurnWithRetries(input(run)))).resolves.toMatchObject({
      status: 'fulfilled',
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(resetStepText).toHaveBeenCalledTimes(1);
    expect(resetStepText).toHaveBeenCalledWith('step-1');
    expect(contentParts).toEqual([
      { type: 'text', text: 'steer' },
      { type: 'text', text: 'attempt 2' },
    ]);
    expect([...stepMap.keys()]).toEqual(['earlier-step', 'step-2']);
  });

  it('gives up with the last error after three attempts', async () => {
    const { resetStepText, runAttempt, input } = createTurn();
    const run = runAttempt(Infinity);

    const result = await settle(runSteelOcrTurnWithRetries(input(run)));

    expect(result).toMatchObject({ status: 'rejected', reason: new Error('stream disconnected') });
    expect(run).toHaveBeenCalledTimes(STEEL_OCR_MAX_ATTEMPTS);
    expect(resetStepText).toHaveBeenCalledTimes(STEEL_OCR_MAX_ATTEMPTS - 1);
  });

  it.each([
    ['an ordinary turn', { context: {} }],
    ['a stop or terminal error', { isRetryable: () => false }],
    [
      'a steer inserted during the attempt',
      { getIndexOffset: jest.fn().mockReturnValueOnce(0).mockReturnValue(1) },
    ],
  ])('does not retry %s', async (_label, overrides) => {
    const { contentParts, resetStepText, runAttempt, input } = createTurn(overrides);
    const run = runAttempt(2);

    const result = await settle(runSteelOcrTurnWithRetries(input(run)));

    expect(result).toMatchObject({ status: 'rejected', reason: new Error('stream disconnected') });
    expect(run).toHaveBeenCalledTimes(1);
    expect(resetStepText).not.toHaveBeenCalled();
    expect(contentParts[1]).toEqual({ type: 'text', text: 'attempt 1' });
  });
});
