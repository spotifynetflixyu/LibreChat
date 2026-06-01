import { getLimit, parseNullableNumber, parseRequiredNumber } from './types';

import type { SteelRepositoryClient } from './types';

interface SteelOrderItemRow {
  order_id: string | number;
  erp_order_code: string | null;
  customer_id: string | number | null;
  order_date: string | Date | null;
  order_status: string;
  item_id: string | number;
  erp_item_code: string | null;
  product_name: string;
  spec_key: string | null;
  quantity: string | number;
  unit: string;
  unit_price: string | number | null;
  line_total: string | number | null;
}

export interface SteelOrderItem {
  orderId: number;
  erpOrderCode?: string;
  customerId: number | null;
  orderDate: string | null;
  orderStatus: string;
  itemId: number;
  erpItemCode?: string;
  productName: string;
  specKey?: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  lineTotal: number | null;
}

interface FindSteelOrderItemsInput {
  erpOrderCode: string;
  limit?: number;
}

function toDateString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value;
}

function toOrderItem(row: SteelOrderItemRow): SteelOrderItem {
  return {
    orderId: parseRequiredNumber(row.order_id),
    erpOrderCode: row.erp_order_code ?? undefined,
    customerId: parseNullableNumber(row.customer_id),
    orderDate: toDateString(row.order_date),
    orderStatus: row.order_status,
    itemId: parseRequiredNumber(row.item_id),
    erpItemCode: row.erp_item_code ?? undefined,
    productName: row.product_name,
    specKey: row.spec_key ?? undefined,
    quantity: parseRequiredNumber(row.quantity),
    unit: row.unit,
    unitPrice: parseNullableNumber(row.unit_price),
    lineTotal: parseNullableNumber(row.line_total),
  };
}

export async function findSteelOrderItems(
  client: SteelRepositoryClient,
  input: FindSteelOrderItemsInput,
): Promise<SteelOrderItem[]> {
  const result = await client.query<SteelOrderItemRow>(
    `
SELECT
  o.id AS order_id,
  o.erp_order_code,
  o.customer_id,
  o.order_date,
  o.status AS order_status,
  oi.id AS item_id,
  oi.erp_item_code,
  oi.product_name,
  oi.spec_key,
  oi.quantity,
  oi.unit,
  oi.unit_price,
  oi.line_total
FROM steel.orders o
JOIN steel.order_items oi ON oi.order_id = o.id
WHERE o.erp_order_code = $1
ORDER BY oi.id ASC
LIMIT $2
`,
    [input.erpOrderCode, getLimit(input.limit, 50, 200)],
  );

  return result.rows.map(toOrderItem);
}
