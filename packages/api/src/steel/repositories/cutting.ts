import { parseNullableNumber, parseNullableString, parseRequiredNumber } from './types';

import type { SteelPriceCandidateQuery } from './prices';
import type { SteelJsonValue, SteelRepositoryClient } from './types';
import type { PriceCategory } from '../pricing/enums';

type SteelCuttingRecordType = 'price' | 'supplement';

interface SteelCuttingPriceRow {
  lookup_term: string;
  id: string | number;
  cutting_category: string;
  record_type: string;
  item_name: string;
  cut_type: string;
  spec_text: string | null;
  normalized_spec_text: string | null;
  inch_min: string | number | null;
  inch_max: string | number | null;
  mm_min: string | number | null;
  mm_max: string | number | null;
  unit: string | null;
  unit_price_a: string | number | null;
  unit_price_b: string | number | null;
  unit_price_c: string | number | null;
  unit_price_f: string | number | null;
  conditions: SteelJsonValue | string;
  calculation_rule: string | null;
  notes: string | null;
}

export interface SteelCuttingTierValues {
  A: number | null;
  B: number | null;
  C: number | null;
  F: number | null;
}

export interface SteelCuttingPriceRecord {
  id: number;
  cuttingCategory: string;
  recordType: SteelCuttingRecordType;
  itemName: string;
  cutType: string;
  specText?: string;
  normalizedSpecText?: string;
  inchMin: number | null;
  inchMax: number | null;
  mmMin: number | null;
  mmMax: number | null;
  unit?: string;
  tierPrices: SteelCuttingTierValues;
  tierBSource: 'B' | 'A/C/F' | null;
  conditions: { [key: string]: SteelJsonValue | undefined };
  calculationRule?: string;
  notes?: string;
}

export interface SteelCuttingPriceGroup {
  cuttingCategory: string;
  sourceCategories: PriceCategory[];
  queryIds: string[];
  prices: SteelCuttingPriceRecord[];
  supplements: SteelCuttingPriceRecord[];
}

interface CuttingLookupProvenance {
  lookupTerm: string;
  sourceCategories: PriceCategory[];
  queryIds: string[];
}

const cuttingLookupTermByCategory: Partial<Record<PriceCategory, string>> = {
  H型鋼: 'H型鋼',
  平鐵: '平鐵',
  鐵板: '鐵板',
  圓管: '鐵管',
  方管: '鐵管',
  扁方管: '鐵管',
  角鐵: '角鐵',
  槽鐵: '槽鐵',
};

function appendUnique<Value>(values: Value[], value: Value): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function getLookupProvenance(
  queries: readonly SteelPriceCandidateQuery[],
): CuttingLookupProvenance[] {
  const byTerm = new Map<string, CuttingLookupProvenance>();

  for (const query of queries) {
    if (query.mode === 'category_discovery') {
      continue;
    }
    const lookupTerm = cuttingLookupTermByCategory[query.category];
    if (!lookupTerm) {
      continue;
    }

    const provenance = byTerm.get(lookupTerm) ?? {
      lookupTerm,
      sourceCategories: [],
      queryIds: [],
    };
    appendUnique(provenance.sourceCategories, query.category);
    appendUnique(provenance.queryIds, query.queryId);
    byTerm.set(lookupTerm, provenance);
  }

  return [...byTerm.values()];
}

function parseRecordType(value: string): SteelCuttingRecordType {
  if (value === 'price' || value === 'supplement') {
    return value;
  }
  throw new Error(`Unexpected Steel cutting record_type: ${value}`);
}

function parseConditions(
  value: SteelJsonValue | string,
): { [key: string]: SteelJsonValue | undefined } {
  const parsed: SteelJsonValue = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Steel cutting conditions must be an object');
  }
  return parsed;
}

function toCuttingPriceRecord(row: SteelCuttingPriceRow): SteelCuttingPriceRecord {
  const A = parseNullableNumber(row.unit_price_a);
  const explicitB = parseNullableNumber(row.unit_price_b);
  const C = parseNullableNumber(row.unit_price_c);
  const F = parseNullableNumber(row.unit_price_f);
  const sharedAcf = A ?? C ?? F;

  return {
    id: parseRequiredNumber(row.id),
    cuttingCategory: row.cutting_category,
    recordType: parseRecordType(row.record_type),
    itemName: row.item_name,
    cutType: row.cut_type,
    specText: parseNullableString(row.spec_text),
    normalizedSpecText: parseNullableString(row.normalized_spec_text),
    inchMin: parseNullableNumber(row.inch_min),
    inchMax: parseNullableNumber(row.inch_max),
    mmMin: parseNullableNumber(row.mm_min),
    mmMax: parseNullableNumber(row.mm_max),
    unit: parseNullableString(row.unit),
    tierPrices: {
      A,
      B: explicitB ?? sharedAcf,
      C,
      F,
    },
    tierBSource: explicitB !== null ? 'B' : sharedAcf !== null ? 'A/C/F' : null,
    conditions: parseConditions(row.conditions),
    calculationRule: parseNullableString(row.calculation_rule),
    notes: parseNullableString(row.notes),
  };
}

const cuttingPricesSql = `
WITH lookup_terms AS (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS lookup(lookup_term TEXT)
)
SELECT
  lookup.lookup_term,
  c.id,
  c.cutting_category,
  c.record_type,
  c.item_name,
  c.cut_type,
  c.spec_text,
  c.normalized_spec_text,
  c.inch_min,
  c.inch_max,
  c.mm_min,
  c.mm_max,
  c.unit,
  c.unit_price_a,
  c.unit_price_b,
  c.unit_price_c,
  c.unit_price_f,
  c.conditions,
  c.calculation_rule,
  c.notes
FROM lookup_terms AS lookup
JOIN steel.cutting_prices AS c
  ON c.cutting_category ILIKE '%' || lookup.lookup_term || '%'
ORDER BY c.cutting_category, c.record_type, c.source_row, c.id
`;

export async function searchSteelCuttingPriceGroups(
  client: SteelRepositoryClient,
  queries: readonly SteelPriceCandidateQuery[],
): Promise<SteelCuttingPriceGroup[]> {
  const provenance = getLookupProvenance(queries);
  if (provenance.length === 0) {
    return [];
  }

  const result = await client.query<SteelCuttingPriceRow>(cuttingPricesSql, [
    JSON.stringify(provenance.map(({ lookupTerm }) => ({ lookup_term: lookupTerm }))),
  ]);
  const provenanceByTerm = new Map(provenance.map((item) => [item.lookupTerm, item]));
  const queryRank = new Map(queries.map((query, index) => [query.queryId, index]));
  const groupByCategory = new Map<
    string,
    SteelCuttingPriceGroup & { recordIds: Set<number>; queryRank: number }
  >();

  for (const row of result.rows) {
    const source = provenanceByTerm.get(row.lookup_term);
    if (!source) {
      continue;
    }

    const group = groupByCategory.get(row.cutting_category) ?? {
      cuttingCategory: row.cutting_category,
      sourceCategories: [],
      queryIds: [],
      prices: [],
      supplements: [],
      recordIds: new Set<number>(),
      queryRank: Number.POSITIVE_INFINITY,
    };
    source.sourceCategories.forEach((category) => appendUnique(group.sourceCategories, category));
    source.queryIds.forEach((queryId) => {
      appendUnique(group.queryIds, queryId);
      group.queryRank = Math.min(group.queryRank, queryRank.get(queryId) ?? group.queryRank);
    });

    const record = toCuttingPriceRecord(row);
    if (!group.recordIds.has(record.id)) {
      group.recordIds.add(record.id);
      group[record.recordType === 'price' ? 'prices' : 'supplements'].push(record);
    }
    groupByCategory.set(row.cutting_category, group);
  }

  return [...groupByCategory.values()]
    .sort((left, right) => left.queryRank - right.queryRank)
    .map(({ recordIds: _recordIds, queryRank: _queryRank, ...group }) => group);
}
