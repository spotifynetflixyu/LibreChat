import type { SteelQuotationScope } from '@librechat/data-schemas';
import { appendSteelNextStep, hasSteelDataMarkdown, steelSectionTitle } from './next';
import { resolveRequestTenantId } from '../../middleware/tenant';
import { parseAssistantMarkdown } from '../ocr/result';

export interface SteelResponseRequest {
  user?: { id?: string; tenantId?: string };
  tenantId?: string;
  cookies?: { lang?: string };
  headers?: { 'accept-language'?: string };
  steelNativeContext?: {
    contextMetadata?: { mode?: string };
    ocrTurnActive?: boolean;
    delegateOcrContext?: {
      didExecute?: boolean;
      activeRun?: object;
      delegateOcrRun?: object;
    };
    quotation?: {
      scope: SteelQuotationScope;
      resume?: boolean;
      pendingOrderPersisted?: boolean;
    };
  };
}

export interface SteelResponseCompletionInput {
  req: SteelResponseRequest;
  responseId: string;
  markdown: string;
  completed: boolean;
  ocrSucceeded?: boolean;
  applyMarkdown(markdown: string): void;
  persistMarkdown?(): Promise<object | null | undefined>;
}

export interface SteelResponseCompletionDependencies {
  readOrder(scope: SteelQuotationScope): Promise<string | undefined>;
  readCustomer(scope: SteelQuotationScope): Promise<string | undefined>;
  reviseOrder(input: {
    scope: SteelQuotationScope;
    response: string;
    responseId: string;
  }): Promise<{ ok: true; markdown: string } | { ok: false; code: string }>;
}

export type SteelResponseCompletionFactory =
  | SteelResponseCompletionDependencies
  | (() => SteelResponseCompletionDependencies);

export class SteelResponseCompletionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Steel response could not be finalized.');
    this.name = 'SteelResponseCompletionError';
    this.code = code;
  }
}

export function isStandardSteelResponse(req: SteelResponseRequest): boolean {
  const context = req.steelNativeContext;
  const delegate = context?.delegateOcrContext;
  return (
    Boolean(context?.quotation) &&
    context?.ocrTurnActive !== true &&
    (!context?.contextMetadata?.mode || context.contextMetadata.mode === 'standard') &&
    delegate?.didExecute !== true &&
    !delegate?.activeRun &&
    !delegate?.delegateOcrRun &&
    context?.quotation?.resume !== true &&
    context?.quotation?.pendingOrderPersisted !== true
  );
}

export async function finishSteelAgentResponse(
  input: SteelResponseCompletionInput,
  factory: SteelResponseCompletionFactory,
): Promise<void> {
  const scope = input.req.steelNativeContext?.quotation?.scope;
  if (
    !scope ||
    !isStandardSteelResponse(input.req) ||
    !input.completed ||
    input.ocrSucceeded === false ||
    !hasSteelDataMarkdown(input.markdown)
  ) {
    return;
  }
  if (
    scope.userId !== input.req.user?.id ||
    scope.tenantId !== resolveRequestTenantId(input.req)
  ) {
    throw new SteelResponseCompletionError('invalid_response_scope');
  }
  try {
    const dependencies = typeof factory === 'function' ? factory() : factory;
    const sections = parseAssistantMarkdown(input.markdown).sections;
    let markdown = input.markdown;
    if (sections.some((section) => steelSectionTitle(section.title) === 'system_order_updates')) {
      const revision = await dependencies.reviseOrder({
        scope,
        response: markdown,
        responseId: input.responseId,
      });
      if (!revision.ok) {
        throw new SteelResponseCompletionError(revision.code);
      }
      markdown = revision.markdown;
    }
    if (
      !parseAssistantMarkdown(markdown).sections.some(
        (section) => steelSectionTitle(section.title) === 'system_order',
      )
    ) {
      const [order, customer] = await Promise.all([
        dependencies.readOrder(scope),
        dependencies.readCustomer(scope),
      ]);
      markdown = appendSteelNextStep({
        markdown,
        order,
        customer,
        completed: true,
        mode: 'standard',
        language:
          input.req.cookies?.lang ||
          input.req.headers?.['accept-language']?.split(',')[0] ||
          'en',
      });
    }
    if (markdown === input.markdown) return;
    input.applyMarkdown(markdown);
    if (input.persistMarkdown && !(await input.persistMarkdown())) {
      throw new SteelResponseCompletionError('response_save_failed');
    }
  } catch (error) {
    if (error instanceof SteelResponseCompletionError) throw error;
    throw new SteelResponseCompletionError('response_save_failed');
  }
}
