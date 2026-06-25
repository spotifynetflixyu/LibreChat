# Lessons

- Future Steel native LibreChat work must start from
  `docs/steel-native-librechat-master-framework.md`, then use
  `docs/plans/2026-06-24-steel-global-native-librechat-integration.md` for phase
  execution. Do not infer architecture from older v8.3/OAuth/OCR planning docs.
- Steel native LibreChat research conclusions belong in the master framework
  `Research Conclusions Lock` and the implementation plan checklist, not only in
  conversation history or task logs.
- Native LibreChat reconstructs context from LibreChat Mongo message history
  plus LibreChat Memory, instructions, MCP, skills, files/RAG, tools, and
  pruning/summarization. Steel must extend that path, not replace it with
  provider-only state.
- Current native `useResponsesApi: true` is reconstructed Responses transport,
  not automatic provider-state continuation. `openai_responses_previous_response_id`
  requires explicit OpenAI `response.id` persistence, lookup, call-option
  injection, and fallback tests.
- Steel-enabled Open Responses is durable and LibreChat-managed, equivalent to
  `store:true`. Do not design a Steel `store:false` branch.
- LibreChat user Memory is distinct from Steel structured quote/workbook state,
  even when existing Steel service names contain `Memory`.
- Steel Markdown capture must run after assistant message persistence succeeds:
  use a native UI post-save hook around assistant `databasePromise`, and hook
  Open Responses `saveResponseOutput()` after `db.saveMessage`.
- LibreChat file records and permissions remain canonical. When Steel needs
  OCR/table extraction, route permitted file bytes/metadata through
  `run_file_ocr` backed by PaddleOCR MCP (`PaddleOCR-VL-1.6` / `paddleocr_vl`),
  then reuse persisted OCR/file-analysis state on follow-up turns by default.
- `/steel/oauth-chat` is dev-only for smoke tests and activity-log inspection.
  Product behavior must live in native LibreChat hooks.
