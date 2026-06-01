export type SteelValueState = 'unknown' | 'confirmed' | 'true_zero' | 'estimate';
export type SteelReviewState = 'draft' | 'needs_review' | 'reviewed' | 'rejected';

export type SteelSqlParameter = string | number | boolean | Date | null;

export type SteelJsonValue =
  | string
  | number
  | boolean
  | null
  | SteelJsonValue[]
  | { [key: string]: SteelJsonValue | undefined };

export interface SteelRepositoryClient {
  query<Row extends object>(
    sql: string,
    values?: readonly SteelSqlParameter[],
  ): Promise<{ rows: Row[] }>;
}

export interface SteelSourceRef {
  channel: string;
  factType: string;
  sourceFile?: string;
  sourceVersionId?: string;
  locator?: string;
  confidence?: string;
  extractedLabel?: string;
  canonicalKey?: string;
}

export interface SteelSourceBackedRecord {
  sourceRefs: SteelSourceRef[];
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(
  value: { [key: string]: unknown },
  key: 'channel' | 'factType',
): string {
  const field = value[key];

  if (typeof field !== 'string' || field.trim() === '') {
    throw new Error(`Steel source ref requires ${key}`);
  }

  return field;
}

function readOptionalString(value: { [key: string]: unknown }, key: keyof SteelSourceRef) {
  const field = value[key];

  if (field === undefined || field === null) {
    return undefined;
  }

  if (typeof field !== 'string') {
    throw new Error(`Steel source ref field ${key} must be a string`);
  }

  return field;
}

export function parseSteelSourceRefs(value: unknown): SteelSourceRef[] {
  if (!Array.isArray(value)) {
    throw new Error('Steel source_refs must be an array');
  }

  return value.map((entry) => {
    if (!isObject(entry)) {
      throw new Error('Steel source ref must be an object');
    }

    return {
      channel: readRequiredString(entry, 'channel'),
      factType: readRequiredString(entry, 'factType'),
      sourceFile: readOptionalString(entry, 'sourceFile'),
      sourceVersionId: readOptionalString(entry, 'sourceVersionId'),
      locator: readOptionalString(entry, 'locator'),
      confidence: readOptionalString(entry, 'confidence'),
      extractedLabel: readOptionalString(entry, 'extractedLabel'),
      canonicalKey: readOptionalString(entry, 'canonicalKey'),
    };
  });
}

export function serializeSteelSourceRefsForInsert(sourceRefs: unknown): string {
  return JSON.stringify(parseSteelSourceRefs(sourceRefs));
}

export function parseNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric database value, received ${String(value)}`);
  }

  return parsed;
}

export function parseRequiredNumber(value: number | string): number {
  const parsed = parseNullableNumber(value);
  if (parsed === null) {
    throw new Error('Expected required numeric database value');
  }

  return parsed;
}

export function parseNullableString(value: string | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : value;
}

export function parseJsonObject(value: SteelJsonValue | null | undefined): SteelJsonValue {
  return value === undefined ? null : value;
}

export function parseReviewState(value: string): SteelReviewState {
  if (
    value === 'draft' ||
    value === 'needs_review' ||
    value === 'reviewed' ||
    value === 'rejected'
  ) {
    return value;
  }

  throw new Error(`Unexpected Steel review_state: ${value}`);
}

export function parseValueState(value: string): SteelValueState {
  if (
    value === 'unknown' ||
    value === 'confirmed' ||
    value === 'true_zero' ||
    value === 'estimate'
  ) {
    return value;
  }

  throw new Error(`Unexpected Steel value_state: ${value}`);
}

export function getLimit(limit: number | undefined, defaultLimit = 20, maxLimit = 100): number {
  if (limit === undefined) {
    return defaultLimit;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`Steel repository limit must be an integer from 1 to ${maxLimit}`);
  }

  return limit;
}
