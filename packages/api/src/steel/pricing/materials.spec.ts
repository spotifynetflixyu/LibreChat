import {
  getSteelPriceAvailableMaterials,
  getSteelPriceAvailableWhiteSteelSurfaces,
  getSteelPriceCommonMaterials,
  getSteelPriceCommonWhiteSteelSurfaces,
  getSteelPriceDefaultMaterial,
  getSteelPriceMaterialCatalog,
  steelPriceMaterialCatalog,
  normalizeSteelPriceMaterialFamily,
  normalizeSteelPriceWhiteSteelSurface,
} from './materials';

describe('Steel price material catalog', () => {
  it('uses category defaults and family-only material lists', () => {
    expect(getSteelPriceDefaultMaterial('C型鋼')).toBe('錏');
    expect(getSteelPriceDefaultMaterial('鐵板')).toBe('黑鐵');
    expect(getSteelPriceAvailableMaterials(['鐵板'])).toEqual(['黑鐵', '白鐵', '錏']);
    expect(getSteelPriceAvailableMaterials(['其他', 'C型鋼'])).toEqual([
      '黑鐵',
      '白鐵',
      '錏',
    ]);
    expect(getSteelPriceAvailableMaterials(['鐵板'])).not.toEqual(
      expect.arrayContaining(['BA', '2B', 'NO1', 'HL']),
    );
    expect(steelPriceMaterialCatalog).not.toHaveProperty('加工/切工');
    expect(() => getSteelPriceMaterialCatalog('加工/切工')).toThrow(
      'does not include processing category',
    );
  });

  it('maps OT, surfaces, and plating labels to canonical families', () => {
    expect(normalizeSteelPriceMaterialFamily('OT')).toBe('黑鐵');
    expect(normalizeSteelPriceMaterialFamily('BA')).toBe('白鐵');
    expect(normalizeSteelPriceMaterialFamily('鍍鋅')).toBe('錏');
    expect(normalizeSteelPriceWhiteSteelSurface('白鐵')).toBe('2B');
    expect(normalizeSteelPriceWhiteSteelSurface('STHL')).toBe('HL');
    expect(getSteelPriceMaterialCatalog('鐵板').availableWhiteSteelSurfaces).toEqual([
      'ST',
      '2B',
      'NO1',
      'HL',
      'BA',
    ]);
    expect(getSteelPriceAvailableWhiteSteelSurfaces(['方管', '鐵板'])).toEqual([
      'ST',
      '2B',
      'NO1',
      'HL',
      'BA',
    ]);
    expect(getSteelPriceCommonMaterials(['H型鋼', '鐵板'])).toEqual(['黑鐵']);
    expect(getSteelPriceCommonWhiteSteelSurfaces(['方管', '鐵板'])).toEqual([
      'ST',
      'BA',
    ]);
  });
});
