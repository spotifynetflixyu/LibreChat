export function getSteelOcrFailureStatus(
  signal?: AbortSignal,
): 'failed' | 'paused' | 'interrupted' {
  if (!signal?.aborted) return 'failed';
  return signal.reason === 'user_pause' ? 'paused' : 'interrupted';
}
