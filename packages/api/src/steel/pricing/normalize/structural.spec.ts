import { inferStructuralSubcategory } from './structural';

describe('inferStructuralSubcategory', () => {
  it.each([
    ['1.6錏板折製檔泥板', '成型/配件'],
    ['0.8黑五溝圍籬', '圍籬'],
    ['黑鐵網板', '網板'],
    ['黑鐵花板 4x8', '花板'],
    ['黑鐵板切圓φ', '切圓'],
    ['黑鐵板切圓', '切圓'],
    ['6.0-10.0mm板切φ', '切圓'],
    ['黑鐵板切內外圓◎', '切內外圓'],
    ['黑鐵板切內外圓', '切內外圓'],
    ['6mm-10mm板切 ◎', '切內外圓'],
    ['ST 2B 1.5 切', '切板'],
    ['黑板 2.0', '平板'],
  ])('classifies 鐵板 product %s as %s', (productName, expected) => {
    expect(inferStructuralSubcategory('鐵板', productName)).toBe(expected);
  });

  it.each([
    ['C型鋼', '型鋼結筒加工費', '加工'],
    ['C型鋼', '黑鐵輕型鋼 125*2.3', '輕型'],
    ['C型鋼', '錏型鋼150*65*20*3.0', '成型'],
    ['H型鋼', '輕量H200*100*3.2/4.5*6M', '輕量'],
    ['H型鋼', 'H型鋼200*100*5.5/8*6M', '標準'],
    ['I型鋼/工字鐵', 'I字鐵200*100*7/10*6M', '標準'],
    ['T型鋼', 'Ｔ型鋼', '標準'],
    ['平鐵', '黑鐵平鐵25*6.0', '標準'],
    ['方鐵', '磨光方鐵 1/2-32mm切', '切料/加工'],
    ['方鐵', '磨光方鐵 1/2*6M', '磨光'],
    ['方鐵', '黑鐵方鐵19mm', '標準'],
    ['角鐵', '萬能角鋼用鏍絲', '配件'],
    ['角鐵', '錏成型角鐵25*2.5*6M', '萬能/成型'],
    ['角鐵', '不等邊黑角鐵100*75*7.0*6M', '不等邊'],
    ['角鐵', '黑角鐵50*5.0', '等邊'],
    ['圓條', '磨光圓鐵 12mm-50mm切', '切料/加工'],
    ['圓條', '磨光圓鐵 12mm', '磨光'],
    ['圓條', '黑鐵圓條 12mm', '標準'],
    ['鋼筋', '節竹鐵 12m/m (4#)', '竹節'],
    ['鋼筋', '光面鋼筋 10mm', '其他'],
    ['鐵軌', '12K鐵軌 10M', '標準'],
    ['槽鐵', '槽鐵75*40*5/7*6M', '標準'],
  ])('classifies %s product %s as %s', (category, productName, expected) => {
    expect(inferStructuralSubcategory(category, productName)).toBe(expected);
  });

  it.each([
    ['圓管', '一體成型太陽片3/4圓管3溝', '成品/太陽片'],
    ['圓管', '3/4白鐵圓管連料100*480', '連料'],
    ['圓管', '白鐵配管 1/2', '配管'],
    ['圓管', '鍍鋅B管 3/8*2.3', 'B管'],
    ['圓管', '黑A鋼管 19mm*1.5', 'A管'],
    ['圓管', '白鐵圓管 25mm', '一般'],
    ['方管', '一體成型太陽片25mm方管', '成品/太陽片'],
    ['方管', 'ST25mm方管雨棚架BA 2尺', '雨棚'],
    ['方管', '白鐵方管連料 U型', '連料'],
    ['方管', '黑鐵方管 100*6.0', '一般'],
    ['扁方管', '白鐵扁方管 10*20*6M', '一般'],
  ])('prioritizes tube family rules for %s product %s', (category, productName, expected) => {
    expect(inferStructuralSubcategory(category, productName)).toBe(expected);
  });

  it.each([
    ['鐵網的固定片(ST304)', '配件'],
    ['黑鐵點焊鋼絲網', '點焊'],
    ['牛筋網3尺', '牛筋'],
    ['白鐵刀刺網', '刺網'],
    ['鍍鋅高床網', '高床'],
    ['錏浪型網 10# ◇孔', '浪型'],
    ['鍍鋅菱形網', '菱形'],
    ['ST網4尺*100尺', '鐵網'],
    ['PE黃色塑膠安全網', '其他'],
  ])('classifies 網 product %s as %s', (productName, expected) => {
    expect(inferStructuralSubcategory('網', productName)).toBe(expected);
  });

  it.each([
    ['鍍鋅收邊水槽', '五金/收邊'],
    ['鍍鋅格柵板', '格柵/溝蓋'],
    ['黑五溝圍籬', '圍籬'],
    ['錏樓層板 50型', '樓層'],
    ['2.0台PC板透明', 'PC'],
    ['琉璃瓦發泡PU', '琉璃瓦'],
    ['350型壁板 PU', '壁板'],
    ['單面樹脂清板', '樹脂板'],
    ['玻璃FRP', '特殊'],
    ['鍍鋅平板*L', '平板/加工'],
    ['鍍鋅OPP浪板', '浪板/清板'],
  ])('classifies 板/浪板 product %s as %s', (productName, expected) => {
    expect(inferStructuralSubcategory('板/浪板', productName)).toBe(expected);
  });

  it.each([
    ['佑享700KG專用黑鐵格板', '700KG'],
    ['乙元鏈式850KG專用白鐵隔板', '850KG'],
    ['乙元鏈式1 HP專用黑鐵隔板', '1HP'],
    ['添誠白鐵格板 1尺2', '一般'],
  ])('classifies 格板/隔板 product %s as %s', (productName, expected) => {
    expect(inferStructuralSubcategory('格板/隔板', productName)).toBe(expected);
  });

  it.each([
    ['未知', '黑鐵平鐵'],
    ['鐵板', '   '],
  ])('returns undefined for unsupported or empty input', (category, productName) => {
    expect(inferStructuralSubcategory(category, productName)).toBeUndefined();
  });
});
