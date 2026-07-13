import { inferCatalogSubcategory } from './catalog';

describe('inferCatalogSubcategory', () => {
  it('classifies fasteners from hardware product names', () => {
    expect(inferCatalogSubcategory('五金/配件', '白鐵六角螺絲 3/8')).toBe('緊固/錨固');
    expect(inferCatalogSubcategory('五金/配件', '百葉窗用銅鏍絲')).toBe('螺絲');
  });

  it.each([
    ['穴丸鋸(彈簧) 20mm', '切削/鑽孔/研磨'],
    ['黑電焊彎頭90度 25mm', '管件'],
    ['植筋膠 PEA300', '膠黏/密封'],
    ['白鐵扶手蓋+華司 25mm', '扶手/欄杆'],
    ['優力剎車輪 4吋', '輪具'],
  ])('uses hardware priority rules for %s', (productName, expected) => {
    expect(inferCatalogSubcategory('五金/配件', productName)).toBe(expected);
  });

  it.each([
    ['ST紗網角雙槽', '紗網'],
    ['YBU隱藏式四段鎖', '鎖具'],
    ['白鐵隱藏天地串', '天地串'],
    ['鋁合金擋水板的底部橡膠', '擋水'],
    ['虹龍鋁窗 3尺6', '成品窗/百葉'],
    ['中式 AU 型門花', '門花'],
    ['銀行 43 號花格', '花格/防盜'],
  ])('classifies door and window catalogs from %s', (productName, expected) => {
    expect(inferCatalogSubcategory('門窗/門板', productName)).toBe(expected);
  });

  it.each([
    ['BT-520 遙控器+氣動主機', '遙控'],
    ['格來得捲門馬達加控制箱', '馬達/控制'],
    ['鋁合金擋水分樘中柱', '中柱'],
    ['伸縮門 ST 花格框', '伸縮門'],
    ['格來得捲門三角架', '捲門五金'],
    ['烤漆 75 型電動門片', '門片/簾片'],
  ])('classifies rolling-door catalogs from %s', (productName, expected) => {
    expect(inferCatalogSubcategory('捲門/伸縮門', productName)).toBe(expected);
  });

  it.each([
    ['另加百葉', '百葉'],
    ['300扁鐵白鐵伸縮(最小30才)', '伸縮門'],
    ['601台揚白鐵消音典雅型', '門片/簾片'],
  ])('classifies AX rolling-door product %s as %s', (productName, expected) => {
    expect(inferCatalogSubcategory('捲門/伸縮門', productName)).toBe(expected);
  });

  it('prioritizes a louver window over a no-screen usage phrase', () => {
    expect(inferCatalogSubcategory('門窗/門板', '牙白色/活動式鋁百葉(無紗網)')).toBe('成品窗/百葉');
  });

  it.each([
    ['預定料-訂單號碼-11307', '訂單/價差'],
    ['租借場地--', '服務/租借'],
    ['蜂巢紙 38x1000', '包裝/保護'],
    ['白鐵活動曬衣架', '家用/成品'],
    ['電焊皮手套(沒現貨)', '勞安'],
    ['金屬保護油(牛油)防鏽油', '油品/化學'],
    ['烤手 60 型 0.8', '門窗/捲門'],
    ['快速鑽孔兼鎖螺絲大六角', '工具/加工'],
    ['扁中式5-8電解(3才)', '門窗/捲門'],
  ])('classifies miscellaneous catalogs from %s', (productName, expected) => {
    expect(inferCatalogSubcategory('其他', productName)).toBe(expected);
  });

  it.each([
    ['H型鋼', '白鐵六角螺絲 3/8'],
    ['門窗/門板', ''],
  ])('returns undefined for unsupported or empty catalogs', (category, productName) => {
    expect(inferCatalogSubcategory(category, productName)).toBeUndefined();
  });

  it.each([
    ['其他', '色帶 LQ680'],
    ['五金/配件', '零件'],
  ])('uses a concise fallback for supported catalogs', (category, productName) => {
    expect(inferCatalogSubcategory(category, productName)).toBe('其他');
  });
});
