import { createSteelOAuthFileCapabilityFixtures } from './fixtures';
import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';

import type { SteelOAuthFileCapabilityExpected } from './fixtures';

const runFileCapability = process.env.STEEL_OPENAI_OAUTH_FILE_CAPABILITY_TEST === 'true';
const describeFileCapability = runFileCapability ? describe : describe.skip;
const fixtureIds = ['txt', 'pdf', 'docx', 'xlsx', 'png'] as const;
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

describeFileCapability('Steel OpenAI OAuth provider file capability smoke', () => {
  it.each(fixtureIds)(
    'extracts English, Chinese, numeric, and sentinel text from %s fixture',
    async (fixtureId) => {
      const config = parseSteelOpenAIConfig(process.env);
      const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);
      const fixture = (await createSteelOAuthFileCapabilityFixtures()).find(
        (candidate) => candidate.id === fixtureId,
      );
      if (fixture == null) {
        throw new Error(`Missing fixture ${fixtureId}`);
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
                'Read the attached file. Return only the exact Sentinel, English, Chinese, and Number values you find in the file. Do not infer values from the filename.',
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
