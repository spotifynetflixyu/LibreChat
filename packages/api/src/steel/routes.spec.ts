import { SteelReviewWriteError } from '@librechat/data-schemas';
import type { SteelReviewRecovery } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import { createSteelRouteHandlers } from './routes';

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
  it('reads a scoped review table through the injected service', async () => {
    const reviewService = {
      read: jest.fn(async () => ({ table: { title: 'ocr_result' } })),
    } as unknown as NonNullable<Parameters<typeof createSteelRouteHandlers>[0]['reviewService']>;
    const handlers = createSteelRouteHandlers({ getModelsConfig: jest.fn(), reviewService });
    const req = {
      params: { conversationId: 'conversation-1', kind: 'ocr_result' },
      query: { messageId: 'message-1', title: 'ocr_result' },
      tenantId: 'tenant-1',
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.readReview(req, res);

    expect(reviewService.read).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      title: 'ocr_result',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reads a scoped receipt through the injected service with authenticated context', async () => {
    const reviewService = {
      receipt: jest.fn(async () => ({ status: 'absent' as const })),
    } as unknown as NonNullable<Parameters<typeof createSteelRouteHandlers>[0]['reviewService']>;
    const handlers = createSteelRouteHandlers({ getModelsConfig: jest.fn(), reviewService });
    const req = {
      params: { conversationId: 'conversation-1', kind: 'ocr_result' },
      query: {
        messageId: 'message-1',
        title: 'ocr_result',
        outputId: 'ocr_result:generation-1',
        operationId: 'operation-1',
        digest: 'a'.repeat(64),
      },
      tenantId: 'tenant-1',
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.readReviewReceipt(req, res);

    expect(reviewService.receipt).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      title: 'ocr_result',
      outputId: 'ocr_result:generation-1',
      operationId: 'operation-1',
      digest: 'a'.repeat(64),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('serializes commit recovery details on a real write conflict', async () => {
    const recovery = {
      table: {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        title: 'ocr_result',
        outputId: 'ocr_result:generation-1',
        kind: 'ocr_result',
        revision: 'generation-2',
        latestOutputId: 'ocr_result:generation-1',
        isLatest: true,
        readOnly: false,
        headers: ['數量'],
        rows: [],
        effectiveMarkdown: '| 數量 |\n| --- |\n',
      },
      conflicts: [{
        kind: 'field',
        rowId: 'row-1',
        header: '數量',
        expected: '2',
        current: '7',
        requested: '9',
      }],
    } as SteelReviewRecovery;
    const reviewService = {
      commit: jest.fn(async () => {
        throw new SteelReviewWriteError('REVIEW_CONFLICT', 'Review rows changed', recovery);
      }),
    } as unknown as NonNullable<Parameters<typeof createSteelRouteHandlers>[0]['reviewService']>;
    const handlers = createSteelRouteHandlers({ getModelsConfig: jest.fn(), reviewService });
    const req = {
      params: { conversationId: 'conversation-1', kind: 'ocr_result' },
      body: { operationId: 'operation-1' },
      tenantId: 'tenant-1',
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = createResponse();

    await handlers.commitReview(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Review rows changed',
      code: 'REVIEW_CONFLICT',
      recovery,
    });
  });

  it('lists the preserved Steel model options', async () => {
    const getModelsConfig = jest.fn(async () => ({ openAI: ['gpt-5.6-luna', 'gpt-5.5'] }));
    const handlers = createSteelRouteHandlers({ getModelsConfig });
    const req = {
      config: {
        modelSpecs: {
          list: [
            {
              name: 'steel-default',
              default: true,
              preset: { endpoint: 'openAI', model: 'gpt-5.6-luna' },
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
      options: [expect.objectContaining({ model: 'gpt-5.6-luna', defaultForSteel: true })],
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
