export type SteelValueState = 'unknown' | 'confirmed' | 'true_zero' | 'estimate';
export type SteelReviewState = 'draft' | 'needs_review' | 'reviewed' | 'rejected';

export type SteelSqlParameter =
  | string
  | number
  | boolean
  | Date
  | null
  | readonly string[]
  | readonly number[];

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

export function getLimit(limit: number | undefined, defaultLimit = 100, maxLimit = 100): number {
  if (limit === undefined) {
    return defaultLimit;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`Steel repository limit must be an integer from 1 to ${maxLimit}`);
  }

  return limit;
}
