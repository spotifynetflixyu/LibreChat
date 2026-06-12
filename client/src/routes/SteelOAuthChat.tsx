import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  GripVertical,
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
  SteelProviderChatFile,
  SteelProviderChatMessage,
  SteelProviderReasoningEffort,
  SteelProviderChatResponse,
  SteelProviderChatStreamEvent,
  SteelChangedPath,
  SteelFileAnalysisData,
  SteelFileAnalysisManualPatchRequest,
  SteelWorkbook,
  SteelWorkbookSheetId,
} from 'librechat-data-provider';
import SteelFileAnalysisPreview from '~/features/steel/fileAnalysis/Preview';
import SteelWorkbookPreview from '~/features/steel/workbook/Preview';

type SteelChatTurn = SteelProviderChatMessage & {
  id: string;
  status?: 'error';
  attachmentNames?: string[];
};

type SelectedSteelFile = SteelProviderChatFile & {
  id: string;
};

type SteelRightPanelTab = 'workbook' | 'fileAnalysis' | 'thinking';

const steelModel = 'gpt-5.5';
const workbookMinWidthPx = 100;
const chatMinWidthPx = 200;
const reasoningEffortOptions: SteelProviderReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const rightPanelTabs: Array<{ id: SteelRightPanelTab; label: string }> = [
  { id: 'workbook', label: 'Workbook' },
  { id: 'fileAnalysis', label: 'File Analysis' },
  { id: 'thinking', label: 'Thinking' },
];
const titleText = 'Steel OAuth Chat';
const tokensLabel = 'tokens';
const emptyStateText = 'Ready';
const pendingText = 'Waiting for provider';
const newChatText = 'New chat';
const streamStatusLabel = 'Steel stream status';
const thinkingStatusTitle = 'Last run';
const thinkingStatusSubtitle = 'last run';
const noThinkingStatusText = 'No run status yet.';
const workbookExportContentType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

function clampWorkbookWidth(widthPx: number, layoutWidthPx: number): number {
  const maxWorkbookWidthPx = Math.max(workbookMinWidthPx, layoutWidthPx - chatMinWidthPx);
  return Math.min(maxWorkbookWidthPx, Math.max(workbookMinWidthPx, Math.round(widthPx)));
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

function getWorkbookSheetIds(workbook: SteelWorkbook): SteelWorkbookSheetId[] {
  return workbook.sheets.map((sheet) => sheet.id);
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

function StreamStatusTimeline({ events }: { events: SteelProviderChatStreamEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-text-secondary">{noThinkingStatusText}</p>;
  }

  return (
    <ol className="space-y-2">
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
          <li key={`${event.type}-${index}-${message}`} className="grid grid-cols-[1rem_1fr] gap-2">
            <span
              className={`mt-0.5 flex h-4 w-4 items-center justify-center ${
                isFailed ? 'text-red-400' : 'text-text-secondary'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${isActive ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] uppercase text-text-secondary">
                {getStreamStatusLabel(event)}
              </span>
              <span className="block whitespace-pre-wrap break-words text-text-primary">
                {message}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ThinkingStatusPanel({ events }: { events: SteelProviderChatStreamEvent[] }) {
  return (
    <section
      aria-label="Thinking status panel"
      className="flex h-full min-h-0 flex-col bg-surface-primary"
    >
      <header className="border-b border-border-light px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-text-primary">{thinkingStatusTitle}</h2>
        <p className="mt-0.5 text-xs text-text-secondary">{thinkingStatusSubtitle}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 text-xs text-text-secondary">
        <StreamStatusTimeline events={events} />
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

export default function SteelOAuthChat() {
  const layoutRef = useRef<HTMLElement | null>(null);
  const isComposingInputRef = useRef(false);
  const [input, setInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<SteelProviderReasoningEffort>('medium');
  const [messages, setMessages] = useState<SteelChatTurn[]>([]);
  const [lastResponse, setLastResponse] = useState<SteelProviderChatResponse | null>(null);
  const [workbook, setWorkbook] = useState<SteelWorkbook | null>(null);
  const [fileAnalysisData, setFileAnalysisData] = useState<SteelFileAnalysisData | null>(null);
  const [changedPaths, setChangedPaths] = useState<SteelChangedPath[]>([]);
  const [workbookExportSheetIds, setWorkbookExportSheetIds] = useState<SteelWorkbookSheetId[]>([]);
  const [isWorkbookExporting, setIsWorkbookExporting] = useState(false);
  const [workbookExportError, setWorkbookExportError] = useState<string | null>(null);
  const [isWorkbookLoading, setIsWorkbookLoading] = useState(true);
  const [workbookError, setWorkbookError] = useState<string | null>(null);
  const [isWorkbookPanelOpen, setIsWorkbookPanelOpen] = useState(true);
  const [activeRightPanelTab, setActiveRightPanelTab] = useState<SteelRightPanelTab>('workbook');
  const [isWorkbookResizing, setIsWorkbookResizing] = useState(false);
  const [workbookWidthPx, setWorkbookWidthPx] = useState<number | null>(null);
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

  const initializeWorkbook = useCallback(async () => {
    setIsWorkbookLoading(true);
    setWorkbookError(null);
    try {
      const result = await dataService.createSteelWorkbook({});
      setWorkbook(result.workbook);
      setWorkbookExportSheetIds(getWorkbookSheetIds(result.workbook));
      setChangedPaths([]);
    } catch (error) {
      setWorkbook(null);
      setWorkbookExportSheetIds([]);
      setChangedPaths([]);
      setWorkbookError(getErrorText(error));
    } finally {
      setIsWorkbookLoading(false);
    }
  }, []);

  useEffect(() => {
    void initializeWorkbook();
  }, [initializeWorkbook]);

  const resizeWorkbookPanel = useCallback((clientX: number) => {
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }

    const rect = layout.getBoundingClientRect();
    const layoutWidth = layout.clientWidth || rect.width;
    if (layoutWidth <= 0) {
      return;
    }

    setWorkbookWidthPx(clampWorkbookWidth(layoutWidth - (clientX - rect.left), layoutWidth));
  }, []);

  useEffect(() => {
    if (!isWorkbookResizing) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => resizeWorkbookPanel(event.clientX);
    const handleMouseUp = () => setIsWorkbookResizing(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isWorkbookResizing, resizeWorkbookPanel]);

  const handleWorkbookResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsWorkbookPanelOpen(true);
    setIsWorkbookResizing(true);
    resizeWorkbookPanel(event.clientX);
  };

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
    setSelectedFiles([]);
    setChangedPaths([]);
    setFileAnalysisData(null);
    setWorkbookExportError(null);
    setStreamEvents([]);
    setIsSending(false);
    setIsEncodingFiles(false);
    void initializeWorkbook();
  };

  const handleToggleWorkbookExportSheet = (sheetId: SteelWorkbookSheetId) => {
    setWorkbookExportSheetIds((current) =>
      current.includes(sheetId)
        ? current.filter((candidate) => candidate !== sheetId)
        : [...current, sheetId],
    );
  };

  const handleDownloadWorkbook = async () => {
    if (!workbook || workbookExportSheetIds.length === 0) {
      return;
    }

    setIsWorkbookExporting(true);
    setWorkbookExportError(null);
    try {
      const arrayBuffer = await dataService.exportSteelWorkbook(workbook.id, {
        workbookVersion: workbook.version,
        sheetIds: workbookExportSheetIds,
      });
      const blob = new Blob([arrayBuffer], { type: workbookExportContentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `steel-workbook-${workbook.id}-v${workbook.version}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setWorkbookExportError(getErrorText(error));
    } finally {
      setIsWorkbookExporting(false);
    }
  };

  const handleSaveFileAnalysisData = async (
    fileAnalysisDataId: string,
    payload: SteelFileAnalysisManualPatchRequest,
  ) => {
    const response = await dataService.patchSteelFileAnalysisData(fileAnalysisDataId, payload);
    setFileAnalysisData(response.fileAnalysisData);
    return response.fileAnalysisData;
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
    setIsSending(true);

    try {
      const payload = {
        model: steelModel,
        reasoningEffort,
        ...(workbook
          ? {
              conversationId: workbook.id,
              workbookId: workbook.id,
              workbookVersion: workbook.version,
              selectedWorkbookRefs: [],
            }
          : {}),
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

              setStreamEvents((current) => [...current, event].slice(-12));
            })
          : await dataService.sendSteelChat(payload);
      setLastResponse(response);
      if (response.workbookPatch?.workbook) {
        setWorkbook(response.workbookPatch.workbook);
        setChangedPaths(response.workbookPatch.changedPaths);
        setActiveRightPanelTab('workbook');
        setIsWorkbookPanelOpen(true);
      }
      if (response.fileAnalysisData) {
        setFileAnalysisData(response.fileAnalysisData);
        if (!response.workbookPatch?.workbook) {
          setActiveRightPanelTab('fileAnalysis');
          setIsWorkbookPanelOpen(true);
        }
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
        return [...current, errorEvent].slice(-12);
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

  const workbookToggleLabel = isWorkbookPanelOpen ? 'Hide workbook' : 'Show workbook';
  const WorkbookToggleIcon = isWorkbookPanelOpen ? PanelRightClose : PanelRightOpen;
  const workbookPanelStyle = {
    width: workbookWidthPx == null ? '50%' : `${workbookWidthPx}px`,
  };
  let rightPanelContent;
  if (activeRightPanelTab === 'workbook') {
    rightPanelContent = (
      <SteelWorkbookPreview
        workbook={workbook}
        changedPaths={changedPaths}
        downloadError={workbookExportError}
        error={workbookError}
        exportSheetIds={workbookExportSheetIds}
        isDownloading={isWorkbookExporting}
        isLoading={isWorkbookLoading}
        onDownload={() => {
          void handleDownloadWorkbook();
        }}
        onRetry={() => {
          void initializeWorkbook();
        }}
        onToggleExportSheet={handleToggleWorkbookExportSheet}
      />
    );
  } else if (activeRightPanelTab === 'fileAnalysis') {
    rightPanelContent = (
      <SteelFileAnalysisPreview
        fileAnalysisData={fileAnalysisData}
        onSave={handleSaveFileAnalysisData}
      />
    );
  } else {
    rightPanelContent = <ThinkingStatusPanel events={streamEvents} />;
  }

  return (
    <main
      ref={layoutRef}
      data-testid="steel-workbook-layout"
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
              aria-label={workbookToggleLabel}
              title={workbookToggleLabel}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-light text-text-primary hover:bg-surface-hover"
              onClick={() => setIsWorkbookPanelOpen((current) => !current)}
            >
              <WorkbookToggleIcon className="h-4 w-4" aria-hidden="true" />
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
                      className={`max-w-[min(42rem,85%)] whitespace-pre-wrap rounded-lg border px-4 py-3 text-sm leading-6 ${
                        bubbleClass
                      }`}
                    >
                      {message.content}
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
      {isWorkbookPanelOpen && (
        <>
          <div
            role="separator"
            aria-label="Resize workbook panel"
            aria-orientation="vertical"
            className="hidden w-2 cursor-col-resize items-center justify-center border-l border-border-light bg-surface-primary hover:bg-surface-hover lg:flex"
            onMouseDown={handleWorkbookResizeStart}
          >
            <GripVertical className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          </div>
          <aside
            aria-label="Workbook panel"
            className="min-h-0 border-t border-border-light lg:flex-shrink-0 lg:border-t-0"
            style={workbookPanelStyle}
          >
            <div className="flex h-full min-h-0 flex-col bg-surface-primary">
              <div
                role="tablist"
                aria-label="Steel right panel"
                className="flex gap-1 border-b border-border-light px-3 py-2"
              >
                {rightPanelTabs.map((tab) => {
                  const selected = activeRightPanelTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`rounded px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? 'bg-surface-active-alt text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover'
                      }`}
                      onClick={() => setActiveRightPanelTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1">{rightPanelContent}</div>
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
