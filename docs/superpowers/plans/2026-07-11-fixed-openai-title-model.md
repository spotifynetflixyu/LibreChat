# Fixed OpenAI Title Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared Agents title generation use `gpt-5.6-luna` with reasoning effort `none` for both OpenAI API and OpenAI OAuth providers.

**Architecture:** Keep the policy inside `packages/api/src/steel/native/title.ts`, where both title routes already converge. Apply immutable title-only client options to the OpenAI API initializer, and pass the same constants directly to the OAuth title model; leave every non-OpenAI provider unchanged.

**Tech Stack:** TypeScript, Jest, `@librechat/agents`, OpenAI Responses API, OpenAI OAuth adapter.

## Global Constraints

- OpenAI API and OpenAI OAuth title generation must use model `gpt-5.6-luna`.
- OpenAI API and OpenAI OAuth title generation must use reasoning effort `none`.
- Main conversation model and reasoning settings must remain unchanged.
- Existing title prompts, templates, filename guidance, abort signals, usage collection, and persistence must remain unchanged.
- Non-OpenAI title providers must retain their existing client options.
- Legacy Assistants title generation is out of scope.
- Do not run Prettier.
- Preserve all pre-existing working-tree changes and do not commit this implementation because the target files already contain overlapping uncommitted OAuth transport work.

---

### Task 1: Fix the shared OpenAI title model policy

**Files:**
- Modify: `packages/api/src/steel/native/title.ts`
- Test: `packages/api/src/steel/native/title.spec.ts`

**Interfaces:**
- Consumes: `GenerateTitleInput.provider`, `GenerateTitleInput.endpoint`, and existing `ClientOptions`.
- Produces: OpenAI title invocations fixed to `gpt-5.6-luna` and reasoning effort `none`; unchanged behavior for other providers.

- [x] **Step 1: Update the OAuth regression to require the fixed model and effort**

Change the existing OAuth test input to select a different model, then require:

```ts
expect(result.model).toBe('gpt-5.6-luna');
expect(callOptions.providerOptions).toEqual({
  openai: {
    reasoningEffort: 'none',
  },
});
```

- [x] **Step 2: Add an OpenAI API regression and a non-OpenAI preservation regression**

Mock only `initializeModel`, returning a minimal invokable model. For OpenAI,
assert it receives title-only client options equivalent to:

```ts
{
  model: 'gpt-5.6-luna',
  reasoning_effort: 'none',
  temperature: 0.4,
}
```

when the incoming options selected another model and contained
`temperature: 0.4`. Assert the original input object remains unchanged. For a
non-OpenAI provider, assert `initializeModel` receives the original options.

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
cd packages/api && npx jest src/steel/native/title.spec.ts --runInBand
```

Expected: the OAuth result still reports the selected model and the OpenAI API
initializer still receives the selected model without fixed reasoning effort.

- [x] **Step 4: Implement the minimal shared policy**

Add title-only constants:

```ts
const OPENAI_TITLE_MODEL = 'gpt-5.6-luna';
const OPENAI_TITLE_REASONING_EFFORT = 'none';
```

Add an OpenAI-provider predicate that treats both `Providers.OPENAI` and
`EModelEndpoint.openAI` as OpenAI API identifiers. Add an immutable client-option
helper:

```ts
function getTitleClientOptions(
  provider: GenerateTitleInput['provider'],
  clientOptions: ClientOptions | undefined,
): ClientOptions | undefined {
  if (!isOpenAIProvider(provider)) {
    return clientOptions;
  }

  return {
    ...clientOptions,
    model: OPENAI_TITLE_MODEL,
    reasoning_effort: OPENAI_TITLE_REASONING_EFFORT,
  };
}
```

Use the constants directly in the OAuth model constructor and result metadata.
Use `getTitleClientOptions()` before `initializeModel()` and when returning the
model for the OpenAI API branch.

- [x] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
cd packages/api && npx jest src/steel/native/title.spec.ts --runInBand
```

Expected: all title tests pass with zero failures.

- [x] **Step 6: Run adjacent controller regressions**

Run:

```bash
cd api && npx jest server/controllers/agents/client.test.js --runInBand
```

Expected: all AgentClient title tests pass with zero failures.

- [x] **Step 7: Build and check the diff**

Run:

```bash
npm run build:api
git diff --check
```

Expected: build exits 0 and diff check produces no output.
