/** PaddleOCR-VL tool name on the PaddleOCR MCP server. */
export const steelPaddleOcrToolName = 'paddleocr_vl';

/** Lowercase error fragments that make a PaddleOCR call worth retrying. */
export const steelPaddleOcrRetryableErrorPatterns: readonly string[] = [
  'connection timeout after',
  'failed to establish connection',
  'connection reset by peer',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host paddleocr.aistudio-app.com',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
  'terminated',
  'timeout',
  'timed out',
  'fetch failed',
  'network error',
  'service unavailable',
  'temporarily unavailable',
  'try again later',
  'too many requests',
  'rate limit',
  'rate_limit',
  'error calling tool',
  'overloaded',
  '429',
  '408',
  '503',
];

/** Lowercase error fragments that mean the MCP transport must be rebuilt before a retry. */
export const steelPaddleOcrTransportErrorPatterns: readonly string[] = [
  'connection timeout',
  'failed to establish connection',
  'connection reset',
  'connectionreseterror',
  'clientconnectorerror',
  'clientoserror',
  'cannot connect to host',
  'econnreset',
  'socket hang up',
  'server disconnected',
  'transport closed',
  'terminated',
  'fetch failed',
  'network error',
];

export const steelPaddleOcrMaxAttempts = 3;

export const steelPaddleOcrRetryDelayMs = 3000;

export const steelPaddleOcrTaskIntervalMs = 1000;

export const steelPaddleOcrCallTimeoutMs: number = 10 * 60 * 1000;
