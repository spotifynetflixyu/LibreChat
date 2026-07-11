import { parseNullableNumber, parseNullableString, parseRequiredNumber } from './types';

import type { SteelPriceCandidateQuery, SteelPriceItem } from './prices';
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

export interface SteelCuttingCandidateMatch {
  queryId: string;
  category: PriceCategory;
  candidates: readonly SteelPriceItem[];
}

interface CuttingLookupProvenance {
  lookupTerm: string;
  sourceCategories: PriceCategory[];
  queryIds: string[];
}

const cuttingLookupTermByCategory: Partial<Record<PriceCategory, string>> = {
  H型鋼: 'H型鋼',
  'I型鋼/工字鐵': '工字鐵',
  平鐵: '平鐵',
  圓管: '鐵管',
  方管: '鐵管',
  扁方管: '鐵管',
  圓鐵: '鐵管',
  角鐵: '角鐵',
  槽鐵: '槽鐵',
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

function isSameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function parseDimensionPair(value: string | undefined): readonly [number, number] | undefined {
  const match = value?.normalize('NFKC').match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/iu);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2])];
}

function parseNumericRange(value: string | undefined): readonly [number, number] | undefined {
  const match = value?.normalize('NFKC').match(/^(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)$/u);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2])];
}

function parseNumericValue(value: string | undefined): number | undefined {
  if (!value?.normalize('NFKC').match(/^\d+(?:\.\d+)?$/u)) {
    return undefined;
  }

  return Number(value);
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
  if (dimensions.length > 0) {
    return Math.max(...dimensions);
  }

  const declaredSize = (candidate.normalizedSpecText ?? candidate.productName)
    ?.normalize('NFKC')
    .match(/(?:角鐵|槽鐵)\s*(\d+(?:\.\d+)?)/u)?.[1];
  return declaredSize ? Number(declaredSize) : undefined;
}

function isRoundBar(candidate: SteelPriceItem): boolean {
  return (
    candidate.category === '圓鐵' ||
    candidate.subcategory === '圓條' ||
    candidate.productName?.includes('圓條') === true
  );
}

function getRoundBarSize(candidate: SteelPriceItem): number | undefined {
  const text = (candidate.normalizedSpecText ?? candidate.productName)?.normalize('NFKC');
  const metric = text?.match(/(?:圓鐵|圓條)\s*(\d+(?:\.\d+)?)\s*mm/u)?.[1];
  if (metric) {
    return Number(metric);
  }
  const inch = text?.match(/(?:圓鐵|圓條)\s*(\d+(?:\s+\d+\/\d+|\/\d+)?)/u)?.[1];
  const parsedInch = parseInchValue(inch);
  return parsedInch === undefined ? undefined : parsedInch * 25.4;
}

function getHFlangeThickness(candidate: SteelPriceItem): number | undefined {
  const section = (candidate.normalizedSpecText ?? candidate.productName)
    ?.normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .match(/\d+(?:\.\d+)?x\d+(?:\.\d+)?x\d+(?:\.\d+)?\/(\d+(?:\.\d+)?)/u);
  return section ? Number(section[1]) : undefined;
}

function matchesHRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  const dimensions = parseDimensionPair(record.normalizedSpecText ?? record.itemName);
  if (dimensions && candidate.heightMm !== null && candidate.widthMm !== null) {
    return (
      isSameNumber(dimensions[0], candidate.heightMm) &&
      isSameNumber(dimensions[1], candidate.widthMm)
    );
  }

  return (
    record.normalizedSpecText === undefined &&
    record.notes?.includes('14m/m 以上') === true &&
    (getHFlangeThickness(candidate) ?? 0) >= 14
  );
}

function getApprovedMetricInch(candidate: SteelPriceItem): number | undefined {
  const size = getCandidatePrimarySize(candidate);
  return size === undefined ? undefined : pipeInchByMetricSize.get(size);
}

function matchesProfileRecord(
  record: SteelCuttingPriceRecord,
  candidate: SteelPriceItem,
  useCandidateNominalInch: boolean,
): boolean {
  const candidateInch = useCandidateNominalInch
    ? (parseInchValue(candidate.nominalInch) ?? getApprovedMetricInch(candidate))
    : getApprovedMetricInch(candidate);
  if (record.inchMin !== null && record.inchMax !== null) {
    return (
      candidateInch !== undefined &&
      candidateInch >= record.inchMin &&
      candidateInch <= record.inchMax
    );
  }

  const size = getCandidatePrimarySize(candidate);
  if (size === undefined) {
    return false;
  }

  const dimensions = parseDimensionPair(record.normalizedSpecText ?? record.itemName);
  if (dimensions && candidate.heightMm !== null && candidate.widthMm !== null) {
    return (
      (isSameNumber(dimensions[0], candidate.heightMm) &&
        isSameNumber(dimensions[1], candidate.widthMm)) ||
      (isSameNumber(dimensions[0], candidate.widthMm) &&
        isSameNumber(dimensions[1], candidate.heightMm))
    );
  }

  const numeric = parseNumericValue(record.normalizedSpecText ?? record.itemName);
  return numeric !== undefined && isSameNumber(numeric, size);
}

function matchesChannelRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  if (matchesProfileRecord(record, candidate, false)) {
    return true;
  }

  const dimensions = parseDimensionPair(record.normalizedSpecText ?? record.itemName);
  const thickness = getCandidateThickness(candidate);
  return (
    dimensions !== undefined &&
    candidate.heightMm !== null &&
    thickness !== undefined &&
    isSameNumber(dimensions[0], candidate.heightMm) &&
    isSameNumber(dimensions[1], thickness)
  );
}

function getCandidateThickness(candidate: SteelPriceItem): number | undefined {
  if (
    candidate.thicknessMinMm !== null &&
    candidate.thicknessMaxMm !== null &&
    isSameNumber(candidate.thicknessMinMm, candidate.thicknessMaxMm)
  ) {
    return candidate.thicknessMinMm;
  }
  if (candidate.category === '平鐵' && candidate.widthMm !== null && candidate.heightMm !== null) {
    return Math.min(candidate.widthMm, candidate.heightMm);
  }
  return undefined;
}

function isThinSquareTube(candidate: SteelPriceItem): boolean {
  return (
    (candidate.category === '方管' || candidate.category === '扁方管') &&
    (getCandidateThickness(candidate) ?? Infinity) <= 1.2
  );
}

function matchesFlatRecord(record: SteelCuttingPriceRecord, candidate: SteelPriceItem): boolean {
  const width = candidate.widthMm;
  const thickness = getCandidateThickness(candidate);
  if (width === null || thickness === undefined) {
    return false;
  }

  const normalized = record.normalizedSpecText ?? record.itemName;
  const parsedRange = parseNumericRange(normalized);
  let widthMatches = false;
  if (parsedRange) {
    widthMatches = width >= parsedRange[0] && width <= parsedRange[1];
  } else if (record.mmMin !== null && record.mmMax !== null) {
    widthMatches = width >= record.mmMin && width <= record.mmMax;
  }
  if (!widthMatches) {
    return false;
  }

  const thicknessText = record.notes?.match(/厚度:([\d.、,，\s]+)/u)?.[1];
  if (!thicknessText) {
    return true;
  }
  const thicknesses = thicknessText
    .split(/[、,，\s]+/u)
    .map(Number)
    .filter(Number.isFinite);
  return thicknesses.some((value) => isSameNumber(value, thickness));
}

function matchesCuttingRecord(
  group: SteelCuttingPriceGroup,
  record: SteelCuttingPriceRecord,
  candidate: SteelPriceItem,
): boolean {
  if (group.cuttingCategory.includes('H型鋼')) {
    return matchesHRecord(record, candidate);
  }
  if (group.cuttingCategory === '鐵板/平鐵') {
    return matchesFlatRecord(record, candidate);
  }
  if (
    group.cuttingCategory === '鐵管' ||
    group.cuttingCategory === '角鐵' ||
    group.cuttingCategory === '槽鐵'
  ) {
    if (
      group.cuttingCategory === '鐵管' &&
      (isRoundBar(candidate) || isThinSquareTube(candidate))
    ) {
      return false;
    }
    if (group.cuttingCategory === '槽鐵') {
      return matchesChannelRecord(record, candidate);
    }
    return matchesProfileRecord(record, candidate, group.cuttingCategory === '鐵管');
  }
  return false;
}

function selectCuttingPrices(
  group: SteelCuttingPriceGroup,
  candidate: SteelPriceItem,
): SteelCuttingPriceRecord[] {
  const matches = group.prices.filter((record) => matchesCuttingRecord(group, record, candidate));
  if (group.cuttingCategory !== '槽鐵') {
    return matches;
  }

  const dimensionMatches = matches.filter(
    (record) => parseDimensionPair(record.normalizedSpecText ?? record.itemName) !== undefined,
  );
  return dimensionMatches.length > 0 ? dimensionMatches : matches;
}

function getCandidateSearchText(candidate: SteelPriceItem): string {
  return [candidate.material, candidate.productName, candidate.normalizedSpecText]
    .filter((value): value is string => value !== undefined)
    .join(' ');
}

function matchesCuttingSupplement(
  group: SteelCuttingPriceGroup,
  supplement: SteelCuttingPriceRecord,
  candidates: readonly SteelPriceItem[],
): boolean {
  const text = [supplement.itemName, supplement.normalizedSpecText, supplement.notes]
    .filter((value): value is string => value !== undefined)
    .join(' ');
  const hasCandidateText = (pattern: RegExp) =>
    candidates.some((candidate) => pattern.test(getCandidateSearchText(candidate)));
  const hasCategory = (categories: readonly PriceCategory[]) =>
    candidates.some((candidate) => categories.includes(candidate.category as PriceCategory));

  const roundBars = candidates.filter(isRoundBar);
  if (roundBars.length > 0) {
    if (!text.includes('圓條')) {
      return false;
    }
    if (text.includes('1"以下')) {
      return roundBars.some((candidate) => (getRoundBarSize(candidate) ?? Infinity) <= 25.4);
    }
    return true;
  }

  if (group.cuttingCategory === '鐵管') {
    if (text.includes('圓條')) {
      return false;
    }
    if (text.includes('白A、錏方管')) {
      return hasCategory(['方管', '扁方管']) && hasCandidateText(/白A|錏/u);
    }
    if (text.includes('白鐵')) {
      const whiteCandidates = candidates.filter((candidate) =>
        /白鐵/u.test(getCandidateSearchText(candidate)),
      );
      if (text.includes('100 以下')) {
        return whiteCandidates.some(
          (candidate) => (getCandidatePrimarySize(candidate) ?? Infinity) <= 100,
        );
      }
      if (text.includes('100 以上')) {
        return whiteCandidates.some(
          (candidate) => (getCandidatePrimarySize(candidate) ?? -Infinity) >= 100,
        );
      }
      return whiteCandidates.length > 0;
    }
    if (text.includes('1"以下小方管')) {
      return candidates.some(
        (candidate) =>
          candidate.category === '方管' && (getCandidatePrimarySize(candidate) ?? Infinity) <= 25.4,
      );
    }
    if (text.includes('方管厚度')) {
      return candidates.some(isThinSquareTube);
    }
  }
  if (group.cuttingCategory === '角鐵' && text.includes('白鐵')) {
    return hasCandidateText(/白鐵/u);
  }
  if (group.cuttingCategory === '鐵板/平鐵' && text.includes('白鐵')) {
    return (
      hasCandidateText(/白鐵/u) ||
      candidates.some((candidate) => (candidate.widthMm ?? Infinity) <= 25.4)
    );
  }
  return true;
}

function hasTierValue(values: SteelPriceItem['tierPrices']): boolean {
  return Object.values(values).some((value) => value !== null);
}

function isQuoteableCandidate(candidate: SteelPriceItem): boolean {
  return (
    hasTierValue(candidate.tierPrices) ||
    ((candidate.unit === 'Kg' || candidate.unit === 'M') && hasTierValue(candidate.tierRatios))
  );
}

function allowsSupplementOnly(group: SteelCuttingPriceGroup, candidate: SteelPriceItem): boolean {
  return group.cuttingCategory === '鐵管' && (isRoundBar(candidate) || isThinSquareTube(candidate));
}

export function filterSteelCuttingPriceGroups(
  groups: readonly SteelCuttingPriceGroup[],
  matches: readonly SteelCuttingCandidateMatch[],
): SteelCuttingPriceGroup[] {
  return groups.flatMap((group) => {
    const recordIds = new Set<number>();
    const supplementIds = new Set<number>();
    const queryIds: string[] = [];
    const sourceCategories: PriceCategory[] = [];

    for (const match of matches) {
      const candidates = match.candidates.filter(isQuoteableCandidate);
      if (!group.sourceCategories.includes(match.category) || candidates.length === 0) {
        continue;
      }

      const candidateSelections = candidates.map((candidate) => {
        const prices = selectCuttingPrices(group, candidate);
        const supplements =
          prices.length > 0 || allowsSupplementOnly(group, candidate)
            ? group.supplements.filter((supplement) =>
                matchesCuttingSupplement(group, supplement, [candidate]),
              )
            : [];
        return { prices, supplements };
      });
      const selectionKeys = new Set(
        candidateSelections.map(
          ({ prices, supplements }) =>
            `p:${prices.map(({ id }) => id).join(',')}|s:${supplements.map(({ id }) => id).join(',')}`,
        ),
      );
      if (selectionKeys.size !== 1) {
        continue;
      }
      const selection = candidateSelections[0];
      if (!selection || (selection.prices.length === 0 && selection.supplements.length === 0)) {
        continue;
      }
      selection.prices.forEach((record) => recordIds.add(record.id));
      selection.supplements.forEach((record) => supplementIds.add(record.id));
      appendUnique(queryIds, match.queryId);
      appendUnique(sourceCategories, match.category);
    }

    if (recordIds.size === 0 && supplementIds.size === 0) {
      return [];
    }

    return [
      {
        cuttingCategory: group.cuttingCategory,
        sourceCategories,
        queryIds,
        prices: group.prices.filter((record) => recordIds.has(record.id)),
        supplements: group.supplements.filter((supplement) => supplementIds.has(supplement.id)),
      },
    ];
  });
}

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

function parseConditions(value: SteelJsonValue | string): {
  [key: string]: SteelJsonValue | undefined;
} {
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
  let tierBSource: SteelCuttingPriceRecord['tierBSource'] = null;
  if (explicitB !== null) {
    tierBSource = 'B';
  } else if (sharedAcf !== null) {
    tierBSource = 'A/C/F';
  }

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
    tierBSource,
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
