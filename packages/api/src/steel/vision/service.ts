import type { SteelAIProviderErrorCategory } from 'librechat-data-provider';

import { buildDrawingEvidencePrompt } from './prompt';

import type {
  SteelOAuthChatFile,
  SteelOAuthChatMessage,
  SteelProviderChatResponse,
} from '../ai/provider';

export type SteelDrawingEvidenceProviderResponse = Pick<
  SteelProviderChatResponse,
  'provider' | 'model' | 'text' | 'warnings' | 'unsupportedSettings'
>;

export interface SteelDrawingEvidenceProviderInput {
  model: string;
  messages: SteelOAuthChatMessage[];
  workbookPatchTool: false;
  steelRuntimePolicy: false;
}

export type SteelDrawingEvidenceProvider = (
  input: SteelDrawingEvidenceProviderInput,
) => Promise<SteelDrawingEvidenceProviderResponse>;

export interface ExtractSteelDrawingEvidenceInput {
  model: string;
  files: readonly SteelOAuthChatFile[];
  userInstruction: string;
  ocrAgentRuleInstruction: string;
  previousAnalysisText?: string;
  rereadOriginalFiles?: boolean;
  provider: SteelDrawingEvidenceProvider;
}

export interface SteelDrawingEvidenceExtractionSuccess {
  status: 'ok';
  provider: 'openai_oauth_responses';
  model: string;
  text: string;
  warnings: string[];
}

export interface SteelDrawingEvidenceExtractionUnsupported {
  status: 'unsupported';
  errorCategory: SteelAIProviderErrorCategory;
  message: string;
}

export type SteelDrawingEvidenceExtractionResult =
  | SteelDrawingEvidenceExtractionSuccess
  | SteelDrawingEvidenceExtractionUnsupported;

const unsupportedVisionInputErrorCategory: SteelAIProviderErrorCategory =
  'provider_vision_input_unsupported';

export class SteelDrawingEvidenceExtractionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SteelDrawingEvidenceExtractionError';
  }
}

function isVisionFile(file: SteelOAuthChatFile) {
  return file.mediaType.startsWith('image/') || file.mediaType === 'application/pdf';
}

function createUserInstruction({
  userInstruction,
  previousAnalysisText,
  rereadOriginalFiles,
}: {
  userInstruction: string;
  previousAnalysisText?: string;
  rereadOriginalFiles?: boolean;
}) {
  const previousText = previousAnalysisText?.trim();

  if (!previousText) {
    return userInstruction;
  }

  return [
    rereadOriginalFiles
      ? '重新判讀時，以上傳原始檔案為準；以下上一輪判讀只作為使用者指出的差異脈絡。'
      : '以下上一輪判讀只作為脈絡，不可取代原始檔案判讀。',
    previousText,
    '',
    userInstruction,
  ].join('\n');
}

export async function extractSteelDrawingEvidence({
  model,
  files,
  userInstruction,
  ocrAgentRuleInstruction,
  previousAnalysisText,
  rereadOriginalFiles,
  provider,
}: ExtractSteelDrawingEvidenceInput): Promise<SteelDrawingEvidenceExtractionResult> {
  if (!files.some(isVisionFile)) {
    return {
      status: 'unsupported',
      errorCategory: unsupportedVisionInputErrorCategory,
      message: 'Steel drawing evidence extraction requires an image or PDF file.',
    };
  }

  const content = buildDrawingEvidencePrompt({
    ocrAgentRuleInstruction,
    userInstruction: createUserInstruction({
      userInstruction,
      previousAnalysisText,
      rereadOriginalFiles,
    }),
  });

  try {
    const response = await provider({
      model,
      messages: [
        {
          role: 'user',
          content,
          files: [...files],
        },
      ],
      workbookPatchTool: false,
      steelRuntimePolicy: false,
    });

    return {
      status: 'ok',
      provider: response.provider,
      model: response.model,
      text: response.text,
      warnings: response.warnings,
    };
  } catch (error) {
    throw new SteelDrawingEvidenceExtractionError(
      'Steel drawing evidence extraction failed.',
      error,
    );
  }
}
