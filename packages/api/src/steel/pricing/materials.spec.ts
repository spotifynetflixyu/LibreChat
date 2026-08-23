import {
  getSteelPriceAvailableMaterials,
  getSteelPriceAvailableWhiteSteelSurfaces,
  getSteelPriceCommonMaterials,
  getSteelPriceCommonWhiteSteelSurfaces,
  getSteelPriceDefaultWhiteSteelSurface,
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

  it('selects preferred defaults from available surfaces and omits empty defaults', () => {
    expect(getSteelPriceDefaultWhiteSteelSurface(['ST', '2B', 'BA'])).toBe('2B');
    expect(getSteelPriceDefaultWhiteSteelSurface(['ST', 'BA'])).toBe('ST');
    expect(getSteelPriceDefaultWhiteSteelSurface(['NO1', 'HL', 'BA'])).toBe('NO1');
    expect(getSteelPriceDefaultWhiteSteelSurface(['HL', 'BA'])).toBe('HL');
    expect(getSteelPriceDefaultWhiteSteelSurface(['BA'])).toBe('BA');
    expect(getSteelPriceDefaultWhiteSteelSurface([])).toBeUndefined();
    expect(getSteelPriceMaterialCatalog('鐵板').defaultWhiteSteelSurface).toBe('2B');
    expect(getSteelPriceMaterialCatalog('方管').defaultWhiteSteelSurface).toBe('ST');
    expect(getSteelPriceMaterialCatalog('角鐵').defaultWhiteSteelSurface).toBe('2B');
    expect(getSteelPriceMaterialCatalog('H型鋼')).not.toHaveProperty('defaultWhiteSteelSurface');

    Object.values(steelPriceMaterialCatalog).forEach((entry) => {
      if (entry.availableMaterials.includes('白鐵')) {
        expect(entry.availableWhiteSteelSurfaces.length).toBeGreaterThan(0);
        expect(entry.defaultWhiteSteelSurface).toBeDefined();
      }
      if (entry.availableWhiteSteelSurfaces.length === 0) {
        expect(entry).not.toHaveProperty('defaultWhiteSteelSurface');
        return;
      }
      expect(entry.defaultWhiteSteelSurface).toBeDefined();
      expect(entry.availableWhiteSteelSurfaces).toContain(entry.defaultWhiteSteelSurface);
    });
  });
});
