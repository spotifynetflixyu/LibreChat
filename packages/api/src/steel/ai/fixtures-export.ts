import fs from 'fs/promises';
import path from 'path';

import { createSteelOAuthFileCapabilityFixtures } from './fixtures';

export interface SteelOAuthFixtureExportFile {
  filename: string;
  id?: string;
  mediaType?: string;
  path: string;
}

export interface SteelOAuthFixtureExportResult {
  outputDir: string;
  files: SteelOAuthFixtureExportFile[];
}

function toBytes(data: Uint8Array | string | URL): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }

  return new TextEncoder().encode(data.toString());
}

export async function exportSteelOAuthFileCapabilityFixtures(
  outputDir: string,
): Promise<SteelOAuthFixtureExportResult> {
  await fs.mkdir(outputDir, { recursive: true });

  const fixtures = await createSteelOAuthFileCapabilityFixtures();
  const fixtureFiles = await Promise.all(
    fixtures.map(async (fixture) => {
      const outputPath = path.join(outputDir, fixture.file.filename);
      await fs.writeFile(outputPath, toBytes(fixture.file.data));

      return {
        id: fixture.id,
        filename: fixture.file.filename,
        mediaType: fixture.file.mediaType,
        path: outputPath,
      };
    }),
  );
  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        fixtures: fixtureFiles.map(({ id, filename, mediaType }) => ({
          id,
          filename,
          mediaType,
        })),
      },
      null,
      2,
    )}\n`,
  );

  return {
    outputDir,
    files: [
      ...fixtureFiles,
      {
        filename: 'manifest.json',
        path: manifestPath,
      },
    ],
  };
}
