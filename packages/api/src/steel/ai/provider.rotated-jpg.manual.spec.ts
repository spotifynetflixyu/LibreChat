import { createSteelOAuthFileCapabilityFixtures } from './fixtures';
import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';

import type { SteelOAuthFileCapabilityExpected } from './fixtures';

const runRotatedJpg = process.env.STEEL_OPENAI_OAUTH_ROTATED_JPG_TEST === 'true';
const describeRotatedJpg = runRotatedJpg ? describe : describe.skip;
const caseTimeoutMs = Number(process.env.STEEL_OPENAI_OAUTH_FILE_CASE_TIMEOUT_MS ?? 90000);

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findMissingExpectedValues(text: string, expected: SteelOAuthFileCapabilityExpected) {
  const normalized = normalize(text);
  const checks = [
    ['sentinel', expected.sentinel],
    ['english', expected.english],
    ['chinese', expected.chinese],
    ['number', expected.number],
  ] as const;

  return checks
    .filter(([, value]) => !normalized.includes(value.toLowerCase()))
    .map(([field]) => field);
}

describeRotatedJpg('Steel OpenAI OAuth provider rotated JPG capability smoke', () => {
  it(
    'extracts English, Chinese, numeric, and sentinel text from a 90-degree rotated JPG',
    async () => {
      const config = parseSteelOpenAIConfig(process.env);
      const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
      const fixture = (await createSteelOAuthFileCapabilityFixtures()).find(
        (candidate) => candidate.id === 'jpg-rotated',
      );
      if (fixture == null) {
        throw new Error('Missing rotated JPG fixture');
      }
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), caseTimeoutMs);

      try {
        const response = await sendSteelOAuthChat({
          abortSignal: abortController.signal,
          authFilePath,
          model: config.model,
          passThroughUnsupportedFiles: true,
          reasoningEffort: config.reasoningEffort,
          messages: [
            {
              role: 'user',
              content:
                'Read the attached 90-degree rotated JPG. Return only the exact Sentinel, English, Chinese, and Number values you find in the image. Do not infer values from the filename.',
              files: [fixture.file],
            },
          ],
        });
        const missing = findMissingExpectedValues(response.text, fixture.expected);
        const result = { id: fixture.id, missing, text: response.text };

        expect(result).toEqual({
          id: fixture.id,
          missing: [],
          text: expect.any(String),
        });
        expect(JSON.stringify(result)).not.toMatch(/access_token|authorization|Bearer|authFile/i);
      } finally {
        clearTimeout(timeout);
      }
    },
    caseTimeoutMs + 10000,
  );
});
