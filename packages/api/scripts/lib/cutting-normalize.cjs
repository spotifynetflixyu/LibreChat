const applicableCategoriesByCuttingCategory = Object.freeze({
  H型鋼: ['H型鋼'],
  '工字鐵/H型鋼': ['I型鋼/工字鐵', 'H型鋼'],
  鐵管: ['圓管', '方管', '扁方管', '圓條', '方鐵'],
  角鐵: ['角鐵'],
  槽鐵: ['槽鐵'],
  '鐵板/平鐵': ['鐵板', '平鐵'],
});

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .replace(/／/gu, '/')
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
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
  if (/切斜|翼板切斜|外形|割型|切圓/u.test(`${cutType} ${text}`)) {
    return '外形切割';
  }
  if (cutType === '加工/切工') {
    return '直線切割';
  }
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
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  const number = Number(text.replace(/,/gu, ''));
  return Number.isFinite(number) && number === 0 ? '' : value;
}

function normalizeCuttingWorkbookRow(raw) {
  const cuttingCategory = normalizeText(raw.cutting_category);
  const recordType = normalizeText(raw.record_type);
  const itemName = normalizeText(raw.item_name);
  const cutType = normalizeText(raw.cut_type);
  const specText = normalizeText(raw.spec_text);
  const notes = normalizeText(raw.notes);
  const searchBase =
    normalizeText(raw.normalized_spec_text) || specText || (itemName === '補充' ? notes : itemName);
  const processingMethod = inferProcessingMethod(`${itemName} ${specText} ${notes}`);
  const processingShape = inferProcessingShape(cutType, `${itemName} ${specText} ${notes}`);
  const applicableCategories = applicableCategoriesByCuttingCategory[cuttingCategory] ?? [];
  const normalizedSpecText = [searchBase, processingMethod, processingShape]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' ');
  const conditions = {
    ...parseConditions(raw.conditions_json),
    applicable_categories:
      cuttingCategory === '鐵管' && recordType === 'supplement'
        ? applicableCategories.filter((category) => category !== '方鐵')
        : applicableCategories,
    processing_category:
      recordType === 'price' && ['加工/孔', '加工/倒角', '加工/開槽'].includes(cutType)
        ? cutType
        : '加工/切工',
    processing_method: processingMethod,
    processing_shape: processingShape,
  };

  return {
    ...raw,
    cutting_category: cuttingCategory,
    record_type: recordType,
    item_name: itemName,
    cut_type: cutType,
    spec_text: specText,
    normalized_spec_text: normalizedSpecText,
    unit: recordType === 'price' ? '刀' : '',
    unit_price_a: normalizePrice(raw.unit_price_a),
    unit_price_b: normalizePrice(raw.unit_price_b),
    unit_price_c: normalizePrice(raw.unit_price_c),
    unit_price_f: normalizePrice(raw.unit_price_f),
    conditions_json: JSON.stringify(conditions),
    calculation_rule: normalizeText(raw.calculation_rule),
    notes,
    source_sheet: normalizeText(raw.source_sheet),
  };
}

module.exports = {
  applicableCategoriesByCuttingCategory,
  inferProcessingMethod,
  inferProcessingShape,
  normalizeCuttingWorkbookRow,
  normalizeText,
};
