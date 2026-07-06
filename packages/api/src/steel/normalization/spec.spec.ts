import { normalizeSteelSpecKey, normalizeSteelSpecKeyOrUnknown } from './spec';

describe('Steel spec key normalization', () => {
  it('normalizes ERP/product/spec fragments using the importer spec_key rules', () => {
    expect(normalizeSteelSpecKey('DNB70060', '6.0m/m OT板 雷射切割')).toBe(
      'DNB70060_6.0m_mOT板雷射切割',
    );
    expect(normalizeSteelSpecKey('PL6×80', '黑鐵板/OT')).toBe('PL6x80_黑鐵板_OT');
    expect(normalizeSteelSpecKey('  CCG075  ', undefined, '75 × 45 × 15 × 2.3')).toBe(
      'CCG075_75x45x15x2.3',
    );
  });

  it('returns undefined for empty input and keeps importer fallback explicit', () => {
    expect(normalizeSteelSpecKey(undefined, ' ', null)).toBeUndefined();
    expect(normalizeSteelSpecKeyOrUnknown(undefined, ' ', null)).toBe('unknown_spec');
  });
});
