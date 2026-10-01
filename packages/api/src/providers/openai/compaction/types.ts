export type OpenAIOAuthProbePath =
  | '/models'
  | '/responses/input_tokens'
  | '/responses/compact'
  | '/responses';

export type OpenAIOAuthProbeMethod = 'GET' | 'POST';

export type OpenAIOAuthCompactionProbeStage =
  | 'eligibility'
  | 'catalog'
  | 'count'
  | 'compact'
  | 'generation'
  | 'cancellation';

export type OpenAIOAuthCompactionProbeCode =
  | 'provider_ineligible'
  | 'model_not_listed'
  | 'http_400'
  | 'http_401'
  | 'http_403'
  | 'http_404'
  | 'http_429'
  | 'malformed_json'
  | 'missing_opaque'
  | 'invalid_count'
  | 'incomplete_stream'
  | 'aborted'
  | 'response_too_large'
  | 'unexpected_status'
  | 'protocol_passed';

export type OpenAIOAuthCompactionProbeOperationalCode =
  | 'provider_unavailable'
  | 'response_too_large'
  | 'invalid_options';

export type OpenAIOAuthCompactionProbeCheckErrorCode =
  | OpenAIOAuthCompactionProbeCode
  | OpenAIOAuthCompactionProbeOperationalCode
  | null;

export interface OpenAIOAuthProbeClient {
  readonly provider: 'openai_oauth_responses';
  readonly authKind: 'oauth';
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
}

export interface OpenAIOAuthCompactionProbeOptions {
  readonly client: OpenAIOAuthProbeClient;
  readonly model: string;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface OpenAIOAuthCompactionProbeCheck {
  readonly path: OpenAIOAuthProbePath;
  readonly method: OpenAIOAuthProbeMethod;
  readonly status: number | null;
  readonly errorCode: OpenAIOAuthCompactionProbeCheckErrorCode;
  readonly ok: boolean;
}

export interface OpenAIOAuthCompactionProbeResult {
  readonly model: string;
  readonly modelListed: boolean;
  /** Capability evidence only; this probe never enables runtime compaction. */
  readonly protocolCompatible: boolean;
  readonly code: OpenAIOAuthCompactionProbeCode;
  readonly stage: OpenAIOAuthCompactionProbeStage;
  readonly checks: readonly OpenAIOAuthCompactionProbeCheck[];
  readonly countAccepted: boolean;
  readonly compactAccepted: boolean;
  readonly replayCompleted: boolean;
  readonly cancellationObserved: boolean;
}
