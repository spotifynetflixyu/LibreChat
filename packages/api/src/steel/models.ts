import type { SteelAIDriver, SteelCapabilityMap, SteelModelOption } from 'librechat-data-provider';

const activeSteelOAuthModel = 'gpt-5.5';

interface LibreChatModelSpec {
  name: string;
  label?: string;
  default?: boolean;
  preset: {
    endpoint?: string | null;
    model?: string | null;
    temperature?: number;
    top_p?: number;
    topP?: number;
    max_tokens?: number;
    maxOutputTokens?: number;
    reasoning_summary?: string;
    reasoningSummary?: string;
    verbosity?: string;
  };
}

interface SteelModelOptionsInput {
  models: {
    [endpoint: string]: string[] | undefined;
  };
  modelSpecs?: {
    list?: LibreChatModelSpec[];
  };
  capabilities?: {
    [id: string]: SteelCapabilityMap | undefined;
  };
}

const defaultProvider: SteelAIDriver = 'openai_oauth_responses';
const defaultCapabilities: SteelCapabilityMap = {
  text: 'unverified',
  streaming: 'unverified',
  tool_calling: 'unverified',
  structured_output: 'unverified',
  workbook_patch: 'unverified',
  image_input: 'unverified',
  pdf_input: 'unverified',
  doc_input: 'unverified',
  docx_input: 'unverified',
  xls_input: 'unverified',
  xlsx_input: 'unverified',
  file_search: 'unverified',
  code_interpreter: 'unverified',
  conversation_state: 'not_applicable',
};

function getModelOptionId(provider: SteelAIDriver, model: string): string {
  return `${provider}:${model}`;
}

function getRequestedSettings(spec: LibreChatModelSpec) {
  const preset = spec.preset;
  const settings: SteelModelOption['requestedSettings'] = {};

  if (preset.temperature !== undefined) {
    settings.temperature = preset.temperature;
  }
  if (preset.top_p !== undefined) {
    settings.top_p = preset.top_p;
  }
  if (preset.topP !== undefined) {
    settings.topP = preset.topP;
  }
  if (preset.max_tokens !== undefined) {
    settings.max_tokens = preset.max_tokens;
  }
  if (preset.maxOutputTokens !== undefined) {
    settings.maxOutputTokens = preset.maxOutputTokens;
  }
  if (preset.reasoning_summary !== undefined) {
    settings.reasoning_summary = preset.reasoning_summary;
  }
  if (preset.reasoningSummary !== undefined) {
    settings.reasoningSummary = preset.reasoningSummary;
  }
  if (preset.verbosity !== undefined) {
    settings.verbosity = preset.verbosity;
  }

  return settings;
}

function hasLibreChatModel(
  models: SteelModelOptionsInput['models'],
  endpoint: string,
  model: string,
) {
  return models[endpoint]?.includes(model) === true;
}

function isActiveSteelModel(model: string): boolean {
  return model === activeSteelOAuthModel;
}

export function buildSteelModelOptions({
  models,
  modelSpecs,
  capabilities = {},
}: SteelModelOptionsInput): SteelModelOption[] {
  const options: SteelModelOption[] = [];

  for (const spec of modelSpecs?.list ?? []) {
    const endpoint = spec.preset.endpoint ?? '';
    const model = spec.preset.model ?? '';

    if (
      !endpoint ||
      !model ||
      !isActiveSteelModel(model) ||
      !hasLibreChatModel(models, endpoint, model)
    ) {
      continue;
    }

    const id = getModelOptionId(defaultProvider, model);
    options.push({
      id,
      label: spec.label ?? model,
      model,
      provider: defaultProvider,
      source: 'librechat_model_spec',
      endpoint: '/v1/responses',
      defaultForSteel: spec.default === true,
      requestedSettings: getRequestedSettings(spec),
      capabilities: capabilities[id] ?? defaultCapabilities,
    });
  }

  if (options.length > 0) {
    return options;
  }

  for (const model of models.openAI ?? []) {
    if (!isActiveSteelModel(model)) {
      continue;
    }

    const id = getModelOptionId(defaultProvider, model);
    options.push({
      id,
      label: model,
      model,
      provider: defaultProvider,
      source: 'endpoint_model',
      endpoint: '/v1/responses',
      defaultForSteel: options.length === 0,
      requestedSettings: {},
      capabilities: capabilities[id] ?? defaultCapabilities,
    });
  }

  return options;
}
