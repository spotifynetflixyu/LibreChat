import { parseNullableNumber, parseNullableString, parseRequiredNumber } from './types';

import type { SteelPriceCandidateQuery, SteelPriceItem } from './prices';
import type { SteelRepositoryClient } from './types';
import type { PriceCategory } from '../pricing/enums';

interface SteelCuttingPriceRow {
  lookup_cutting_category: string;
  id: string | number;
  cutting_category: string;
  item_name: string;
  cut_type: string;
  spec_text: string | null;
  inch_min: string | number | null;
  inch_max: string | number | null;
  mm_min: string | number | null;
  mm_max: string | number | null;
  height_mm: string | number | null;
  width_mm: string | number | null;
  thickness_mm_values: readonly (string | number | null)[] | string | null;
  thickness_mm_min: string | number | null;
  thickness_mm_max: string | number | null;
  unit: string | null;
  unit_price_a: string | number | null;
  unit_price_b: string | number | null;
  unit_price_c: string | number | null;
  unit_price_f: string | number | null;
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
  itemName: string;
  cutType: string;
  specText?: string;
  inchMin: number | null;
  inchMax: number | null;
  mmMin: number | null;
  mmMax: number | null;
  heightMm: number | null;
  widthMm: number | null;
  thicknessMmValues: readonly number[] | null;
  thicknessMmMin: number | null;
  thicknessMmMax: number | null;
  unit?: string;
  tierPrices: SteelCuttingTierValues;
  notes?: string;
}

export interface SteelCuttingCandidateMatch {
  queryId: string;
  category: PriceCategory;
  candidates: readonly SteelPriceItem[];
}

export interface SteelCuttingPriceCandidateMatch {
  queryId: string;
  priceCandidateId: number;
  erpItemCode: string;
  specKey: string;
  cuttingPriceIds: number[];
}

export interface SteelCuttingPriceGroup {
  cuttingCategory: string;
  sourceCategories: PriceCategory[];
  queryIds: string[];
  prices: SteelCuttingPriceRecord[];
  candidateMatches: SteelCuttingPriceCandidateMatch[];
  manualReviewRequired?: true;
  manualReviewNotes?: string[];
}

interface CuttingLookupProvenance {
  cuttingCategory: string;
  sourceCategories: PriceCategory[];
  queryIds: string[];
}

const cuttingCategoriesByPriceCategory: Partial<Record<PriceCategory, readonly string[]>> = {
  H型鋼: ['H型鋼', '工字鐵/H型鋼'],
  'I型鋼/工字鐵': ['工字鐵/H型鋼'],
  平鐵: ['平鐵'],
  圓管: ['鐵管'],
  方管: ['鐵管'],
  扁方管: ['鐵管'],
  圓條: ['鐵管'],
  方鐵: ['鐵管'],
  角鐵: ['角鐵'],
  槽鐵: ['槽鐵'],
};

const pipeInchByMetricSize = new Map<number, number>([
  [13, 0.5],
  [19, 0.75],
  [25, 1],
  [32, 1.25],
  [38, 1.5],
  [40, 1.5],
  [50, 2],
  [65, 2.5],
  [75, 3],
  [100, 4],
  [125, 5],
  [150, 6],
  [200, 8],
]);

function parseNullableCuttingNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  return parseNullableNumber(value);
}

function parseThicknessValues(
  value: SteelCuttingPriceRow['thickness_mm_values'],
): readonly number[] | null {
  if (value === null) {
    return null;
  }
  let entries: readonly (string | number | null)[];
  if (typeof value !== 'string') {
    entries = value;
  } else {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      entries = trimmed.slice(1, -1).split(',');
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (entry) => typeof entry === 'string' || typeof entry === 'number' || entry === null,
        )
      ) {
        return null;
      }
      entries = parsed;
    }
  }

  const numbers = entries.map(parseNullableCuttingNumber);
  return numbers.length > 0 && numbers.every((entry): entry is number => entry !== null)
    ? numbers
    : null;
}

function parseInchValue(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.normalize('NFKC').replace(/["”]/gu, '').trim();
  const mixedFraction = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/u);
  if (mixedFraction) {
    return Number(mixedFraction[1]) + Number(mixedFraction[2]) / Number(mixedFraction[3]);
  }
  const fraction = normalized.match(/^(\d+)\/(\d+)$/u);
  if (fraction) {
    return Number(fraction[1]) / Number(fraction[2]);
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getCandidatePrimarySize(candidate: SteelPriceItem): number | undefined {
  const dimensions = [candidate.outerDiameterMm, candidate.heightMm, candidate.widthMm].filter(
    (value): value is number => value !== null,
  );
  return dimensions.length > 0 ? Math.max(...dimensions) : undefined;
}

function getApprovedMetricInch(candidate: SteelPriceItem): number | undefined {
  const primarySize = getCandidatePrimarySize(candidate);
  return primarySize === undefined ? undefined : pipeInchByMetricSize.get(primarySize);
}

function getCandidateThickness(candidate: SteelPriceItem): number | undefined {
  if (candidate.thicknessMinMm !== null && candidate.thicknessMaxMm !== null) {
    return Math.trunc(candidate.thicknessMinMm) === Math.trunc(candidate.thicknessMaxMm)
      ? candidate.thicknessMinMm
      : undefined;
  }
  if (candidate.category === '平鐵' && candidate.widthMm !== null && candidate.heightMm !== null) {
    return Math.min(candidate.widthMm, candidate.heightMm);
  }
  return undefined;
}

function isSameMm(left: number, right: number): boolean {
  return Math.trunc(left) === Math.trunc(right);
}

function isWithin(value: number, minimum: number | null, maximum: number | null): boolean {
  return minimum !== null && maximum !== null && value >= minimum && value <= maximum;
}

function isWithinMm(value: number, minimum: number | null, maximum: number | null): boolean {
  return (
    minimum !== null &&
    maximum !== null &&
    Math.trunc(value) >= Math.trunc(minimum) &&
    Math.trunc(value) <= Math.trunc(maximum)
  );
}

function parseDimensionPair(value: string | undefined): readonly [number, number] | undefined {
  const match = value
    ?.normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?=$|\s)/iu);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2])];
}

function matchesThickness(record: SteelCuttingPriceRecord, thickness: number): boolean {
  if (record.thicknessMmValues !== null) {
    return record.thicknessMmValues.some(
      (expected) => Math.trunc(thickness) === Math.trunc(expected),
    );
  }
  if (record.thicknessMmMin !== null || record.thicknessMmMax !== null) {
    return isWithinMm(thickness, record.thicknessMmMin, record.thicknessMmMax);
  }
  return true;
}

function matchesHRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  return (
    record.heightMm !== null &&
    record.widthMm !== null &&
    candidate.heightMm !== null &&
    candidate.widthMm !== null &&
    isSameMm(record.heightMm, candidate.heightMm) &&
    isSameMm(record.widthMm, candidate.widthMm)
  );
}

function matchesPipeRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  if (record.inchMin !== null && record.inchMax !== null) {
    const candidateInch = parseInchValue(candidate.nominalInch) ?? getApprovedMetricInch(candidate);
    if (candidateInch !== undefined) {
      return isWithin(candidateInch, record.inchMin, record.inchMax);
    }
  }
  return (
    candidate.outerDiameterMm !== null &&
    isWithinMm(candidate.outerDiameterMm, record.mmMin, record.mmMax)
  );
}

function matchesAngleRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  if (candidate.heightMm === null || candidate.widthMm === null) {
    return false;
  }
  const dimensions = parseDimensionPair(record.specText ?? record.itemName);
  if (dimensions) {
    const recordLegs = [...dimensions].sort((left, right) => right - left);
    const candidateLegs = [candidate.heightMm, candidate.widthMm].sort(
      (left, right) => right - left,
    );
    return (
      isSameMm(recordLegs[0], candidateLegs[0]) && isSameMm(recordLegs[1], candidateLegs[1])
    );
  }
  if (!isSameMm(candidate.heightMm, candidate.widthMm)) {
    return false;
  }
  if (record.inchMin !== null && record.inchMax !== null) {
    const candidateInch = getApprovedMetricInch(candidate);
    return candidateInch !== undefined
      ? isWithin(candidateInch, record.inchMin, record.inchMax)
      : isWithinMm(candidate.heightMm, record.mmMin, record.mmMax);
  }
  return isWithinMm(candidate.heightMm, record.mmMin, record.mmMax);
}

function matchesChannelRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  if (record.inchMin !== null && record.inchMax !== null) {
    const candidateInch = getApprovedMetricInch(candidate);
    if (candidateInch !== undefined) {
      return isWithin(candidateInch, record.inchMin, record.inchMax);
    }
  }
  if (candidate.heightMm === null) {
    return false;
  }
  const dimensions = parseDimensionPair(record.specText ?? record.itemName);
  if (!dimensions) {
    return isWithinMm(candidate.heightMm, record.mmMin, record.mmMax);
  }
  if (record.thicknessMmValues !== null) {
    const thickness = getCandidateThickness(candidate);
    return (
      thickness !== undefined &&
      isSameMm(dimensions[0], candidate.heightMm) &&
      matchesThickness(record, thickness)
    );
  }
  return (
    candidate.widthMm !== null &&
    isSameMm(dimensions[0], candidate.heightMm) &&
    isSameMm(dimensions[1], candidate.widthMm)
  );
}

function matchesFlatRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  if (candidate.heightMm === null || candidate.widthMm === null) {
    return false;
  }
  const width = Math.max(candidate.heightMm, candidate.widthMm);
  const thickness = getCandidateThickness(candidate);
  return (
    thickness !== undefined &&
    isWithinMm(width, record.mmMin, record.mmMax) &&
    matchesThickness(record, thickness)
  );
}

const cuttingMatcherByCategory: Readonly<
  Record<string, (record: SteelCuttingPriceRecord, candidate: SteelPriceItem) => boolean>
> = {
  H型鋼: matchesHRecord,
  '工字鐵/H型鋼': matchesHRecord,
  鐵管: matchesPipeRecord,
  角鐵: matchesAngleRecord,
  槽鐵: matchesChannelRecord,
  平鐵: matchesFlatRecord,
};

function matchesCuttingRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  const matcher = cuttingMatcherByCategory[record.cuttingCategory];
  return matcher?.(record, candidate) ?? false;
}

function selectCuttingRecords(
  group: SteelCuttingPriceGroup,
  candidate: SteelPriceItem,
): SteelCuttingPriceRecord[] {
  const matches = group.prices.filter((record) => matchesCuttingRecord(record, candidate));
  if (group.cuttingCategory !== '角鐵') {
    return matches;
  }
  const exactMetricMatches = matches.filter(
    (record) => record.inchMin === null && record.inchMax === null,
  );
  return exactMetricMatches.length > 0 ? exactMetricMatches : matches;
}

function hasTierValue(values: SteelPriceItem['tierPrices']): boolean {
  return Object.values(values).some((value) => value !== null);
}

function isQuoteableCandidate(candidate: SteelPriceItem): boolean {
  return (
    candidate.unitPriceBase !== null ||
    hasTierValue(candidate.tierPrices) ||
    ((candidate.unit === 'Kg' || candidate.unit === 'M') && hasTierValue(candidate.tierRatios))
  );
}

function appendUnique<Value>(values: Value[], value: Value): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function getManualReviewNotes(
  group: SteelCuttingPriceGroup,
  sourceCategories: readonly PriceCategory[],
  prices: readonly SteelCuttingPriceRecord[],
): string[] {
  if (group.cuttingCategory !== '工字鐵/H型鋼' || !sourceCategories.includes('H型鋼')) {
    return [];
  }
  return [
    ...new Set(
      prices.flatMap((price) =>
        price.notes?.match(/H型鋼\s*另\+30\s*[~～-]\s*50/u)
          ? [`${price.notes}；加價金額需人工確認`]
          : [],
      ),
    ),
  ];
}

export function filterSteelCuttingPriceGroups(
  groups: readonly SteelCuttingPriceGroup[],
  matches: readonly SteelCuttingCandidateMatch[],
): SteelCuttingPriceGroup[] {
  return groups.flatMap((group) => {
    const recordIds = new Set<number>();
    const candidateMatches: SteelCuttingPriceCandidateMatch[] = [];
    const queryIds: string[] = [];
    const sourceCategories: PriceCategory[] = [];

    for (const match of matches) {
      if (!cuttingCategoriesByPriceCategory[match.category]?.includes(group.cuttingCategory)) {
        continue;
      }
      for (const candidate of match.candidates.filter(isQuoteableCandidate)) {
        const prices = selectCuttingRecords(group, candidate);
        if (prices.length === 0) {
          continue;
        }
        const cuttingPriceIds = prices.map(({ id }) => id);
        prices.forEach(({ id }) => recordIds.add(id));
        candidateMatches.push({
          queryId: match.queryId,
          priceCandidateId: candidate.id,
          erpItemCode: candidate.erpItemCode,
          specKey: candidate.specKey,
          cuttingPriceIds,
        });
        appendUnique(queryIds, match.queryId);
        appendUnique(sourceCategories, match.category);
      }
    }

    if (recordIds.size === 0) {
      return [];
    }
    const prices = group.prices.filter(({ id }) => recordIds.has(id));
    const manualReviewNotes = getManualReviewNotes(group, sourceCategories, prices);
    return [
      {
        cuttingCategory: group.cuttingCategory,
        sourceCategories,
        queryIds,
        prices,
        candidateMatches,
        ...(manualReviewNotes.length > 0
          ? { manualReviewRequired: true as const, manualReviewNotes }
          : {}),
      },
    ];
  });
}

function getLookupProvenance(
  queries: readonly SteelPriceCandidateQuery[],
): CuttingLookupProvenance[] {
  const byCuttingCategory = new Map<string, CuttingLookupProvenance>();
  for (const query of queries) {
    if (query.mode === 'category_discovery') {
      continue;
    }
    const cuttingCategories = cuttingCategoriesByPriceCategory[query.category];
    if (!cuttingCategories) {
      continue;
    }
    for (const cuttingCategory of cuttingCategories) {
      const provenance = byCuttingCategory.get(cuttingCategory) ?? {
        cuttingCategory,
        sourceCategories: [],
        queryIds: [],
      };
      appendUnique(provenance.sourceCategories, query.category);
      appendUnique(provenance.queryIds, query.queryId);
      byCuttingCategory.set(cuttingCategory, provenance);
    }
  }
  return [...byCuttingCategory.values()];
}

function toCuttingPriceRecord(row: SteelCuttingPriceRow): SteelCuttingPriceRecord {
  if (row.cut_type !== '加工/切工') {
    throw new Error('Unexpected Steel cutting operation');
  }
  const A = parseNullableCuttingNumber(row.unit_price_a);
  const explicitB = parseNullableCuttingNumber(row.unit_price_b);
  const C = parseNullableCuttingNumber(row.unit_price_c);
  const F = parseNullableCuttingNumber(row.unit_price_f);

  return {
    id: parseRequiredNumber(row.id),
    cuttingCategory: row.cutting_category,
    itemName: row.item_name,
    cutType: row.cut_type,
    specText: parseNullableString(row.spec_text),
    inchMin: parseNullableCuttingNumber(row.inch_min),
    inchMax: parseNullableCuttingNumber(row.inch_max),
    mmMin: parseNullableCuttingNumber(row.mm_min),
    mmMax: parseNullableCuttingNumber(row.mm_max),
    heightMm: parseNullableCuttingNumber(row.height_mm),
    widthMm: parseNullableCuttingNumber(row.width_mm),
    thicknessMmValues: parseThicknessValues(row.thickness_mm_values),
    thicknessMmMin: parseNullableCuttingNumber(row.thickness_mm_min),
    thicknessMmMax: parseNullableCuttingNumber(row.thickness_mm_max),
    unit: parseNullableString(row.unit),
    tierPrices: { A, B: explicitB ?? A, C, F },
    notes: parseNullableString(row.notes),
  };
}

const cuttingPricesSql = `
WITH lookup_categories AS (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS lookup(cutting_category TEXT)
)
SELECT
  lookup.cutting_category AS lookup_cutting_category,
  c.id,
  c.cutting_category,
  c.item_name,
  c.cut_type,
  c.spec_text,
  c.inch_min,
  c.inch_max,
  c.mm_min,
  c.mm_max,
  c.height_mm,
  c.width_mm,
  c.thickness_mm_values,
  c.thickness_mm_min,
  c.thickness_mm_max,
  c.unit,
  c.unit_price_a,
  c.unit_price_b,
  c.unit_price_c,
  c.unit_price_f,
  c.notes
FROM lookup_categories AS lookup
JOIN steel.cutting_prices AS c
  ON c.cutting_category = lookup.cutting_category
  AND c.cut_type = '加工/切工'
ORDER BY c.cutting_category, c.id
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
    JSON.stringify(provenance.map(({ cuttingCategory }) => ({ cutting_category: cuttingCategory }))),
  ]);
  const provenanceByCuttingCategory = new Map(
    provenance.map((item) => [item.cuttingCategory, item]),
  );
  const queryRank = new Map(queries.map((query, index) => [query.queryId, index]));
  const categoryRank = new Map<PriceCategory, number>();
  queries.forEach((query, index) => {
    if (query.mode !== 'category_discovery' && !categoryRank.has(query.category)) {
      categoryRank.set(query.category, index);
    }
  });
  const groupByCategory = new Map<
    string,
    SteelCuttingPriceGroup & { recordIds: Set<number>; queryRank: number }
  >();

  for (const row of result.rows) {
    const source = provenanceByCuttingCategory.get(row.lookup_cutting_category);
    if (!source) {
      continue;
    }
    const group = groupByCategory.get(row.cutting_category) ?? {
      cuttingCategory: row.cutting_category,
      sourceCategories: [],
      queryIds: [],
      prices: [],
      candidateMatches: [],
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
      group.prices.push(record);
    }
    groupByCategory.set(row.cutting_category, group);
  }

  return [...groupByCategory.values()]
    .sort((left, right) => left.queryRank - right.queryRank)
    .map(({ recordIds: _recordIds, queryRank: _queryRank, ...group }) => ({
      ...group,
      sourceCategories: group.sourceCategories.sort(
        (left, right) => (categoryRank.get(left) ?? 0) - (categoryRank.get(right) ?? 0),
      ),
      queryIds: group.queryIds.sort(
        (left, right) => (queryRank.get(left) ?? 0) - (queryRank.get(right) ?? 0),
      ),
    }));
}
