import { logger } from '@librechat/data-schemas';
import type { SteelQuotationSavedMessage } from '@librechat/data-schemas';
import type { SteelQuotationPublicationContentPart } from './publication';
import { createSteelQuotationMessageNotifier, createSteelQuotationTextWiring, projectSteelQuotationTerminalMessage, createSteelQuotationFailurePersistence, isQuotationPreparationTurn } from './wiring';

const publication = {
  version: 1,
  runId: 'quote-run',
  outputId: 'system_order:quote-run',
  sourceMessageId: 'response',
  receiptSha256: 'a'.repeat(64),
  admissionSequence: 1,
  tableContentIndex: 1,
  summaryContentIndex: 2,
  footerContentIndex: 3,
};
const scope = { userId: 'user', conversationId: 'conversation' };
it('enables signal handoff only for ordinary scoped quotation preparation', () => {
  const context = { quotation: { scope, resume: false } };
  expect(isQuotationPreparationTurn(context)).toBe(true);
  expect(isQuotationPreparationTurn(undefined)).toBe(false);
  expect(isQuotationPreparationTurn({})).toBe(false);
  expect(isQuotationPreparationTurn({ quotation: { scope, resume: true } })).toBe(false);
  expect(isQuotationPreparationTurn({ ...context, ocrTurnActive: true })).toBe(false);
  expect(isQuotationPreparationTurn(context, { runId: 'ocr-resume' })).toBe(false);
});
const saved: SteelQuotationSavedMessage = {
  messageId: 'response',
  conversationId: scope.conversationId,
  user: scope.userId,
  text: 'primary\n\n## system_order\n\ntable',
  metadata: { steelQuotation: publication },
  content: [
    { type: 'text', text: 'primary' },
    { type: 'text', text: '## system_order\n\ntable' },
    { type: 'text', text: '' },
    { type: 'text', text: '' },
  ],
};

afterEach(() => jest.restoreAllMocks());

describe('quotation failure persistence', () => {
  const quotation = { scope, publicationAdmission: { sequence: 1, responseId: 'response', generationId: 'generation', lineageId: 'lineage', expected: {} } };
  it('leaves ordinary chat persistence with its common appender', () => {
    expect(createSteelQuotationFailurePersistence({ req: {}, getMessages: jest.fn(), append: jest.fn() })).toEqual({});
  });
  it('appends the safe failure through the validated quotation writer', async () => {
    const getMessages = jest.fn().mockResolvedValue([saved]);
    const append = jest.fn().mockResolvedValue({ ok: true, message: saved });
    const persistence = createSteelQuotationFailurePersistence({ req: { steelNativeContext: { quotation } }, responseId: 'response', getMessages, append });
    expect(await persistence.preservePublished?.()).toBe(true);
    expect(getMessages).toHaveBeenCalledWith({ user: 'user', conversationId: 'conversation', 'metadata.steelQuotation.sourceMessageId': 'response' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ runId: 'quote-run', targetMessageId: 'response', errors: [{ type: 'error', error: 'An error occurred while processing the request' }] }));
    expect(await persistence.appendError?.({ user: 'user', conversationId: 'conversation', parentMessageId: 'parent', messageId: 'response', error: 'safe' })).toBeNull();
  });
  it('does not bypass validation when quotation persistence rejects the identity', async () => {
    const append = jest.fn().mockResolvedValue({ ok: false, reason: 'superseded' });
    const persistence = createSteelQuotationFailurePersistence({ req: { steelNativeContext: { quotation } }, responseId: 'response', getMessages: jest.fn().mockResolvedValue([saved]), append });
    await expect(persistence.preservePublished?.()).rejects.toThrow();
  });
});

it('transmits the complete durable message without clearing its table or footer', () => {
  const response = {
    ...saved,
    messageId: 'raw-response',
    unfinished: true,
    content: [
      { type: 'text', text: 'primary' },
      { type: 'text', text: '' },
      { type: 'text', text: 'partial main prose' },
      { type: 'text', text: '' },
    ],
  };
  const result = projectSteelQuotationTerminalMessage({ response, saved });
  expect(result.messageId).toBe('response');
  expect(result.text).toBe(saved.text);
  expect(result.content).toEqual(saved.content);
  expect(result.unfinished).toBe(true);
  expect(JSON.stringify(result.content)).toContain('system_order');
  expect(saved.content?.[1]).toEqual({ type: 'text', text: '## system_order\n\ntable' });
});

it('projects an errored terminal with the complete saved quotation and deduplicated errors', () => {
  const savedWithSummary: SteelQuotationSavedMessage = {
    ...saved,
    text: 'primary\n\n## system_order\n\ntable\n\nMain summary\n\nFooter',
    content: [
      { type: 'text', text: 'primary' },
      { type: 'text', text: '## system_order\n\ntable' },
      { type: 'text', text: 'Main summary' },
      { type: 'text', text: 'Footer' },
      { type: 'error', error: 'already persisted' },
      { type: 'error', error: 'new failure' },
    ],
  };
  const response = {
    ...saved,
    content: [
      { type: 'text', text: 'primary' },
      { type: 'text', text: '' },
      { type: 'text', text: 'Main summary' },
      { type: 'text', text: 'Footer' },
      { type: 'error', error: 'already persisted' },
      { type: 'error', error: 'new failure' },
    ],
  };
  const result = projectSteelQuotationTerminalMessage({ response, saved: savedWithSummary });
  expect(result.content).toEqual([
    { type: 'text', text: 'primary' },
    { type: 'text', text: '## system_order\n\ntable' },
    { type: 'text', text: 'Main summary' },
    { type: 'text', text: 'Footer' },
    { type: 'error', error: 'already persisted' },
    { type: 'error', error: 'new failure' },
  ]);
  expect(result.content?.filter((part) => part != null && typeof part === 'object' &&
    'type' in part && part.type === 'error')).toHaveLength(2);
  expect(result.text).toContain('## system_order\n\ntable');
  expect(result.text).toContain('Footer');
});

it('reserves the committed summary slot without copying the backend table into the AI buffer', async () => {
  const contentParts: SteelQuotationPublicationContentPart[] = [{ type: 'text', text: 'primary' }];
  const step = jest.fn(async () => undefined);
  const wiring = createSteelQuotationTextWiring({
    responseId: 'response', conversationId: scope.conversationId, contentParts,
    stepHandler: { handle: step },
    buildMessageFields: () => ({ sourceMessageId: 'response', conversationId: scope.conversationId, user: scope.userId }),
  });
  wiring.onCommittedMessage(saved);
  await wiring.onText('Main summary');
  expect(contentParts).toEqual([
    { type: 'text', text: 'primary' },
    { type: 'text', text: '' },
    { type: 'text', text: 'Main summary' },
    { type: 'text', text: '' },
  ]);
  expect(step).toHaveBeenCalledWith('on_run_step', expect.objectContaining({ index: 2 }), expect.any(Object));
});

it('resets only the streamed summary slot and never the published system_order', async () => {
  const contentParts: SteelQuotationPublicationContentPart[] = [
    { type: 'text', text: 'primary' },
    { type: 'text', text: '## system_order\n\ntable' },
  ];
  const reset = jest.fn(async () => undefined);
  const wiring = createSteelQuotationTextWiring({
    responseId: 'response', conversationId: scope.conversationId, contentParts,
    stepHandler: { handle: jest.fn(async () => undefined) },
    resetHandler: { handle: reset },
    buildMessageFields: () => ({ sourceMessageId: 'response', conversationId: scope.conversationId, user: scope.userId }),
  });
  await wiring.onTextReset();
  expect(reset).not.toHaveBeenCalled();

  wiring.onCommittedMessage(saved);
  await wiring.onText('一半的總結');
  await wiring.onTextReset();

  expect(reset).toHaveBeenCalledWith('on_steel_content_reset', { id: 'quotation:response' }, expect.any(Object));
  const local = createSteelQuotationTextWiring({
    responseId: 'response', conversationId: scope.conversationId, contentParts,
    buildMessageFields: () => ({ sourceMessageId: 'response', conversationId: scope.conversationId, user: scope.userId }),
  });
  local.onCommittedMessage(saved);
  await local.onText('一半的總結');
  await local.onTextReset();
  expect(contentParts[1]).toEqual({ type: 'text', text: '## system_order\n\ntable' });
  expect(contentParts[2]).toEqual({ type: 'text', text: '' });
});

it('publishes the actual committed message through a separate ordered event', async () => {
  const emit = jest.fn(async () => undefined);
  const adopt = jest.fn();
  const notify = createSteelQuotationMessageNotifier({ scope, responseId: 'response', emit, onCommittedMessage: adopt });
  await notify(saved, 'order');
  expect(adopt).toHaveBeenCalledWith(saved);
  expect(emit).toHaveBeenCalledWith({ event: 'steel_message_update', data: { message: saved, publication, update: 'order' } });
  expect(adopt.mock.invocationCallOrder[0]).toBeLessThan(emit.mock.invocationCallOrder[0]);
});

it('binds main deltas to the committed target when a resumed response has a new source identity', async () => {
  const step = jest.fn(async () => undefined);
  const delta = jest.fn(async () => undefined);
  const wiring = createSteelQuotationTextWiring({
    responseId: 'resumed-response', conversationId: scope.conversationId, contentParts: [],
    stepHandler: { handle: step }, deltaHandler: { handle: delta },
    buildMessageFields: () => ({ sourceMessageId: 'resumed-response', conversationId: scope.conversationId, user: scope.userId }),
  });
  wiring.onCommittedMessage(saved);
  await wiring.onText('Main prose');
  expect(step).toHaveBeenCalledWith('on_run_step', expect.objectContaining({
    runId: saved.messageId,
    index: publication.summaryContentIndex,
    stepDetails: expect.objectContaining({ message_creation: { message_id: saved.messageId } }),
  }), expect.objectContaining({ run_id: saved.messageId }));
  expect(delta).toHaveBeenCalledWith('on_message_delta', expect.objectContaining({
    delta: { content: [{ type: 'text', text: 'Main prose' }] },
  }), expect.objectContaining({ run_id: saved.messageId }));
});

it('does not emit a foreign conversation or propagate a notification failure after commit', async () => {
  const log = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  const emit = jest.fn(async () => { throw new Error('stream disconnected'); });
  const notify = createSteelQuotationMessageNotifier({ scope, responseId: 'response', emit });
  await notify({ ...saved, conversationId: 'foreign' }, 'order');
  expect(emit).not.toHaveBeenCalled();
  await expect(notify(saved, 'order')).resolves.toBeUndefined();
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining('"code":null,"message":"stream disconnected","conversationId":"conversation","responseId":"response"'));
});
