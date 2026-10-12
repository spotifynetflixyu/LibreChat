import { logger } from '@librechat/data-schemas';
import type { SteelQuotationSavedMessage } from '@librechat/data-schemas';
import type { SteelQuotationPublicationContentPart } from './publication';
import { createSteelQuotationMessageNotifier, createSteelQuotationTextWiring, projectSteelQuotationTerminalMessage } from './wiring';

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

it('projects canonical terminal identity without putting the backend table or footer into the main snapshot', () => {
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
  expect(result.text).toBe('primary partial main prose');
  expect(result.unfinished).toBe(true);
  expect(JSON.stringify(result.content)).not.toContain('system_order');
  expect(saved.content?.[1]).toEqual({ type: 'text', text: '## system_order\n\ntable' });
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
