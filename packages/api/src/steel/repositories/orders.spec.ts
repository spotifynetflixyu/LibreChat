import { findSteelOrderItems } from './orders';

import type { SteelRepositoryClient } from './types';

describe('Steel orders repository', () => {
  it('returns order items for ERP order lookup with nullable historical prices', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          order_id: '8',
          erp_order_code: 'SO-1',
          customer_id: '9',
          order_date: '2026-05-01',
          order_status: 'closed',
          item_id: '10',
          erp_item_code: 'A001',
          product_name: 'H型鋼',
          spec_key: 'H100x100',
          quantity: '3.0000',
          unit: '支',
          unit_price: null,
          line_total: null,
        },
      ],
    });

    const result = await findSteelOrderItems({ query } as SteelRepositoryClient, {
      erpOrderCode: 'SO-1',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('o.erp_order_code = $1'), [
      'SO-1',
      50,
    ]);
    expect(result[0]).toMatchObject({
      orderId: 8,
      erpOrderCode: 'SO-1',
      itemId: 10,
      unitPrice: null,
      lineTotal: null,
    });
  });
});
