import type { Request, Response } from 'express';

import { createQuotationRouteHandlers } from './routes';
import { createSteelQuotationStateService } from './state';
import { abortQuotationExecution } from './control';

jest.mock('./state', () => ({
  createSteelQuotationStateService: jest.fn(),
}));

jest.mock('./control', () => ({
  abortQuotationExecution: jest.fn(),
}));

const mockedCreateService = jest.mocked(createSteelQuotationStateService);
const mockedAbortQuotationExecution = jest.mocked(abortQuotationExecution);

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
  chunks: [{ status: 'completed' as const }, { status: 'pending' as const }],
};

describe('quotation route handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('rejects a stale quotation index without cancelling the active run', async () => {
    const readState = jest.fn().mockResolvedValue({ activeRun });
    const cancelRun = jest.fn();
    mockedCreateService.mockReturnValue({ readState, cancelRun } as never);
    const handlers = createQuotationRouteHandlers({
      ownsConversation: jest.fn().mockResolvedValue(true),
    });
    const response = createResponse();

    await handlers.cancel(
      createRequest({ conversationId: 'conversation-1', index: '2' }, 'user-1'),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ message: 'Quotation has changed' });
    expect(cancelRun).not.toHaveBeenCalled();
    expect(mockedAbortQuotationExecution).not.toHaveBeenCalled();
  });

  it('returns the completed result when completion wins a cancellation race', async () => {
    const completedRun = { ...activeRun, status: 'completed' as const };
    const readState = jest
      .fn()
      .mockResolvedValueOnce({ activeRun })
      .mockResolvedValueOnce({ activeRun: completedRun });
    const cancelRun = jest.fn().mockResolvedValue(completedRun);
    mockedCreateService.mockReturnValue({ readState, cancelRun } as never);
    const handlers = createQuotationRouteHandlers({
      ownsConversation: jest.fn().mockResolvedValue(true),
    });
    const response = createResponse();

    await handlers.cancel(
      createRequest({ conversationId: 'conversation-1', index: '1' }, 'user-1'),
      response,
    );

    expect(cancelRun).toHaveBeenCalledWith({
      scope: { userId: 'user-1', conversationId: 'conversation-1' },
      runId: 'run-1',
    });
    expect(response.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      index: 1,
      runId: 'run-1',
      status: 'completed',
      completedChunks: 1,
      totalChunks: 2,
      canCancel: false,
    });
  });
});
