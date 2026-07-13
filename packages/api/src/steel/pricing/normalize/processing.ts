import type { ProcessingMethod, ProcessingShape } from '../categories';

type ProcessingRule = readonly [subcategory: string, pattern: RegExp];

export interface ProcessingAttributes {
  subcategory: string;
  processingMethod: ProcessingMethod | null;
  processingShape: ProcessingShape | null;
}

const otherRules: readonly ProcessingRule[] = [
  ['C型鋼', /^型鋼結筒加工費$/u],
  ['雷射畫線', /雷射畫線/u],
  ['熱浸鍍', /熱浸鍍(?:鋅)?費/u],
  ['喇叭桶', /滾喇叭桶/u],
  ['滾圓', /板滾|滾圓|H\s*鐵滾工|管類滾工/u],
  ['端板', /端板/u],
  ['噴砂/塗裝', /噴砂.*紅丹/u],
  ['烤漆', /另加烤漆/u],
  ['壓花', /壓花/u],
  ['拋光', /拋工資|拋光/u],
  ['整平', /整平/u],
  ['雕花', /雕花/u],
  ['保護', /^保護$/u],
  ['厚板', /厚板部加工/u],
];

const holeRules: readonly ProcessingRule[] = [
  ['角鐵', /角[鐵鋼].*沖孔/u],
  ['C型鋼', /(?:75|100)型短片沖孔/u],
  ['鐵板', /鐵板|厚板部沖孔|板沖孔|沖孔加工|沖孔φ|鑽\s*孔φ|[□◇○]孔/u],
  ['通用', /^加工沖孔切$/u],
];

const cuttingRules: readonly ProcessingRule[] = [
  ['方鐵', /方鐵鋸工/u],
  ['方管', /方管鋸工/u],
  ['圓條', /圓條鋸工|黑圓條切/u],
  ['圓管', /圓管鋸工/u],
  ['平鐵', /平鐵鋸工/u],
  ['角鐵', /角鐵鋸工/u],
  ['槽鐵', /槽鐵鋸工/u],
  ['I型鋼/工字鐵', /工字鐵鋸工/u],
  ['H型鋼', /H鐵(?:鋸工|氧切切工)/u],
  ['鐵板', /雷圓|板切|CNC切割|雷射|電離子|氧切|剪床|切圓|切工φ|CNC切工φ/u],
  ['通用', /^切工$|鋸台切/u],
];

const bendingRules: readonly ProcessingRule[] = [
  ['豬公', /豬公/u],
  ['斗笠', /斗笠/u],
  ['工具箱', /工具箱/u],
  ['車斗', /後車斗/u],
  ['中柱', /中柱/u],
  ['下軌', /伸縮門下軌/u],
  ['含切工', /切工|\+切/u],
  ['無缺口', /無缺口/u],
  ['消音', /消音/u],
  ['花板', /花板|\d(?:\.\d+)?\s*花\)/u],
  ['特殊', /特殊/u],
  ['一般', /板折|鐵板折工|折工/u],
];

function inferFromRules(productName: string, rules: readonly ProcessingRule[]): string | undefined {
  return rules.find(([, pattern]) => pattern.test(productName))?.[0];
}

function inferCuttingMethod(productName: string): ProcessingMethod | null {
  if (/剪床/u.test(productName)) return '剪床';
  if (/雷射|雷圓/u.test(productName)) return '雷射';
  if (/鋸床|鋸台|鋸工/u.test(productName)) return '鋸床';
  if (/水刀/u.test(productName)) return '水刀';
  if (/氧切|電離子|火焰/u.test(productName)) return '火';
  return null;
}

function inferCuttingShape(productName: string): ProcessingShape | null {
  if (/剪床|鋸床|鋸台|鋸工|圓條切/u.test(productName)) return '直線切割';
  if (/雷圓|雷射切割|CNC切割|CNC切工|板切|切圓|切內外圓|電離子|氧切|切工φ/u.test(productName)) {
    return '外形切割';
  }
  return null;
}

function inferHoleMethod(productName: string): ProcessingMethod | null {
  if (/沖/u.test(productName)) return '沖床';
  if (/雷射/u.test(productName)) return '雷射';
  if (/鑽/u.test(productName)) return '鑽床';
  if (/水刀/u.test(productName)) return '水刀';
  return null;
}

function inferHoleShape(productName: string): ProcessingShape {
  if (/橢圓/u.test(productName)) return '橢圓孔';
  if (/長孔/u.test(productName)) return '長孔';
  if (/□/u.test(productName)) return '方孔';
  if (/φ|○/u.test(productName)) return '圓孔';
  return '其他';
}

function inferSlottingSubcategory(productName: string): string {
  if (/H(?:型鋼|鐵)/iu.test(productName)) return 'H型鋼';
  if (/鐵板/u.test(productName)) return '鐵板';
  return '通用';
}

export function inferProcessingAttributes(
  category: string,
  productName: string,
): ProcessingAttributes | undefined {
  const normalizedName = productName.normalize('NFKC').trim();

  if (category === '加工/其他') {
    return {
      subcategory: inferFromRules(normalizedName, otherRules) ?? '其他',
      processingMethod: /雷射畫線/u.test(normalizedName) ? '雷射' : null,
      processingShape: null,
    };
  }
  if (category === '加工/孔') {
    return {
      subcategory: inferFromRules(normalizedName, holeRules) ?? '通用',
      processingMethod: inferHoleMethod(normalizedName),
      processingShape: inferHoleShape(normalizedName),
    };
  }
  if (category === '加工/切工') {
    return {
      subcategory: inferFromRules(normalizedName, cuttingRules) ?? '通用',
      processingMethod: inferCuttingMethod(normalizedName),
      processingShape: inferCuttingShape(normalizedName),
    };
  }
  if (category === '加工/倒角') {
    return {
      subcategory: /鐵板/u.test(normalizedName) ? '鐵板' : '通用',
      processingMethod: inferCuttingMethod(normalizedName),
      processingShape: null,
    };
  }
  if (category === '加工/開槽') {
    return {
      subcategory: inferSlottingSubcategory(normalizedName),
      processingMethod: inferCuttingMethod(normalizedName),
      processingShape: null,
    };
  }
  if (category === '加工/折工') {
    return {
      subcategory: inferFromRules(normalizedName, bendingRules) ?? '一般',
      processingMethod: null,
      processingShape: null,
    };
  }
  if (category === '加工/焊接') {
    return { subcategory: '通用', processingMethod: null, processingShape: null };
  }

  return undefined;
}

export function inferProcessingSubcategory(
  category: string,
  productName: string,
): string | undefined {
  return inferProcessingAttributes(category, productName)?.subcategory;
}
