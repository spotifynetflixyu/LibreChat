const CUTTING_PRICE_OPERATIONS = Object.freeze([
  '加工/切工',
]);

const CANONICAL_CUTTING_HEADERS = Object.freeze([
  'cutting_category',
  'item_name',
  'cut_type',
  'spec_text',
  'inch_min',
  'inch_max',
  'mm_min',
  'mm_max',
  'height_mm',
  'width_mm',
  'thickness_mm_values',
  'thickness_mm_min',
  'thickness_mm_max',
  'unit',
  'unit_price_a',
  'unit_price_b',
  'unit_price_c',
  'unit_price_f',
  'notes',
]);

const EXPECTED_CUTTING_PRICE_RECONCILIATION = Object.freeze({
  importRows: 97,
  byCategory: Object.freeze({
    H型鋼: 19,
    '工字鐵/H型鋼': 31,
    鐵管: 13,
    角鐵: 12,
    槽鐵: 12,
    平鐵: 10,
  }),
  profileDimensionRows: 50,
  mmRangeRows: 47,
  unrestrictedRows: 0,
  thicknessConstrainedRows: 11,
});

const applicableCategoriesByCuttingCategory = Object.freeze({
  H型鋼: ['H型鋼'],
  '工字鐵/H型鋼': ['I型鋼/工字鐵', 'H型鋼'],
  鐵管: ['圓管', '方管', '扁方管', '圓條', '方鐵'],
  角鐵: ['角鐵'],
  槽鐵: ['槽鐵'],
  平鐵: ['平鐵'],
});

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

function normalizeCuttingCategory(value) {
  const category = normalizeText(value);
  return category === '鐵板/平鐵' || category === '黑平鐵' ? '平鐵' : category;
}

function appendUniqueNote(value, note) {
  const notes = normalizeText(value);
  if (!notes) return note;
  if (notes.includes(note)) return notes;
  return `${notes}；${note}`;
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
  const match = normalizeText(notes).match(
    /厚度\s*:\s*([0-9.]+(?:\s*[、,，]\s*[0-9.]+)*)/u,
  );
  if (!match) throw new Error(`${label} is missing 厚度 notes`);
  const values = match[1]
    .split(/[、,，]/u)
    .filter(Boolean)
    .map((value) => positiveNumber(value, label));
  if (!values.length) throw new Error(`${label} is missing thickness values`);
  return [...new Set(values)].sort((a, b) => a - b);
}

function normalizePrice(value) {
  const text = normalizeText(value).replace(/,/gu, '');
  if (!text || Number(text) === 0) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid cutting price: ${value}`);
  return number;
}

function deriveSizing(category, cutType, specText, notes) {
  if (cutType !== '加工/切工') {
    throw new Error(`Unsupported cutting type: ${cutType}`);
  }
  if (category === 'H型鋼' || category === '工字鐵/H型鋼') {
    const [heightMm, widthMm] = parseDimensionPair(specText, `${category}/${specText}`);
    return {
      inchMin: null,
      inchMax: null,
      mmMin: null,
      mmMax: null,
      heightMm,
      widthMm,
      thicknessValues: null,
      thicknessMin: null,
      thicknessMax: null,
    };
  }
  if (category === '鐵管' && cutType === '加工/切工') {
    if (/"/u.test(specText)) {
      const inch = parseInch(specText, `${category}/${specText}`);
      return { inchMin: inch, inchMax: inch, mmMin: mmFromInch(inch), mmMax: mmFromInch(inch), heightMm: null, widthMm: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
    }
    const mm = positiveNumber(specText, `${category}/${specText}`);
    return { inchMin: null, inchMax: null, mmMin: mm, mmMax: mm, heightMm: null, widthMm: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  }
  if (category === '角鐵' && cutType === '加工/切工') {
    const text = normalizeText(specText);
    const pair = /x/u.test(text) ? parseDimensionPair(text, `${category}/${text}`) : null;
    const raw = pair ? Math.max(...pair) : parseMetricOrInch(text, `${category}/${text}`);
    const inch = !/x/u.test(text) && /"/u.test(text) ? parseInch(text, `${category}/${text}`) : null;
    return { inchMin: inch, inchMax: inch, mmMin: raw, mmMax: raw, heightMm: null, widthMm: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  }
  if (category === '槽鐵' && cutType === '加工/切工') {
    const text = normalizeText(specText);
    if (/x/u.test(text)) {
      const [height, second] = parseDimensionPair(text, `${category}/${text}`);
      return { inchMin: null, inchMax: null, mmMin: height, mmMax: height, heightMm: null, widthMm: null, thicknessValues: height === 150 && second === 9 ? [second] : null, thicknessMin: null, thicknessMax: null };
    }
    const inch = /"/u.test(text) ? parseInch(text, `${category}/${text}`) : null;
    const mm = inch === null ? positiveNumber(text, `${category}/${text}`) : mmFromInch(inch);
    return { inchMin: inch, inchMax: inch, mmMin: mm, mmMax: mm, heightMm: null, widthMm: null, thicknessValues: null, thicknessMin: null, thicknessMax: null };
  }
  if (category === '平鐵' && cutType === '加工/切工') {
    const dimensions = parseRange(specText, `${category}/${specText}`);
    const thicknessValues = parseThicknesses(notes, `${category}/${specText}`);
    return { ...dimensions, heightMm: null, widthMm: null, thicknessValues, thicknessMin: null, thicknessMax: null };
  }
  throw new Error(`Unsupported cutting category: ${category}`);
}

function normalizeCuttingWorkbookRow(raw) {
  const category = normalizeCuttingCategory(raw.cutting_category);
  const itemName = normalizeText(raw.item_name);
  const cutType = normalizeText(raw.cut_type);
  const specText = normalizeText(raw.spec_text);
  const sourceNotes = normalizeText(raw.notes).replace(/白鐵平鐵另計/gu, '白鐵另計');
  const notes =
    category === '平鐵' && cutType === '加工/切工'
      ? appendUniqueNote(sourceNotes, '白鐵另計')
      : sourceNotes;
  const sizing = deriveSizing(category, cutType, specText || itemName, notes);
  const unitPriceA = normalizePrice(raw.unit_price_a);
  const unitPriceB = normalizePrice(raw.unit_price_b) ?? unitPriceA;
  return {
    cutting_category: category,
    item_name: itemName,
    cut_type: cutType,
    spec_text: specText || null,
    inch_min: sizing.inchMin,
    inch_max: sizing.inchMax,
    mm_min: sizing.mmMin,
    mm_max: sizing.mmMax,
    height_mm: sizing.heightMm,
    width_mm: sizing.widthMm,
    thickness_mm_values: sizing.thicknessValues ? JSON.stringify(sizing.thicknessValues) : null,
    thickness_mm_min: sizing.thicknessMin,
    thickness_mm_max: sizing.thicknessMax,
    unit: '刀',
    unit_price_a: unitPriceA,
    unit_price_b: unitPriceB,
    unit_price_c: normalizePrice(raw.unit_price_c),
    unit_price_f: normalizePrice(raw.unit_price_f),
    notes: notes || null,
  };
}

function mapRawCuttingRow(raw) {
  const category = normalizeText(raw[RAW_FIELD_ALIASES.cutting_category]);
  const size = normalizeText(raw[RAW_FIELD_ALIASES.item_name]);
  const cutType = normalizeText(raw[RAW_FIELD_ALIASES.cut_type]);
  if (!CUTTING_PRICE_OPERATIONS.includes(cutType)) return null;
  const itemName = size || cutType;
  return normalizeCuttingWorkbookRow({
    cutting_category: category,
    item_name: itemName,
    cut_type: cutType,
    spec_text: size || null,
    unit_price_a: raw[RAW_FIELD_ALIASES.unit_price_acf],
    unit_price_b: raw[RAW_FIELD_ALIASES.unit_price_b],
    unit_price_c: raw[RAW_FIELD_ALIASES.unit_price_acf],
    unit_price_f: raw[RAW_FIELD_ALIASES.unit_price_acf],
    notes: raw[RAW_FIELD_ALIASES.notes],
  });
}

module.exports = {
  CANONICAL_CUTTING_HEADERS,
  CUTTING_PRICE_OPERATIONS,
  EXPECTED_CUTTING_PRICE_RECONCILIATION,
  applicableCategoriesByCuttingCategory,
  deriveSizing,
  mapRawCuttingRow,
  normalizeCuttingWorkbookRow,
  normalizeText,
};
