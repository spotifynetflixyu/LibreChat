import { createSteelOAuthFileCapabilityFixtures } from './fixtures';

describe('Steel OAuth file capability fixtures', () => {
  it('generates non-secret file fixtures for text, documents, spreadsheets, and PNG only', async () => {
    const fixtures = await createSteelOAuthFileCapabilityFixtures();

    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      'txt',
      'pdf',
      'docx',
      'xlsx',
      'png',
      'jpg-rotated',
    ]);
    expect(fixtures.map((fixture) => fixture.file.filename)).toEqual([
      'steel-oauth-smoke.txt',
      'steel-oauth-smoke.pdf',
      'steel-oauth-smoke.docx',
      'steel-oauth-smoke.xlsx',
      'steel-oauth-smoke.png',
      'steel-oauth-smoke-rotated.jpg',
    ]);
    expect(fixtures.map((fixture) => fixture.expected)).toEqual(
      fixtures.map(() =>
        expect.objectContaining({
          english: 'Steel OAuth capability smoke',
          chinese: '鋼鐵檔案測試',
          number: '73921',
        }),
      ),
    );
    expect(fixtures.some((fixture) => fixture.file.filename === 'steel-oauth-smoke.jpg')).toBe(
      false,
    );
    expect(fixtures.find((fixture) => fixture.id === 'jpg-rotated')?.file.mediaType).toBe(
      'image/jpeg',
    );
    expect(JSON.stringify(fixtures)).not.toMatch(/access_token|authorization|Bearer|authFile/i);
  });
});
