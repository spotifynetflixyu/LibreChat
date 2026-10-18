import type { Agents } from 'librechat-data-provider';
import type { RunSteelOcrTurnWithRetriesInput } from './retry';
import {
  isSteelOcrPreflightTurn,
  runSteelOcrTurnWithRetries,
  STEEL_OCR_TURN_MAX_ATTEMPTS,
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

describe('runSteelOcrTurnWithRetries', () => {
  it('reruns a failed main agent over a cleared attempt and keeps earlier parts', async () => {
    const { contentParts, stepMap, resetStepText, runAttempt, input } = createTurn();
    const run = runAttempt(2);

    await runSteelOcrTurnWithRetries(input(run));

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

    await expect(runSteelOcrTurnWithRetries(input(run))).rejects.toThrow('stream disconnected');
    expect(run).toHaveBeenCalledTimes(STEEL_OCR_TURN_MAX_ATTEMPTS);
    expect(resetStepText).toHaveBeenCalledTimes(STEEL_OCR_TURN_MAX_ATTEMPTS - 1);
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

    await expect(runSteelOcrTurnWithRetries(input(run))).rejects.toThrow('stream disconnected');
    expect(run).toHaveBeenCalledTimes(1);
    expect(resetStepText).not.toHaveBeenCalled();
    expect(contentParts[1]).toEqual({ type: 'text', text: 'attempt 1' });
  });
});
