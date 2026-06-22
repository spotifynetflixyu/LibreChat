import {
  getLimit,
  parseJsonObject,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
} from './types';

import type {
  SteelJsonValue,
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
} from './types';

interface SteelInstructionPacketRow {
  id: string | number;
  slug: string;
  version: string | number;
  title: string;
  locale: string;
  packet_groups: unknown;
  selectors: SteelJsonValue | null;
  instruction: string;
  blocking_rules: unknown;
  required_lookups: unknown;
  user_visible_notes: unknown;
  confirmation_questions: unknown;
  priority: string | number;
  confidence: string;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

export interface SteelInstructionPacket extends SteelSourceBackedRecord {
  id: number;
  slug: string;
  version: number;
  title: string;
  locale: string;
  packetGroups: string[];
  selectors: SteelJsonValue;
  instruction: string;
  blockingRules: string[];
  requiredLookups: string[];
  userVisibleNotes: string[];
  confirmationQuestions: string[];
  priority: number;
  confidence: string;
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

export interface SearchSteelInstructionPacketsInput {
  keywords?: readonly string[];
  packetGroups?: readonly string[];
  taskTypes?: readonly string[];
  catalogFamilies?: readonly string[];
  processingTypes?: readonly string[];
  formulaCodes?: readonly string[];
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.trim() !== ''))];
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Steel instruction packet ${fieldName} must be an array`);
  }

  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`Steel instruction packet ${fieldName} entries must be strings`);
    }

    return entry;
  });
}

function addPacketGroupFilter(
  where: string[],
  values: SteelSqlParameter[],
  packetGroups: readonly string[] | undefined,
) {
  const uniqueGroups = uniqueNonEmpty(packetGroups);

  if (uniqueGroups.length === 0) {
    return;
  }

  const placeholders = uniqueGroups.map((group) => {
    values.push(group);
    return `$${values.length}`;
  });

  where.push(`packet_groups && ARRAY[${placeholders.join(', ')}]::text[]`);
}

function addKeywordContainsFilter(
  where: string[],
  values: SteelSqlParameter[],
  keywords: readonly string[] | undefined,
) {
  const uniqueKeywords = uniqueNonEmpty(keywords);
  if (uniqueKeywords.length === 0) {
    return;
  }

  const clauses = uniqueKeywords.map((keyword) => {
    values.push(`%${keyword}%`);
    const placeholder = `$${values.length}`;
    return `(
      slug ILIKE ${placeholder}
      OR title ILIKE ${placeholder}
      OR locale ILIKE ${placeholder}
      OR packet_groups::text ILIKE ${placeholder}
      OR selectors::text ILIKE ${placeholder}
      OR instruction ILIKE ${placeholder}
      OR blocking_rules::text ILIKE ${placeholder}
      OR required_lookups::text ILIKE ${placeholder}
      OR user_visible_notes::text ILIKE ${placeholder}
      OR confirmation_questions::text ILIKE ${placeholder}
    )`;
  });

  where.push(`(${clauses.join('\n  OR ')})`);
}

function toInstructionPacket(row: SteelInstructionPacketRow): SteelInstructionPacket {
  return {
    id: parseRequiredNumber(row.id),
    slug: row.slug,
    version: parseRequiredNumber(row.version),
    title: row.title,
    locale: row.locale,
    packetGroups: parseStringArray(row.packet_groups, 'packet_groups'),
    selectors: parseJsonObject(row.selectors),
    instruction: row.instruction,
    blockingRules: parseStringArray(row.blocking_rules, 'blocking_rules'),
    requiredLookups: parseStringArray(row.required_lookups, 'required_lookups'),
    userVisibleNotes: parseStringArray(row.user_visible_notes, 'user_visible_notes'),
    confirmationQuestions: parseStringArray(row.confirmation_questions, 'confirmation_questions'),
    priority: parseRequiredNumber(row.priority),
    confidence: row.confidence,
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelInstructionPackets(
  client: SteelRepositoryClient,
  input: SearchSteelInstructionPacketsInput,
): Promise<SteelInstructionPacket[]> {
  const keywords = uniqueNonEmpty(input.keywords);
  const useKeywordSearch = keywords.length > 0;
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];

  if (input.reviewState !== undefined || !useKeywordSearch) {
    values.push(input.reviewState ?? 'reviewed');
    where.push(`review_state = $${values.length}`);
  }

  if (input.includeInactive === false || (!useKeywordSearch && !input.includeInactive)) {
    where.push('active = true');
  }

  addKeywordContainsFilter(where, values, keywords);
  addPacketGroupFilter(where, values, input.packetGroups);
  values.push(getLimit(input.limit));
  const whereClause = where.length > 0 ? `WHERE ${where.join('\n  AND ')}` : '';

  const result = await client.query<SteelInstructionPacketRow>(
    `
SELECT
  id,
  slug,
  version,
  title,
  locale,
  packet_groups,
  selectors,
  instruction,
  blocking_rules,
  required_lookups,
  user_visible_notes,
  confirmation_questions,
  priority,
  confidence,
  active,
  review_state,
  source_refs
FROM steel.instruction_packets
${whereClause}
ORDER BY priority ASC, id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toInstructionPacket);
}

export async function listReviewedSteelInstructionPackets(
  client: SteelRepositoryClient,
): Promise<SteelInstructionPacket[]> {
  const result = await client.query<SteelInstructionPacketRow>(
    `
SELECT
  id,
  slug,
  version,
  title,
  locale,
  packet_groups,
  selectors,
  instruction,
  blocking_rules,
  required_lookups,
  user_visible_notes,
  confirmation_questions,
  priority,
  confidence,
  active,
  review_state,
  source_refs
FROM steel.instruction_packets
WHERE review_state = $1
  AND active = true
ORDER BY priority ASC, id ASC
`,
    ['reviewed'],
  );

  return result.rows.map(toInstructionPacket);
}
