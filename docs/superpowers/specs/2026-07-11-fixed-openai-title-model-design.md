# Fixed OpenAI Title Model Design

## Goal

Make conversation-title generation use `gpt-5.6-luna` with reasoning effort
`none` whenever the title provider is either OpenAI API or OpenAI OAuth, without
changing the model or reasoning settings used by the main conversation.

## Scope

- Apply the fixed title settings only in the shared Agents title path implemented
  by `packages/api/src/steel/native/title.ts`.
- Cover both `openAI` and `openAIOAuth` title-provider branches.
- Preserve existing title prompts, filename guidance, templates, abort signals,
  output sanitization, usage collection, and title persistence behavior.
- Keep legacy Assistants-specific title generation out of scope because it uses
  a separate service and was not part of the selected shared title route.

## Design

Define title-only constants for model `gpt-5.6-luna` and reasoning effort
`none` beside the shared title implementation. The OpenAI OAuth branch will use
those constants directly when constructing `createOpenAIOAuthModel`.

The OpenAI API branch will create title-only client options from the existing
provider options, overriding the model and setting `reasoning_effort` to
`none` before calling `initializeModel`. Non-OpenAI providers will continue to
receive their existing client options unchanged.

This keeps routing and authentication unchanged: OpenAI API title requests still
use the configured API credentials, while OpenAI OAuth title requests still use
the configured OAuth credentials and transport.

## Behavioral Contract

- A title request with provider `openAI` invokes the model as
  `gpt-5.6-luna` with reasoning effort `none`.
- A title request with endpoint or provider `openAIOAuth` invokes the model as
  `gpt-5.6-luna` with reasoning effort `none`.
- Explicit UI-selected models, `titleModel`, and `OPENAI_DEFAULT_MODEL` do not
  override the fixed title model for these two providers.
- Main chat runs continue honoring their existing selected model and reasoning
  settings.
- Other title providers remain unchanged.

## Error Handling

Use the existing provider initialization and invocation error paths. Do not add
fallback to another model because that would make the fixed-model contract
unobservable and could hide access or transport failures.

## Testing

Use test-driven development in `packages/api/src/steel/native/title.spec.ts`:

1. Assert the OAuth title model receives `gpt-5.6-luna` and reasoning effort
   `none` even when client options select another model.
2. Assert the OpenAI API title initializer receives `gpt-5.6-luna` and
   reasoning effort `none` while preserving unrelated client options.
3. Assert a non-OpenAI provider still receives its original model/options.
4. Run the focused title test suite, the `packages/api` build, and
   `git diff --check`.

## Non-Goals

- Changing the default model shown in the UI.
- Changing main-agent model selection or reasoning effort.
- Adding runtime configuration for the title model.
- Modifying legacy Assistants title generation.
- Adding fallback models.
