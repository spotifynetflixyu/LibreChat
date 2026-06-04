import { getLimit, parseJsonObject, parseReviewState, parseSteelSourceRefs } from './types';

import type {
  SteelJsonValue,
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
} from './types';

interface SteelCatalogFamilyRow {
  key: string;
  display_name_zh: string;
  aliases: SteelJsonValue | null;
  metadata: SteelJsonValue | null;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

export interface SteelCatalogFamily extends SteelSourceBackedRecord {
  key: string;
  displayNameZh: string;
  aliases: string[];
  metadata: SteelJsonValue;
  reviewState: SteelReviewState;
  active: boolean;
  sourceRefs: SteelSourceRef[];
}

export interface LookupSteelCatalogFamiliesInput {
  searchText?: string;
  keys?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function readAliases(value: SteelJsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function addKeysFilter(
  values: SteelSqlParameter[],
  keys: readonly string[] | undefined,
): string | undefined {
  const uniqueKeys = uniqueNonEmpty(keys);
  if (uniqueKeys.length === 0) {
    return undefined;
  }

  const placeholders = uniqueKeys.map((key) => {
    values.push(key);
    return `$${values.length}`;
  });

  return `key IN (${placeholders.join(', ')})`;
}

function addSearchTextFilter(
  values: SteelSqlParameter[],
  searchText: string | undefined,
): string | undefined {
  const trimmedSearchText = searchText?.trim();
  if (!trimmedSearchText) {
    return undefined;
  }

  values.push(`%${trimmedSearchText}%`);
  const placeholder = `$${values.length}`;

  return `(key ILIKE ${placeholder} OR display_name_zh ILIKE ${placeholder} OR aliases::text ILIKE ${placeholder})`;
}

function toCatalogFamily(row: SteelCatalogFamilyRow): SteelCatalogFamily {
  return {
    key: row.key,
    displayNameZh: row.display_name_zh,
    aliases: readAliases(row.aliases),
    metadata: parseJsonObject(row.metadata),
    reviewState: parseReviewState(row.review_state),
    active: row.active,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function lookupSteelCatalogFamilies(
  client: SteelRepositoryClient,
  input: LookupSteelCatalogFamiliesInput,
): Promise<SteelCatalogFamily[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  const filters = [
    addKeysFilter(values, input.keys),
    addSearchTextFilter(values, input.searchText),
  ].filter((filter): filter is string => filter !== undefined);

  if (filters.length > 0) {
    where.push(`(${filters.join(' OR ')})`);
  }

  values.push(getLimit(input.limit));

  const result = await client.query<SteelCatalogFamilyRow>(
    `
SELECT
  key,
  display_name_zh,
  aliases,
  metadata,
  review_state,
  active,
  source_refs
FROM steel.catalog_families
WHERE ${where.join('\n  AND ')}
ORDER BY display_name_zh ASC, key ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toCatalogFamily);
}
