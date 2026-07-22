import { act, renderHook } from '@testing-library/react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useGetLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useAuthContext } from '~/hooks/AuthContext';
import useSubmitMessage from '../useSubmitMessage';

const mockSetActivePrompt = jest.fn();

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(),
  useSetRecoilState: jest.fn(),
}));

jest.mock('librechat-data-provider', () => ({
  Constants: {
    NEW_CONVO: 'new',
  },
  replaceSpecialVars: jest.fn(({ text }) => text),
}));

jest.mock('~/Providers', () => ({
  useChatContext: jest.fn(),
  useChatFormContext: jest.fn(),
  useAddedChatContext: jest.fn(),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) =>
    key === 'com_ui_steel_file_ocr_default_prompt' ? 'OCR檔案內容，逐一列表給我核對。' : key,
}));

jest.mock('~/hooks/Messages/useLatestMessage', () => ({
  useGetLatestMessage: jest.fn(),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    autoSendPrompts: 'autoSendPrompts',
    activePromptByIndex: jest.fn(() => 'activePromptByIndex'),
    pendingMarkdownTableCommentsByConvoId: jest.fn(() => 'pendingMarkdownTableComments'),
  },
}));

const mockUseRecoilValue = useRecoilValue as jest.Mock;
const mockUseSetRecoilState = useSetRecoilState as jest.Mock;
const mockUseChatContext = useChatContext as jest.Mock;
const mockUseChatFormContext = useChatFormContext as jest.Mock;
const mockUseAddedChatContext = useAddedChatContext as jest.Mock;
const mockUseAuthContext = useAuthContext as jest.Mock;
const mockUseGetLatestMessage = useGetLatestMessage as jest.Mock;

describe('useSubmitMessage', () => {
  const ask = jest.fn();
  const reset = jest.fn();
  const setMessages = jest.fn();
  const getMessages = jest.fn();
  let files: Map<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    ask.mockReset();
    ask.mockReturnValue(undefined);
    files = new Map();
    mockUseRecoilValue.mockImplementation((atom) =>
      atom === 'pendingMarkdownTableComments' ? [] : false,
    );
    mockUseSetRecoilState.mockReturnValue(mockSetActivePrompt);
    mockUseAuthContext.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAddedChatContext.mockReturnValue({ conversation: null });
    mockUseChatFormContext.mockReturnValue({ reset, getValues: jest.fn(() => '') });
    mockUseGetLatestMessage.mockReturnValue(() => ({ messageId: 'assistant-message' }));
    getMessages.mockReturnValue([{ messageId: 'assistant-message' }]);
    mockUseChatContext.mockReturnValue({
      ask,
      index: 0,
      files,
      getMessages,
      setMessages,
      conversation: { conversationId: 'conversation-1' },
    });
  });

  it('propagates blocked submits so direct callers can preserve their text', () => {
    ask.mockReturnValue(false);

    const { result } = renderHook(() => useSubmitMessage());

    let submitted: false | void = undefined;
    act(() => {
      submitted = result.current.submitMessage({ text: 'dictated follow-up' });
    });

    expect(submitted).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('submits the default OCR review prompt when only files are attached', () => {
    files.set('file-1', {});

    const { result } = renderHook(() => useSubmitMessage());

    act(() => {
      result.current.submitMessage({ text: '   ' });
    });

    expect(ask).toHaveBeenCalledWith(
      { text: 'OCR檔案內容，逐一列表給我核對。' },
      expect.objectContaining({ addedConvo: undefined }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('blocks an empty submit when no files are attached', () => {
    const { result } = renderHook(() => useSubmitMessage());

    let submitted: false | void = undefined;
    act(() => {
      submitted = result.current.submitMessage({ text: '   ' });
    });

    expect(submitted).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('allows an empty submit when markdown table comments are pending', () => {
    mockUseRecoilValue.mockImplementation((atom) =>
      atom === 'pendingMarkdownTableComments' ? [{ id: 'comment-1' }] : false,
    );

    const { result } = renderHook(() => useSubmitMessage());

    act(() => {
      result.current.submitMessage({ text: '   ' });
    });

    expect(ask).toHaveBeenCalledWith(
      { text: '' },
      expect.objectContaining({ addedConvo: undefined }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reads the tail at call time and appends it to root when missing', () => {
    const rootMessages = [{ messageId: 'root-user' }];
    const latest = { messageId: 'assistant-tail', text: 'tail' };
    const reader = jest.fn(() => latest);
    mockUseGetLatestMessage.mockReturnValue(reader);
    getMessages.mockReturnValue(rootMessages);
    ask.mockReturnValue(true);

    const { result } = renderHook(() => useSubmitMessage());
    act(() => {
      result.current.submitMessage({ text: 'hello' });
    });

    expect(reader).toHaveBeenCalled();
    expect(setMessages).toHaveBeenCalledWith([...rootMessages, latest]);
    expect(ask).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it('does not append when the latest message is already in root', () => {
    const latest = { messageId: 'assistant-tail' };
    mockUseGetLatestMessage.mockReturnValue(() => latest);
    getMessages.mockReturnValue([latest]);
    ask.mockReturnValue(true);

    const { result } = renderHook(() => useSubmitMessage());
    act(() => {
      result.current.submitMessage({ text: 'hello' });
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalled();
  });

  it('does not append when there is no latest message', () => {
    mockUseGetLatestMessage.mockReturnValue(() => null);
    getMessages.mockReturnValue([{ messageId: 'root-user' }]);
    ask.mockReturnValue(true);

    const { result } = renderHook(() => useSubmitMessage());
    act(() => {
      result.current.submitMessage({ text: 'hello' });
    });

    expect(setMessages).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalled();
  });
});
