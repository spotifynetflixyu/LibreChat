import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { exportSteelOAuthFileCapabilityFixtures } from './fixtures-export';

describe('Steel OAuth file capability fixture export', () => {
  it('writes manual smoke files and a manifest to the requested directory', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'steel-oauth-fixtures-'));

    const result = await exportSteelOAuthFileCapabilityFixtures(outputDir);

    expect(result.outputDir).toBe(outputDir);
    expect(result.files.map((file) => file.filename)).toEqual([
      'steel-oauth-smoke.txt',
      'steel-oauth-smoke.pdf',
      'steel-oauth-smoke.docx',
      'steel-oauth-smoke.xlsx',
      'steel-oauth-smoke.png',
      'steel-oauth-smoke-rotated.jpg',
      'manifest.json',
    ]);

    const sizes = await Promise.all(
      result.files.map(async (file) => {
        const stat = await fs.stat(path.join(outputDir, file.filename));
        return stat.size;
      }),
    );
    expect(sizes.every((size) => size > 0)).toBe(true);

    const manifest = JSON.parse(await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    expect(manifest.fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'jpg-rotated',
          filename: 'steel-oauth-smoke-rotated.jpg',
          mediaType: 'image/jpeg',
        }),
      ]),
    );
    expect(JSON.stringify(manifest)).not.toMatch(/access_token|authorization|Bearer|authFile/i);
  });
});
