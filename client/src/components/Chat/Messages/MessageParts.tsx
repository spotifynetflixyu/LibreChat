import React, { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { ContentTypes, ToolCallTypes } from 'librechat-data-provider';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps, TMessageIcon } from '~/common';
import {
  cn,
  getMessageAriaLabel,
  areMessageRowPropsEqual,
  getHeaderPrefixForScreenReader,
  isValidTimestamp,
} from '~/utils';
import { useMessageHelpers, useLocalize, useAttachments, useContentMetadata } from '~/hooks';
import AuthorHeader from '~/components/Chat/Messages/Content/Parts/AuthorHeader';
import { getHeaderModelName } from '~/components/Chat/Messages/ui/HeaderLabel';
import { revealOnRowHoverClasses, messageFooterClasses } from './styles';
import MessageRow from '~/components/Chat/Messages/ui/MessageRow';
import MessageIcon from '~/components/Chat/Messages/MessageIcon';
import ContentParts from './Content/ContentParts';
import SiblingSwitch from './SiblingSwitch';
import HoverButtons from './HoverButtons';
import SubRow from './SubRow';
import store from '~/store';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function getPersistedSteelActivityEvents(
  metadata: TMessage['metadata'],
): readonly unknown[] | undefined {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.steel)) {
    return undefined;
  }

  const activityEvents = metadata.steel.activityEvents;
  return Array.isArray(activityEvents) ? activityEvents : undefined;
}

type PersistedSteelPreflightToolCall = {
  type: 'tool_call';
  id: string;
  name: string;
  args: {
    output_mode: 'detailed';
    return_images: boolean;
    use_doc_orientation_classify: boolean;
    use_doc_unwarping: boolean;
    use_layout_detection: boolean;
  };
  output?: string;
  progress: 0 | 1;
};

function isPersistedSteelPreflightToolCall(
  value: unknown,
): value is PersistedSteelPreflightToolCall {
  if (!isPlainObject(value)) {
    return false;
  }
  try {
    const serialized = JSON.stringify(value);
    if (
      typeof serialized !== 'string' ||
      new TextEncoder().encode(serialized).length > 4 * 1024
    ) {
      return false;
    }
  } catch {
    return false;
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = ['args', 'id', 'name', 'output', 'progress', 'type'];
  if (
    !keys.every((key) => expectedKeys.includes(key)) ||
    !['args', 'id', 'name', 'progress', 'type'].every((key) => key in value)
  ) {
    return false;
  }
  if (
    value.type !== 'tool_call' ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    new TextEncoder().encode(value.id).length > 256 ||
    typeof value.name !== 'string' ||
    (value.name !== 'paddleocr_vl' &&
      !/^paddleocr_vl(?:---|_mcp_)[A-Za-z0-9_-]+$/u.test(value.name)) ||
    (value.progress !== 0 && value.progress !== 1) ||
    (value.output !== undefined && typeof value.output !== 'string')
  ) {
    return false;
  }
  const args = value.args;
  if (!isPlainObject(args)) {
    return false;
  }
  const argKeys = Object.keys(args).sort();
  if (
    argKeys.join(',') !==
    [
      'output_mode',
      'return_images',
      'use_doc_orientation_classify',
      'use_doc_unwarping',
      'use_layout_detection',
    ]
      .sort()
      .join(',')
  ) {
    return false;
  }
  if (
    args.output_mode !== 'detailed' ||
    typeof args.return_images !== 'boolean' ||
    typeof args.use_doc_orientation_classify !== 'boolean' ||
    typeof args.use_doc_unwarping !== 'boolean' ||
    typeof args.use_layout_detection !== 'boolean'
  ) {
    return false;
  }
  if (value.output?.startsWith('Error:')) {
    return value.output.length <= 512 && !/https?:\/\//iu.test(value.output);
  }
  if (value.output !== undefined) {
    try {
      const parsed = JSON.parse(value.output);
      if (!isPlainObject(parsed)) {
        return false;
      }
      const outputKeys = Object.keys(parsed).sort();
      const expectedOutputKeys = [
        'chunkCount',
        'chunkIndex',
        'filename',
        'ocrEngine',
        'ocrFileKey',
        'outputStorage',
        'pageEnd',
        'pageStart',
        'rawResultHash',
        'rawTextLength',
        'status',
      ].sort();
      if (outputKeys.join(',') !== expectedOutputKeys.join(',')) {
        return false;
      }
      const chunkIndex = parsed.chunkIndex;
      const chunkCount = parsed.chunkCount;
      const pageStart = parsed.pageStart;
      const pageEnd = parsed.pageEnd;
      const rawTextLength = parsed.rawTextLength;
      return (
        parsed.status === 'completed' &&
        parsed.ocrEngine === 'paddleocr_vl' &&
        parsed.outputStorage === 'steel_working_order_memory:paddleocr_preflight' &&
        typeof parsed.ocrFileKey === 'string' &&
        parsed.ocrFileKey.length <= 256 &&
        typeof parsed.filename === 'string' &&
        parsed.filename.length <= 256 &&
        typeof parsed.rawResultHash === 'string' &&
        parsed.rawResultHash.length <= 128 &&
        Number.isSafeInteger(chunkIndex) &&
        Number.isSafeInteger(chunkCount) &&
        Number.isSafeInteger(pageStart) &&
        Number.isSafeInteger(pageEnd) &&
        Number.isSafeInteger(rawTextLength) &&
        (chunkIndex as number) >= 0 &&
        (chunkCount as number) >= 1 &&
        (pageStart as number) >= 1 &&
        (pageEnd as number) >= (pageStart as number) &&
        (rawTextLength as number) >= 0
      );
    } catch {
      return false;
    }
  }
  return true;
}

function clonePersistedSteelPreflightToolCall(
  value: PersistedSteelPreflightToolCall,
): TMessageContentParts {
  return {
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      type: ToolCallTypes.TOOL_CALL,
      id: value.id,
      name: value.name,
      args: { ...value.args },
      ...(value.output !== undefined ? { output: value.output } : {}),
      progress: value.progress,
    },
  } as TMessageContentParts;
}

export function getPersistedSteelPreflightToolCallParts(
  metadata: TMessage['metadata'],
): TMessageContentParts[] {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.steel)) {
    return [];
  }
  const cards = metadata.steel.preflightToolCalls;
  if (!Array.isArray(cards)) {
    return [];
  }
  const seen = new Set<string>();
  const parts: TMessageContentParts[] = [];
  for (const card of cards) {
    if (seen.size >= 100) {
      break;
    }
    if (!isPersistedSteelPreflightToolCall(card) || seen.has(card.id)) {
      continue;
    }
    seen.add(card.id);
    parts.push(clonePersistedSteelPreflightToolCall(card));
  }
  return parts;
}

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
  } = useMessageHelpers(props);

  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const { messageId = null, isCreatedByUser } = message ?? {};
  const persistedActivityEvents = message
    ? getPersistedSteelActivityEvents(message.metadata)
    : undefined;
  const persistedPreflightToolCallParts = message
    ? getPersistedSteelPreflightToolCallParts(message.metadata)
    : [];
  const contentWithPersistedPreflight = useMemo(() => {
    const safeContent = Array.isArray(message?.content)
      ? (message.content as Array<TMessageContentParts | undefined>)
      : [];
    if (persistedPreflightToolCallParts.length === 0) {
      return safeContent;
    }
    const existingToolCallIds = new Set<string>();
    for (const part of safeContent) {
      if (part?.type !== ContentTypes.TOOL_CALL) {
        continue;
      }
      const id = (part[ContentTypes.TOOL_CALL] as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string' && id.length > 0) {
        existingToolCallIds.add(id);
      }
    }
    return [
      ...persistedPreflightToolCallParts.filter(
        (part) =>
          !existingToolCallIds.has(
            (part[ContentTypes.TOOL_CALL] as { id: string }).id,
          ),
      ),
      ...safeContent,
    ];
  }, [message?.content, persistedPreflightToolCallParts]);

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

  const authorHeader = useMemo(
    () =>
      isCreatedByUser === true ? undefined : (
        <AuthorHeader
          icon={<MessageIcon iconData={iconData} assistant={assistant} agent={agent} />}
          label={name}
        />
      ),
    [isCreatedByUser, iconData, assistant, agent, name],
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
          icon={<MessageIcon iconData={iconData} assistant={assistant} agent={agent} />}
          label={name}
          hoverLabel={getHeaderModelName(
            agent?.model,
            assistant?.model,
            message.model,
            conversation?.model,
          )}
          timestamp={
            isValidTimestamp(message.createdAt) ? message.createdAt : message.clientTimestamp
          }
          processingStartedAt={
            isValidTimestamp(message.clientTimestamp) ? message.clientTimestamp : message.createdAt
          }
          processingDurationMs={!message.isCreatedByUser ? message.processingDurationMs : undefined}
          isSubmitting={isSubmitting}
          parentMessageId={message.parentMessageId}
          ariaLabel={getMessageAriaLabel(message, localize)}
          headerPrefix={getHeaderPrefixForScreenReader(message, localize)}
          isCreatedByUser={isCreatedByUser === true}
          hasParallelContent={hasParallelContent}
          fullWidth={maximizeChatSpace}
          isEditing={edit}
          footer={
            <SubRow classes={cn(messageFooterClasses, isCreatedByUser && 'justify-end')}>
              {/* While the answer is generating every other action is withheld, which
                  would otherwise leave this counter sitting alone under a half-written
                  response. It reveals on hover there, like the actions it sits with. */}
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
                isSubmitting={isSubmitting}
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
            authorHeader={authorHeader}
            createdAt={
              isValidTimestamp(message.createdAt) ? message.createdAt : message.clientTimestamp
            }
            processingDurationMs={
              !message.isCreatedByUser ? message.processingDurationMs : undefined
            }
            persistedActivityEvents={persistedActivityEvents}
            setSiblingIdx={setSiblingIdx}
            isCreatedByUser={message.isCreatedByUser}
            conversationId={conversation?.conversationId}
            isLatestMessage={messageId === latestMessageId}
            content={contentWithPersistedPreflight}
          />
        </MessageRow>
      </div>
    </div>
  );
}

export default React.memo(MessageParts, areMessageRowPropsEqual);
