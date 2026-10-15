export const PADDLE_OCR_DIAGNOSTIC_CODES = [
  'ai_studio_auth',
  'ai_studio_unavailable',
  'ai_studio_rate_limited',
  'ai_studio_timeout',
  'ai_studio_invalid_request',
  'ai_studio_job_failed',
  'ai_studio_response_parse',
  'ai_studio_inference',
] as const;

export type PaddleOcrDiagnosticCode = (typeof PADDLE_OCR_DIAGNOSTIC_CODES)[number];

export const PADDLE_OCR_MCP_SERVER_NAME: string =
  process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME?.trim() || 'PaddleOCR';

export function isPaddleOcrMcpServerName(serverName: unknown): boolean {
  return (
    typeof serverName === 'string' &&
    serverName.toLowerCase() === PADDLE_OCR_MCP_SERVER_NAME.toLowerCase()
  );
}

const diagnosticPatterns: ReadonlyArray<readonly [PaddleOcrDiagnosticCode, RegExp]> = [
  ['ai_studio_rate_limited', /(?:rate[ -]?limit|too many requests|quota exceeded|\b429\b)/iu],
  [
    'ai_studio_auth',
    /(?:\b401\b|\b403\b|authenticationerror|unauthori[sz]ed|authentication|access token|api key|invalid token|credential)/iu,
  ],
  [
    'ai_studio_timeout',
    /(?:executiontimeouterror|timed? ?out|timeout|read timeout|deadline exceeded)/iu,
  ],
  ['ai_studio_invalid_request', /(?:\b400\b|bad request|invalid request|invalid argument)/iu],
  [
    'ai_studio_response_parse',
    /(?:responseformaterror|resultparseerror|parse(?:r|ing)?|jsondecode|decode|deseriali[sz]|invalid json|malformed response)/iu,
  ],
  [
    'ai_studio_job_failed',
    /(?:jobfailederror|job (?:status )?failed|task (?:execution )?failed|failed to (?:submit|poll) job)/iu,
  ],
  [
    'ai_studio_unavailable',
    /(?:resourceunavailableerror|unavailable|connection (?:refused|reset)|network error|service down|\b5\d\d\b)/iu,
  ],
  [
    'ai_studio_inference',
    /(?:apierror|inference (?:error|failed)|model (?:error|failed)|predict(?:ion)? failed)/iu,
  ],
];

export function isPaddleOcrDiagnosticCode(value: unknown): value is PaddleOcrDiagnosticCode {
  return (
    typeof value === 'string' &&
    PADDLE_OCR_DIAGNOSTIC_CODES.includes(value as PaddleOcrDiagnosticCode)
  );
}

export function classifyPaddleOcrDiagnostic(stderr: string): PaddleOcrDiagnosticCode | undefined {
  if (typeof stderr !== 'string' || stderr.trim() === '') {
    return undefined;
  }

  const matchableText = stderr.replace(/https?:\/\/\S+/giu, ' ');
  for (const [code, pattern] of diagnosticPatterns) {
    if (pattern.test(matchableText)) {
      return code;
    }
  }

  return undefined;
}


export interface StderrCaptureSource {
  hasStderrCapture?(): boolean;
  getStderrCursor(): number;
  readStderrSince(cursor: number): string;
}

export interface PaddleOcrDiagnosticCapture {
  /** Attaches the classified stderr diagnostic to a failed call's error. */
  annotate(error: unknown): Promise<void>;
  /** Turns an error tool result into a thrown, classified error. */
  assertResult(isError: boolean): Promise<void>;
  release(): void;
}

const DIAGNOSTIC_FLUSH_WINDOW_MS = 75;
const captureLocks = new WeakMap<object, Promise<void>>();

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('MCP diagnostic wait aborted');
}

function waitAbortable(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function attachDiagnosticCode(error: unknown, code: PaddleOcrDiagnosticCode | undefined): void {
  if (!code || !error || typeof error !== 'object') return;
  try {
    Object.defineProperty(error, 'diagnosticCode', { value: code, enumerable: false, configurable: true });
  } catch {
    // Frozen errors keep their original shape.
  }
}

/**
 * Serializes PaddleOCR calls per connection so stderr printed during one call
 * is attributable to it, and classifies that stderr into a diagnostic code.
 * Returns undefined for non-PaddleOCR calls or connections without capture.
 */
export async function startPaddleOcrDiagnosticCapture(input: {
  connection: StderrCaptureSource;
  serverName: string;
  toolName: string;
  signal?: AbortSignal;
}): Promise<PaddleOcrDiagnosticCapture | undefined> {
  const { connection, signal } = input;
  if (
    !isPaddleOcrMcpServerName(input.serverName) ||
    input.toolName.toLowerCase() !== 'paddleocr_vl' ||
    connection.hasStderrCapture?.() !== true
  ) {
    return undefined;
  }

  const previous = captureLocks.get(connection) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  captureLocks.set(connection, previous.then(() => current));
  try {
    await waitAbortable(previous, signal);
  } catch (error) {
    releaseCurrent();
    throw error;
  }
  const cursor = connection.getStderrCursor();

  const readDiagnostic = async (): Promise<PaddleOcrDiagnosticCode | undefined> => {
    const immediate = classifyPaddleOcrDiagnostic(connection.readStderrSince(cursor));
    if (immediate) return immediate;
    await waitAbortable(
      new Promise<void>((resolve) => setTimeout(resolve, DIAGNOSTIC_FLUSH_WINDOW_MS)),
      signal,
    );
    return classifyPaddleOcrDiagnostic(connection.readStderrSince(cursor));
  };

  return {
    async annotate(error) {
      attachDiagnosticCode(error, await readDiagnostic());
    },
    async assertResult(isError) {
      if (!isError) return;
      const code = await readDiagnostic();
      if (!code) return;
      const error = new Error('PaddleOCR MCP tool returned an error');
      attachDiagnosticCode(error, code);
      throw error;
    },
    release: releaseCurrent,
  };
}
