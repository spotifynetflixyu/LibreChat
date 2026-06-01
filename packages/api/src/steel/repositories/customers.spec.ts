import { searchSteelCustomers } from './customers';

import type { SteelRepositoryClient } from './types';

describe('Steel customer repository', () => {
  it('searches active customers by name or alias and includes tier/source refs', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '1',
          erp_customer_code: 'C001',
          display_name: '龍頂鋼鐵',
          legal_name: '龍頂鋼鐵股份有限公司',
          tax_id: '12345678',
          customer_tier_id: '2',
          customer_tier_code: 'A',
          customer_tier_name: 'A級',
          matched_alias: '龍頂',
          status: 'active',
          source_refs: [
            {
              channel: 'admin_erp_xlsx',
              factType: 'customer',
              locator: 'sheet=客戶;row=2',
            },
          ],
        },
      ],
    });

    const result = await searchSteelCustomers({ query } as SteelRepositoryClient, {
      searchText: '龍頂',
      limit: 3,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN steel.customer_aliases'),
      ['龍頂', '%龍頂%', 3],
    );
    expect(result[0]).toMatchObject({
      id: 1,
      erpCustomerCode: 'C001',
      displayName: '龍頂鋼鐵',
      customerTier: {
        id: 2,
        code: 'A',
        name: 'A級',
      },
      matchedAlias: '龍頂',
      status: 'active',
    });
  });
});
