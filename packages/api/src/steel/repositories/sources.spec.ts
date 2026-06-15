import { searchSteelSourceChunks } from './sources';

import type { SteelRepositoryClient } from './types';

describe('Steel source repository', () => {
  it('searches active source chunks with parameterized text matching', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '11',
          project_source_id: 'handbook',
          source_version_id: 'v1',
          chunk_key: 'page-1',
          chunk_text: 'H型鋼標準長度',
          token_count: 20,
          status: 'active',
          metadata: { page: 1 },
        },
      ],
    });

    const result = await searchSteelSourceChunks({ query } as SteelRepositoryClient, {
      projectSourceId: 'handbook',
      searchText: '標準長度',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('chunk_text ILIKE $3'), [
      'active',
      'handbook',
      '%標準長度%',
      100,
    ]);
    expect(result[0]).toMatchObject({
      id: 11,
      chunkKey: 'page-1',
      metadata: { page: 1 },
    });
  });
});
