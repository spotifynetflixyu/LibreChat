# Independent quotation preflight

Status: quotation execution implemented locally, 2026-09-17. Flexible preparation-confirmation and saved-state injection are implemented and verified locally. No production deployment or live-provider quotation smoke is claimed.

## Output compatibility

Preserve the existing division of output responsibilities as clarified by the user: the quotation main agent consolidates `system_order`, checks missing values, and emits applicable AI-owned Markdown such as `manual_reviews`; the backend generates `customer_quote` and the final completion summary. Preserve the final presentation contract in [the quotation output rules](../rules/輸出規則.txt), including section order, table columns, review conditions, and completion wording, while assigning generation to these owners. The execution change delegates price lookup and per-item quotation to batched child agents, then supplies their saved results to the main agent for consolidation; it does not move backend-generated output into the main agent. The separately agreed preparation, signal, recovery, and cancellation behavior remains in scope.

## Order and customer preparation

- Maintain one current, complete `ocr_result` per conversation. It may come from the main OCR agent or from ordinary AI converting a text order to the same Markdown format.
- Present a newly prepared order for user confirmation before quotation. A later request to quote the presented order can serve as confirmation and quotation intent together.
- Apply explicit user deletions and corrections by emitting the full resulting `ocr_result`, then automatically saving it through the backend. Explicit deletions require a hidden `ocr_deletions` table with the prior order SHA-256, exact source/part keys, and a deletion instruction in the user message. Other omitted rows are restored by OCR reconciliation.
- Before calling the customer lookup tool, AI must establish that `ocr_result` exists. The current tool is `search_customers`; `customer_data` is the resulting output sheet, not the tool name.
- If lookup returns multiple customers, ask the user which customer they mean. Do not emit resolved `customer_data` or a quotation signal until the choice is established.
- For one resolved customer, output its `customer_data`. If no customer matches, visibly disclose default B tier and persist that customer context. A lookup failure does not establish a no-match result.
- Treat complete-order confirmation, customer or explicit direct-B selection, customer-data presentation, and consent to start quotation as prerequisites that may be collected in different orders or combined user messages. Ask only for missing or changed information. Present `customer_data`, then wait for start consent unless the user already explicitly authorized quotation of the displayed order and confirmed pricing context. Merely supplying a customer name or choosing B is not start consent. Customer Markdown and the signal may be emitted in separate responses; unchanged confirmed information is reusable.

## Signal acceptance and entry gate

- The quotation flow is independent from OCR. It may reuse suitable infrastructure, but does not share OCR execution identities or completion state.
- Only after the AI response completes does the backend inspect it for a quotation signal. Partial, interrupted, or truncated streamed output must not start quotation.
- Persist and validate the full order and customer data before accepting the signal. Reject or defer a signal if either prerequisite is missing or invalid; never run with partially written inputs.
- AI emits exactly `## quote_signal` followed by a blank line and `start`. After validating the saved OCR/customer data against the completed response, the backend atomically allocates the quotation index. The immutable assistant-response ID deduplicates delivery; a new completed response may start a new quotation after the previous one is terminal.
- Bind each run to fixed order and customer snapshots, retaining its input and output artifacts for debugging. Keep the conversation's current order distinct from historical run snapshots.
- At request entry, ordinary conversation AI may run only when no quotation preflight exists or the current one is complete or explicitly cancelled. An interrupted quotation resumes first. An already running quotation must not acquire a second execution merely because another request arrives.
- New quotation work must wait for the existing quotation to complete or be explicitly cancelled. It must not modify the input of that unfinished quotation.

## Chunk execution and aggregation

- Group order rows by category, then split each category into chunks of at most 30 source rows. There is no additional subgroup by steel dimensions.
- Preserve stable source-row identities and original order through grouping, processing expansion, and final aggregation. Thirty input rows do not necessarily mean thirty output material-and-processing rows.
- Only quotation child agents receive `search_price_candidates`. Every child execution receiving a chunk must call this tool to look up the prices needed for its material and processing rows before completing its result; tool availability alone does not satisfy this requirement. Retain the Python calculation capability required by the existing quotation rules.
- Execute the category-grouped chunks sequentially. Supply each child only with its assigned chunk, the established customer context, and applicable quotation rules; do not include other chunks, the full category order, or the full OCR result. Persist its `system_order_chunk` and optional `manual_reviews_chunk` Markdown to the database together with progress and lookup evidence so completed chunks can be reused after interruption.
- Each child's quotation Markdown uses the heading `## system_order_chunk`, with the same table columns, column order, and row-format contract as the final `system_order`. Its scope is all material and required processing rows belonging to its assigned chunk. Only the section title and row scope differ from the final quotation table.
- Give all children the same run-level quotation column contract. Store chunk, attempt, and run metadata alongside the Markdown instead of adding child-only columns to the quotation table.
- Keep successful chunks when another chunk fails; retry the failed work. A returned price-tool failure may leave unknown prices blank. Provider interruption, cancellation, or failed persistence still leaves the work unfinished.
- A lookup attempt without usable prices retains the corresponding rows and leaves unknown values blank. Preserve concrete missing-value reasons and lookup evidence with the child result for the main agent's final `manual_reviews`; never invent a value or substitute zero for unknown data.
- After all chunk batches have completed and their results are saved, the quotation main agent reads the persisted `system_order_chunk` and optional `manual_reviews_chunk` tables and combines them into one complete `## system_order`, including required processing rows, in source order. Emit only one final heading and table header while preserving the shared column contract.
- The quotation main agent follows the existing AI output workflow to consolidate the other applicable AI-owned Markdown sections and check the complete quotation for missing field values. Preserve confirmed values, distinguish genuinely missing required values from inapplicable fields, and retain existing candidate, fallback, and low-confidence review requirements. The main agent does not call `search_price_candidates`; the children perform those lookups; the main agent receives their Markdown tables, while raw tool records remain in backend storage. Neither main nor child agents generate `customer_quote` or the overall completion summary.
- Preserve the existing `manual_reviews` contract: when review items exist, consolidate them into one table with the existing columns, placed as the last table before the backend-generated `## quote_summary` section; when none exist, emit no empty table. After the main agent's output completes successfully and provides a readable Markdown table, the backend generates `customer_quote` from the consolidated `system_order` and places it according to the existing output flow, then produces the final completion summary with authoritative counts. A child result does not declare the overall quotation complete.
- Save the main agent's consolidated Markdown for debugging, and save the backend-finalized response containing `system_order`, generated `customer_quote`, any `manual_reviews` or other applicable sections, and the backend-generated completion summary for normal output persistence and debugging. Partial `system_order_chunk` artifacts must not replace the conversation's complete final quotation output.
- AI checks row coverage, duplicates, candidate selection, calculations, and manual review. The backend does not validate quotation business content or reconstruct lineage; it reads table structure for persistence and final presentation. Chunking does not remove final-context or final-output limits; an incomplete aggregate must remain incomplete.
- The quotation main agent checks every source row in the run's complete `ocr_result` against the quotation, including missing material or processing rows and required values missing in the source or omitted from the quotation. Merge these findings with child reviews into `manual_reviews`, locating missing items by their original OCR source even when no quotation row exists. Do not fabricate missing rows or treat inapplicable fields as missing values.
- Stream the quotation main agent's response through the existing system-order row normalizer: buffer unfinished lines, clean numeric fields once a row is complete, then publish the normalized text. Partial output is a preview, not a completed checkpoint. After a successful completion, the durable finalized response replaces the preview once and includes the backend-generated customer quote and summary. Reuse the same normalization for final persistence and restored main results.
- Main and child quotation rules live in separate TXT files, describing their respective inputs, workflows, pricing logic, and outputs without explaining backend agent architecture. Carry forward the main agent's existing AI-owned output rules, excluding instructions to generate backend-owned customer quotations or completion summaries; adapt the child rules to chunk-scoped lookup, calculation, and `system_order_chunk` output without changing the applicable pricing logic.
- Emit progress events and subagent/tool-call UI activities during execution and recovery. Persist enough history to restore accurate progress without presenting old tool calls as new executions.

## Pending messages and reconfirmation

- Persist a new user message received during an active or interrupted quotation as pending. Resume or finish the old quotation against its original fixed input first; do not inject the pending message into a child or the aggregation prompt.
- Once the run completes, automatically process pending messages in arrival order. Persist message identity and processing progress so delivery retries, reconnects, or recovery do not apply a message twice or lose it. Cancellation also releases pending messages after its terminal state is durably accepted.
- For a pending order correction, AI applies the correction and emits a new full `ocr_result`. The backend saves that complete result, and the user must confirm quotation of the revised order before AI emits another quotation signal.
- Confirmation of an old order revision does not authorize quotation of a later correction. A pending instruction containing both a correction and a request to quote still presents the changed complete order for confirmation first.
- Only after the revised order is confirmed and customer data is available (reusing unchanged saved data) may AI emit a new quotation signal upon explicit start consent. The backend checks all prerequisites again after that response completes.

## Cancellation button

- Show a dedicated `取消報價` button on the quotation-preflight progress/activity UI while a run is active, interrupted, or recoverably failed, including during final aggregation. It cancels the specific quotation signal index shown in that UI.
- Clicking the button requests cancellation directly from the backend without waiting for ordinary AI execution. Disable repeated clicks and show `取消中…` while awaiting the backend result; do not require an additional confirmation dialog.
- On accepted cancellation, persist the terminal cancelled state, stop scheduling further child work, request abortion of in-flight work, and prevent late child or aggregation responses from publishing a final quotation or changing the cancelled run back to completed.
- Show `已取消報價` after cancellation is accepted. Keep saved chunks, tool activities, input snapshots, and any intermediate aggregation data for debugging. Preserve the conversation's current `ocr_result`, customer context, and any earlier completed quotation.
- A cancelled run never auto-resumes. A later quotation request requires a new signal index. Cancelled partial results are not a complete `system_order`.
- If cancellation fails, show the error and allow retry; do not report cancellation as successful. If completion wins a concurrent cancellation race, report that the quotation already completed and preserve that completed result.
- Disconnection or interruption alone does not mean cancellation and continues to use normal recovery.

## Recovery boundary

- Use a durably saved `system_order_chunk` result from a completed response after a price lookup attempt as the chunk checkpoint. Reuse completed chunks without a new child execution or repeated lookup, and rerun only unfinished chunks. Any rerun child execution must perform the required price lookup.
- Tool calls inside an unfinished chunk may run again; resuming midway through a child's tool-call sequence is outside this initial recovery guarantee.
- Track aggregation separately. If all chunks completed but final aggregation failed or was interrupted, reuse the saved chunks and retry only aggregation.
- A run is complete only after the final `system_order` is readable, the main agent completes its review and AI-owned output, the backend completes customer-quotation and summary generation, and all required artifacts are durably saved. Persist finalization progress so a restart after saving does not publish a duplicate final result; a backend-finalization retry must not repeat completed child or main-agent work.
- Restore progress and tool activity history using stable run, chunk, and attempt identities. Replayed historical events are not new tool calls; a rerun of an unfinished chunk is a new attempt within the same quotation signal index.

## Implementation contracts

- `## quote_signal` has the fixed body `start`, with no AI-generated index or token. A successful resolved customer lookup saves `customerDataMarkdown`; an explicit B choice is saved from completed AI customer Markdown, including before OCR exists. Admission checks the saved customer and current confirmed-order context against the turn snapshot, then atomically allocates an internal ticket/index for the signal response. Repeated delivery of that response reuses its run, including cancelled runs. Each run freezes the validated customer Markdown in its snapshot and supplies that exact tier context to every child and retry. Backend chunk metadata retains original source order; AI output has no JSON sidecar or extra columns.
- Implement durable storage, execution leases, atomic signal acceptance, restart recovery, and ownership checks, including cancellation authorization and stale-worker write protection.
- Preserve rule and calculation provenance, cross-chunk pricing dependencies, AI output rules, and bounded concurrency.
- Integrate existing edit/rerun semantics and distinguish current output artifacts from historical quotation artifacts.
- Retain backend finalization for the quotation main-agent output even though price-tool calls now occur in children. Do not gate customer-quotation or summary generation solely on price-tool calls in the main agent's own message history, and do not apply final quotation generation to `system_order_chunk` output.

## Current-code verification notes

- Backend customer-quotation composition is verified in `packages/api/src/steel/markdown/quote.ts` (`buildCustomerQuoteFromMarkdown`) and `packages/api/src/steel/native/oauth.ts` (`composeCustomerQuote` and the streaming parser integration).
- `quotation/protocol.ts` now owns quotation finalization: read the consolidated table, compose the customer quotation with the existing helper, generate authoritative completion counts, and place conditional manual review last. Dedicated consolidation instructions override the legacy workbook directives that assigned backend-owned outputs to AI.

## Acceptance scenarios

1. A text order produces one full saved `ocr_result`; quotation waits for order confirmation, saved `customer_data`, and start consent before a completed response emits a new signal. Customer data and the signal may arrive in separate responses.
2. Multiple customer matches produce a selection question and no quotation signal until the user resolves the customer.
3. Missing order data, missing customer data, an incomplete response, or a repeated accepted signal does not create a new quotation.
4. A category with 61 source rows creates chunks of 30, 30, and 1. Recovery after the first two chunks were saved reruns only the third; aggregation-only failure reruns no completed child.
5. A pending quantity correction received during interruption remains separate from the old quotation, is applied once after completion, and produces a new full order requiring confirmation before a new signal.
6. Cancellation works while child work or aggregation is active, retains debug artifacts, releases the execution gate and pending messages, and prevents late responses from publishing the cancelled quotation.
7. Recovery preserves accurate event and subagent/tool-call activities without treating history replay as a new tool execution.
8. Every newly executed child calls `search_price_candidates` and saves its partial quotation as `## system_order_chunk`, using the final `system_order` columns and row format. A lookup attempt is required, but success is not required to save an AI response containing blank no-data values.
9. Once all chunk batches complete, aggregating their saved tables produces one complete `## system_order` with one heading and header, preserves source order and required processing rows, and introduces no child-only columns. The main agent follows its existing AI-owned output workflow without calling the price tool, consolidates other applicable AI-owned Markdown, checks missing values, and emits `manual_reviews` only when needed. The backend generates `customer_quote` and the final completion summary and persists the finalized response.
10. Both quotations with review items and quotations without review items retain the existing section order, table schemas, conditional table emission, and exact completion-sentence format. Customer quotations and completion summaries are generated once by the backend, not by the main or child agents, including after recovery. Moving lookup and calculation to child agents preserves this division of output responsibilities.

## Implemented modules and verification

- `packages/api/src/steel/quotation/` owns preparation, signal and Markdown parsing, immutable artifacts, CAS state/leases, execution, pending-message journals, provider invocation, and owner-scoped status/cancel handlers. OCR and quotation have separate run identities and checkpoints.
- `packages/data-schemas/src/schema/steel/quotation.ts` defines conversation state and immutable artifacts, including unique indexes. Environments with automatic indexing disabled must provision these declared indexes before enabling the workflow. The three declared indexes were explicitly created and read back in DEV; its MongoDB target was verified distinct from PROD. No records or existing indexes were removed.
- AgentClient and Responses both gate ordinary AI, start quotation only after completed AI output, and publish to stable message identities. Pending corrections are persisted before publication and skip the outer OCR finalizer so an older response cannot overwrite the newly saved order.
- Children run with bounded concurrency of one. Saved prompts, tool evidence, raw attempts, Markdown chunks, aggregation, final output, and publication receipts support debugging and retry. Recovery reuses complete checkpoints; final publication is retryable without rerunning AI.
- The quotation activity UI restores progress/tool history and supports owner-scoped cancellation. Pending messages include attachment metadata; file corrections use the existing OCR workflow before presenting the revised complete order.
- Automated tests cover signal/Markdown parsing, chunk/main/publication recovery, cancellation followed by a new signal, pending FIFO and claim renewal, explicit deletion, chat entry points, and frontend status/cancel behavior. Quotation business-content validation is intentionally removed following the user correction; AI owns candidate, calculation, source coverage, and review judgments.
- DEV rule synchronization uses the managed manifest and verifies saved prompt hashes plus active/reviewed state. The target was checked to be distinct from PROD before applying.
- Runtime execution currently uses the existing OpenAI OAuth provider integration. No actual model-backed end-to-end quotation has been run in this implementation session. Production deployment and production rule synchronization have not been performed.


## Markdown-only quotation refinement

- A cancelled run stays terminal. Replaying its signal does not restart it; another completed AI response must emit a new signal to create a new run. Interruption instead resumes unfinished work in the existing run.
- Child output is one `system_order_chunk` Markdown table and, when issues exist, one `manual_reviews_chunk` table. No lineage JSON or calculation JSON is required in the AI response; raw tool results remain available for debugging without being forwarded to the consolidation prompt.
- Missing quotation values are allowed. A completed price-tool error may lead to blank no-data fields and AI review. Backend state/ownership/cancellation/persistence protections remain enforced.
- Rules are loaded once per role. Consolidation loads the shared output rules followed by its own consolidation rules. Item pricing loads DB quote defaults and all active reviewed category rules, then shared output rules, calculation rules, and its own item-pricing rules. This preserves the dedicated output contract as the last instruction.

Effective rule groups were checked through the DEV context builder: consolidation uses `輸出規則.txt` then `報價主Agent規則.txt`; pricing uses the 11 active reviewed category files (`查價方式`, `C型鋼`, `H型鋼`, `鐵板`, `孔`, `網`, `方鐵`, `其他類別`, `加工`, `長條料`, `切工`), then `輸出規則.txt`, `報價計算驗證規則.txt`, and `報價子Agent規則.txt`. The additional DB quote-default list is currently empty. Neither role loads the general conversation `agent規則.txt` or OCR/Vision rule groups.

Quotation review output uses `manual_reviews_chunk` for each child and `manual_reviews` for the consolidated result. Save the optional six-column child review table in the same durable Markdown checkpoint as `system_order_chunk`, and restore both together without repeating completed child work. No review issues means no empty review table. Legacy saved `manual_review` main output remains readable and is normalized to `manual_reviews`; OCR review contracts are unchanged.

After the ordinary agent completes a response containing the fixed quotation signal, the backend checks required OCR/customer Markdown and signal admission before independent quotation preflight. The ordinary agent prepares complete order Markdown, confirms the order and customer, and emits the fixed start signal; its tool policy excludes price lookup. Backend validation concerns structure and run admission, while pricing and business review remain AI responsibilities.

Every new user turn checks unfinished quotation and OCR preflight before invoking ordinary conversation-provider work. Resume an interrupted task first; cancelled quotation is terminal and requires a fresh completed AI response with the fixed signal. The Chat and Responses entry paths share this ordering.

## Flexible preparation and saved state

Each ordinary or pending AI turn receives `hasOcrResult`, `hasCustomerData`, and `hasSystemOrder`, plus saved complete OCR and customer Markdown. These report database presence, not user consent. `shouldAskToQuote` is derived from OCR and customer data being present with no existing system order. Only a saved final artifact belonging to the latest accepted, completed run makes `hasSystemOrder` true. Accepting a new signal makes it false until that run completes and saves its final result; interrupted or cancelled runs remain false even when older final artifacts exist. Historical quotation artifacts are retained. A user-requested re-quote still requires a new signal.

AI may collect customer choice before order data. An explicit B-tier choice emits canonical `customer_data` (blank customer code, 未指定客戶, B, 用戶指定預設 B tier), which a completed response saves without fabricating a lookup. Named customers still use the actual customer tool after OCR exists. Customer Markdown remains available across turns and order revisions; a new unresolved customer lookup invalidates the previous selection. A signal can be emitted in a later response without repeating unchanged customer Markdown. Admission binds the current order/customer versions supplied at the start of that turn, preserving response deduplication and stale-response protection. Changes to order or pricing context still require appropriate new user confirmation.

Latest saved-state verification: quotation module 79 tests passed; Chat/Responses integration 410 passed and 2 skipped; data-schema and API builds passed. Review of cross-response customer updates completed with delayed-result fencing verified.

### Fixed Markdown headings

Data sections use exact standalone H2 machine titles with no filename, category, or index suffix. OCR child artifacts and their merged input use `## ocr_result_chunk`; the complete order uses `## ocr_result`. Quotation output uses `## system_order_chunk`, optional `## manual_reviews_chunk`, `## system_order`, optional `## notes` and `## manual_reviews`, and backend-generated `## customer_quote` and `## quote_summary`. Omit optional review headings and tables when there are no review items. Existing stored legacy headings remain readable; this change does not rewrite historical artifacts.
