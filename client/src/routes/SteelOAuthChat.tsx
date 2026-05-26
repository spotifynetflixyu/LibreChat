import { useMemo, useState } from 'react';
import { AlertCircle, Bot, Loader2, Send, UserRound } from 'lucide-react';
import { dataService } from 'librechat-data-provider';
import type { SteelProviderChatMessage, SteelProviderChatResponse } from 'librechat-data-provider';

type SteelChatTurn = SteelProviderChatMessage & {
  id: string;
  status?: 'error';
};

const modelOptions = ['gpt-5.4', 'gpt-5.5'] as const;
const titleText = 'Steel OAuth Chat';
const tokensLabel = 'tokens';
const emptyStateText = 'Ready';
const pendingText = 'Waiting for provider';

function createTurn(role: SteelProviderChatMessage['role'], content: string): SteelChatTurn {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
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

export default function SteelOAuthChat() {
  const [input, setInput] = useState('');
  const [model, setModel] = useState<(typeof modelOptions)[number]>('gpt-5.4');
  const [messages, setMessages] = useState<SteelChatTurn[]>([]);
  const [lastResponse, setLastResponse] = useState<SteelProviderChatResponse | null>(null);
  const [isSending, setIsSending] = useState(false);

  const providerLabel = useMemo(
    () => lastResponse?.provider ?? 'openai_oauth_responses',
    [lastResponse],
  );
  const canSend = input.trim().length > 0 && !isSending;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) {
      return;
    }

    const nextUserTurn = createTurn('user', input.trim());
    const nextMessages = [...messages, nextUserTurn];
    setInput('');
    setMessages(nextMessages);
    setIsSending(true);

    try {
      const response = await dataService.sendSteelChat({
        model,
        messages: nextMessages
          .filter((message) => message.status !== 'error')
          .map(({ role, content }) => ({ role, content })),
      });
      setLastResponse(response);
      setMessages([...nextMessages, createTurn('assistant', response.text)]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          ...createTurn('assistant', getErrorText(error)),
          status: 'error',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="flex h-full min-h-0 bg-surface-primary text-text-primary">
      <section className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 py-4 md:px-6">
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
          <div className="flex rounded-lg border border-border-light p-1" aria-label="Model">
            {modelOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  option === model
                    ? 'bg-surface-active-alt text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                onClick={() => setModel(option)}
              >
                {option}
              </button>
            ))}
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
                    </div>
                    {isUser && (
                      <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                  </article>
                );
              })}
              {isSending && (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {pendingText}
                </div>
              )}
            </div>
          )}
        </div>

        <form className="border-t border-border-light pt-3" onSubmit={handleSubmit}>
          <div className="flex items-end gap-2 rounded-lg border border-border-light bg-surface-secondary p-2">
            <textarea
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-text-secondary"
              placeholder="Message Steel"
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!canSend}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-text-primary text-surface-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
