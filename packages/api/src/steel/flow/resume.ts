import { ErrorTypes, steelFlowResumeSchema } from 'librechat-data-provider';
import type { SteelFlowResume } from 'librechat-data-provider';
import type { prepareQuotationTurn } from '../quotation/preparation';
import type { SteelDelegateOcrService } from '../native/delegation';
import type { SteelOcrService } from '../ocr/preflight';
import { SteelFlowReplayError } from '../replay';

type QuotationInput = Parameters<typeof prepareQuotationTurn>[0];
type OcrInput = Parameters<SteelOcrService['runSteelPaddleOcrPreflight']>[0];
type DelegateInput = Parameters<SteelDelegateOcrService['prepareDelegateOcrResume']>[0];

interface SteelFlowRequestBody {
  steelFlowResume?: unknown;
  isRegenerate?: boolean;
  isContinued?: boolean;
  compact?: boolean;
  editedContent?: unknown;
  responseMessageId?: string;
}

interface SteelFlowTurnInput extends Omit<QuotationInput, 'resume'> {
  body?: SteelFlowRequestBody;
  ocr: OcrInput & { req: DelegateInput['req'] };
  readMessage(input: { user: string; messageId: string }): Promise<{
    conversationId?: string | null;
    isCreatedByUser?: boolean;
    parentMessageId?: string | null;
  } | null>;
}

function parseSteelFlowResume(
  body?: SteelFlowRequestBody,
): (SteelFlowResume & { sourceMessageId: string }) | undefined {
  if (body?.steelFlowResume === undefined) return undefined;
  const parsed = steelFlowResumeSchema.safeParse(body.steelFlowResume);
  const source = body.responseMessageId;
  if (
    !parsed.success ||
    body.isRegenerate !== true ||
    body.isContinued ||
    body.compact ||
    body.editedContent != null ||
    typeof source !== 'string' ||
    source.length < 2 ||
    source.length > 513 ||
    !source.endsWith('_')
  ) {
    throw new SteelFlowReplayError(ErrorTypes.STEEL_FLOW_NOT_RESUMABLE);
  }
  return { ...parsed.data, sourceMessageId: source.slice(0, -1) };
}

export function rejectInvalidSteelFlowResume(req: { body?: SteelFlowRequestBody }, res: {
  status(code: number): { json(body: { code: string }): void };
}): boolean {
  try {
    parseSteelFlowResume(req.body);
    return false;
  } catch (error) {
    if (!(error instanceof SteelFlowReplayError)) throw error;
    res.status(400).json({ code: error.code });
    return true;
  }
}

export async function prepareSteelFlowTurn(input: SteelFlowTurnInput, dependencies: {
  prepareQuotationTurn: typeof prepareQuotationTurn;
  prepareDelegateOcrResume: SteelDelegateOcrService['prepareDelegateOcrResume'];
  runSteelPaddleOcrPreflight: SteelOcrService['runSteelPaddleOcrPreflight'];
}): Promise<{
  quotation: Awaited<ReturnType<typeof prepareQuotationTurn>>;
  delegateOcrResume: Awaited<ReturnType<SteelDelegateOcrService['prepareDelegateOcrResume']>>;
  paddleOcrPreflight: Awaited<ReturnType<SteelOcrService['runSteelPaddleOcrPreflight']>> |
    { ocrTurnActive: false; delegateOcrResume?: true };
}> {
  const { body, ocr, readMessage, ...quotationInput } = input;
  const { scope, messageId } = quotationInput;
  const resume = parseSteelFlowResume(body);
  if (resume) {
    const source = await readMessage({ user: scope.userId, messageId: resume.sourceMessageId });
    if (
      !source ||
      source.isCreatedByUser !== false ||
      source.conversationId !== scope.conversationId ||
      source.parentMessageId !== messageId
    ) {
      throw new SteelFlowReplayError(ErrorTypes.STEEL_FLOW_NOT_FOUND);
    }
  }

  if (resume?.kind === 'quotation') {
    const quotation = await dependencies.prepareQuotationTurn({ ...quotationInput, resume });
    return { quotation, delegateOcrResume: undefined, paddleOcrPreflight: { ocrTurnActive: false } };
  }

  if (resume?.kind === 'delegate') {
    const delegateOcrResume = await dependencies.prepareDelegateOcrResume({
      req: ocr.req,
      conversationId: scope.conversationId,
      userId: scope.userId,
      resume,
    });
    if (!delegateOcrResume) {
      throw new SteelFlowReplayError(ErrorTypes.STEEL_FLOW_NOT_RESUMABLE);
    }
    const quotation = await dependencies.prepareQuotationTurn(quotationInput);
    return {
      quotation,
      delegateOcrResume,
      paddleOcrPreflight: { ocrTurnActive: false, delegateOcrResume: true },
    };
  }

  if (resume?.kind === 'preflight') {
    const paddleOcrPreflight = await dependencies.runSteelPaddleOcrPreflight({ ...ocr, resume });
    const quotation = await dependencies.prepareQuotationTurn(quotationInput);
    return { quotation, delegateOcrResume: undefined, paddleOcrPreflight };
  }

  const quotation = await dependencies.prepareQuotationTurn(quotationInput);
  const paddleOcrPreflight = await dependencies.runSteelPaddleOcrPreflight(ocr);
  return { quotation, delegateOcrResume: undefined, paddleOcrPreflight };
}
