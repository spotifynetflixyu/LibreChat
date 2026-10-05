import type { SteelCatalogCustomerEvidence } from 'librechat-data-provider';
import type { SteelRepositoryClient } from './repositories/types';
import { createSteelReviewCatalogService, steelCatalogCustomerRevision, SteelReviewCatalogError } from './catalog';

const scope = {
  userId: 'user-1',
  conversationId: 'conversation-1',
};

const row = {
  rowId: 'material-1',
  values: { 類別: { baseline: '鐵板', effective: '鐵板' } },
  source: null,
  system: { kind: 'material' as const, parentRowId: null, cascadeDeletedBy: null },
  origin: 'ai' as const,
  deleted: false,
};

const snapshot = { snapshotId: 'customer-run-1', customerIdentity: 'explicit-default:B',
  customerMarkdown: '## customer_data\n\n| 客戶 | 計價基準 |\n| --- | --- |\n| 預設 | B |' };

const review = {
  ...scope,
  kind: 'system_order' as const,
  messageId: 'message-1',
  title: 'system_order｜報價單 A',
  tableId: 'system_order:1',
  outputId: 'output-1',
  latestOutputId: 'output-1',
  revision: 'revision-1',
  state: 'current' as const,
  headers: ['類別'],
  rows: [row],
  customerSnapshot: snapshot,
};

const customer: SteelCatalogCustomerEvidence = {
  snapshotId: 'customer-run-1',
  revision: steelCatalogCustomerRevision(snapshot.customerIdentity, snapshot.customerMarkdown),
  tier: 'B',
};

const catalogRow = {
  id: 'catalog-1',
  erp_item_code: 'SC-1',
  product_name: 'Plate',
  spec_key: '400mm',
  category: '鐵板',
  subcategory: null,
  formula_code: null,
  material: 'SS400',
  unit: 'kg',
  cost_basis: 'kg',
  value_state: 'confirmed',
  unit_price_a: '1', unit_price_b: '2', unit_price_c: null,
  unit_price_d: null, unit_price_e: null, unit_price_f: null,
  unit_weight_value: null, unit_weight_basis: null, density: '7.85',
  thickness_min_mm: '2', thickness_max_mm: '6', width_mm: '400', height_mm: null,
  length_mm: null, outer_diameter_mm: null, web_mm: null, flange_mm: null, lip_mm: null,
  sheet_width_mm: null, sheet_length_mm: null, unit_price: '2',
};

describe('Steel catalog authority', () => {
  it('binds search and resolution to the current review and customer evidence', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [catalogRow] });
    const client: SteelRepositoryClient = { query };
    const readSteelReview = jest.fn().mockResolvedValue(review);
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview },
      client: { getClient: () => client },
      pageSize: 10,
    });

    const page = await service.search({
      scope,
      query: {
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        field: 'description',
        keyword: 'plate',
      },
    });
    const [candidate] = page.options;
    expect(candidate).toMatchObject({ id: 'catalog-1', unitPrice: '2' });
    expect(page.customer).toEqual(customer);

    readSteelReview.mockResolvedValue({ ...review, revision: 'saved-other-row' });
    const resolved = await service.resolve({
      scope,
      messageId: review.messageId,
      title: review.title,
      outputId: review.outputId,
      revision: review.revision,
      rowId: row.rowId,
      selection: {
        id: candidate!.id,
        revision: candidate!.revision,
        evidence: customer,
      },
    });
    expect(resolved.evidence).toMatchObject({
      rowId: row.rowId,
      candidateId: candidate!.id,
      customerTier: 'B',
      unitPrice: '2',
    });
  });

  it.each(['snapshotId', 'revision', 'tier'] as const)('rejects forged customer %s evidence', async (field) => {
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
      client: { getClient: () => ({ query: jest.fn() }) },
    });

    await expect(service.resolve({
      scope,
      messageId: review.messageId,
      title: review.title,
      outputId: review.outputId,
      revision: review.revision,
      rowId: row.rowId,
      selection: {
        id: 'catalog-1', revision: 'a'.repeat(64), evidence: { ...customer, [field]: field === 'tier' ? 'A' : 'forged' },
      },
    })).rejects.toMatchObject<Partial<SteelReviewCatalogError>>({ code: 'CATALOG_CHANGED', statusCode: 409 });
  });
});
