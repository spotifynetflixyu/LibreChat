import type { SteelCatalogCustomerEvidence } from 'librechat-data-provider';
import type { SteelRepositoryClient } from './repositories/types';
import {
  createSteelReviewCatalogService,
  steelCatalogCustomerRevision,
  SteelReviewCatalogError,
} from './catalog';

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

const snapshot = {
  snapshotId: 'customer-run-1',
  customerIdentity: 'explicit-default:B',
  customerMarkdown: '## customer_data\n\n| 客戶 | 計價基準 |\n| --- | --- |\n| 預設 | B |',
};

const review = {
  ...scope,
  kind: 'system_order' as const,
  messageId: 'message-1',
  title: 'system_order｜報價單 A',
  tableId: 'system_order:1',
  outputId: 'system_order:run-1',
  latestOutputId: 'system_order:run-1',
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
  unit_price_a: '1',
  unit_price_b: '2',
  unit_price_c: null,
  unit_price_d: null,
  unit_price_e: null,
  unit_price_f: null,
  unit_weight_value: null,
  unit_weight_basis: null,
  density: '7.85',
  thickness_min_mm: '2',
  thickness_max_mm: '6',
  width_mm: '400',
  height_mm: null,
  length_mm: null,
  outer_diameter_mm: null,
  web_mm: null,
  flange_mm: null,
  lip_mm: null,
  sheet_width_mm: null,
  sheet_length_mm: null,
  unit_price: '2',
};

const processingCatalogRow = {
  ...catalogRow,
  id: 'processing-1',
  erp_item_code: 'PR-1',
  product_name: 'Weld',
  spec_key: 'PR-1 weld',
  category: '加工/焊接',
  subcategory: '通用',
  unit_price: null,
};

describe('Steel catalog authority', () => {
  it('returns at most 50 candidates by default and retains the next-page cursor', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: Array.from({ length: 51 }, (_, index) => ({
        ...catalogRow,
        id: String(index + 1),
        erp_item_code: `SC-${String(index + 1).padStart(3, '0')}`,
      })),
    });
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
      client: { getClient: () => ({ query }) },
    });
    const result = await service.search({
      scope,
      query: {
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        field: 'model',
        keyword: 'SC',
      },
    });
    expect(result.options).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    expect(query.mock.calls[0][1]).toContain(51);
  });

  it('returns all prices after authorizing the review and verifies evidence during resolution', async () => {
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
        customerSnapshotId: customer.snapshotId,
        customerRevision: customer.revision,
        customerTier: customer.tier,
      },
    });
    expect(readSteelReview).toHaveBeenCalledTimes(1);
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
    expect(readSteelReview).toHaveBeenCalledWith(
      expect.objectContaining({ customerRunId: 'run-1' }),
    );
  });

  it('supports a legacy tier preview locally while returning the complete price set without extra reads', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [catalogRow] });
    const readSteelReview = jest.fn().mockResolvedValue(review);
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview },
      client: { getClient: () => ({ query }) },
    });

    const result = await service.search({
      scope,
      query: {
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        field: 'model',
        keyword: 'SC',
        customerSnapshotId: customer.snapshotId,
        customerRevision: customer.revision,
        customerTier: 'A',
      },
    });

    expect(readSteelReview).toHaveBeenCalledTimes(1);
    expect(result.customer).toEqual({ ...customer, tier: 'A' });
    expect(result.options[0]?.unitPrice).toBe('1');
    expect(result.options[0]?.prices).toEqual({
      A: '1',
      B: '2',
      C: null,
      D: null,
      E: null,
      F: null,
    });
    expect(query.mock.calls[0]?.[1]?.[0]).toBe('B');
  });

  it.each(['model', 'description'] as const)(
    'searches %s after review authorization when customer evidence is absent',
    async (field) => {
      const query = jest.fn().mockResolvedValue({ rows: [catalogRow] });
      const readSteelReview = jest
        .fn()
        .mockResolvedValue({ ...review, customerSnapshot: undefined });
      const service = createSteelReviewCatalogService({
        reader: { readSteelReview },
        client: { getClient: () => ({ query }) },
      });
      const result = await service.search({
        scope,
        query: {
          messageId: review.messageId,
          title: review.title,
          outputId: review.outputId,
          revision: review.revision,
          rowId: row.rowId,
          field,
          keyword: 'SC',
        },
      });
      expect(result.options).toEqual([
        expect.objectContaining({
          id: catalogRow.id,
          unitPrice: '2',
          prices: { A: '1', B: '2', C: null, D: null, E: null, F: null },
        }),
      ]);
      expect(result).not.toHaveProperty('customer');
      expect(readSteelReview).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]?.[0]).toContain('FROM steel.prices AS p');
      expect(query.mock.calls[0]?.[1]?.[0]).toBe('B');
    },
  );

  it.each([
    { label: 'another user', requestScope: { ...scope, userId: 'other-user' }, record: null },
    { label: 'another tenant', requestScope: { ...scope, tenantId: 'other-tenant' }, record: null },
    {
      label: 'a stale revision',
      requestScope: scope,
      record: { ...review, revision: 'old-revision' },
    },
    {
      label: 'a historical output',
      requestScope: scope,
      record: { ...review, state: 'historical' },
    },
  ])('rejects $label before reading catalog prices', async ({ requestScope, record }) => {
    const query = jest.fn();
    const readSteelReview = jest.fn().mockResolvedValue(record);
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview },
      client: { getClient: () => ({ query }) },
    });
    await expect(
      service.search({
        scope: requestScope,
        query: {
          messageId: review.messageId,
          title: review.title,
          outputId: review.outputId,
          revision: review.revision,
          rowId: row.rowId,
          field: 'model',
          keyword: 'SC',
        },
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });
    expect(readSteelReview).toHaveBeenCalledWith(expect.objectContaining(requestScope));
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unowned reviews at resolution before querying prices', async () => {
    const query = jest.fn();
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(null) },
      client: { getClient: () => ({ query }) },
    });
    await expect(
      service.resolve({
        scope,
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        selection: { id: catalogRow.id, revision: 'a'.repeat(64), evidence: customer },
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['snapshotId', 'revision', 'tier'] as const)(
    'rejects forged customer %s evidence',
    async (field) => {
      const service = createSteelReviewCatalogService({
        reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
        client: { getClient: () => ({ query: jest.fn() }) },
      });

      await expect(
        service.resolve({
          scope,
          messageId: review.messageId,
          title: review.title,
          outputId: review.outputId,
          revision: review.revision,
          rowId: row.rowId,
          selection: {
            id: 'catalog-1',
            revision: 'a'.repeat(64),
            evidence: { ...customer, [field]: field === 'tier' ? 'A' : 'forged' },
          },
        }),
      ).rejects.toMatchObject<Partial<SteelReviewCatalogError>>({
        code: 'CATALOG_CHANGED',
        statusCode: 409,
      });
    },
  );

  it('authorizes processing search and resolve from the frozen review while using the requested kind', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [processingCatalogRow] });
    const client: SteelRepositoryClient = { query };
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
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
        kind: 'processing',
        parentRowId: row.rowId,
        materialCategory: '鐵板',
        field: 'model',
        keyword: 'PR-',
      },
    });

    expect(page.options[0]).toMatchObject({
      id: processingCatalogRow.id,
      category: '加工/焊接',
      unitPrice: null,
    });
    const candidate = page.options[0]!;
    const resolved = await service.resolve({
      scope,
      messageId: review.messageId,
      title: review.title,
      outputId: review.outputId,
      revision: review.revision,
      rowId: row.rowId,
      kind: 'processing',
      selection: { id: candidate.id, revision: candidate.revision, evidence: customer },
    });

    expect(resolved.candidate.category).toBe('加工/焊接');
    expect(query.mock.calls[0]?.[0]).toMatch(/p\.category LIKE '加工\/%'/u);
  });

  it.each(['A', 'C', undefined] as const)(
    'resolves selected tier %s from prices without requiring customer evidence',
    async (priceTier) => {
      const query = jest.fn().mockResolvedValue({ rows: [catalogRow] });
      const readSteelReview = jest
        .fn()
        .mockResolvedValue({ ...review, customerSnapshot: undefined });
      const service = createSteelReviewCatalogService({
        reader: { readSteelReview },
        client: { getClient: () => ({ query }) },
      });
      const page = await service.search({
        scope,
        query: {
          messageId: review.messageId,
          title: review.title,
          outputId: review.outputId,
          revision: review.revision,
          rowId: row.rowId,
          field: 'model',
          keyword: 'SC',
        },
      });
      const candidate = page.options[0]!;
      const prices = { A: '1', B: '2', C: null };
      const expectedPrice = prices[priceTier ?? 'B'];
      query.mockResolvedValue({ rows: [{ ...catalogRow, unit_price: expectedPrice }] });
      const resolved = await service.resolve({
        scope,
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        selection: {
          id: candidate.id,
          revision: candidate.revision,
          ...(priceTier ? { priceTier } : {}),
        },
      });
      expect(query.mock.calls[1]?.[1]).toEqual([priceTier ?? 'B', candidate.id]);
      expect(resolved.candidate.unitPrice).toBe(expectedPrice);
      expect(resolved.evidence).toBeUndefined();
      expect(readSteelReview).toHaveBeenCalledTimes(2);
    },
  );

  it('audits selected tier separately from immutable customer evidence', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [catalogRow] });
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
      client: { getClient: () => ({ query }) },
    });
    const page = await service.search({
      scope,
      query: {
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        field: 'model',
        keyword: 'SC',
      },
    });
    const candidate = page.options[0]!;
    query.mockResolvedValue({ rows: [{ ...catalogRow, unit_price: '1' }] });
    const resolved = await service.resolve({
      scope,
      messageId: review.messageId,
      title: review.title,
      outputId: review.outputId,
      revision: review.revision,
      rowId: row.rowId,
      selection: {
        id: candidate.id,
        revision: candidate.revision,
        evidence: customer,
        priceTier: 'A',
      },
    });
    expect(resolved.evidence).toMatchObject({ customerTier: 'B', priceTier: 'A', unitPrice: '1' });
    query.mockResolvedValue({ rows: [{ ...catalogRow, unit_price_f: '99', unit_price: '1' }] });
    await expect(
      service.resolve({
        scope,
        messageId: review.messageId,
        title: review.title,
        outputId: review.outputId,
        revision: review.revision,
        rowId: row.rowId,
        selection: { id: candidate.id, revision: candidate.revision, priceTier: 'A' },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_CHANGED' });
  });

  it('returns a safe operational failure when the catalog query fails', async () => {
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
      client: {
        getClient: () => ({
          query: jest.fn().mockRejectedValue(new Error('secret database detail')),
        }),
      },
    });

    await expect(
      service.search({
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
      }),
    ).rejects.toMatchObject<Partial<SteelReviewCatalogError>>({
      code: 'CATALOG_QUERY_FAILED',
      statusCode: 503,
      message: 'Catalog query failed',
    });
  });

  it('rejects a processing cursor reused with a different material scope', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [processingCatalogRow, { ...processingCatalogRow, id: 'processing-2' }],
    });
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(review) },
      client: { getClient: () => ({ query }) },
      pageSize: 1,
    });
    const baseQuery = {
      messageId: review.messageId,
      title: review.title,
      outputId: review.outputId,
      revision: review.revision,
      rowId: row.rowId,
      kind: 'processing' as const,
      parentRowId: row.rowId,
      materialCategory: '鐵板',
      field: 'model' as const,
      keyword: 'PR-',
    };
    const page = await service.search({ scope, query: baseQuery });
    expect(page.nextCursor).toBeTruthy();

    await expect(
      service.search({
        scope,
        query: { ...baseQuery, materialCategory: '圓管', cursor: page.nextCursor! },
      }),
    ).rejects.toMatchObject<Partial<SteelReviewCatalogError>>({
      code: 'INVALID_REVIEW_QUERY',
      statusCode: 400,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a cursor reused with different supplied customer evidence', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [catalogRow, { ...catalogRow, id: 'catalog-2', erp_item_code: 'SC-2' }],
    });
    const readSteelReview = jest.fn().mockResolvedValue(review);
    const service = createSteelReviewCatalogService({
      reader: { readSteelReview },
      client: { getClient: () => ({ query }) },
      pageSize: 1,
    });
    const baseQuery = {
      messageId: review.messageId,
      title: review.title,
      outputId: review.outputId,
      revision: review.revision,
      rowId: row.rowId,
      field: 'model' as const,
      keyword: 'SC',
      customerSnapshotId: customer.snapshotId,
      customerRevision: customer.revision,
      customerTier: customer.tier,
    };
    const page = await service.search({ scope, query: baseQuery });
    expect(page.nextCursor).toBeTruthy();

    await expect(
      service.search({
        scope,
        query: { ...baseQuery, customerTier: 'C', cursor: page.nextCursor! },
      }),
    ).rejects.toMatchObject<Partial<SteelReviewCatalogError>>({
      code: 'INVALID_REVIEW_QUERY',
      statusCode: 400,
    });
    expect(readSteelReview).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
