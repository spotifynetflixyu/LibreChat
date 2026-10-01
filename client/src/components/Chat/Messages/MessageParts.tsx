import React, { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps, TMessageIcon } from '~/common';
import {
  cn,
  getMessageAriaLabel,
  areMessageRowPropsEqual,
  getHeaderPrefixForScreenReader,
  getMessageProcessingStartedAt,
  getMessageTimestampSource,
} from '~/utils';
import {
  getPersistedSteelActivityEvents,
  getPersistedSteelPreflightToolCallParts,
  prependPersistedSteelPreflightToolCallParts,
} from '~/utils/steel';
import { useMessageHelpers, useLocalize, useAttachments, useContentMetadata } from '~/hooks';
import ResumeAuthorHeader from '~/components/Chat/Messages/Content/Parts/ResumeAuthorHeader';
import { ErrorSourceProvider } from '~/components/Messages/Content/Error/source';
import { getHeaderHoverLabel } from '~/components/Chat/Messages/ui/HeaderLabel';
import { revealOnRowHoverClasses, messageFooterClasses } from './styles';
import MessageRow from '~/components/Chat/Messages/ui/MessageRow';
import MessageIcon from '~/components/Chat/Messages/MessageIcon';
import { showThinkingAtom } from '~/store/showThinking';
import ContentParts from './Content/ContentParts';
import { shouldShowElapsed } from './Elapsed';
import SiblingSwitch from './SiblingSwitch';
import { AuthorContext } from '~/Providers';
import HoverButtons from './HoverButtons';
import SubRow from './SubRow';
import store from '~/store';

/**
 * The one header every assistant message hands its parts. It reads the author from
 * `AuthorContext`, so the author resolving after paint cannot break the parts' memo.
 */
const RESUME_AUTHOR_HEADER = <ResumeAuthorHeader />;

function MessageParts(props: TMessageProps) {
  const localize = useLocalize();
  const { message, siblingIdx, siblingCount, setSiblingIdx } = props;
  const { attachments, searchResults } = useAttachments({
    messageId: message?.messageId,
    attachments: message?.attachments,
  });
  const {
    edit,
    index,
    agent,
    isLast,
    enterEdit,
    assistant,
    handleScroll,
    conversation,
    isSubmitting,
    latestMessageId,
    handleContinue,
    copyToClipboard,
    getCanCopy,
    regenerateMessage,
    hasConfiguredSender,
  } = useMessageHelpers(props, searchResults);
  const submissionStartedAt = useRecoilValue(store.submissionStartFamily(index));

  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const autoExpandTools = useRecoilValue(store.autoExpandTools);
  const showThinking = useAtomValue(showThinkingAtom);
  const { messageId = null, isCreatedByUser } = message ?? {};
  const metadata = message?.metadata;
  const persistedActivityEvents = useMemo(
    () => getPersistedSteelActivityEvents(metadata),
    [metadata],
  );
  const persistedPreflightToolCallParts = useMemo(
    () => getPersistedSteelPreflightToolCallParts(metadata),
    [metadata],
  );
  const contentWithPersistedPreflight = useMemo(
    () =>
      prependPersistedSteelPreflightToolCallParts(
        message?.content as Array<TMessageContentParts | undefined> | undefined,
        persistedPreflightToolCallParts,
      ),
    [message?.content, persistedPreflightToolCallParts],
  );

  const name = useMemo(() => {
    let result = '';
    if (isCreatedByUser === true) {
      result = localize('com_user_message');
    } else if (assistant) {
      result = assistant.name ?? localize('com_ui_assistant');
    } else if (agent) {
      result = agent.name ?? localize('com_ui_agent');
    }

    return result;
  }, [assistant, agent, isCreatedByUser, localize]);

  const iconData: TMessageIcon = useMemo(
    () => ({
      endpoint: message?.endpoint ?? conversation?.endpoint,
      model: message?.model ?? conversation?.model,
      iconURL: message?.iconURL ?? conversation?.iconURL,
      modelLabel: name,
      isCreatedByUser: message?.isCreatedByUser,
    }),
    [
      name,
      conversation?.endpoint,
      conversation?.iconURL,
      conversation?.model,
      message?.model,
      message?.iconURL,
      message?.endpoint,
      message?.isCreatedByUser,
    ],
  );

  const author = useMemo(
    () => ({
      icon: <MessageIcon iconData={iconData} assistant={assistant} agent={agent} />,
      label: name,
    }),
    [iconData, assistant, agent, name],
  );

  const { hasParallelContent } = useContentMetadata(message);

  if (!message) {
    return null;
  }

  return (
    <div
      className="w-full border-0 bg-transparent"
      onWheel={handleScroll}
      onTouchMove={handleScroll}
    >
      <div className="m-auto justify-center px-4 py-3 sm:px-0">
        <MessageRow
          id={messageId ?? ''}
          icon={author.icon}
          label={author.label}
          hoverLabel={getHeaderHoverLabel(
            hasConfiguredSender,
            agent?.model,
            assistant?.model,
            message.model,
            conversation?.model,
          )}
          timestamp={getMessageTimestampSource(message)}
          processingStartedAt={getMessageProcessingStartedAt(message)}
          processingDurationMs={!message.isCreatedByUser ? message.processingDurationMs : undefined}
          isSubmitting={shouldShowElapsed({
            isSubmitting,
            isLatestMessage: messageId === latestMessageId,
            isCreatedByUser,
            siblingIdx,
            siblingCount,
          })}
          submissionStartedAt={submissionStartedAt}
          parentMessageId={message.parentMessageId}
          ariaLabel={getMessageAriaLabel(message, localize)}
          headerPrefix={getHeaderPrefixForScreenReader(message, localize)}
          isCreatedByUser={isCreatedByUser === true}
          hasParallelContent={hasParallelContent}
          fullWidth={maximizeChatSpace}
          isEditing={edit}
          footer={
            <SubRow classes={cn(messageFooterClasses, isCreatedByUser && 'justify-end')}>
              <SiblingSwitch
                siblingIdx={siblingIdx}
                siblingCount={siblingCount}
                setSiblingIdx={setSiblingIdx}
                className={cn(
                  isSubmitting && messageId === latestMessageId && revealOnRowHoverClasses,
                )}
              />
              <HoverButtons
                index={index}
                isEditing={edit}
                message={message}
                enterEdit={enterEdit}
                conversation={conversation ?? null}
                regenerate={() => regenerateMessage()}
                copyToClipboard={copyToClipboard}
                getCanCopy={getCanCopy}
                handleContinue={handleContinue}
                latestMessageId={latestMessageId}
                isLast={isLast}
              />
            </SubRow>
          }
        >
          <AuthorContext.Provider value={author}>
            <ErrorSourceProvider message={message}>
              <ContentParts
                edit={edit}
                isLast={isLast}
                enterEdit={enterEdit}
                siblingIdx={siblingIdx}
                attachments={attachments}
                isSubmitting={isSubmitting}
                searchResults={searchResults}
                manualSkills={message.manualSkills}
                messageId={message.messageId}
                authorHeader={isCreatedByUser === true ? undefined : RESUME_AUTHOR_HEADER}
                createdAt={getMessageTimestampSource(message)}
                processingDurationMs={
                  !message.isCreatedByUser ? message.processingDurationMs : undefined
                }
                persistedActivityEvents={persistedActivityEvents}
                setSiblingIdx={setSiblingIdx}
                isCreatedByUser={message.isCreatedByUser}
                conversationId={conversation?.conversationId}
                foldLiveActivity={!autoExpandTools}
                showThinking={showThinking}
                isLatestMessage={messageId === latestMessageId}
                content={contentWithPersistedPreflight}
              />
            </ErrorSourceProvider>
          </AuthorContext.Provider>
        </MessageRow>
      </div>
    </div>
  );
}

export default React.memo(MessageParts, areMessageRowPropsEqual);
