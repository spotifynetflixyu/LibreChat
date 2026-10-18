import { createHash, webcrypto } from 'crypto';
import type { SteelReviewPrepared, SteelReviewTable, TMessage } from 'librechat-data-provider';
import type { SteelReviewCapturedAuthority, SteelReviewSelection } from './state';
import {
  isLiveCapture,
  isCurrentOwner,
  sameSteelReviewScope,
  isCapturedSessionActive,
  isAuthorizedCurrentTable,
  isCurrentCapturedSession,
  isCapturedAuthorityForPrepared,
  canApplySteelReviewMessageSnapshot,
} from './authority';

const identity = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  kind: 'ocr_result' as const,
  title: 'ocr_result',
};

const table: SteelReviewTable = {
  ...identity,
  outputId: 'ocr_result:generation-1',
  revision: 'generation-1',
  latestOutputId: 'ocr_result:generation-1',
  isLatest: true,
  readOnly: false,
  headers: ['數量'],
  rows: [],
};

const prepared = {
  ...identity,
  outputId: table.outputId,
  revision: table.revision,
  messageSha256: 'a'.repeat(64),
} as SteelReviewPrepared;

const authority: SteelReviewCapturedAuthority = {
  outputId: table.outputId,
  revision: table.revision,
  table,
};

const selection: SteelReviewSelection = { ...identity, captureId: 'capture-1' };

/** Each identity field a review owner, prepared operation, or selection is scoped by. */
const foreignIdentityFields = [
  ['conversationId', 'conversation-foreign'],
  ['messageId', 'message-foreign'],
  ['kind', 'system_order'],
  ['title', 'table-foreign'],
] as const;

describe('Steel review scope predicates', () => {
  it('accepts the owner, operation, and selection of one review', () => {
    expect(sameSteelReviewScope(table, prepared)).toBe(true);
    expect(isCapturedAuthorityForPrepared(authority, prepared)).toBe(true);
    expect(isCurrentCapturedSession(selection, identity, authority, authority)).toBe(true);
    expect(isCapturedSessionActive(selection, identity, authority, prepared)).toBe(true);
    expect(isAuthorizedCurrentTable(table, prepared)).toBe(true);
    expect(isCurrentOwner(table, table)).toBe(true);
    expect(isLiveCapture(selection, 'capture-1', identity)).toBe(true);
  });

  it.each(foreignIdentityFields)('rejects a review with a different %s', (field, value) => {
    const foreignTable = { ...table, [field]: value };
    const foreignAuthority = { ...authority, table: foreignTable };
    const foreignSelection = { ...selection, [field]: value };

    expect(sameSteelReviewScope(foreignTable, prepared)).toBe(false);
    expect(isCapturedAuthorityForPrepared(foreignAuthority, prepared)).toBe(false);
    expect(isCurrentCapturedSession(selection, identity, foreignAuthority, authority)).toBe(false);
    expect(isCurrentCapturedSession(foreignSelection, identity, authority, authority)).toBe(false);
    expect(isCapturedSessionActive(selection, identity, foreignAuthority, prepared)).toBe(false);
    expect(isCapturedSessionActive(foreignSelection, identity, authority, prepared)).toBe(false);
    expect(isAuthorizedCurrentTable(foreignTable, prepared)).toBe(false);
    expect(isCurrentOwner(foreignTable, table)).toBe(false);
    expect(isLiveCapture(foreignSelection, 'capture-1', identity)).toBe(false);
  });

  it('rejects a captured authority for a different output', () => {
    const regenerated = { ...authority, outputId: 'ocr_result:generation-2' };

    expect(isCapturedAuthorityForPrepared(regenerated, prepared)).toBe(false);
    expect(isCurrentCapturedSession(selection, identity, regenerated, authority)).toBe(false);
    expect(isCapturedAuthorityForPrepared(undefined, prepared)).toBe(false);
  });

  it.each([
    ['a newer latest output', { latestOutputId: 'ocr_result:generation-2' }],
    ['a previous version', { isLatest: false }],
  ])('does not authorize the prepared operation against %s', (_label, change) => {
    expect(isAuthorizedCurrentTable({ ...table, ...change }, prepared)).toBe(false);
  });

  it('treats a saved revision as a different owner', () => {
    expect(isCurrentOwner({ ...table, revision: 'generation-1-save-1' }, table)).toBe(false);
    expect(isCurrentOwner(undefined, table)).toBe(false);
  });

  it('rejects a selection that belongs to another capture', () => {
    expect(isLiveCapture(selection, 'capture-2', identity)).toBe(false);
    expect(isLiveCapture(null, 'capture-1', identity)).toBe(false);
  });
});

describe('canApplySteelReviewMessageSnapshot', () => {
  const snapshot = { messageId: 'message-1', messageText: 'saved text' };
  const message = (text: string) => ({ messageId: 'message-1', text }) as TMessage;

  const jsdomCrypto = globalThis.crypto;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: jsdomCrypto });
  });

  it('applies when no messages are cached or the message already shows the saved text', async () => {
    await expect(canApplySteelReviewMessageSnapshot(undefined, prepared, snapshot)).resolves.toBe(
      true,
    );
    await expect(
      canApplySteelReviewMessageSnapshot([message('saved text')], prepared, snapshot),
    ).resolves.toBe(true);
  });

  it('applies when the cached message is the text the operation was prepared against', async () => {
    const preparedFor = {
      ...prepared,
      messageSha256: createHash('sha256').update('original text').digest('hex'),
    };

    await expect(
      canApplySteelReviewMessageSnapshot([message('original text')], preparedFor, snapshot),
    ).resolves.toBe(true);
  });

  it('does not apply over a different or missing message', async () => {
    await expect(
      canApplySteelReviewMessageSnapshot([message('newer AI text')], prepared, snapshot),
    ).resolves.toBe(false);
    await expect(canApplySteelReviewMessageSnapshot([], prepared, snapshot)).resolves.toBe(false);
  });
});
