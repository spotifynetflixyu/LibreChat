import { EModelEndpoint } from 'librechat-data-provider';
import type { InitializeResultBase, ProviderInitializeParams } from '~/types';
import { parseOpenAIConfig } from '~/steel/ai/config';

export async function initializeOpenAIOAuth({
  model_parameters,
}: ProviderInitializeParams): Promise<InitializeResultBase> {
  const modelOptions = {
    ...(model_parameters ?? {}),
    model:
      typeof model_parameters?.model === 'string'
        ? model_parameters.model
        : parseOpenAIConfig(process.env).model,
  };

  return {
    provider: EModelEndpoint.openAIOAuth,
    llmConfig: {
      ...modelOptions,
      streaming: true,
    },
  };
}
