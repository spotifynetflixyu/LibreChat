import {
  EModelEndpoint,
  LocalStorageKeys,
  isUUID,
} from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';

type LastSelectedModels = Record<string, string | undefined>;

function removeLegacyOpenAIOAuthModel(
  models: LastSelectedModels | null,
): LastSelectedModels | null {
  if (!models || !Object.hasOwn(models, EModelEndpoint.openAIOAuth)) {
    return models;
  }

  const normalized = { ...models };
  if (!Object.hasOwn(normalized, EModelEndpoint.openAI)) {
    normalized[EModelEndpoint.openAI] = normalized[EModelEndpoint.openAIOAuth];
  }
  delete normalized[EModelEndpoint.openAIOAuth];
  return normalized;
}

export function storeLastSelectedModel(endpoint: string, model?: string): void {
  const stored = localStorage.getItem(LocalStorageKeys.LAST_MODEL) ?? '';
  const parsed = stored ? (JSON.parse(stored) as LastSelectedModels) : {};
  const models = removeLegacyOpenAIOAuthModel(parsed) ?? {};
  const storageEndpoint =
    endpoint === EModelEndpoint.openAIOAuth ? EModelEndpoint.openAI : endpoint;

  models[storageEndpoint] = model;
  localStorage.setItem(LocalStorageKeys.LAST_MODEL, JSON.stringify(models));
}

export function getLocalStorageItems() {
  const items = {
    lastSelectedModel: localStorage.getItem(LocalStorageKeys.LAST_MODEL) ?? '',
    lastSelectedTools: localStorage.getItem(LocalStorageKeys.LAST_TOOLS) ?? '',
    lastConversationSetup: localStorage.getItem(LocalStorageKeys.LAST_CONVO_SETUP + '_0') ?? '',
  };

  const parsedLastSelectedModel = items.lastSelectedModel
    ? (JSON.parse(items.lastSelectedModel) as LastSelectedModels | null)
    : {};
  const lastSelectedModel = removeLegacyOpenAIOAuthModel(parsedLastSelectedModel);
  if (lastSelectedModel !== parsedLastSelectedModel) {
    localStorage.setItem(LocalStorageKeys.LAST_MODEL, JSON.stringify(lastSelectedModel));
  }
  const lastSelectedTools = items.lastSelectedTools
    ? (JSON.parse(items.lastSelectedTools) as string[] | null)
    : [];
  const lastConversationSetup = items.lastConversationSetup
    ? (JSON.parse(items.lastConversationSetup) as Partial<TConversation> | null)
    : {};

  return {
    lastSelectedModel,
    lastSelectedTools,
    lastConversationSetup,
  };
}

export function clearLocalStorage(skipFirst?: boolean) {
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (skipFirst === true && key.endsWith('0')) {
      return;
    }
    if (
      key.startsWith(LocalStorageKeys.LAST_MCP_) ||
      key.startsWith(LocalStorageKeys.LAST_CODE_TOGGLE_) ||
      key.startsWith(LocalStorageKeys.LAST_MEMORY_TOGGLE_) ||
      key.startsWith(LocalStorageKeys.ASST_ID_PREFIX) ||
      key.startsWith(LocalStorageKeys.AGENT_ID_PREFIX) ||
      key.startsWith(LocalStorageKeys.LAST_CONVO_SETUP) ||
      key === LocalStorageKeys.LAST_SPEC ||
      key === LocalStorageKeys.LAST_TOOLS ||
      key === LocalStorageKeys.LAST_MODEL ||
      key === LocalStorageKeys.FILES_TO_DELETE
    ) {
      localStorage.removeItem(key);
    }
  });
}

export function clearConversationStorage(conversationId?: string | null) {
  if (!conversationId) {
    return;
  }
  if (!isUUID.safeParse(conversationId)?.success) {
    console.warn(
      `Conversation ID ${conversationId} is not a valid UUID. Skipping local storage cleanup.`,
    );
    return;
  }
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (key.includes(conversationId)) {
      localStorage.removeItem(key);
    }
  });
}
export function clearAllConversationStorage() {
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (
      key.startsWith(LocalStorageKeys.LAST_MCP_) ||
      key.startsWith(LocalStorageKeys.LAST_CODE_TOGGLE_) ||
      key.startsWith(LocalStorageKeys.LAST_MEMORY_TOGGLE_) ||
      key.startsWith(LocalStorageKeys.TEXT_DRAFT) ||
      key.startsWith(LocalStorageKeys.ASST_ID_PREFIX) ||
      key.startsWith(LocalStorageKeys.AGENT_ID_PREFIX) ||
      key.startsWith(LocalStorageKeys.LAST_CONVO_SETUP) ||
      key === LocalStorageKeys.LAST_SPEC ||
      key === LocalStorageKeys.LAST_MODEL ||
      key === LocalStorageKeys.LAST_TOOLS
    ) {
      localStorage.removeItem(key);
    }
  });
}
