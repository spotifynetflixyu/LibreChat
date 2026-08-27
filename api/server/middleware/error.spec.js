const mockSaveMessage = jest.fn().mockResolvedValue({});
const mockSendEvent = jest.fn();
const mockHandleError = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('librechat-data-provider', () => ({
  parseConvo: jest.fn((message) => ({ conversationId: message.conversationId })),
}));

jest.mock('@librechat/api', () => ({
  sendEvent: (...args) => mockSendEvent(...args),
  handleError: (...args) => mockHandleError(...args),
  sanitizeMessageForTransmit: jest.fn((message) => message),
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
  getMessages: jest.fn().mockResolvedValue([]),
  getConvo: jest.fn().mockResolvedValue({ conversationId: 'conversation-1' }),
}));

const { sendError } = require('./error');

const req = {
  user: { id: 'user-1' },
  body: {},
  config: {},
};
const res = {};
const baseOptions = {
  user: 'user-1',
  sender: 'AI',
  conversationId: 'conversation-1',
  messageId: 'response-1',
  parentMessageId: 'request-1',
  text: 'partial response',
  shouldSaveMessage: true,
};

describe('sendError processing duration persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unsets a prior duration when saving an unfinished response', async () => {
    await sendError(req, res, { ...baseOptions, error: false, unfinished: true });

    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageId: 'response-1', unfinished: true }),
      expect.objectContaining({ unsetProcessingDurationMs: true }),
    );
  });

  it('does not unset duration metadata for a completed error response', async () => {
    await sendError(req, res, baseOptions);

    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageId: 'response-1', unfinished: false }),
      { context: 'api/server/utils/streamResponse.js - sendError' },
    );
  });
});
