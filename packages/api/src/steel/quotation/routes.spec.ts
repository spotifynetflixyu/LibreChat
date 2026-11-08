import type { Request, Response } from 'express';

import { createQuotationRouteHandlers, quotationStatus } from './routes';
import { createSteelQuotationStateService } from './state';

jest.mock('./state', () => ({
  createSteelQuotationStateService: jest.fn(),
}));

const mockedCreateService = jest.mocked(createSteelQuotationStateService);

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
};

function createResponse(): MockResponse {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockResponse;
  response.status.mockReturnValue(response);
  return response;
}

function createRequest(params: Record<string, string>, userId?: string): Request {
  return {
    params,
    ...(userId !== undefined ? { user: { id: userId } } : {}),
  } as unknown as Request;
}

const activeRun = {
  runId: 'run-1',
  index: 1,
  status: 'running' as const,
  chunks: [
    { index: 1, sourceRowCount: 10, status: 'completed' as const },
    { index: 2, sourceRowCount: 10, status: 'pending' as const },
  ],
  checkpointRefs: [],
};

describe('quotation route handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('projects split quotation progress into durable v2 units', () => {
    const splitRun = {
      ...activeRun,
      chunks: [
        { index: 1, sourceRowCount: 10, status: 'completed' as const },
        { index: 2, sourceRowCount: 23, status: 'pending' as const },
      ],
      checkpointRefs: [
        { operationId: 'split-v2:2:r', kind: 'main' },
        { operationId: 'split-v2:2:r.1', kind: 'main' },
        { operationId: 'leaf-v2:2:r.1.1', kind: 'chunk' },
      ],
    };
    expect(quotationStatus({ activeRun: splitRun } as never, 'conversation-1')).toMatchObject({
      completedChunks: 2,
      totalChunks: 4,
    });
  });

  it('requires authentication and conversation ownership before reading status', async () => {
    const readState = jest.fn();
    mockedCreateService.mockReturnValue({ readState } as never);
    const handlers = createQuotationRouteHandlers({
      ownsConversation: jest.fn().mockResolvedValue(false),
    });

    const unauthenticatedResponse = createResponse();
    await handlers.status(
      createRequest({ conversationId: 'conversation-1' }),
      unauthenticatedResponse,
    );
    expect(unauthenticatedResponse.status).toHaveBeenCalledWith(401);
    expect(readState).not.toHaveBeenCalled();

    const unauthorizedResponse = createResponse();
    await handlers.status(
      createRequest({ conversationId: 'conversation-1' }, 'user-1'),
      unauthorizedResponse,
    );
    expect(unauthorizedResponse.status).toHaveBeenCalledWith(404);
    expect(readState).not.toHaveBeenCalled();
  });
});
