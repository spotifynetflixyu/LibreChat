import { ChatGenerationChunk } from '@langchain/core/outputs';
import { getChatModelClass, registerProvider } from '@librechat/agents';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  BaseChatModelCallOptions,
  BaseChatModelParams,
  BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { OpenAIClientOptions } from '@librechat/agents';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { OpenAIOAuthModelOptions, OpenAIOAuthInvokeOptions } from '~/steel/native/oauth';
import { createOpenAIOAuthGraphModel } from '~/steel/native/oauth';

export const oauthCompactionProvider = 'librechat_openai_oauth';

export interface OAuthChatConfig extends BaseChatModelParams, OpenAIClientOptions {
  oauth: OpenAIOAuthModelOptions;
  oauthSubagent?: boolean;
  oauthRunId: string;
}

declare module '@librechat/agents/provider-registration' {
  interface CustomProviderOptionsMap {
    librechat_openai_oauth: OAuthChatConfig;
  }
}

interface OAuthCallOptions extends BaseChatModelCallOptions {
  oauthExecutionId?: string;
  oauthRunId?: string;
  oauthConfigurable?: RunnableConfig['configurable'];
  oauthMetadata?: RunnableConfig['metadata'];
  toolChoice?: OpenAIOAuthInvokeOptions['toolChoice'];
}

/** Registered through the SDK's provider extension API, including child graphs. */
export class OAuthChatModel extends BaseChatModel<OAuthCallOptions> {
  lc_namespace: string[] = ['librechat', 'openai_oauth'];
  lc_serializable: boolean = false;

  constructor(private readonly options: OAuthChatConfig) {
    super(options);
  }

  static lc_name(): string {
    return 'LibreChatOpenAIOAuth';
  }

  _llmType(): string {
    return oauthCompactionProvider;
  }

  _useResponsesApi(): boolean {
    return true;
  }

  protected _separateRunnableConfigFromCallOptionsCompat(
    options?: Partial<OAuthCallOptions>,
  ): [RunnableConfig, this['ParsedCallOptions']] {
    const [config, call] = super._separateRunnableConfigFromCallOptionsCompat(options);
    const context = config.configurable?.executionContext;
    let executionId: string | undefined;
    if (
      context &&
      typeof context === 'object' &&
      'ancestry' in context &&
      Array.isArray(context.ancestry)
    ) {
      const last: unknown = context.ancestry[context.ancestry.length - 1];
      if (
        last &&
        typeof last === 'object' &&
        'subagentRunId' in last &&
        typeof last.subagentRunId === 'string'
      ) {
        executionId = last.subagentRunId;
      }
    }
    return [
      config,
      {
        ...call,
        oauthConfigurable: config.configurable,
        oauthMetadata: config.metadata,
        oauthExecutionId: executionId ?? call.oauthExecutionId,
        oauthRunId:
          typeof config.configurable?.run_id === 'string'
            ? config.configurable.run_id
            : this.options.oauthRunId,
      },
    ];
  }

  bindTools(tools: BindToolsInput[]): OAuthChatModel {
    return new OAuthChatModel({
      ...this.options,
      oauth: { ...this.options.oauth, tools },
    });
  }

  private createModel(call: this['ParsedCallOptions'], manager?: CallbackManagerForLLMRun) {
    const compaction = this.options.oauth.compaction;
    const executionId = call.oauthExecutionId ?? (this.options.oauthSubagent ? undefined : 'main');
    if (compaction && !executionId) {
      throw new Error('oauth_compaction_missing_execution');
    }
    return createOpenAIOAuthGraphModel({
      modelOptions: {
        ...this.options.oauth,
        ...(compaction && {
          compaction: {
            ...compaction,
            scope: { ...compaction.scope, executionId: executionId! },
            onContextUsage: async (event) => {
              const usage = { ...event, runId: call.oauthRunId ?? this.options.oauthRunId };
              if (compaction.onContextUsage) {
                await compaction.onContextUsage(usage, {
                  ...call.oauthConfigurable,
                  ...call.oauthMetadata,
                });
              } else {
                await manager?.handleCustomEvent('on_context_usage', usage);
              }
            },
            onStatus: async (event) => {
              const status = { ...event, runId: call.oauthRunId ?? this.options.oauthRunId };
              // Child custom-event forwarders filter unknown event names; the host sink survives them.
              if (compaction.onStatus) {
                await compaction.onStatus(status, {
                  ...call.oauthConfigurable,
                  ...call.oauthMetadata,
                });
              } else {
                await manager?.handleCustomEvent('on_context_compaction', status);
              }
            },
          },
        }),
      },
      boundTools: this.options.oauth.tools,
      terminalToolNames: compaction?.compactOnly ? undefined : ['delegate_ocr'],
    });
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    manager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const message = await this.createModel(options, manager).invoke(messages, {
      ...options,
      configurable: options.oauthConfigurable,
      signal: options.signal,
      callbacks: manager?.handlers,
    });
    return {
      generations: [{ message, text: typeof message.content === 'string' ? message.content : '' }],
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    manager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const stream = await this.createModel(options, manager).stream(messages, {
      ...options,
      configurable: options.oauthConfigurable,
      signal: options.signal,
      callbacks: manager?.handlers,
    });
    for await (const message of stream) {
      yield new ChatGenerationChunk({
        message,
        text: typeof message.content === 'string' ? message.content : '',
        generationInfo: message.response_metadata,
      });
    }
  }
}

let registered = false;

export function registerOAuthCompactionProvider(): void {
  if (registered) {
    return;
  }
  try {
    if (getChatModelClass(oauthCompactionProvider).name === OAuthChatModel.name) {
      registered = true;
      return;
    }
    throw new Error('oauth_compaction_provider_conflict');
  } catch (error) {
    if (error instanceof Error && error.message === 'oauth_compaction_provider_conflict') {
      throw error;
    }
  }
  registerProvider({ provider: oauthCompactionProvider, model: OAuthChatModel, family: 'openai' });
  registered = true;
}
