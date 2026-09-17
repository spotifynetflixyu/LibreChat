# Independent quotation preflight

Status: implemented locally, 2026-09-17. Automated validation is recorded below; no production deployment or live-provider quotation smoke is claimed.

## Output compatibility

Preserve the existing division of output responsibilities as clarified by the user: the quotation main agent consolidates `system_order`, checks missing values, and emits applicable AI-owned Markdown such as `manual_review`; the backend generates `customer_quote` and the final completion summary. Preserve the final presentation contract in [the quotation output rules](../rules/輸出規則.txt), including section order, table columns, review conditions, and completion wording, while assigning generation to these owners. The execution change delegates price lookup and per-item quotation to batched child agents, then supplies their saved results to the main agent for consolidation; it does not move backend-generated output into the main agent. The separately agreed preparation, signal, recovery, and cancellation behavior remains in scope.

## Order and customer preparation

- Maintain one current, complete `ocr_result` per conversation. It may come from the main OCR agent or from ordinary AI converting a text order to the same Markdown format.
- Present a newly prepared order for user confirmation before quotation. A later request to quote the presented order can serve as confirmation and quotation intent together.
- Apply explicit user deletions and corrections by emitting the full resulting `ocr_result`, then automatically saving it through the backend. Explicit deletions require a hidden `ocr_deletions` table with the prior order SHA-256, exact source/part keys, and a deletion instruction in the user message. Other omitted rows are restored by OCR reconciliation.
- Before calling the customer lookup tool, AI must establish that `ocr_result` exists. The current tool is `search_customers`; `customer_data` is the resulting output sheet, not the tool name.
- If lookup returns multiple customers, ask the user which customer they mean. Do not emit resolved `customer_data` or a quotation signal until the choice is established.
- For one resolved customer, output its `customer_data`. If no customer matches, visibly disclose default B tier and persist that customer context. A lookup failure does not establish a no-match result.
- Emit `customer_data` Markdown and the quotation signal in the same completed AI response. A unique match or disclosed no-match B fallback needs no additional customer-confirmation turn.

## Signal acceptance and entry gate

- The quotation flow is independent from OCR. It may reuse suitable infrastructure, but does not share OCR execution identities or completion state.
- Only after the AI response completes does the backend inspect it for a quotation signal. Partial, interrupted, or truncated streamed output must not start quotation.
- Persist and validate the full order and customer data before accepting the signal. Reject or defer a signal if either prerequisite is missing or invalid; never run with partially written inputs.
- The backend controls signal-index allocation and validation; AI emits the index for the requested quotation. A repeated delivery or resume of the same accepted index refers to the existing run, while a new accepted index creates a new quotation.
- Bind each run to fixed order and customer snapshots, retaining its input and output artifacts for debugging. Keep the conversation's current order distinct from historical run snapshots.
- At request entry, ordinary conversation AI may run only when no quotation preflight exists or the current one is complete or explicitly cancelled. An interrupted quotation resumes first. An already running quotation must not acquire a second execution merely because another request arrives.
- New quotation work must wait for the existing quotation to complete or be explicitly cancelled. It must not modify the input of that unfinished quotation.

## Chunk execution and aggregation

- Group order rows by category, then split each category into chunks of at most 30 source rows. There is no additional subgroup by steel dimensions.
- Preserve stable source-row identities and original order through grouping, processing expansion, and final aggregation. Thirty input rows do not necessarily mean thirty output material-and-processing rows.
- Only quotation child agents receive `search_price_candidates`. Every child execution receiving a chunk must call this tool to look up the prices needed for its material and processing rows before completing its result; tool availability alone does not satisfy this requirement. Retain the Python calculation capability required by the existing quotation rules.
- Supply each child with its chunk, the established customer context, and applicable quotation rules. Persist its validated `system_order_chunk` Markdown to the database together with progress and lookup evidence so completed chunks can be reused after interruption.
- Each child's quotation Markdown uses the heading `## system_order_chunk`, with the same table columns, column order, and row-format contract as the final `system_order`. Its scope is all material and required processing rows belonging to its assigned chunk. Only the section title and row scope differ from the final quotation table.
- Give all children the same run-level quotation column contract. Store chunk, attempt, and run metadata alongside the Markdown instead of adding child-only columns to the quotation table.
- Keep successful chunks when another chunk fails; retry the failed work. An execution failure must not be silently represented as missing price data.
- A successful lookup without usable prices retains the corresponding rows and leaves unknown values blank. Preserve concrete missing-value reasons and lookup evidence with the child result for the main agent's final `manual_review`; never invent a value or substitute zero for unknown data.
- After all chunk batches have completed and their results are saved, the quotation main agent reads the persisted `system_order_chunk` tables and combines them into one complete `## system_order`, including required processing rows, in source order. Emit only one final heading and table header while preserving the shared column contract.
- The quotation main agent follows the existing AI output workflow to consolidate the other applicable AI-owned Markdown sections and check the complete quotation for missing field values. Preserve confirmed values, distinguish genuinely missing required values from inapplicable fields, and retain existing candidate, fallback, and low-confidence review requirements. The main agent does not call `search_price_candidates`; the children perform those lookups and supply the saved evidence. Neither main nor child agents generate `customer_quote` or the overall completion summary.
- Preserve the existing `manual_review` contract: when review items exist, consolidate them into one table with the existing columns, placed as the last table and last section; when none exist, emit no empty table. After the main agent's output completes successfully and passes validation, the backend generates `customer_quote` from the consolidated `system_order` and places it according to the existing output flow, then produces the final completion summary with authoritative counts. A child result does not declare the overall quotation complete.
- Save the main agent's consolidated Markdown for debugging, and save the backend-finalized response containing `system_order`, generated `customer_quote`, any `manual_review` or other applicable sections, and the backend-generated completion summary for normal output persistence and debugging. Partial `system_order_chunk` artifacts must not replace the conversation's complete final quotation output.
- Validate row coverage, duplicates, candidate provenance, and calculation consistency before completion. Chunking does not remove final-context or final-output limits; an incomplete aggregate must remain incomplete.
- Main and child quotation rules live in separate TXT files, describing their respective inputs, workflows, pricing logic, and outputs without explaining backend agent architecture. Carry forward the main agent's existing AI-owned output rules, excluding instructions to generate backend-owned customer quotations or completion summaries; adapt the child rules to chunk-scoped lookup, calculation, and `system_order_chunk` output without changing the applicable pricing logic.
- Emit progress events and subagent/tool-call UI activities during execution and recovery. Persist enough history to restore accurate progress without presenting old tool calls as new executions.

## Pending messages and reconfirmation

- Persist a new user message received during an active or interrupted quotation as pending. Resume or finish the old quotation against its original fixed input first; do not inject the pending message into a child or the aggregation prompt.
- Once the run completes, automatically process pending messages in arrival order. Persist message identity and processing progress so delivery retries, reconnects, or recovery do not apply a message twice or lose it. Cancellation also releases pending messages after its terminal state is durably accepted.
- For a pending order correction, AI applies the correction and emits a new full `ocr_result`. The backend saves that complete result, and the user must confirm quotation of the revised order before AI emits another quotation signal.
- Confirmation of an old order revision does not authorize quotation of a later correction. A pending instruction containing both a correction and a request to quote still presents the changed complete order for confirmation first.
- Only after the revised order is confirmed does AI follow the customer-resolution flow and emit `customer_data` with a new quotation signal. The backend checks all prerequisites again after that response completes.

## Cancellation button

- Show a dedicated `取消報價` button on the quotation-preflight progress/activity UI while a run is active, interrupted, or recoverably failed, including during final aggregation. It cancels the specific quotation signal index shown in that UI.
- Clicking the button requests cancellation directly from the backend without waiting for ordinary AI execution. Disable repeated clicks and show `取消中…` while awaiting the backend result; do not require an additional confirmation dialog.
- On accepted cancellation, persist the terminal cancelled state, stop scheduling further child work, request abortion of in-flight work, and prevent late child or aggregation responses from publishing a final quotation or changing the cancelled run back to completed.
- Show `已取消報價` after cancellation is accepted. Keep saved chunks, tool activities, input snapshots, and any intermediate aggregation data for debugging. Preserve the conversation's current `ocr_result`, customer context, and any earlier completed quotation.
- A cancelled run never auto-resumes. A later quotation request requires a new signal index. Cancelled partial results are not a complete `system_order`.
- If cancellation fails, show the error and allow retry; do not report cancellation as successful. If completion wins a concurrent cancellation race, report that the quotation already completed and preserve that completed result.
- Disconnection or interruption alone does not mean cancellation and continues to use normal recovery.

## Recovery boundary

- Use a durably saved, validated, complete `system_order_chunk` result with the required lookup evidence as the chunk checkpoint. Reuse completed chunks without a new child execution or repeated lookup, and rerun only unfinished or invalid chunks. Any rerun child execution must perform the required price lookup.
- Tool calls inside an unfinished chunk may run again; resuming midway through a child's tool-call sequence is outside this initial recovery guarantee.
- Track aggregation separately. If all chunks completed but final aggregation failed or was interrupted, reuse the saved chunks and retry only aggregation.
- A run is complete only after the full final `system_order` passes validation, the main agent completes its review and AI-owned output, the backend completes customer-quotation and summary generation, and all required artifacts are durably saved. Persist finalization progress so a restart after saving does not publish a duplicate final result; a backend-finalization retry must not repeat completed child or main-agent work.
- Restore progress and tool activity history using stable run, chunk, and attempt identities. Replayed historical events are not new tool calls; a rerun of an unfinished chunk is a new attempt within the same quotation signal index.

## Implementation contracts

- `## quote_signal` contains exactly `index` and `token` columns. The backend issues the opaque ticket from the actual successful customer lookup and binds it to the current order/customer snapshots and triggering turn. Admission checks the completed response against that ticket. Source rows receive deterministic `source-row-N` identities in original order.
- Implement durable storage, execution leases, atomic signal acceptance, restart recovery, and ownership checks, including cancellation authorization and stale-worker write protection.
- Preserve rule and calculation provenance, cross-chunk pricing dependencies, output validation, and bounded concurrency.
- Integrate existing edit/rerun semantics and distinguish current output artifacts from historical quotation artifacts.
- Retain backend finalization for the quotation main-agent output even though price-tool calls now occur in children. Do not gate customer-quotation or summary generation solely on price-tool calls in the main agent's own message history, and do not apply final quotation generation to `system_order_chunk` output.

## Current-code verification notes

- Backend customer-quotation composition is verified in `packages/api/src/steel/markdown/quote.ts` (`buildCustomerQuoteFromMarkdown`) and `packages/api/src/steel/native/oauth.ts` (`composeCustomerQuote` and the streaming parser integration).
- `quotation/protocol.ts` now owns quotation finalization: validate the canonical combined rows, compose the customer quotation with the existing helper, generate authoritative completion counts, and place conditional manual review last. Dedicated consolidation instructions override the legacy workbook directives that assigned backend-owned outputs to AI.

## Acceptance scenarios

1. A text order produces one full saved `ocr_result`; quotation waits for confirmation, then customer resolution and a completed response containing both `customer_data` and a new signal.
2. Multiple customer matches produce a selection question and no quotation signal until the user resolves the customer.
3. Missing order data, missing customer data, an incomplete response, or a repeated accepted signal does not create a new quotation.
4. A category with 61 source rows creates chunks of 30, 30, and 1. Recovery after the first two chunks were saved reruns only the third; aggregation-only failure reruns no completed child.
5. A pending quantity correction received during interruption remains separate from the old quotation, is applied once after completion, and produces a new full order requiring confirmation before a new signal.
6. Cancellation works while child work or aggregation is active, retains debug artifacts, releases the execution gate and pending messages, and prevents late responses from publishing the cancelled quotation.
7. Recovery preserves accurate event and subagent/tool-call activities without treating history replay as a new tool execution.
8. Every newly executed child calls `search_price_candidates` and saves its partial quotation as `## system_order_chunk`, using the final `system_order` columns and row format. A result without the required lookup evidence cannot count as a completed chunk.
9. Once all chunk batches complete, aggregating their saved tables produces one complete `## system_order` with one heading and header, preserves source order and required processing rows, and introduces no child-only columns. The main agent follows its existing AI-owned output workflow without calling the price tool, consolidates other applicable AI-owned Markdown, checks missing values, and emits `manual_review` only when needed. The backend generates `customer_quote` and the final completion summary and persists the finalized response.
10. Both quotations with review items and quotations without review items retain the existing section order, table schemas, conditional table emission, and exact completion-sentence format. Customer quotations and completion summaries are generated once by the backend, not by the main or child agents, including after recovery. Moving lookup and calculation to child agents preserves this division of output responsibilities.

## Implemented modules and verification

- `packages/api/src/steel/quotation/` owns preparation, protocol validation, immutable artifacts, CAS state/leases, execution, pending-message journals, provider invocation, and owner-scoped status/cancel handlers. OCR and quotation have separate run identities and checkpoints.
- `packages/data-schemas/src/schema/steel/quotation.ts` defines conversation state and immutable artifacts, including unique indexes. Environments with automatic indexing disabled must provision these declared indexes before enabling the workflow. The three declared indexes were explicitly created and read back in DEV; its MongoDB target was verified distinct from PROD. No records or existing indexes were removed.
- AgentClient and Responses both gate ordinary AI, start quotation only after completed AI output, and publish to stable message identities. Pending corrections are persisted before publication and skip the outer OCR finalizer so an older response cannot overwrite the newly saved order.
- Children run with bounded concurrency of one. Saved prompts, tool evidence, raw attempts, validated chunks, aggregation, final output, and publication receipts support debugging and retry. Recovery reuses complete checkpoints; final publication is retryable without rerunning AI.
- The quotation activity UI restores progress/tool history and supports owner-scoped cancellation. Pending messages include attachment metadata; file corrections use the existing OCR workflow before presenting the revised complete order.
- Automated tests cover protocol/source/tier/evidence validation, chunk/main/publication recovery, cancellation, pending FIFO and claim renewal, explicit deletion, both chat entry points, routes, and frontend status/cancel behavior. Final backend verification passed 185 package tests and 316 chat/route tests (2 pre-existing skips); API production build passed. Final integrity checks also passed: 60 quotation/context tests, followed by 17 protocol/runner regressions after the missing-thickness review fix. The state suite includes concurrent first requests against real unique indexes; candidate checks cover inclusive thickness bounds, missing headers, and inapplicable lookup results.
- DEV rule synchronization uses the managed manifest and verifies saved prompt hashes plus active/reviewed state. The target was checked to be distinct from PROD before applying.
- Runtime execution currently uses the existing OpenAI OAuth provider integration. No actual model-backed end-to-end quotation has been run in this implementation session. Production deployment and production rule synchronization have not been performed.
