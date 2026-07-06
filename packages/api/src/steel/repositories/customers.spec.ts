import { searchSteelCustomers } from './customers';

import type { SteelRepositoryClient } from './types';

describe('Steel customer repository', () => {
  it('searches customers by keyword and includes uppercase customer tier/source refs', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '1',
          erp_customer_code: 'C001',
          display_name: '龍頂鋼鐵',
          legal_name: '龍頂鋼鐵股份有限公司',
          tax_id: '12345678',
          customer_tier: 'A',
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
      keywords: ['龍頂'],
      limit: 3,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM steel.customers c'), [
      '龍頂',
      '%龍頂%',
      3,
    ]);
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('customer_aliases'));
    expect(query.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('customer_tiers'));
    expect(result[0]).toMatchObject({
      id: 1,
      erpCustomerCode: 'C001',
      displayName: '龍頂鋼鐵',
      customerTier: 'A',
      status: 'active',
    });
  });
});
