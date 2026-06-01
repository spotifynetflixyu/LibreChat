import { getLimit, parseJsonObject, parseNullableNumber, parseRequiredNumber } from './types';

import type { SteelJsonValue, SteelRepositoryClient, SteelSqlParameter } from './types';

interface SteelSourceChunkRow {
  id: string | number;
  project_source_id: string;
  source_version_id: string;
  chunk_key: string;
  chunk_text: string;
  token_count: string | number | null;
  status: string;
  metadata: SteelJsonValue | null;
}

export interface SteelSourceChunk {
  id: number;
  projectSourceId: string;
  sourceVersionId: string;
  chunkKey: string;
  chunkText: string;
  tokenCount: number | null;
  status: string;
  metadata: SteelJsonValue;
}

interface SearchSteelSourceChunksInput {
  projectSourceId?: string;
  searchText?: string;
  status?: 'active' | 'inactive' | 'deleted';
  limit?: number;
}

function toSourceChunk(row: SteelSourceChunkRow): SteelSourceChunk {
  return {
    id: parseRequiredNumber(row.id),
    projectSourceId: row.project_source_id,
    sourceVersionId: row.source_version_id,
    chunkKey: row.chunk_key,
    chunkText: row.chunk_text,
    tokenCount: parseNullableNumber(row.token_count),
    status: row.status,
    metadata: parseJsonObject(row.metadata),
  };
}

export async function searchSteelSourceChunks(
  client: SteelRepositoryClient,
  input: SearchSteelSourceChunksInput,
): Promise<SteelSourceChunk[]> {
  const where = ['status = $1'];
  const values: SteelSqlParameter[] = [input.status ?? 'active'];

  if (input.projectSourceId) {
    values.push(input.projectSourceId);
    where.push(`project_source_id = $${values.length}`);
  }

  if (input.searchText) {
    values.push(`%${input.searchText}%`);
    where.push(`chunk_text ILIKE $${values.length}`);
  }

  values.push(getLimit(input.limit));

  const result = await client.query<SteelSourceChunkRow>(
    `
SELECT
  id,
  project_source_id,
  source_version_id,
  chunk_key,
  chunk_text,
  token_count,
  status,
  metadata
FROM steel.source_chunks
WHERE ${where.join('\n  AND ')}
ORDER BY project_source_id ASC, source_version_id ASC, chunk_key ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toSourceChunk);
}
