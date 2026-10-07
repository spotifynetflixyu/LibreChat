import {
  createSteelReviewMessageMutationMiddleware,
  STEEL_REVIEW_MESSAGE_EDIT_ERROR,
} from './messageGuard';

function response() {
  const value = {
    status: jest.fn(),
    json: jest.fn(),
  };
  value.status.mockReturnValue(value);
  return value;
}

describe('Steel review message mutation guard', () => {
  it('requires the typed managed-message checker at factory construction', () => {
    expect(() => createSteelReviewMessageMutationMiddleware(undefined as never)).toThrow(
      'requires an injected mutation checker',
    );
  });

  it('rejects a managed message with the stable conflict response', async () => {
    const checker = jest.fn().mockResolvedValue({ ok: true, value: { managed: true } });
    const middleware = createSteelReviewMessageMutationMiddleware({
      checkSteelReviewMessageMutation: checker,
    });
    const res = response();
    const next = jest.fn();

    await middleware({
      user: { id: 'user-1', tenantId: 'tenant-user' },
      tenantId: 'tenant-request',
      params: { conversationId: 'conversation-1', messageId: 'message-1' },
    } as never, res as never, next);

    expect(checker).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-request',
      conversationId: 'conversation-1',
      messageId: 'message-1',
    });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: STEEL_REVIEW_MESSAGE_EDIT_ERROR });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes an unmanaged message and propagates checker failures', async () => {
    const checker = jest.fn().mockResolvedValue({ ok: true, value: { managed: false } });
    const middleware = createSteelReviewMessageMutationMiddleware({
      checkSteelReviewMessageMutation: checker,
    });
    const res = response();
    const next = jest.fn();
    const request = {
      user: { id: 'user-1' },
      params: { conversationId: 'conversation-1', messageId: 'message-1' },
    };

    await middleware(request as never, res as never, next);
    expect(next).toHaveBeenCalledWith();

    const failure = new Error('query failed');
    checker.mockRejectedValueOnce(failure);
    await middleware(request as never, res as never, next);
    expect(next).toHaveBeenLastCalledWith(failure);
  });

  it('hides unavailable ownership before the legacy message handler', async () => {
    const checker = jest.fn().mockResolvedValue({ ok: false, error: { code: 'REVIEW_NOT_FOUND' } });
    const middleware = createSteelReviewMessageMutationMiddleware({
      checkSteelReviewMessageMutation: checker,
    });
    const res = response();
    const next = jest.fn();

    await middleware({
      user: { id: 'user-1' },
      params: { conversationId: 'conversation-1', messageId: 'message-1' },
    } as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Message not found' });
    expect(next).not.toHaveBeenCalled();
  });
});
