import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import { dataService } from 'librechat-data-provider';
import type {
  SteelProviderChatMessage,
  SteelProviderChatRequest,
  SteelProviderReasoningEffort,
  SteelProviderChatResponse,
  SteelProviderChatStreamEvent,
  SteelProviderTimings,
} from 'librechat-data-provider';

type SteelChatTurn = SteelProviderChatMessage & {
  id: string;
  status?: 'error';
  attachmentNames?: string[];
};

type SelectedSteelFile = {
  id: string;
  filename?: string;
  mediaType: string;
  dataBase64: string;
};

const steelModel = 'gpt-5.5';
const reasoningEffortOptions: SteelProviderReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const titleText = 'Steel OAuth Chat';
const tokensLabel = 'tokens';
const emptyStateText = 'Ready';
const pendingText = 'Waiting for provider';
const newChatText = 'New chat';
const streamStatusLabel = 'Steel stream status';
const activityPanelLabel = 'Activity panel';
const activityStatusTitle = 'Activity';
const activityStatusSubtitle = 'Public work log';
const noActivityStatusText = 'No activity yet.';
const providerTimingsTitle = 'Provider timings';

function createTurn(
  role: SteelProviderChatMessage['role'],
  content: string,
  attachmentNames: string[] = [],
): SteelChatTurn {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('FileReader did not return an ArrayBuffer.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'));
    reader.readAsArrayBuffer(file);
  });
}

async function toSelectedSteelFile(file: File): Promise<SelectedSteelFile> {
  const dataBase64 = bytesToBase64(new Uint8Array(await readFileAsArrayBuffer(file)));

  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    filename: file.name,
    mediaType: file.type || 'application/octet-stream',
    dataBase64,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorText(error: unknown): string {
  if (isRecord(error)) {
    const response = error.response;
    if (isRecord(response)) {
      const data = response.data;
      if (isRecord(data)) {
        if (typeof data.errorSummary === 'string') {
          return data.errorSummary;
        }
        if (typeof data.message === 'string') {
          return data.message;
        }
      }
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return 'Steel chat request failed.';
}

function getInitialSteelConversationId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URL(window.location.href).searchParams.get('conversationId');
}

function replaceSteelConversationIdInUrl(conversationId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  const currentConversationId = url.searchParams.get('conversationId');
  if (currentConversationId === conversationId) {
    return;
  }

  if (conversationId) {
    url.searchParams.set('conversationId', conversationId);
  } else {
    url.searchParams.delete('conversationId');
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function getStreamStatusMessage(event: SteelProviderChatStreamEvent): string | undefined {
  if (event.type === 'progress' || event.type === 'lookup' || event.type === 'tool') {
    return event.message;
  }
  if (event.type === 'reasoning') {
    return event.summary;
  }
  if (event.type === 'error') {
    return event.errorSummary;
  }
  return undefined;
}

function getStreamStatusLabel(event: SteelProviderChatStreamEvent): string {
  if (event.type === 'progress') {
    return event.stage.replace(/_/g, ' ');
  }
  if (event.type === 'reasoning') {
    return 'reasoning summary';
  }
  if (event.type === 'lookup' || event.type === 'tool') {
    return event.toolName;
  }
  if (event.type === 'error') {
    return 'error';
  }
  return 'response';
}

function getStreamActivityKindLabel(event: SteelProviderChatStreamEvent): string {
  if (event.type === 'progress') {
    return 'Progress';
  }
  if (event.type === 'reasoning') {
    return 'Reasoning summary';
  }
  if (event.type === 'lookup') {
    return 'Lookup';
  }
  if (event.type === 'tool') {
    return 'Tool';
  }
  if (event.type === 'error') {
    return 'Error';
  }
  return 'Activity';
}

function getStreamActivityStateLabel(event: SteelProviderChatStreamEvent): string {
  if (event.type === 'progress') {
    return 'Working';
  }
  if (event.type === 'reasoning') {
    return 'Summary';
  }
  if (event.type === 'error') {
    return 'Failed';
  }
  if (event.type === 'lookup' || event.type === 'tool') {
    if (event.status === 'started') {
      return 'Started';
    }
    if (event.status === 'completed') {
      return 'Done';
    }
    return 'Failed';
  }
  return 'Updated';
}

function getStreamActivityStateClass(event: SteelProviderChatStreamEvent): string {
  if (
    event.type === 'error' ||
    ((event.type === 'lookup' || event.type === 'tool') && event.status === 'failed')
  ) {
    return 'border-red-500/40 bg-red-500/10 text-red-400';
  }
  if ((event.type === 'lookup' || event.type === 'tool') && event.status === 'completed') {
    return 'border-green-500/30 bg-green-500/10 text-green-400';
  }
  if (
    event.type === 'progress' ||
    ((event.type === 'lookup' || event.type === 'tool') && event.status === 'started')
  ) {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-400';
  }
  return 'border-border-light bg-surface-primary text-text-secondary';
}

function getStreamStatusIcon(event: SteelProviderChatStreamEvent) {
  if (
    event.type === 'error' ||
    ((event.type === 'lookup' || event.type === 'tool') && event.status === 'failed')
  ) {
    return AlertCircle;
  }
  if (event.type === 'reasoning') {
    return Bot;
  }
  if ((event.type === 'lookup' || event.type === 'tool') && event.status === 'completed') {
    return CheckCircle2;
  }
  return Loader2;
}

function formatTimingDurationMs(durationMs: number): string {
  return `${Math.round(durationMs)} ms`;
}

function TimingMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border-l border-border-light pl-2">
      <dt className="truncate text-[11px] uppercase text-text-secondary">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-text-primary">{value}</dd>
    </div>
  );
}

function ProviderTimingsPanel({ timings }: { timings: SteelProviderTimings }) {
  return (
    <section
      aria-label={providerTimingsTitle}
      className="mt-4 rounded border border-border-light bg-surface-secondary p-3"
    >
      <h3 className="text-xs font-semibold text-text-primary">{providerTimingsTitle}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <TimingMetric label="Total" value={formatTimingDurationMs(timings.totalDurationMs)} />
        <TimingMetric
          label="Generation"
          value={formatTimingDurationMs(timings.generationDurationMs)}
        />
        <TimingMetric label="Tools" value={formatTimingDurationMs(timings.toolDurationMs)} />
        <TimingMetric label="Rounds" value={timings.roundCount} />
      </dl>
      {timings.rounds.length > 0 && (
        <ol aria-label="Round timings" className="mt-3 space-y-2">
          {timings.rounds.map((roundTiming) => (
            <li
              key={roundTiming.round}
              className="rounded border border-border-light bg-surface-primary p-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-text-primary">
                  Round {roundTiming.round}
                </h4>
                <span className="text-[11px] text-text-secondary">
                  {roundTiming.generatedToolCallCount} tool calls
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <TimingMetric
                  label="Generation"
                  value={formatTimingDurationMs(roundTiming.generationDurationMs)}
                />
                <TimingMetric
                  label="Tools"
                  value={formatTimingDurationMs(roundTiming.toolDurationMs)}
                />
                <TimingMetric label="Prompt messages" value={roundTiming.promptMessageCount} />
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StreamStatusTimeline({ events }: { events: SteelProviderChatStreamEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-text-secondary">{noActivityStatusText}</p>;
  }

  return (
    <ol aria-label={activityStatusSubtitle} className="space-y-2">
      {events.map((event, index) => {
        const message = getStreamStatusMessage(event);
        if (!message) {
          return null;
        }
        const Icon = getStreamStatusIcon(event);
        const isActive =
          event.type === 'progress' ||
          ((event.type === 'lookup' || event.type === 'tool') && event.status === 'started');
        const isFailed =
          event.type === 'error' ||
          ((event.type === 'lookup' || event.type === 'tool') && event.status === 'failed');

        return (
          <li
            key={`${event.type}-${index}-${message}`}
            className="rounded border border-border-light bg-surface-secondary p-3"
          >
            <div className="flex min-w-0 gap-2">
              <span
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                  isFailed
                    ? 'border-red-500/40 text-red-400'
                    : 'border-border-light text-text-secondary'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${isActive ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] uppercase text-text-secondary">
                    {getStreamActivityKindLabel(event)}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[11px] leading-none ${getStreamActivityStateClass(
                      event,
                    )}`}
                  >
                    {getStreamActivityStateLabel(event)}
                  </span>
                </div>
                <span className="mt-1 block truncate text-xs font-medium text-text-primary">
                  {getStreamStatusLabel(event)}
                </span>
                <span className="mt-1 block whitespace-pre-wrap break-words text-text-primary">
                  {message}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ActivityStatusPanel({
  events,
  timings,
}: {
  events: SteelProviderChatStreamEvent[];
  timings?: SteelProviderTimings;
}) {
  return (
    <section
      aria-label={activityPanelLabel}
      className="flex h-full min-h-0 flex-col bg-surface-primary"
    >
      <header className="border-b border-border-light px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-text-primary">{activityStatusTitle}</h2>
        <p className="mt-0.5 text-xs text-text-secondary">{activityStatusSubtitle}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 text-xs text-text-secondary">
        <StreamStatusTimeline events={events} />
        {timings && <ProviderTimingsPanel timings={timings} />}
      </div>
    </section>
  );
}

function createStreamErrorEvent(error: unknown): SteelProviderChatStreamEvent {
  return {
    type: 'error',
    errorCategory: 'unknown',
    errorSummary: getErrorText(error),
  };
}

function isMarkdownTableBlock(lines: string[]): boolean {
  return (
    lines.length >= 2 &&
    /^\s*\|.+\|\s*$/.test(lines[0] ?? '') &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[1] ?? '')
  );
}

function renderMarkdownTable(lines: string[], key: string) {
  const rows = lines.map((line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim()),
  );
  const [headers = [], _divider, ...bodyRows] = rows;

  return (
    <div key={key} className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                key={`${key}-h-${index}`}
                className="border border-border-light bg-surface-secondary px-2 py-1 font-semibold"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`${key}-r-${rowIndex}`}>
              {headers.map((_header, cellIndex) => (
                <td key={`${key}-c-${rowIndex}-${cellIndex}`} className="border border-border-light px-2 py-1">
                  {row[cellIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SteelMessageContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="whitespace-pre-wrap break-words">
        {paragraph.join('\n')}
      </p>,
    );
    paragraph = [];
  };

  while (index < lines.length) {
    const candidate: string[] = [];
    while (index + candidate.length < lines.length) {
      const line = lines[index + candidate.length] ?? '';
      if (!/^\s*\|.+\|\s*$/.test(line)) {
        break;
      }
      candidate.push(line);
    }

    if (isMarkdownTableBlock(candidate)) {
      flushParagraph();
      blocks.push(renderMarkdownTable(candidate, `table-${blocks.length}`));
      index += candidate.length;
      continue;
    }

    paragraph.push(lines[index] ?? '');
    index += 1;
  }
  flushParagraph();

  return <>{blocks}</>;
}

export default function SteelOAuthChat() {
  const layoutRef = useRef<HTMLElement | null>(null);
  const isComposingInputRef = useRef(false);
  const [input, setInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<SteelProviderReasoningEffort>('medium');
  const [messages, setMessages] = useState<SteelChatTurn[]>([]);
  const [lastResponse, setLastResponse] = useState<SteelProviderChatResponse | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(
    getInitialSteelConversationId,
  );
  const [isActivityPanelOpen, setIsActivityPanelOpen] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isEncodingFiles, setIsEncodingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedSteelFile[]>([]);
  const [streamEvents, setStreamEvents] = useState<SteelProviderChatStreamEvent[]>([]);

  const providerLabel = useMemo(
    () => lastResponse?.provider ?? 'openai_oauth_responses',
    [lastResponse],
  );
  const canSend =
    (input.trim().length > 0 || selectedFiles.length > 0) && !isSending && !isEncodingFiles;

  useEffect(() => {
    replaceSteelConversationIdInUrl(conversationId);
  }, [conversationId]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    setIsEncodingFiles(true);
    try {
      const nextFiles = await Promise.all(files.map(toSelectedSteelFile));
      setSelectedFiles((current) => [...current, ...nextFiles]);
    } finally {
      setIsEncodingFiles(false);
    }
  };

  const removeSelectedFile = (id: string) => {
    setSelectedFiles((current) => current.filter((file) => file.id !== id));
  };

  const handleNewChat = () => {
    setInput('');
    setMessages([]);
    setLastResponse(null);
    setConversationId(null);
    setSelectedFiles([]);
    setStreamEvents([]);
    setIsSending(false);
    setIsEncodingFiles(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) {
      return;
    }

    const outgoingFiles = selectedFiles.map(({ filename, mediaType, dataBase64 }) => ({
      filename,
      mediaType,
      dataBase64,
    }));
    const content = input.trim() || 'Read the attached file(s).';
    const nextUserTurn = {
      ...createTurn(
        'user',
        content,
        outgoingFiles.map((file) => file.filename ?? 'attachment'),
      ),
      ...(outgoingFiles.length > 0 ? { files: outgoingFiles } : {}),
    };
    const nextMessages = [...messages, nextUserTurn];
    setInput('');
    setSelectedFiles([]);
    setMessages(nextMessages);
    setStreamEvents([]);
    setLastResponse(null);
    setIsSending(true);

    try {
      const payload: SteelProviderChatRequest = {
        model: steelModel,
        reasoningEffort,
        ...(conversationId ? { conversationId } : {}),
        messages: nextMessages
          .filter((message) => message.status !== 'error')
          .map(({ role, content, files }) => ({
            role,
            content,
            ...(files != null && files.length > 0 ? { files } : {}),
          })),
      };
      const response =
        typeof dataService.streamSteelChat === 'function'
          ? await dataService.streamSteelChat(payload, (event) => {
              const message = getStreamStatusMessage(event);
              if (!message) {
                return;
              }

              setStreamEvents((current) => [...current, event]);
            })
          : await dataService.sendSteelChat(payload);
      setLastResponse(response);
      if (response.conversationId) {
        setConversationId(response.conversationId);
      }
      setMessages([...nextMessages, createTurn('assistant', response.text)]);
    } catch (error) {
      const errorText = getErrorText(error);
      const errorEvent = createStreamErrorEvent(error);
      setStreamEvents((current) => {
        const lastEvent = current[current.length - 1];
        if (lastEvent?.type === 'error' && lastEvent.errorSummary === errorText) {
          return current;
        }
        return [...current, errorEvent];
      });
      setMessages([
        ...nextMessages,
        {
          ...createTurn('assistant', errorText),
          status: 'error',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const activityToggleLabel = isActivityPanelOpen ? 'Hide activity' : 'Show activity';
  const ActivityToggleIcon = isActivityPanelOpen ? PanelRightClose : PanelRightOpen;

  return (
    <main
      ref={layoutRef}
      data-testid="steel-chat-layout"
      className="flex h-full min-h-0 flex-col bg-surface-primary text-text-primary lg:flex-row"
    >
      <section className="flex h-full min-w-0 flex-1 flex-col px-4 py-4 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light pb-3">
          <div>
            <h1 className="text-xl font-semibold">{titleText}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-text-secondary">
              <span className="rounded border border-border-light px-2 py-1">{providerLabel}</span>
              {lastResponse?.responseId != null && (
                <span className="rounded border border-border-light px-2 py-1">
                  {lastResponse.responseId}
                </span>
              )}
              {lastResponse?.usage?.totalTokens != null && (
                <span className="rounded border border-border-light px-2 py-1">
                  {lastResponse.usage.totalTokens} {tokensLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSending || isEncodingFiles}
              onClick={handleNewChat}
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              {newChatText}
            </button>
            <div
              className="flex rounded-lg border border-border-light p-1"
              aria-label="Reasoning effort"
            >
              {reasoningEffortOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    option === reasoningEffort
                      ? 'bg-surface-active-alt text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover'
                  }`}
                  onClick={() => setReasoningEffort(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={activityToggleLabel}
              title={activityToggleLabel}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-light text-text-primary hover:bg-surface-hover"
              onClick={() => setIsActivityPanelOpen((current) => !current)}
            >
              <ActivityToggleIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-secondary">
              {emptyStateText}
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                const Icon = (() => {
                  if (message.status === 'error') {
                    return AlertCircle;
                  }
                  return isUser ? UserRound : Bot;
                })();
                let bubbleClass = 'border-border-light bg-surface-secondary';
                if (isUser) {
                  bubbleClass = 'border-transparent bg-surface-active-alt';
                } else if (message.status === 'error') {
                  bubbleClass = 'border-red-500/40 bg-red-500/10 text-text-primary';
                }
                return (
                  <article
                    key={message.id}
                    className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isUser && (
                      <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                    <div
                      className={`max-w-[min(42rem,85%)] rounded-lg border px-4 py-3 text-sm leading-6 ${
                        bubbleClass
                      }`}
                    >
                      <SteelMessageContent content={message.content} />
                      {message.attachmentNames != null && message.attachmentNames.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {message.attachmentNames.map((name) => (
                            <span
                              key={name}
                              className="max-w-56 truncate rounded border border-border-light px-2 py-0.5 text-xs text-text-secondary"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {isUser && (
                      <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                  </article>
                );
              })}
              {isSending && streamEvents.length > 0 && (
                <div
                  aria-label={streamStatusLabel}
                  className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-xs text-text-secondary"
                >
                  <div className="mb-2 flex items-center gap-2 text-text-primary">
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="font-medium">{streamStatusLabel}</span>
                  </div>
                  <StreamStatusTimeline events={streamEvents} />
                </div>
              )}
              {isSending && streamEvents.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {pendingText}
                </div>
              )}
            </div>
          )}
        </div>

        <form className="border-t border-border-light pt-3" onSubmit={handleSubmit}>
          {selectedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {selectedFiles.map((file) => (
                <span
                  key={file.id}
                  className="flex max-w-64 items-center gap-2 rounded border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary"
                >
                  <span className="truncate">{file.filename}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.filename}`}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-surface-hover"
                    onClick={() => removeSelectedFile(file.id)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-lg border border-border-light bg-surface-secondary p-2">
            <label
              className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              <input
                aria-label="Attach files"
                className="sr-only"
                multiple
                type="file"
                onChange={(event) => {
                  void handleFileChange(event);
                }}
              />
            </label>
            <textarea
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-text-secondary"
              placeholder="Message Steel"
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onCompositionStart={() => {
                isComposingInputRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingInputRef.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && isComposingInputRef.current) {
                  event.preventDefault();
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!canSend || isEncodingFiles}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-text-primary text-surface-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSending || isEncodingFiles ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </form>
      </section>
      {isActivityPanelOpen && (
        <aside
          className="min-h-0 border-t border-border-light lg:w-[24rem] lg:flex-shrink-0 lg:border-l lg:border-t-0"
        >
          <ActivityStatusPanel events={streamEvents} timings={lastResponse?.timings} />
        </aside>
      )}
    </main>
  );
}
