export type SteelSourceSchemaUsage =
  | 'admin_import'
  | 'calculator_context'
  | 'customer_lookup'
  | 'price_lookup';

export interface SteelSourceSchemaMappingEntry {
  sourceFile: string;
  sourceLabels: readonly string[];
  canonicalKey: string;
  target: string;
  allowedFor: readonly SteelSourceSchemaUsage[];
  valueType: 'date' | 'enum' | 'money' | 'number' | 'string';
  customerTierCode?: string;
  note?: string;
}

export interface ResolveSourceSchemaMappingInput {
  sourceFile: string;
  sourceLabel: string;
}

export interface BuildSourceSchemaMappingPromptContextOptions {
  sourceFiles?: readonly string[];
  allowedFor?: SteelSourceSchemaUsage;
}

const productPriceTierEntries = (['A', 'B', 'C', 'F'] as const).map((tier) => ({
  sourceFile: '產品價格.xlsx',
  sourceLabels: [`售價${tier}`],
  canonicalKey: `unit_price_by_tier.${tier}`,
  target: 'steel.prices.unit_price_*',
  allowedFor: ['admin_import', 'price_lookup'] as const,
  valueType: 'money' as const,
  customerTierCode: tier,
  note: '匯入只保留售價A-F；來源比率A-F 欄位 intentionally ignored，不入庫也不提供查價。',
}));

export const steelSourceSchemaMappings: readonly SteelSourceSchemaMappingEntry[] = [
  {
    sourceFile: '產品價格.xlsx',
    sourceLabels: ['型號', '品號', 'ERP 品項代碼'],
    canonicalKey: 'erp_item_code',
    target: 'steel.price_items.erp_item_code',
    allowedFor: ['admin_import', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '產品價格.xlsx',
    sourceLabels: ['品名規格', '品名', '產品名稱'],
    canonicalKey: 'product_name',
    target: 'steel.price_items.product_name',
    allowedFor: ['admin_import', 'price_lookup'],
    valueType: 'string',
  },
  ...productPriceTierEntries,
  {
    sourceFile: '產品價格.xlsx',
    sourceLabels: ['單位重', '產品價格單位重'],
    canonicalKey: 'product_price_unit_weight',
    target: 'steel.price_items.product_price_unit_weight',
    allowedFor: ['admin_import', 'calculator_context', 'price_lookup'],
    valueType: 'number',
    note: 'Reviewed product price unit weight is preferred quote weight evidence; when this column is 0, importer may use a validated product-name parenthetical weight such as 白鐵平鐵 50 *8.0( 19.7).',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['公司編號'],
    canonicalKey: 'company_code',
    target: 'steel.orders.metadata.company_code',
    allowedFor: ['admin_import'],
    valueType: 'string',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['項次'],
    canonicalKey: 'line_no',
    target: 'steel.order_items.metadata.line_no',
    allowedFor: ['admin_import'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['倉庫編號'],
    canonicalKey: 'warehouse_code',
    target: 'steel.order_items.metadata.warehouse_code',
    allowedFor: ['admin_import'],
    valueType: 'string',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['型號'],
    canonicalKey: 'erp_item_code',
    target: 'steel.order_items.erp_item_code',
    allowedFor: ['admin_import', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['品名規格'],
    canonicalKey: 'product_name',
    target: 'steel.order_items.product_name',
    allowedFor: ['admin_import', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['單位'],
    canonicalKey: 'unit',
    target: 'steel.order_items.unit',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'enum',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['數量'],
    canonicalKey: 'quantity',
    target: 'steel.order_items.quantity',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['單重'],
    canonicalKey: 'unit_weight',
    target: 'steel.order_items.metadata.unit_weight',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['總數'],
    canonicalKey: 'line_total_quantity',
    target: 'steel.order_items.metadata.line_total_quantity',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['單價'],
    canonicalKey: 'unit_price',
    target: 'steel.order_items.unit_price',
    allowedFor: ['admin_import', 'price_lookup'],
    valueType: 'money',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['計價基準'],
    canonicalKey: 'pricing_basis',
    target: 'steel.order_items.metadata.pricing_basis',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'enum',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['公式編號'],
    canonicalKey: 'formula_code',
    target: 'steel.order_items.metadata.formula_code',
    allowedFor: ['admin_import', 'calculator_context', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['厚度'],
    canonicalKey: 'thickness_mm',
    target: 'steel.order_items.metadata.thickness_mm',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['寬度'],
    canonicalKey: 'width_mm',
    target: 'steel.order_items.metadata.width_mm',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['長度'],
    canonicalKey: 'length_mm',
    target: 'steel.order_items.metadata.length_mm',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['度'],
    canonicalKey: 'degree',
    target: 'steel.order_items.metadata.degree',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['交貨日期'],
    canonicalKey: 'delivery_date',
    target: 'steel.order_items.metadata.delivery_date',
    allowedFor: ['admin_import'],
    valueType: 'date',
  },
  {
    sourceFile: '系統訂單.xlsx',
    sourceLabels: ['備註'],
    canonicalKey: 'line_note',
    target: 'steel.order_items.metadata.line_note',
    allowedFor: ['admin_import'],
    valueType: 'string',
  },
  {
    sourceFile: '公式編號.xlsx',
    sourceLabels: ['公式編號'],
    canonicalKey: 'formula_code',
    target: 'steel.formula_versions.code',
    allowedFor: ['admin_import', 'calculator_context', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '公式編號.xlsx',
    sourceLabels: ['公式名稱'],
    canonicalKey: 'formula_name',
    target: 'steel.formula_versions.formula_body.name',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'string',
  },
  {
    sourceFile: '公式編號.xlsx',
    sourceLabels: ['公式計算式'],
    canonicalKey: 'formula_expression',
    target: 'steel.formula_versions.formula_body.expression',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'string',
  },
  {
    sourceFile: '公式編號.xlsx',
    sourceLabels: ['長度'],
    canonicalKey: 'formula_length',
    target: 'steel.formula_versions.formula_body.length',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'number',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['來源區塊'],
    canonicalKey: 'cutting_source_section',
    target: 'steel.cutting_prices.metadata.source_section',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'string',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['品項/尺寸', '尺寸'],
    canonicalKey: 'spec_key',
    target: 'steel.cutting_prices.spec_key',
    allowedFor: ['admin_import', 'calculator_context', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['加工', '切工'],
    canonicalKey: 'cut_type',
    target: 'steel.cutting_prices.cut_type',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'string',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['型號'],
    canonicalKey: 'processing_item_code',
    target: 'steel.cutting_prices.metadata.processing_item_code',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'string',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['A/C/F'],
    canonicalKey: 'cutting_unit_price_by_tier.A_C_F',
    target: 'steel.cutting_prices.unit_price',
    allowedFor: ['admin_import', 'calculator_context', 'price_lookup'],
    valueType: 'money',
    customerTierCode: 'A/C/F',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['B'],
    canonicalKey: 'cutting_unit_price_by_tier.B',
    target: 'steel.cutting_prices.unit_price',
    allowedFor: ['admin_import', 'calculator_context', 'price_lookup'],
    valueType: 'money',
    customerTierCode: 'B',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['備註'],
    canonicalKey: 'cutting_note',
    target: 'steel.cutting_prices.metadata.note',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'string',
  },
  {
    sourceFile: '切工價錢.xlsx',
    sourceLabels: ['信心'],
    canonicalKey: 'confidence',
    target: 'steel.cutting_prices.source_refs.confidence',
    allowedFor: ['admin_import', 'calculator_context'],
    valueType: 'enum',
  },
  {
    sourceFile: '客戶資料.xlsx',
    sourceLabels: ['客戶編', '客戶編號'],
    canonicalKey: 'erp_customer_code',
    target: 'steel.customers.erp_customer_code',
    allowedFor: ['admin_import', 'customer_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '客戶資料.xlsx',
    sourceLabels: ['客戶名稱'],
    canonicalKey: 'customer_display_name',
    target: 'steel.customers.display_name',
    allowedFor: ['admin_import', 'customer_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '客戶資料.xlsx',
    sourceLabels: ['負責人'],
    canonicalKey: 'customer_contact_name',
    target: 'steel.customers.metadata.contact_name',
    allowedFor: ['admin_import', 'customer_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '客戶資料.xlsx',
    sourceLabels: ['等級', '客戶等級', '客戶分級'],
    canonicalKey: 'customer_tier_code',
    target: 'steel.customer_tiers.code',
    allowedFor: ['admin_import', 'customer_lookup', 'price_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '客戶資料.xlsx',
    sourceLabels: ['電話1', '電話2', '行動電話'],
    canonicalKey: 'customer_phone',
    target: 'steel.customers.metadata.phone',
    allowedFor: ['admin_import', 'customer_lookup'],
    valueType: 'string',
  },
  {
    sourceFile: '客戶資料.xlsx',
    sourceLabels: ['地址'],
    canonicalKey: 'customer_address',
    target: 'steel.customers.metadata.address',
    allowedFor: ['admin_import', 'customer_lookup'],
    valueType: 'string',
  },
];

function normalizeSourceFile(sourceFile: string): string {
  const segments = sourceFile.trim().split(/[\\/]+/);
  return segments[segments.length - 1] ?? sourceFile.trim();
}

function normalizeSourceLabel(sourceLabel: string): string {
  return sourceLabel.trim();
}

function matchesSourceFile(entry: SteelSourceSchemaMappingEntry, sourceFile: string): boolean {
  return entry.sourceFile === normalizeSourceFile(sourceFile);
}

function matchesAllowedFor(
  entry: SteelSourceSchemaMappingEntry,
  allowedFor: SteelSourceSchemaUsage | undefined,
): boolean {
  return allowedFor === undefined || entry.allowedFor.includes(allowedFor);
}

export function resolveSourceSchemaMapping(
  input: ResolveSourceSchemaMappingInput,
): SteelSourceSchemaMappingEntry | undefined {
  const sourceLabel = normalizeSourceLabel(input.sourceLabel);

  return steelSourceSchemaMappings.find(
    (entry) =>
      matchesSourceFile(entry, input.sourceFile) && entry.sourceLabels.includes(sourceLabel),
  );
}

export function buildSourceSchemaMappingPromptContext(
  options: BuildSourceSchemaMappingPromptContextOptions = {},
): string {
  const sourceFiles = new Set((options.sourceFiles ?? []).map(normalizeSourceFile));
  const entries = steelSourceSchemaMappings.filter(
    (entry) =>
      (sourceFiles.size === 0 || sourceFiles.has(entry.sourceFile)) &&
      matchesAllowedFor(entry, options.allowedFor),
  );

  return entries
    .map((entry) => {
      const label = entry.sourceLabels[0] ?? entry.canonicalKey;
      return `${entry.sourceFile}: ${label} -> ${entry.canonicalKey} (${entry.target})`;
    })
    .join('\n');
}
