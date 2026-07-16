import { renderHook, act } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation, TMessage, TSubmission } from 'librechat-data-provider';
import useChatFunctions from '../useChatFunctions';

const mockNavigate = jest.fn();
const mockSetShowStopButton = jest.fn();
const mockSetIsSubmitting = jest.fn();
const mockGetEphemeralAgent = jest.fn(() => null);
const mockSetFilesToDelete = jest.fn();
const mockGetSender = jest.fn(() => 'Assistant');
const mockGetExpiry = jest.fn(() => 'expiry-key');
const mockGetQueryData = jest.fn(() => ({}));
const mockResetRecoil = jest.fn();
let mockRecoilLoadables: Record<string, unknown[]> = {};

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: mockGetQueryData,
  }),
}));

jest.mock('recoil', () => ({
  useRecoilValue: () => false,
  useSetRecoilState: (atom: unknown) =>
    String(atom).includes('isSubmitting') ? mockSetIsSubmitting : mockSetShowStopButton,
  useRecoilCallback: (factory: any) =>
    factory({
      snapshot: {
        getLoadable: (atom: unknown) => ({
          state: 'hasValue',
          contents: mockRecoilLoadables[String(atom)] ?? [],
        }),
      },
      set: jest.fn(),
      reset: mockResetRecoil,
    }),
}));

jest.mock('~/hooks/Files/useSetFilesToDelete', () => () => mockSetFilesToDelete);
jest.mock('~/hooks/Conversations/useGetSender', () => () => mockGetSender);
jest.mock('~/hooks/Input/useUserKey', () => () => ({ getExpiry: mockGetExpiry }));
jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: null }),
}));
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    isTemporary: 'isTemporary',
    isSubmittingFamily: () => 'isSubmitting',
    showStopButtonByIndex: () => 'showStopButton',
    pendingManualSkillsByConvoId: () => 'pendingManualSkills',
    pendingQuotesByConvoId: () => 'pendingQuotes',
    pendingMarkdownTableCommentsByConvoId: () => 'pendingMarkdownTableComments',
    messagesSiblingIdxFamily: () => 'messagesSiblingIdx',
  },
  useGetEphemeralAgent: () => mockGetEphemeralAgent,
}));
jest.mock('~/utils', () => ({
  logger: {
    log: jest.fn(),
    dir: jest.fn(),
    warn: jest.fn(),
  },
  hasStreamStartFailed: jest.fn(() => false),
  createDualMessageContent: jest.fn(() => []),
  getRouteChatProjectId: jest.fn(() => null),
}));

const userMessage = (messageId: string, parentMessageId = '00000000-0000-0000-0000-000000000000') =>
  ({
    messageId,
    parentMessageId,
    conversationId: 'conversation-1',
    isCreatedByUser: true,
    sender: 'User',
    text: messageId,
  }) as TMessage;

const assistantMessage = (messageId: string, parentMessageId: string) =>
  ({
    messageId,
    parentMessageId,
    conversationId: 'conversation-1',
    isCreatedByUser: false,
    sender: 'Assistant',
    text: messageId,
  }) as TMessage;

describe('useChatFunctions regenerate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecoilLoadables = {};
    mockGetQueryData.mockReturnValue({});
  });

  it('keys a non-tail regenerate to the selected assistant response', () => {
    let messages = [
      userMessage('user-1'),
      assistantMessage('assistant-1', 'user-1'),
      userMessage('user-2', 'assistant-1'),
      assistantMessage('assistant-2', 'user-2'),
      userMessage('user-3', 'assistant-2'),
      assistantMessage('assistant-3', 'user-3'),
    ];
    const setMessages = jest.fn((nextMessages: TMessage[]) => {
      messages = nextMessages;
    });
    const setSubmission = jest.fn();
    const conversation = {
      conversationId: 'conversation-1',
      endpoint: EModelEndpoint.agents,
      model: 'gpt-4o',
      agent_id: 'agent-1',
    } as TConversation;

    const { result } = renderHook(() =>
      useChatFunctions({
        isSubmitting: false,
        latestMessage: messages[5],
        conversation,
        getMessages: () => messages,
        setMessages,
        setSubmission,
      }),
    );

    act(() => {
      result.current.regenerate(messages[1]);
    });

    const submission = setSubmission.mock.calls.at(-1)?.[0] as TSubmission;
    expect(submission.userMessage.overrideParentMessageId).toBe('user-1');
    expect(submission.userMessage.responseMessageId).toBe('assistant-1_');
    expect(submission.initialResponse?.messageId).toBe('assistant-1_');
    expect(submission.initialResponse?.parentMessageId).toBe('user-1');
    expect(submission.initialResponse?.clientTimestamp).toBeDefined();
    expect(submission.messages.map((message) => message.messageId)).toEqual(['user-1']);
    expect(submission.regenerateMessages?.map((message) => message.messageId)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
      'user-3',
      'assistant-3',
    ]);
    expect(
      setMessages.mock.calls.at(-1)?.[0].map((message: TMessage) => message.messageId),
    ).toEqual(['user-1', 'assistant-1_']);
    expect(messages.at(-1)?.messageId).toBe('assistant-1_');
  });

  it('retains persisted parent files when regenerating without a compose setter', () => {
    const persistedFile = {
      file_id: 'file-bh-pdf',
      filename: 'BH.pdf',
      filepath: 'files/user-123/BH.pdf',
      type: 'application/pdf',
      bytes: 2048,
      source: 'local',
    };
    const messages = [
      { ...userMessage('user-1'), files: [persistedFile] },
      assistantMessage('assistant-1', 'user-1'),
    ] as TMessage[];
    const setMessages = jest.fn();
    const setSubmission = jest.fn();
    const conversation = {
      conversationId: 'conversation-1',
      endpoint: EModelEndpoint.agents,
      model: 'gpt-4o',
      agent_id: 'agent-1',
    } as TConversation;

    const { result } = renderHook(() =>
      useChatFunctions({
        isSubmitting: false,
        latestMessage: messages[1],
        conversation,
        getMessages: () => messages,
        setMessages,
        setSubmission,
      }),
    );

    act(() => {
      result.current.regenerate(messages[1]);
    });

    const submission = setSubmission.mock.calls.at(-1)?.[0] as TSubmission;
    expect(submission.userMessage.files).toEqual([persistedFile]);
  });

  it('appends and clears pending markdown table comments on a fresh submit', () => {
    const messages = [userMessage('user-1'), assistantMessage('assistant-1', 'user-1')];
    const setMessages = jest.fn((nextMessages: TMessage[]) => {
      messages.splice(0, messages.length, ...nextMessages);
    });
    const setSubmission = jest.fn();
    const conversation = {
      conversationId: 'conversation-1',
      endpoint: EModelEndpoint.agents,
      model: 'gpt-4o',
      agent_id: 'agent-1',
    } as TConversation;
    mockRecoilLoadables.pendingMarkdownTableComments = [
      {
        id: 'assistant-1:1:2:3',
        conversationId: 'conversation-1',
        messageId: 'assistant-1',
        messageTimestampLabel: '2026-06-27 14:32',
        markdownIndex: 1,
        markdownLabel: '2026-06-27 14:32 / Markdown 1',
        tableFingerprint: '| A | B |',
        rowIndex: 2,
        columnIndex: 3,
        columnHeader: 'Qty',
        oldValue: '10',
        comment: '改成 12',
      },
    ];

    const { result } = renderHook(() =>
      useChatFunctions({
        isSubmitting: false,
        latestMessage: messages[1],
        conversation,
        getMessages: () => messages,
        setMessages,
        setSubmission,
      }),
    );

    act(() => {
      result.current.ask({ text: '請更新表格' });
    });

    const submission = setSubmission.mock.calls.at(-1)?.[0] as TSubmission;
    expect(submission.userMessage.text).toContain('請更新表格');
    expect(submission.userMessage.text).toContain('### 2026-06-27 14:32 / Markdown 1');
    expect(submission.userMessage.text).toContain('1. Cell: row 2, column "Qty"');
    expect(submission.userMessage.text).toContain('Old value: 10');
    expect(submission.userMessage.text).toContain('Comment: 改成 12');
    expect(submission.userMessage.text).toContain('分別輸出每個 Markdown 的完整新表格');
    expect(mockResetRecoil).toHaveBeenCalledWith('pendingMarkdownTableComments');
  });

  it('includes filename-bearing file metadata on a fresh submit', () => {
    const messages = [userMessage('user-1')];
    const setMessages = jest.fn((nextMessages: TMessage[]) => {
      messages.splice(0, messages.length, ...nextMessages);
    });
    const setFiles = jest.fn();
    const setSubmission = jest.fn();
    const conversation = {
      conversationId: 'conversation-1',
      endpoint: EModelEndpoint.agents,
      model: 'gpt-5.5',
      agent_id: 'agent-1',
    } as TConversation;
    const files = new Map([
      [
        'file-bh-pdf',
        {
          file_id: 'file-bh-pdf',
          filename: 'BH.pdf',
          filepath: 'files/user-123/BH.pdf',
          type: 'application/pdf',
          size: 2048,
          width: 0,
          height: 0,
          progress: 1,
        },
      ],
    ]);

    const { result } = renderHook(() =>
      useChatFunctions({
        isSubmitting: false,
        latestMessage: messages[0],
        conversation,
        files,
        setFiles,
        getMessages: () => messages,
        setMessages,
        setSubmission,
      }),
    );

    act(() => {
      result.current.ask({ text: 'OCR檔案內容，逐一列表給我核對。' });
    });

    const submission = setSubmission.mock.calls.at(-1)?.[0] as TSubmission;
    expect(submission.userMessage.files).toEqual([
      expect.objectContaining({
        file_id: 'file-bh-pdf',
        filename: 'BH.pdf',
        filepath: 'files/user-123/BH.pdf',
        type: 'application/pdf',
        bytes: 2048,
        width: 0,
        height: 0,
      }),
    ]);
    expect(setFiles).toHaveBeenCalledWith(new Map());
  });
});
