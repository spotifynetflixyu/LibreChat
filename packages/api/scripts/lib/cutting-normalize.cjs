const CUTTING_PRICE_OPERATIONS = Object.freeze([
  '加工/切工',
  '加工/孔',
  '加工/倒角',
  '加工/開槽',
]);

const CANONICAL_CUTTING_HEADERS = Object.freeze([
  'cutting_category',
  'record_type',
  'item_name',
  'cut_type',
  'spec_text',
  'normalized_spec_text',
  'inch_min',
  'inch_max',
  'mm_min',
  'mm_max',
  'thickness_axis',
  'thickness_mm_values',
  'thickness_mm_min',
  'thickness_mm_max',
  'unit',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_f',
  'conditions_json',
  'calculation_rule',
  'notes',
  'source_sheet',
  'source_row',
  'spec_selector_json',
]);

const EXPECTED_CUTTING_PRICE_RECONCILIATION = Object.freeze({
  importRows: 100,
  priceRows: 100,
  supplementRows: 0,
  byCategory: Object.freeze({
    H型鋼: 22,
    '工字鐵/H型鋼': 31,
    鐵管: 13,
    角鐵: 12,
    槽鐵: 12,
    '鐵板/平鐵': 10,
  }),
  mmRangeRows: 97,
  unrestrictedRows: 3,
  thicknessConstrainedRows: 14,
});

const applicableCategoriesByCuttingCategory = Object.freeze({
  H型鋼: ['H型鋼'],
  '工字鐵/H型鋼': ['I型鋼/工字鐵', 'H型鋼'],
  鐵管: ['圓管', '方管', '扁方管', '圓條', '方鐵'],
  角鐵: ['角鐵'],
  槽鐵: ['槽鐵'],
  '鐵板/平鐵': ['鐵板', '平鐵'],
});

const CUTTING_SPEC_SELECTOR_VERSION = 1;
const ALLOWED_SELECTOR_AXES = Object.freeze([
  'height_mm',
  'width_mm',
  'nominal_size_mm',
  'outer_size_mm',
  'long_leg_mm',
  'short_leg_mm',
  'thickness_mm',
  'flange_thickness_mm',
]);

const RAW_FIELD_ALIASES = Object.freeze({
  cutting_category: '來源區塊',
  item_name: '品項/尺寸',
  cut_type: '加工',
  unit_price_acf: 'tier A/C/F',
  unit_price_b: 'tier B',
  notes: '備註',
});

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .replace(/[X＊*×]/gu, 'x')
    .replace(/／/gu, '/')
    .replace(/[“”″]/gu, '"')
    .replace(/：/gu, ':')
    .replace(/\s+/gu, ' ')
    .trim();
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return number;
}

function mmFromInch(value) {
  return Math.round(value * 25.4 * 1_000_000_000) / 1_000_000_000;
}

function parseInch(value, label) {
  const text = normalizeText(value).replace(/"/gu, '');
  const match = text.match(/^(?:(\d+)\s+)?(\d+(?:\.\d+)?|\d+\/\d+)$/u);
  if (!match) throw new Error(`${label} must be an inch value`);
  const whole = match[1] ? Number(match[1]) : 0;
  const fraction = match[2].includes('/')
    ? (() => {
        const [numerator, denominator] = match[2].split('/').map(Number);
        if (!denominator) throw new Error(`${label} must be an inch value`);
        return numerator / denominator;
      })()
    : Number(match[2]);
  return positiveNumber(whole + fraction, label);
}

function parseDimensionPair(value, label) {
  const match = normalizeText(value).match(/^([0-9]+(?:\.[0-9]+)?)x([0-9]+(?:\.[0-9]+)?)$/u);
  if (!match) throw new Error(`${label} must be an AxB dimension`);
  return [positiveNumber(match[1], label), positiveNumber(match[2], label)];
}

function parseMetricOrInch(value, label) {
  const text = normalizeText(value);
  return /"/u.test(text) ? mmFromInch(parseInch(text, label)) : positiveNumber(text, label);
}

function parseRange(value, label) {
  const parts = normalizeText(value).split('~');
  if (parts.length !== 2) throw new Error(`${label} must be a range`);
  const inch = parts.every((part) => /"/u.test(part) || /\//u.test(part));
  const min = inch ? parseInch(parts[0], label) : positiveNumber(parts[0], label);
  const max = inch ? parseInch(parts[1], label) : positiveNumber(parts[1], label);
  if (min > max) throw new Error(`${label} range is reversed`);
  return inch ? { inchMin: min, inchMax: max, mmMin: mmFromInch(min), mmMax: mmFromInch(max) } : { inchMin: null, inchMax: null, mmMin: min, mmMax: max };
}

function parseThicknesses(notes, label) {
  const match = normalizeText(notes).match(/厚度\s*:\s*([^\s]+)/u);
  if (!match) throw new Error(`${label} is missing 厚度 notes`);
  const values = match[1]
    .split(/[、,，]/u)
    .filter(Boolean)
    .map((value) => positiveNumber(value, label));
  if (!values.length) throw new Error(`${label} is missing thickness values`);
  return [...new Set(values)].sort((a, b) => a - b);
}

function exact(value) {
  return { kind: 'exact', value };
}

function minimum(value) {
  return { kind: 'minimum', value, inclusive: true };
}

function oneOf(values) {
  return { kind: 'one_of', values: [...new Set(values)].sort((a, b) => a - b) };
}

function range(min, max) {
  return { kind: 'range', min, max, min_inclusive: true, max_inclusive: true };
}

function axisSelector(axes) {
  return JSON.stringify({
    version: CUTTING_SPEC_SELECTOR_VERSION,
    match: 'any',
    selectors: [{ type: 'axis_constraints', axes }],
  });
}

function inferProcessingMethod(text) {
  if (/剪床/u.test(text)) return '剪床';
  if (/雷射|CNC/u.test(text)) return '雷射';
  if (/鋸床|鋸切/u.test(text)) return '鋸床';
  if (/水刀/u.test(text)) return '水刀';
  if (/火切|氧切|電離子/u.test(text)) return '火';
  return null;
}

function inferProcessingShape(cutType, text) {
  if (/切斜|翼板切斜|外形|割型|切圓/u.test(`${cutType} ${text}`)) return '外形切割';
  if (cutType === '加工/切工') return '直線切割';
  return null;
}

function parseConditions(value) {
  const text = normalizeText(value) || '{}';
  const parsed = JSON.parse(text);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('conditions_json must be an object');
  }
  return parsed;
}

function normalizePrice(value) {
  const text = normalizeText(value).replace(/,/gu, '');
  if (!text || Number(text) === 0) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid cutting price: ${value}`);
  return number;
}

function appendUniqueProcessingTokens(searchBase, ...tokens) {
  const output = normalizeText(searchBase).split(' ').filter(Boolean);
  for (const token of tokens) if (token && !output.includes(token)) output.push(token);
  return output.join(' ');
}

function buildCuttingSpecSelector(raw) {
  const category = normalizeText(raw.cutting_category);
  const cutType = normalizeText(raw.cut_type);
  const specText = normalizeText(raw.spec_text) || normalizeText(raw.item_name);
  const label = `${category}/${cutType}/${specText || 'unrestricted'}`;

  if (category === 'H型鋼' && ['加工/孔', '加工/倒角', '加工/開槽'].includes(cutType)) {
    return axisSelector({ flange_thickness_mm: minimum(14) });
  }
  if (category === 'H型鋼' && cutType === '加工/切工') {
    const [height, width] = parseDimensionPair(specText, label);
    return axisSelector({ height_mm: exact(height), width_mm: exact(width) });
  }
  if (category === '工字鐵/H型鋼' && cutType === '加工/切工') {
    const [height, width] = parseDimensionPair(specText, label);
    return axisSelector({ height_mm: exact(height), width_mm: exact(width) });
  }
  if (category === '鐵管' && cutType === '加工/切工') {
    return axisSelector(/"/u.test(specText) ? { nominal_size_mm: exact(mmFromInch(parseInch(specText, label))) } : { outer_size_mm: exact(positiveNumber(specText, label)) });
  }
  if (category === '角鐵' && cutType === '加工/切工') {
    if (/x/u.test(specText)) {
      const [first, second] = parseDimensionPair(specText, label).sort((a, b) => b - a);
      return axisSelector({ long_leg_mm: exact(first), short_leg_mm: exact(second) });
    }
    const size = /"/u.test(specText) ? mmFromInch(parseInch(specText, label)) : positiveNumber(specText, label);
    return axisSelector({ long_leg_mm: exact(size), short_leg_mm: exact(size) });
  }
  if (category === '槽鐵' && cutType === '加工/切工') {
    if (/x/u.test(specText)) {
      const [height, second] = parseDimensionPair(specText, label);
      if (height === 150 && second === 9) return axisSelector({ height_mm: exact(height), thickness_mm: exact(second) });
      if (height === 200 && second === 90) return axisSelector({ height_mm: exact(height), width_mm: exact(second) });
      throw new Error(`Unsupported 槽鐵 AxB spec at ${label}`);
    }
    return axisSelector({ height_mm: exact(parseMetricOrInch(specText, label)) });
  }
  if (category === '鐵板/平鐵' && cutType === '加工/切工') {
    const dimensions = parseRange(specText, label);
    const thicknessValues = parseThicknesses(raw.notes, label);
    return axisSelector({ width_mm: range(dimensions.mmMin, dimensions.mmMax), thickness_mm: oneOf(thicknessValues) });
  }
  throw new Error(`Unsupported cutting selector at ${label}`);
}

function deriveSizing(category, cutType, specText, notes) {
  if (category === 'H型鋼' && ['加工/孔', '加工/倒角', '加工/開槽'].includes(cutType)) {
    return { inchMin: null, inchMax: null, mmMin: null, mmMax: null, thicknessAxis: 'flange', thicknessValues: null, thicknessMin: 14, thicknessMax: null };
  }
  if (category === '鐵管' && cutType === '加工/切工') {
    if (/"/u.test(specText)) {
      const inch = parseInch(specText, `${category}/${specText}`);
      return { inchMin: inch, inchMax: inch, mmMin: mmFromInch(inch), mmMax: mmFromInch(inch), thicknessAxis: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
    }
    const mm = positiveNumber(specText, `${category}/${specText}`);
    return { inchMin: null, inchMax: null, mmMin: mm, mmMax: mm, thicknessAxis: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  }
  if (category === '角鐵' && cutType === '加工/切工') {
    const text = normalizeText(specText);
    const pair = /x/u.test(text) ? parseDimensionPair(text, `${category}/${text}`) : null;
    const raw = pair ? Math.max(...pair) : parseMetricOrInch(text, `${category}/${text}`);
    const inch = !/x/u.test(text) && /"/u.test(text) ? parseInch(text, `${category}/${text}`) : null;
    return { inchMin: inch, inchMax: inch, mmMin: raw, mmMax: raw, thicknessAxis: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  }
  if (category === '槽鐵' && cutType === '加工/切工') {
    const text = normalizeText(specText);
    if (/x/u.test(text)) {
      const [height, second] = parseDimensionPair(text, `${category}/${text}`);
      return { inchMin: null, inchMax: null, mmMin: height, mmMax: height, thicknessAxis: height === 150 && second === 9 ? 'material' : null, thicknessValues: height === 150 && second === 9 ? [second] : null, thicknessMin: null, thicknessMax: null };
    }
    const inch = /"/u.test(text) ? parseInch(text, `${category}/${text}`) : null;
    const mm = inch === null ? positiveNumber(text, `${category}/${text}`) : mmFromInch(inch);
    return { inchMin: inch, inchMax: inch, mmMin: mm, mmMax: mm, thicknessAxis: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  }
  if (category === '鐵板/平鐵' && cutType === '加工/切工') {
    const dimensions = parseRange(specText, `${category}/${specText}`);
    const thicknessValues = parseThicknesses(notes, `${category}/${specText}`);
    return { ...dimensions, thicknessAxis: 'material', thicknessValues, thicknessMin: null, thicknessMax: null };
  }
  const [height] = parseDimensionPair(specText, `${category}/${specText}`);
  return { inchMin: null, inchMax: null, mmMin: height, mmMax: height, thicknessAxis: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
}

function normalizeCuttingWorkbookRow(raw) {
  const category = normalizeText(raw.cutting_category);
  const recordType = normalizeText(raw.record_type);
  const itemName = normalizeText(raw.item_name);
  const cutType = normalizeText(raw.cut_type);
  const specText = normalizeText(raw.spec_text);
  const notes = normalizeText(raw.notes);
  const processingText = `${itemName} ${specText} ${notes}`;
  const normalizedSpecText = appendUniqueProcessingTokens(specText || itemName, inferProcessingMethod(processingText), inferProcessingShape(cutType, processingText));
  const existingConditions = parseConditions(raw.conditions_json);
  const sizing = recordType === 'price' ? deriveSizing(category, cutType, specText || itemName, notes) : { inchMin: null, inchMax: null, mmMin: null, mmMax: null, thicknessAxis: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  const conditions = {
    ...existingConditions,
    applicable_categories: applicableCategoriesByCuttingCategory[category] ?? [],
    processing_category: cutType,
    processing_method: inferProcessingMethod(processingText),
    processing_shape: inferProcessingShape(cutType, processingText),
  };
  return {
    cutting_category: category,
    record_type: recordType,
    item_name: itemName,
    cut_type: cutType,
    spec_text: specText || null,
    normalized_spec_text: normalizedSpecText || null,
    inch_min: sizing.inchMin,
    inch_max: sizing.inchMax,
    mm_min: sizing.mmMin,
    mm_max: sizing.mmMax,
    thickness_axis: sizing.thicknessAxis,
    thickness_mm_values: sizing.thicknessValues ? JSON.stringify(sizing.thicknessValues) : null,
    thickness_mm_min: sizing.thicknessMin,
    thickness_mm_max: sizing.thicknessMax,
    unit: recordType === 'price' ? '刀' : null,
    unit_price_a: normalizePrice(raw.unit_price_a),
    unit_price_b: normalizePrice(raw.unit_price_b),
    unit_price_c: normalizePrice(raw.unit_price_c),
    unit_price_f: normalizePrice(raw.unit_price_f),
    conditions_json: JSON.stringify(conditions),
    calculation_rule: normalizeText(raw.calculation_rule) || null,
    notes: notes || null,
    source_sheet: normalizeText(raw.source_sheet),
    source_row: Number(raw.source_row),
    spec_selector_json: buildCuttingSpecSelector({ category, cutting_category: category, recordType, record_type: recordType, itemName, item_name: itemName, cutType, cut_type: cutType, specText, spec_text: specText, notes }),
  };
}

function mapRawCuttingRow(raw, sourceRow) {
  const category = normalizeText(raw[RAW_FIELD_ALIASES.cutting_category]);
  const size = normalizeText(raw[RAW_FIELD_ALIASES.item_name]);
  const cutType = normalizeText(raw[RAW_FIELD_ALIASES.cut_type]);
  if (!CUTTING_PRICE_OPERATIONS.includes(cutType)) return null;
  const itemName = size || cutType;
  return normalizeCuttingWorkbookRow({
    cutting_category: category,
    record_type: 'price',
    item_name: itemName,
    cut_type: cutType,
    spec_text: size || null,
    normalized_spec_text: '',
    unit_price_a: raw[RAW_FIELD_ALIASES.unit_price_acf],
    unit_price_b: raw[RAW_FIELD_ALIASES.unit_price_b],
    unit_price_c: raw[RAW_FIELD_ALIASES.unit_price_acf],
    unit_price_f: raw[RAW_FIELD_ALIASES.unit_price_acf],
    conditions_json: '{}',
    calculation_rule: null,
    notes: raw[RAW_FIELD_ALIASES.notes],
    source_sheet: '全部整理資料',
    source_row: sourceRow,
  });
}

module.exports = {
  ALLOWED_SELECTOR_AXES,
  CANONICAL_CUTTING_HEADERS,
  CUTTING_PRICE_OPERATIONS,
  EXPECTED_CUTTING_PRICE_RECONCILIATION,
  applicableCategoriesByCuttingCategory,
  buildCuttingSpecSelector,
  deriveSizing,
  mapRawCuttingRow,
  normalizeCuttingWorkbookRow,
  normalizeText,
};
