import { parseSteelOpenAIConfig, resolveSteelOpenAIOAuthAuthFilePath } from './config';
import { sendSteelOAuthChat } from './provider';

const runRealAuth = process.env.STEEL_OPENAI_OAUTH_REAL_AUTH_TEST === 'true';
const describeRealAuth = runRealAuth ? describe : describe.skip;

describeRealAuth('Steel OpenAI OAuth provider real auth smoke', () => {
  it('gets a deterministic response without exposing auth material', async () => {
    const config = parseSteelOpenAIConfig(process.env);
    const expected = 'librechat-steel-oauth-live-ok';
    const authFilePath = resolveSteelOpenAIOAuthAuthFilePath(process.env);

    const response = await sendSteelOAuthChat({
      authFilePath,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      messages: [{ role: 'user', content: `Reply exactly: ${expected}` }],
    });

    expect(response.text.trim()).toBe(expected);
    expect(response.provider).toBe('openai_oauth_responses');
    expect(response.model).toBe(config.model);
    expect(JSON.stringify(response)).not.toMatch(/access_token|authorization|Bearer|authFile/i);
  }, 60000);
});
