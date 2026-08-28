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

export const classifyPaddleOcrDiagnosticCode: typeof classifyPaddleOcrDiagnostic =
  classifyPaddleOcrDiagnostic;
