import { useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { Constants, replaceSpecialVars } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useGetLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useAuthContext } from '~/hooks/AuthContext';
import useLocalize from '~/hooks/useLocalize';
import { mainTextareaId } from '~/common';
import type { MarkdownTableComment } from '~/common';
import store from '~/store';

const emptyFiles = new Map();

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const localize = useLocalize();
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const {
    ask,
    index,
    getMessages,
    setMessages,
    conversation,
    files = emptyFiles,
  } = useChatContext();
  const getLatestMessage = useGetLatestMessage(index);

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const pendingMarkdownTableComments = useRecoilValue(
    store.pendingMarkdownTableCommentsByConvoId(conversationId),
  );
  const hasPendingMarkdownTableComments = pendingMarkdownTableComments.length > 0;

  const submitMessage = useCallback(
    (data?: {
      text: string;
      overrideFiles?: TMessage['files'];
      overrideQuotes?: string[];
      overrideManualSkills?: string[];
      overrideMarkdownTableComments?: MarkdownTableComment[];
    }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }
      const text = data.text.trim()
        ? data.text
        : files.size > 0
          ? localize('com_ui_steel_file_ocr_default_prompt')
          : '';
      if (!text.trim() && !hasPendingMarkdownTableComments) {
        return false;
      }
      const latestMessage = getLatestMessage();
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      const submitted = ask(
        {
          text,
        },
        {
          addedConvo: addedConvo ?? undefined,
          // Queued during-run messages carry their own consumed attachments,
          // quote chips, and manual skill picks (undefined = drain composer).
          overrideFiles: data.overrideFiles,
          overrideQuotes: data.overrideQuotes,
          overrideManualSkills: data.overrideManualSkills,
          overrideMarkdownTableComments: data.overrideMarkdownTableComments,
        },
      );
      if (submitted === false) {
        return false;
      }
      methods.reset();
    },
    [
      ask,
      methods,
      addedConvo,
      setMessages,
      getMessages,
      files,
      localize,
      hasPendingMarkdownTableComments,
      getLatestMessage,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      const currentText = textarea?.value ?? methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
