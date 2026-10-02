import type { ResponseTracker, StreamHandlerConfig } from '../../agents/responses/handlers';
import type { SteelResponseRequest, SteelResponseCompletionFactory } from './completion';
import type { Response } from '../../agents/responses/types';
import { finishSteelAgentResponse, isStandardSteelResponse, SteelResponseCompletionError } from './completion';
import { emitOutputTextDelta, emitResponseFailed } from '../../agents/responses/handlers';
import { extractSteelNativeResponseOutputText } from '../native/markdown';
import { hasSteelDataMarkdown } from './next';

function requiresSteelPersistence(req: SteelResponseRequest, markdown: string): boolean {
  const context = req.steelNativeContext;
  const delegate = context?.delegateOcrContext;
  return hasSteelDataMarkdown(markdown) || context?.ocrTurnActive === true ||
    delegate?.didExecute === true || Boolean(delegate?.activeRun || delegate?.delegateOcrRun) ||
    context?.quotation?.resume === true || context?.quotation?.pendingOrderPersisted === true;
}

export function replaceSteelResponsesMarkdown(response: Response, markdown: string): void {
  let last: { text: string } | undefined;
  let prefix = '';
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const content of item.content) {
      if (content.type !== 'output_text') continue;
      if (last) prefix += last.text;
      last = content;
    }
  }
  // Earlier message items may already be closed on the stream after a tool call.
  if (last) last.text = markdown.startsWith(prefix) ? markdown.slice(prefix.length) : markdown;
}

export function applySteelResponsesCompletionMarkdown(
  response: Response,
  message: { text: string },
  markdown: string,
): void {
  replaceSteelResponsesMarkdown(response, markdown);
  message.text = extractSteelNativeResponseOutputText(response);
}

export async function finalizeSteelResponsesTurn(
  input: {
    req: SteelResponseRequest;
    response: Response;
    responseId: string;
    store: boolean;
    saveConversation(): Promise<void>;
    saveInput(): Promise<void>;
    saveOutput(): Promise<void>;
    saveOrderWithoutMessage(): Promise<void>;
    onPersistenceFailure?(): void;
    tracker?: ResponseTracker;
    streamConfig?: StreamHandlerConfig;
  },
  dependencies: SteelResponseCompletionFactory,
): Promise<void> {
  const original = extractSteelNativeResponseOutputText(input.response);
  try {
    if (input.store) {
      await input.saveConversation();
      await input.saveInput();
      await input.saveOutput();
    } else {
      if (input.req.steelNativeContext?.quotation?.scope && isStandardSteelResponse(input.req)) {
        await input.saveOrderWithoutMessage();
      }
      await finishSteelAgentResponse(
        {
          req: input.req,
          responseId: input.responseId,
          markdown: extractSteelNativeResponseOutputText(input.response),
          completed: input.response.status === 'completed',
          applyMarkdown: (markdown) => replaceSteelResponsesMarkdown(input.response, markdown),
        },
        dependencies,
      );
    }
  } catch (error) {
    if (!requiresSteelPersistence(input.req, original)) {
      input.onPersistenceFailure?.();
      return;
    }
    const failure = error instanceof SteelResponseCompletionError
      ? error : new SteelResponseCompletionError('response_save_failed');
    if (input.streamConfig) {
      emitResponseFailed(input.streamConfig, {
        type: 'server_error', message: failure.message, code: failure.code,
      });
    }
    throw failure;
  }
  if (!input.tracker) return;
  const markdown = extractSteelNativeResponseOutputText(input.response);
  if (markdown !== original && markdown.startsWith(original) && input.streamConfig) {
    emitOutputTextDelta(input.streamConfig, markdown.slice(original.length));
  }
  const current = input.tracker.currentMessage?.content[input.tracker.currentContentIndex];
  if (current?.type === 'output_text') {
    input.tracker.accumulatedText = current.text;
  }
}
