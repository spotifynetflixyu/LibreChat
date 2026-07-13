import { inferProcessingAttributes, inferProcessingSubcategory } from './processing';

describe('inferProcessingSubcategory', () => {
  it('classifies generic processing rows by process family', () => {
    expect(inferProcessingSubcategory('加工/其他', '熱浸鍍費--H')).toBe('熱浸鍍');
  });

  it.each([
    ['板滾 *φ*H', '滾圓'],
    ['滾喇叭桶(3.0)', '喇叭桶'],
    ['端板(1.0~2.0)', '端板'],
    ['噴砂+紅丹(EP01)', '噴砂/塗裝'],
    ['另加烤漆', '烤漆'],
    ['壓花(3.0)', '壓花'],
    ['拋光', '拋光'],
    ['整平工資', '整平'],
    ['雕花', '雕花'],
    ['保護', '保護'],
    ['厚板部加工', '厚板'],
    ['型鋼結筒加工費', 'C型鋼'],
  ])('maps 加工/其他 %s to %s', (productName, expected) => {
    expect(inferProcessingSubcategory('加工/其他', productName)).toBe(expected);
  });

  it.each([
    ['冷鍍鋅角鐵沖孔 51mm*3.5', '角鐵'],
    ['白鐵 100型短片沖孔', 'C型鋼'],
    ['厚度6.0-12.0m/m鐵板鑽孔φ', '鐵板'],
    ['厚板部沖孔', '鐵板'],
    ['沖孔加工', '鐵板'],
    ['加工沖孔切', '通用'],
  ])('maps 加工/孔 %s to %s', (productName, expected) => {
    expect(inferProcessingSubcategory('加工/孔', productName)).toBe(expected);
  });

  it.each([
    ['H鐵氧切切工--', 'H型鋼'],
    ['黑鐵板 CNC切割', '鐵板'],
    ['雷圓○ (3.0~12)', '鐵板'],
    ['方鐵鋸工--', '方鐵'],
    ['方管鋸工--', '方管'],
    ['圓條鋸工--', '圓條'],
    ['圓管鋸工--', '圓管'],
    ['平鐵鋸工--', '平鐵'],
    ['角鐵鋸工--', '角鐵'],
    ['槽鐵鋸工--', '槽鐵'],
    ['工字鐵鋸工--', 'I型鋼/工字鐵'],
    ['鋸台切--', '通用'],
  ])('maps 加工/切工 %s to %s', (productName, expected) => {
    expect(inferProcessingSubcategory('加工/切工', productName)).toBe(expected);
  });

  it.each([
    ['板折  型(0.8-1.5)特殊+切工', '含切工'],
    ['板折  型(0.8-2.0)特殊', '特殊'],
    ['花板折  型(3.0)', '花板'],
    ['板折  *  型(0.8-2.0)無缺口', '無缺口'],
    ['板折  型(0.8-2.0) 消音', '消音'],
    ['板折  型(伸縮門下軌)', '下軌'],
    ['板折  型(0.8-2.0)消音中柱', '中柱'],
    ['鐵板折工(工具箱)', '工具箱'],
    ['板折  型後車斗', '車斗'],
    ['板折 豬公用', '豬公'],
    ['折斗笠*φ*H', '斗笠'],
    ['板折  型(0.8-2.0)', '一般'],
  ])('maps 加工/折工 %s to %s', (productName, expected) => {
    expect(inferProcessingSubcategory('加工/折工', productName)).toBe(expected);
  });

  it.each([
    ['切斜角-開槽', '通用'],
    ['開槽加工', '通用'],
  ])('maps 加工/開槽 %s to %s', (productName, expected) => {
    expect(inferProcessingSubcategory('加工/開槽', productName)).toBe(expected);
  });

  it('uses a concise fallback only for supported processing categories', () => {
    expect(inferProcessingSubcategory('加工/其他', '未分類加工')).toBe('其他');
    expect(inferProcessingSubcategory('鐵板', '熱浸鍍費')).toBeUndefined();
  });

  it.each([
    ['黑鐵板剪床切倒角', '鐵板', '剪床'],
    ['倒角加工', '通用', null],
  ] as const)('separates 加工/倒角 %s from cutting', (productName, subcategory, method) => {
    expect(inferProcessingAttributes('加工/倒角', productName)).toEqual({
      subcategory,
      processingMethod: method,
      processingShape: null,
    });
  });

  it('separates welding from 加工/其他', () => {
    expect(inferProcessingAttributes('加工/焊接', '焊工')).toEqual({
      subcategory: '通用',
      processingMethod: null,
      processingShape: null,
    });
  });

  it.each([
    ['雷射切割(3.0)', '雷射', '外形切割'],
    ['剪床切工', '剪床', '直線切割'],
    ['方管鋸工--', '鋸床', '直線切割'],
    ['電離子切割', '火', '外形切割'],
    ['H鐵氧切切工--', '火', '外形切割'],
  ] as const)('extracts cutting method and shape from %s', (productName, method, shape) => {
    expect(inferProcessingAttributes('加工/切工', productName)).toMatchObject({
      processingMethod: method,
      processingShape: shape,
    });
  });

  it.each([
    ['沖3/4□孔', '沖床', '方孔'],
    ['沖25mm○孔', '沖床', '圓孔'],
    ['鐵板鑽孔φ', '鑽床', '圓孔'],
    ['鐵板橢圓孔φ', null, '橢圓孔'],
    ['沖連體水平鎖孔', '沖床', '其他'],
  ] as const)('extracts hole method and shape from %s', (productName, method, shape) => {
    expect(inferProcessingAttributes('加工/孔', productName)).toMatchObject({
      processingMethod: method,
      processingShape: shape,
    });
  });
});
