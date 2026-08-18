# Steel Provider Input Merge Guards

Apply these guards when pulling or merging upstream LibreChat changes that touch:

- `api/server/controllers/agents/client.js`
- `api/server/controllers/agents/responses.js`
- `packages/api/src/steel/native/routing.ts`
- `packages/api/src/steel/native/delegate.ts`
- agent message formatting, `createRun()`, or `run.processStream()`

## Required invariants

1. Non-OCR turns filter formatted provider messages through
   `stripSteelOcrPartsFromProviderMessages()` before `createRun()`.
2. Streaming and non-streaming `run.processStream()` receive the same filtered
   `providerMessages`; they must not fall back to unfiltered formatted history.
3. Historical OCR source binaries are removed from quote/tool-loop provider
   input. Cover top-level file data and nested OpenAI blocks shaped like
   `{ type: 'file', file: { file_data, filename, file_id } }`.
4. Current-turn files remain available during active OCR or explicit
   reinspection.
5. Organized assistant OCR Markdown and delegate OCR history remain available
   as quote evidence. Do not replace them with the original PDF.
6. Prior-result confirmation such as `確認以上 OCR 明細，依 B 價報價` is
   quote-only. Explicit reinspection such as `重新核對原始 PDF 後報價` keeps
   OCR capability.

## Regression signal

Failure usually appears as LibreChat `empty_messages` before an OpenAI request.
The breakdown may misattribute historical PDF bytes to enormous tool-definition
tokens. Inspect provider-bound messages rather than trusting the UI context meter
or breakdown label alone.

## Required post-merge checks

```sh
cd packages/api
npx jest src/steel/native/routing.spec.ts src/steel/native/delegate.spec.ts --runInBand

cd ../../api
npx jest server/controllers/agents/__tests__/responses.unit.spec.js --runInBand

cd ..
npm run build:api
git diff --check
```

Review the three focused test files after conflict resolution. An upstream merge
that deletes or weakens these regressions is incomplete even when compilation
passes.
