import { buildSemanticWorkbookPatchOperations } from './semantic';

function expectOperation(
  operations: ReturnType<typeof buildSemanticWorkbookPatchOperations>,
  expected: {
    sheetId: string;
    rowId: string;
    columnKey: string;
    value: string | number | boolean | null;
  },
) {
  expect(operations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        op: 'set_cell',
        sheetId: expected.sheetId,
        rowId: expected.rowId,
        columnKey: expected.columnKey,
        value: expected.value,
      }),
    ]),
  );
}

describe('Steel semantic workbook projection', () => {
  it('projects one semantic quote line into all workbook sheets', () => {
    const operations = buildSemanticWorkbookPatchOperations({
      customer: {
        name: '未提供',
        tier: 'B級',
        note: '未提供客戶，暫用價格B',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: 'C100x50x20x2.3t 6M 一支',
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          searchKeywords: ['c_type', '錏輕型鋼', '100x2.3'],
          productPriceCandidateItems:
            '錏輕型鋼 100*2.3 B價26.8元/kg；白鐵輕型鋼 100*2.3 B價100元/kg',
          adoptedProductPriceItem: 'CCG10023 錏輕型鋼 100*2.3',
          isExactMatch: false,
          materialCategory: 'C型鋼',
          material: '錏',
          spec: 'C100x50x20x2.3t，6M',
          finishedLengthM: 6,
          quantity: 1,
          unit: '支',
          unitWeightKgPerM: 4,
          unitWeightKg: 24,
          totalWeightKg: 24,
          weightAlgorithm: '價格表單位重 4kg/m × 6M',
          customerName: '未提供',
          customerTier: 'B級',
          materialUnitPrice: 26.8,
          materialUnitPriceField: '售價B',
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 643.2,
          confidence: '中',
          lowConfidenceReason: '材質未指定，暫採錏輕型鋼',
          decisionEvidence: 'lookup_quote_rules + 產品價格.xlsx reviewed candidate',
          suggestedReview: '確認材質是否為錏輕型鋼；若提供客戶可改查客戶分級',
          note: 'C型鋼預設不列一般切工/孔費',
          systemOrder: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            unit: 'Kg',
            quantity: 24,
            unitWeight: 4,
            totalQuantity: 24,
            unitPrice: 26.8,
            pricingBasis: '價格B暫估',
            length: 6000,
            category: 'C型鋼',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
            differenceNote: '價格表規格為 100*2.3，使用者文字為 C100x50x20x2.3t',
          },
          customerQuote: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            quantity: 1,
            unit: '支',
            unitPrice: 643.2,
            subtotal: 643.2,
            note: '暫估，待確認材質與客戶',
          },
          manualReview: {
            issueType: '材質/客戶待確認',
            estimatedValue: '錏輕型鋼 B價 26.8元/kg，小計643.2',
            confirmationNeeded: '確認材質是否為錏輕型鋼；提供客戶後可改查客戶分級',
            amountImpact: 643.2,
            suggestedAction: '確認後重算或轉正式報價',
          },
          interpretationNote: {
            item: 'C型鋼快報',
            content: '未指定材質時暫採錏輕型鋼；同規格另有白鐵候選。',
            confidence: '中',
            evidence: 'lookup_catalog_families / lookup_quote_rules / 產品價格.xlsx',
          },
        },
      ],
    });

    expect(operations.length).toBeLessThanOrEqual(100);
    expectOperation(operations, {
      sheetId: 'quote_details',
      rowId: 'line_1',
      columnKey: 'material_unit_price',
      value: 26.8,
    });
    expectOperation(operations, {
      sheetId: 'quote_details',
      rowId: 'line_1',
      columnKey: 'subtotal',
      value: 643.2,
    });
    expectOperation(operations, {
      sheetId: 'system_order',
      rowId: 'order_1',
      columnKey: 'item_spec',
      value: '錏C型鋼 C100x50x20x2.3 L=6000',
    });
    expectOperation(operations, {
      sheetId: 'system_order',
      rowId: 'order_1',
      columnKey: 'unit_price',
      value: 26.8,
    });
    expectOperation(operations, {
      sheetId: 'summary',
      rowId: 'summary_total_amount',
      columnKey: 'value',
      value: 643.2,
    });
    expectOperation(operations, {
      sheetId: 'manual_review',
      rowId: 'review_1',
      columnKey: 'confirmation_needed',
      value: '確認材質是否為錏輕型鋼；提供客戶後可改查客戶分級',
    });
    expectOperation(operations, {
      sheetId: 'price_sources',
      rowId: 'source_1',
      columnKey: 'adopted_product_price_item',
      value: 'CCG10023 錏輕型鋼 100*2.3',
    });
    expectOperation(operations, {
      sheetId: 'interpretation_notes',
      rowId: 'note_1',
      columnKey: 'content',
      value: '未指定材質時暫採錏輕型鋼；同規格另有白鐵候選。',
    });
    expectOperation(operations, {
      sheetId: 'customer_quote',
      rowId: 'customer_1',
      columnKey: 'item_spec',
      value: '錏C型鋼 C100x50x20x2.3 L=6000',
    });
    expectOperation(operations, {
      sheetId: 'customer_quote',
      rowId: 'customer_1',
      columnKey: 'subtotal',
      value: 643.2,
    });
    expect(operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetId: 'customer_quote',
          columnKey: 'customer_tier',
        }),
      ]),
    );
  });

  it('reprojects all affected cells when one quote value changes', () => {
    const operations = buildSemanticWorkbookPatchOperations({
      customer: {
        name: '龍頂',
        tier: 'A級',
        code: 'O-15',
      },
      quoteLines: [
        {
          lineId: 'line_1',
          lineNo: 1,
          customerOriginalItemName: 'C100x50x20x2.3t 6M 一支',
          normalizedItemName: '錏輕型鋼 100*2.3，6M',
          adoptedProductPriceItem: 'CCG10023 錏輕型鋼 100*2.3',
          quantity: 1,
          unit: '支',
          totalWeightKg: 24,
          customerName: '龍頂',
          customerTier: 'A級',
          materialUnitPrice: 26,
          materialUnitPriceField: '售價A',
          materialPricingUnit: 'Kg',
          billableQuantity: 24,
          subtotal: 624,
          confidence: '中',
          systemOrder: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            unit: 'Kg',
            quantity: 24,
            totalQuantity: 24,
            unitPrice: 26,
            pricingBasis: '龍頂A級',
          },
          priceSource: {
            sourceFile: '產品價格.xlsx',
            worksheet: 'Sheet1',
            rowOrPage: '1560',
          },
          customerQuote: {
            itemSpec: '錏C型鋼 C100x50x20x2.3 L=6000',
            quantity: 1,
            unit: '支',
            unitPrice: 624,
            subtotal: 624,
            note: '暫估',
          },
          manualReview: {
            confirmationNeeded: '確認龍頂客戶全名與材質',
          },
          interpretationNote: {
            item: '客戶分級',
            content: '客戶改為龍頂候選，C型鋼改用A級價格重算。',
          },
        },
      ],
    });

    expectOperation(operations, {
      sheetId: 'quote_details',
      rowId: 'line_1',
      columnKey: 'material_unit_price',
      value: 26,
    });
    expectOperation(operations, {
      sheetId: 'quote_details',
      rowId: 'line_1',
      columnKey: 'subtotal',
      value: 624,
    });
    expectOperation(operations, {
      sheetId: 'system_order',
      rowId: 'order_1',
      columnKey: 'unit_price',
      value: 26,
    });
    expectOperation(operations, {
      sheetId: 'summary',
      rowId: 'summary_total_amount',
      columnKey: 'value',
      value: 624,
    });
    expectOperation(operations, {
      sheetId: 'price_sources',
      rowId: 'source_1',
      columnKey: 'adopted_unit_price',
      value: 26,
    });
    expectOperation(operations, {
      sheetId: 'customer_quote',
      rowId: 'customer_1',
      columnKey: 'unit_price',
      value: 624,
    });
    expectOperation(operations, {
      sheetId: 'customer_quote',
      rowId: 'customer_1',
      columnKey: 'subtotal',
      value: 624,
    });
  });
});
