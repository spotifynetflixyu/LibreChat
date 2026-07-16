import os from 'os';
import path from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';

import { loadOpenAIOAuthTokens } from './credentials';

function createJwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${payload}.signature_sensitive`;
}

describe('OpenAI OAuth credential loader', () => {
  it('loads Codex auth.json through the installed local OAuth package', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
    const authFilePath = path.join(tempDir, 'auth.json');
    const accessToken = createJwt(1893456000);

    try {
      await writeFile(
        authFilePath,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            account_id: 'account_test',
            refresh_token: 'refresh_sensitive',
          },
        }),
      );

      await expect(
        loadOpenAIOAuthTokens({
          authFilePath,
          ensureFresh: false,
          fetch: globalThis.fetch,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          accessToken,
          refreshToken: 'refresh_sensitive',
        }),
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
