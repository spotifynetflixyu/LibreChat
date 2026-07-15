import { createSteelToolRunState, executeSteelTool } from './execute';

import type { SteelRepositoryClient, SteelSqlParameter } from '../repositories/types';

interface QueryCall {
  sql: string;
  values?: readonly SteelSqlParameter[];
}

interface CapturingClient extends SteelRepositoryClient {
  calls: QueryCall[];
}

function createClient(rowBatches: object[][]): CapturingClient {
  const calls: QueryCall[] = [];

  return {
    calls,
    query: async <Row extends object>(
      sql: string,
      values?: readonly SteelSqlParameter[],
    ): Promise<{ rows: Row[] }> => {
      calls.push({ sql, values });
      return { rows: (rowBatches.shift() ?? []) as Row[] };
    },
  };
}

describe('executeSteelTool', () => {
  it('does not execute removed read_markdown calls', async () => {
    const result = await executeSteelTool({
      client: createClient([]),
      toolName: 'read_markdown',
      arguments: { scope: 'ocr' },
    });

    expect(result).toMatchObject({
      ok: false,
      toolName: 'read_markdown',
      errorCategory: 'unknown_tool',
    });
  });

  it('searches customers with the normalized repository contract', async () => {
    const client = createClient([
      [
        {
          id: '21',
          erp_customer_code: 'A001',
          display_name: '大成鋼',
          legal_name: '大成鋼鐵股份有限公司',
          tax_id: '12345678',
          customer_tier: 'A',
          status: 'active',
          source_refs: [],
        },
      ],
    ]);

    const result = await executeSteelTool({
      client,
      toolName: 'search_customers',
      arguments: { keywords: ['大成'], limit: 10 },
    });

    expect(result).toMatchObject({ ok: true, data: { customers: [expect.any(Object)] } });
    expect(client.calls).toHaveLength(1);
  });

  it('enforces per-run tool call limits', async () => {
    const client = createClient([[], []]);
    const runState = createSteelToolRunState(1);

    const firstResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_customers',
      arguments: { keywords: ['龍頂'] },
    });
    const secondResult = await executeSteelTool({
      client,
      runState,
      toolName: 'search_customers',
      arguments: { keywords: ['龍頂'] },
    });

    expect(firstResult.ok).toBe(true);
    expect(secondResult).toMatchObject({ ok: false, errorCategory: 'rate_limited' });
    expect(client.calls).toHaveLength(1);
  });
});
