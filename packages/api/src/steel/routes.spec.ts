import { createSteelRouteHandlers } from './routes';

import type { Request, Response } from 'express';

function createResponse() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
}

describe('Steel production route handlers', () => {
  it('lists the preserved Steel model options', async () => {
    const getModelsConfig = jest.fn(async () => ({ openAI: ['gpt-5.5', 'gpt-5.4'] }));
    const handlers = createSteelRouteHandlers({ getModelsConfig });
    const req = {
      config: {
        modelSpecs: {
          list: [
            {
              name: 'steel-default',
              default: true,
              preset: { endpoint: 'openAI', model: 'gpt-5.5' },
            },
          ],
        },
      },
    } as unknown as Request;
    const res = createResponse();

    await handlers.listModels(req, res);

    expect(getModelsConfig).toHaveBeenCalledWith(req);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      options: [expect.objectContaining({ model: 'gpt-5.5', defaultForSteel: true })],
    });
  });

  it('reads OAuth usage from the configured auth file', async () => {
    const getOpenAIOAuthUsageRemaining = jest.fn(async () => ({
      provider: 'openai_oauth_responses' as const,
      source: 'chatgpt_wham_usage' as const,
      status: 'available' as const,
      fetchedAt: '2026-07-15T00:00:00.000Z',
      windows: [],
    }));
    const handlers = createSteelRouteHandlers({
      env: { OPENAI_OAUTH_AUTH_FILE: '/tmp/steel-auth.json' },
      getModelsConfig: jest.fn(),
      getOpenAIOAuthUsageRemaining,
    });
    const res = createResponse();

    await handlers.readOpenAIOAuthUsage({} as Request, res);

    expect(getOpenAIOAuthUsageRemaining).toHaveBeenCalledWith({
      authFilePath: '/tmp/steel-auth.json',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'available' }));
  });

  it('passes authenticated rule proposals to the preserved service', async () => {
    const result = { id: 'proposal-1', status: 'needs_review' };
    const ruleProposalService = {
      create: jest.fn(async () => result),
    } as unknown as NonNullable<
      Parameters<typeof createSteelRouteHandlers>[0]['ruleProposalService']
    >;
    const handlers = createSteelRouteHandlers({
      getModelsConfig: jest.fn(),
      ruleProposalService,
    });
    const req = {
      body: { proposalType: 'customer_default' },
      user: { id: 'user-1', role: 'USER' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.createRuleProposal(req, res);

    expect(ruleProposalService.create).toHaveBeenCalledWith({
      body: req.body,
      user: { id: 'user-1', role: 'USER' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(result);
  });
});
