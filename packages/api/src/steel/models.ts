type SteelAIDriver = 'openai_oauth_responses' | 'openai_api';
type SteelCapabilityStatus = 'passed' | 'failed' | 'not_run' | 'disabled' | 'not_applicable';

type SteelCapabilityId =
  | 'text'
  | 'streaming'
  | 'tool_calling'
  | 'structured_output'
  | 'workbook_patch'
  | 'image_input'
  | 'pdf_input'
  | 'xlsx_input'
  | 'file_search'
  | 'code_interpreter'
  | 'conversation_state';

type SteelCapabilityMap = Record<SteelCapabilityId, SteelCapabilityStatus>;

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
  models: Record<string, string[] | undefined>;
  modelSpecs?: {
    list?: LibreChatModelSpec[];
  };
  capabilities?: Record<string, SteelCapabilityMap | undefined>;
}

export interface SteelModelOption {
  id: string;
  label: string;
  model: string;
  provider: SteelAIDriver;
  source: 'librechat_model_spec' | 'default_preset' | 'endpoint_model';
  endpoint: '/v1/responses' | '/v1/chat/completions';
  defaultForSteel: boolean;
  requestedSettings: Record<string, string | number | boolean | null | string[] | number[]>;
  capabilities: SteelCapabilityMap;
  disabledReason?: string;
}

const defaultProvider: SteelAIDriver = 'openai_oauth_responses';
const defaultCapabilities: SteelCapabilityMap = {
  text: 'not_run',
  streaming: 'not_run',
  tool_calling: 'not_run',
  structured_output: 'not_run',
  workbook_patch: 'not_run',
  image_input: 'not_run',
  pdf_input: 'not_run',
  xlsx_input: 'not_run',
  file_search: 'not_run',
  code_interpreter: 'not_run',
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

function hasLibreChatModel(models: SteelModelOptionsInput['models'], endpoint: string, model: string) {
  return models[endpoint]?.includes(model) === true;
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

    if (!endpoint || !model || !hasLibreChatModel(models, endpoint, model)) {
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
