import { EModelEndpoint } from 'librechat-data-provider';
import type { BaseInitializeParams, InitializeResultBase } from '~/types';

export async function initializeOpenAIOAuth({
  model_parameters,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  const modelOptions = {
    ...(model_parameters ?? {}),
    model: model_parameters?.model,
  };

  return {
    provider: EModelEndpoint.openAIOAuth,
    llmConfig: {
      ...modelOptions,
      streaming: true,
    },
  };
}
