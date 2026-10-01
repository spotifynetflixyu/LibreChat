import type { OpenAIOAuthModelOptions } from '~/steel/native/oauth';

export function scopeOAuthCompaction(
  options: OpenAIOAuthModelOptions,
  executionId: string,
): OpenAIOAuthModelOptions {
  if (!options.compaction) return options;
  return {
    ...options,
    compaction: {
      ...options.compaction,
      scope: { ...options.compaction.scope, executionId },
    },
  };
}
