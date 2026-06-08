# AI Rule Selection Scenarios

Purpose: make the next quote vertical slice testable by describing how AI should
reason about formula/rule/tool orchestration before backend validates workbook
results.

These scenarios are not prompt text. They are expected behavior for `/steel/oauth-chat`, provider tool orchestration, backend tool validation, and workbook patching.

## Operating Model

AI decides:

- what the customer probably ordered
- which candidate needs confirmation
- which backend tool to call next
- which reviewed formula/rule candidate to select
- whether a user instruction is a quote-specific override
- what workbook patch to propose from accepted tool results

Backend tools decide:

- whether a normalized item is complete enough to price
- whether a formula/rule/source is reviewed, active, and applicable
- whether a zero charge is supported by selected rule, reviewed true-zero fact, or quote-specific override
- whether workbook summary totals match the sum of line subtotals
- whether a workbook patch is valid and can be persisted

Backend code must not implement product-family shortcuts such as
`if C-type then cutting = 0`, and must not keep a parallel canonical quote
calculator. Reviewed defaults/rules become prompt/tool context for the AI
calculation lane.

C-type cutting/hole no-charge behavior must be configured as a site-managed quote default before it can be selected. AI retrieves and selects that default; backend validation accepts or rejects the selected origin. Backend code does not infer this behavior from C-type product family alone.

For any material whose matched facts can include cutting price and whose order requires cutting, AI asks about head/tail trimming unless the evidence, selected rule, or user instruction already makes it explicit. If no cutting is needed, the workbook still records cutting as `0` with a reason such as `無需切料`. If a remainder exists and the selected rule omits tail trim, assistant text and workbook notes must explicitly say `有餘料，切尾不計入`.

If AI produces numeric quote results whose summary total or confirmed amount does
not match the sum of line subtotals, the assistant must not patch confirmed
customer-facing totals. It should loop back to recalculate and emit a corrected
workbook patch, or patch only interpretation/manual-review state until totals are
internally consistent.

When the user explicitly asks for an approximate quote, such as `一支多少` or `大約100支`, AI may provide a preview estimate from the highest-confidence reviewed product-price candidate even when the request has typos or incomplete specs. It must state the assumed spec, confidence, and low-confidence reason. If multiple candidates are equally plausible or the price source is missing/zero, AI asks for confirmation instead of silently producing a confirmed quote.

When a single order contains multiple steel materials, each normalized item/line
gets its own calculation prompt/source context, AI-calculated result, confidence,
and workbook patch target. Order-level totals aggregate line subtotals only.
Database storage keeps the latest workbook state only; accepted updates overwrite
old state.

## Scenario 1: Clear C-Type Item, Default Free Cut/Hole Rule

User:

```text
C150*3.0 長度 1200，數量 10支
```

Expected AI logic:

1. Call `lookup_quote_rules` for C-type/material-price interpretation policy and reviewed quote defaults, including price-before-weight and C-type finished-length/no-general-cutting behavior.
2. Propose normalized quote item: material family C-type, spec candidate `C150`, thickness `3.0`, length `1200mm`, quantity `10`.
3. Call `search_customers` when customer context is present so tier and customer-scoped defaults can participate. Exact customer matches are returned by this tool, not by a separate `lookup_customer` MVP tool.
4. Use AI reasoning plus the returned Instruction Packets to produce material/spec candidates; proceed only if the candidate is high confidence or user confirmed.
5. Call `search_price_candidates` with confirmed normalized keys or AI-derived `candidateQueries`.
6. Use reviewed product-price unit weight when the returned price row carries one; otherwise rely on backend internal validation or formula/default facts rather than an exposed `lookup_weight_spec` MVP tool.
7. Call `lookup_formula` and select formula code `C` when returned as a reviewed C-type match.
8. Use the `quoteDefaults` returned by `lookup_quote_rules` for the preconfigured site-managed C-type quote default that says C-type cutting and hole charges are not counted. Material-rule lookup and selected-rule validation are backend internal policy, not separate MVP tools.
9. Select the C-type finished-length rule.
10. AI proposes the workbook calculation using material price, unit weight, length, quantity, formula code `C`, selected default/rule, and charge exclusions; backend validation/calculation confirms accepted numeric fields before they become confirmed totals.
11. Propose workbook patch for quote details, price sources, interpretation notes, manual review if needed, summary, and customer quote.

Expected backend validation:

- Formula code `C` must exist as reviewed and active.
- Selected C-type rule must match the normalized material/spec.
- Cutting/hole true zero is accepted only because selected global/site-managed quote default, reviewed rule, or explicit quote-specific override supports it.
- Product material price `0` still means no material price; it cannot be rescued by free cutting/hole behavior.
- If no cutting is needed under the selected C-type rule, workbook cutting fields still record `0` cutting with the selected rule/default as reason.

## Scenario 2: C-Type Item With Missing Or Zero Material Price

User:

```text
C100*50*20*2.3 長度 2M 數量 8支，切孔不用算
```

Reviewed price result:

```text
search_price_candidates -> best material price has valueState=unknown because source price is 0
```

Expected AI logic:

1. Continue formula/rule lookup enough to explain the calculation path and candidate differences.
2. Select nearest reviewed material-price/spec candidates from nonzero reviewed rows.
3. Do not produce a confirmed quote total.
4. Ask the user to confirm one nearest candidate or provide a material unit price.
5. Patch workbook only with candidate/manual-review state, interpretation notes, and no confirmed line total until the user confirms.

Expected assistant message:

```text
我找到 C 型鋼規則可讓切工/孔工不計價，但這筆材料單價目前是未確認。我找到幾個最相近的已審核規格/價格，請確認要套用哪一個，或直接提供材料單價。
```

Backend guard:

- `產品價格.xlsx` source value `0` remains no price.
- C-type true-zero cutting/hole does not imply material price is zero or confirmed.
- Candidate workbook patches must be marked as unconfirmed/manual review and must not update the customer-facing confirmed total.

## Scenario 3: Ambiguous C-Type Spec

User:

```text
C100 長度 1.5米 20支
```

Expected AI logic:

1. Propose candidates such as `C100x50`, `C100x50x20`, and available thickness variants.
2. Produce bounded candidate options from AI reasoning.
3. Treat the candidate state as `confirm_candidates`.
4. Ask the user to choose before price/formula calculation.

Expected assistant message:

```text
我找到多個 C100 可能規格：C100x50、C100x50x20、C100x50x20x2.3。請確認要用哪一個，或補厚度。
```

Backend guard:

- No calculator call before candidate confirmation.
- No workbook price patch for an ambiguous quote item.

## Scenario 4: User Custom Material Unit Price

User:

```text
這筆 C150*3.0 材料單價用 115，切跟孔不算
```

Expected AI logic:

1. Normalize and validate the C-type item.
2. Treat `115` as an explicit quote-specific `parameterOverride` for material unit price.
3. Still lookup formula/rule/weight source; do not mutate reviewed product price data.
4. Call calculation with default database price preserved as source evidence and quoted unit price overridden to `115`.
5. Patch workbook with both database default price and quoted price when workbook columns exist.

Expected backend validation:

- Override is high confidence because the user explicitly says "材料單價用 115".
- Override is scoped to the current workbook line.
- No customer default or quote defaults mutation occurs unless the user explicitly asks to save it as a future default, and then only a `needs_review` proposal can be created.

## Scenario 5: H-Type Non-Standard Length

User:

```text
H200 長度 7M 2支，要切
```

Expected AI logic:

1. Normalize as H-type, not C-type.
2. Select H-type formula/rule candidates.
3. Apply reviewed H non-standard length material surcharge because 7M is outside 6M, 9M, 10M, and 12M.
4. Ask whether cutting needs head trim, tail trim, no-head/no-tail, split-only, or other cut-count assumptions when the order only says "要切".
5. Separately lookup cutting price and cut-count evidence because H-type surcharge changes material unit price only.
6. Propose workbook patch after the cutting assumptions are confirmed, or patch material-only/manual-review state while waiting for cutting confirmation.

Expected assistant message:

```text
H200 長度 7M 會套用非定尺材料加價 +0.3/kg。切工我需要確認：要切頭、切尾、都不切，還是只做分切？
```

Backend guard:

- `+0.3/kg` applies only to material unit price.
- Cutting remains resolved through cutting-price data and cut-count calculator.
- C-type true-zero rule must not be visible or selected for this item.
- If head/tail cutting is unclear, confirmed cutting fee and final line total must wait for user confirmation or be marked manual review.

## Scenario 5A: Cuttable Material With Remainder

User:

```text
黑鐵扁條 長度 2M 5支，用 6M 材，要切
```

Expected AI logic:

1. Normalize as a cuttable long-material item.
2. Retrieve material price/weight, cutting price, and applicable cutting/allocation rules.
3. Detect that cutting is needed and head/tail trimming is not explicit.
4. Ask the user whether to cut head, cut tail, no-head/no-tail, or split-only before confirmed cut-count pricing.
5. After confirmation, calculate stock allocation and cut count.
6. If the allocation produces a remainder and the selected rule says tail trim is omitted when a remainder exists, explicitly say tail trim is not counted.
7. Patch workbook with operation cut count, billable cut count, tail-trim decision, remainder note, cutting fee, and source refs.

Expected assistant message after confirmation:

```text
此材料需要切料；6M 材切 2M 會有餘料，依規則切尾不計入，但最後一支與餘料的分離切仍計入切刀數。
```

Backend guard:

- Remainder omits only the extra tail trim/finish cut.
- The separation cut between the last finished piece and the remainder remains counted unless an explicit reviewed rule says otherwise.
- Workbook notes must preserve `有餘料，切尾不計入` when this path is applied.

## Scenario 5B: No Cutting Required

User:

```text
H200 6M 2支，不用切
```

Expected AI logic:

1. Normalize item and retrieve price/weight/formula rules.
2. Detect explicit no-cut instruction.
3. Skip cutting price and cut-count calculation.
4. Patch workbook with cutting fee `0`, cut count `0`, and reason `不用切` or `無需切料`.

Backend guard:

- Zero cutting is accepted here because the order explicitly says no cutting is needed, not because cutting price is unknown or silently free.
- Workbook must still show the zero cutting state so the quote trace is auditable.

## Scenario 6: User Wants Future Customer Default For H-Type

User:

```text
這個客戶以後 H 型鋼切跟孔都不用算錢
```

Expected AI logic:

1. Confirm the scope if customer, material family, charge type, or formula selector is unclear.
2. If enough structure is known, call rule-proposal creation through backend tool/API, not direct quote defaults publication.
3. Continue the current quote with quote-specific override only when applicable.
4. After future Admin approval and publication into the site-managed quote defaults retrieval layer, the next matching order for this customer should retrieve that customer-scoped H-type default.
5. When the approved default is applied, the assistant should explicitly tell the user that this customer's H-type cutting and hole charges are not counted.

Expected assistant message:

```text
我可以建立一筆待 Admin 審核的客戶預設規則。審核通過前不會自動套用；審核通過後，下次此客戶的 H 型鋼訂單會明確提示「已套用此客戶 H 型鋼切工/孔工不計價規則」。
```

Backend guard:

- Pending proposal must not participate in quote lookup.
- Quote assistant cannot publish global/site-managed quote defaults directly.
- Published customer-scoped defaults must remain scoped by customer and material selector, not become an all-customer H-type rule.

Expected future applied-default assistant message:

```text
已套用此客戶預設規則：H 型鋼切工與孔工不計價。材料費仍依 H 型鋼規格、長度與單價計算。
```

## Scenario 7: Summary Total Does Not Match Line Subtotals

User:

```text
把這張估價算一下，先給我 workbook 預覽
```

Provider/tool result:

```text
報價明細.line_1.subtotal = 19,430
總結.summary.totalAmount = 19,400
總結.summary.confirmedAmount = 19,400
Reviewed price source: A-tier unit price 194.3
```

Expected AI logic:

1. Do not accept the mismatched summary values as confirmed workbook totals.
2. Prompt/loop the model to recalculate from reviewed unit price, quantity,
   weight, formula/rule refs, and assumptions.
3. Patch confirmed numeric workbook fields only after source/rule validation and
   subtotal/summary consistency pass.
4. If the model cannot emit internally consistent totals, patch only
   interpretation/manual-review fields and mark the total as `未確認`.

Expected assistant message:

```text
目前不能確認總額，因為報價明細小計合計為 19,430，但總結寫成 19,400。我會依 reviewed 單價、數量、重量與公式重新計算，等總結與明細一致後再更新 workbook。
```

Backend guard:

- Mismatched summary totals are not persisted as confirmed customer-facing totals.
- Hidden provider code/tool output is not required as acceptance evidence and is
  not visible workbook content.
- Workbook `價格來源` / `判讀備註` may contain concise calculation/source summaries.
- If source/rule validation fails or summary totals disagree with line subtotals,
  no confirmed customer-facing total is patched.

## Scenario 8: 全華興 亞L30x30 Approximate Quote

User:

```text
全華興 報價 亞L30*30一支多少   大約100支
```

Expected AI logic:

1. Call `lookup_quote_rules` for material alias/surface-treatment/angle-steel price-search policy and reviewed quote defaults, especially oral conversion rules such as `L` as angle/L steel and `亞` as a low-confidence surface clue that must be validated against reviewed rows.
2. Call `search_customers` and match `全華興` to tier `A級`.
3. AI first reads the raw item text as evidence and identifies both issues: `亞` may be a typo/colloquial material clue, and `L30x30` is incomplete because thickness/length/surface variant are not confirmed.
4. AI proposes possible material/spec candidates from the raw evidence and returned Instruction Packets, not a confirmed source fact. For `亞L30*30`, likely candidates include angle/L steel, equal angle `30x30`, and possible surface/product wording such as `錏`, `錏成型角鐵`, `鍍鋅角鐵`, or generic `角鐵`.
5. AI decides which reviewed-data tool path to use from the normalized candidate and user intent. For this "一支多少" material-price question, the appropriate path is product-price lookup, not handbook weight, cutting price, or material-rule lookup.
6. For the product-price path, AI directly provides derived `candidateQueries` to `search_price_candidates`; it must not query reviewed price rows with the raw typo string `亞L30x30`. Bounded query candidates include `錏成型角鐵` + `30x30`, `鍍鋅角鐵` + `30x30`, `角鐵` + `30x30`, and optional `L30x30`.
7. Call `search_price_candidates` with the derived candidate queries and use the returned reviewed rows plus backend safety marks to decide whether the result is usable, ambiguous, missing, or only an estimate.
8. If there is one clearly highest-confidence source-backed candidate, use it for a preview estimate and ask the user to confirm the assumption. Example: `錏成型角鐵 30x30x2.5x6M`.
9. Use A-tier unit price `194.3 元/支` from the reviewed product-price row.
10. Treat quantity as approximate because the user said `大約100支`.
11. Produce a preview quote from the highest-confidence candidate, with overall confidence `中` because the user omitted thickness and exact surface/material variant.
12. Generate a provisional workbook update: write the likely line item, candidate price/source refs, confidence, missing fields, and manual-review/confirmation note. Do not mark the line as a final confirmed customer-facing total until the user confirms the candidate or provides exact thickness/unit price.
13. Explain the assumption and list bounded options in chat so the user can judge without opening source files.
14. If multiple plausible candidates remain, do not list only the highest candidate. Present bounded options with product name, spec, tier price, unit, source, and the difference that matters.
15. If product price is `0` or missing for the exact candidate, keep that unavailable candidate visible as an option with the unavailable reason, then list nearest reviewed candidates or ask the user to provide the exact unit price.

Expected assistant message:

```text
全華興查到是 **A級**。你寫「亞L30×30」，我先推導為可能的角鐵/L鐵 30×30，再用這些候選查產品價格表；最接近採用：

| 品項       | 規格          | A級單價       | 數量    | 小計          |
| ---------- | ------------- | ------------- | ------- | ------------- |
| 錏成型角鐵 | 30×30×2.5×6M | **194.3 元/支** | 約100支 | **19,430 元** |

**報價建議：亞 L30×30 一支先報 194 元/支，100支約 19,430 元。**

依據：客戶資料表顯示全華興為 A級；報價規則要求產品價格需先查產品價格表、找到匹配品項後依客戶分級取價，不可用手冊重量取代價格表單價。

信心：**中**
低信心原因：你只寫「亞L30×30」，未寫厚度；`亞` 不是已確認品名，我只把它當作可能的 `錏`/鍍鋅相關候選，再用 reviewed price rows 查到 **錏成型角鐵 30×30×2.5×6M** 暫估。若客人要 3.0t 或熱浸鍍鋅，價格會不同。

請確認是否採用這個規格；如果不是，請選下面其中一個或直接提供正確厚度/單價。
```

Expected assistant message when multiple plausible candidates remain:

```text
全華興查到是 **A級**。你寫「亞L30×30」，但厚度沒寫完整；產品價格表有多個接近品項，請選一個：

| 選項 | 品項       | 規格           | A級單價       | 差異/需確認 |
| ---- | ---------- | -------------- | ------------- | ----------- |
| 1    | 錏成型角鐵 | 30×30×2.5×6M  | 194.3 元/支   | 先前常用近似；厚度 2.5t |
| 2    | 錏成型角鐵 | 30×30×3.0×6M  | 221 元/支     | 厚度 3.0t，單價較高 |

目前不寫 confirmed 總額；你回「選 1」、「選 2」，或直接給厚度/單價後我再更新報價。
```

Expected workbook patch:

- `報價明細` records customer `全華興`, customer tier `A級` internally, item `錏成型角鐵`, assumed spec `30x30x2.5x6M`, unit `支`, unit price `194.3`, approximate quantity `100`, provisional line estimate `19430`, and confirmation/manual-review state.
- `價格來源` records the reviewed product-price row and A-tier price source.
- `判讀備註` records that AI detected typo/incomplete spec, used `亞L30x30` only as evidence, searched derived candidates, selected/returned `錏成型角鐵 30x30x2.5x6M`, missing thickness lowered confidence, and the quote is provisional.
- `人工複核` is marked when the workbook has a review/confidence field for provisional estimates.

Backend guard:

- Product-price table row wins over handbook weight for this piece-priced quote.
- AI owns tool orchestration: after candidate reasoning it chooses among the MVP
  reviewed lookup tools: `lookup_quote_rules`, `search_customers`,
  `search_price_candidates`, and `lookup_formula`. Backend
  tools validate the chosen tool input and source facts, but do not silently
  choose the domain lookup path from raw text. Weight, cutting, processing,
  material-rule, ranking, and calculator details remain backend internal unless
  a later slice explicitly exposes them.
- `search_price_candidates` must not use raw typo/incomplete source text such as `亞L30x30` as a canonical `product_name` or `spec_key`. It searches only derived `candidateQueries` or confirmed normalized keys.
- Workbook generation may record provisional estimates and candidate/source
  context, but confirmed totals need user confirmation when spec or price
  candidate selection remains ambiguous.
- The preview is allowed because the user asked approximately and the selected candidate is the highest-confidence source-backed match. Overall confidence remains medium when required dimensions are missing, and assistant text must ask the user to confirm the assumed candidate.
- If multiple plausible reviewed candidates remain, tool output must include all bounded options with enough product/spec/price/source detail for the user to choose without opening the source files.
- If the product price is `0`, missing, or tied across multiple plausible specs, no confirmed customer-facing total is patched before confirmation. A provisional/manual-review workbook note may record the candidates.

## Scenario 9: Multi-Item Order Calculation Audit Scope

User:

```text
全華興 C150*3.0 長度1200 10支，亞L30*30 大約100支，先給我預覽
```

Expected AI logic:

1. Normalize this as one quote/order request with two item candidates.
2. Keep one current workbook state for the conversation/workbook.
3. Keep line-specific calculation/source context for the C-type line.
4. Keep separate line-specific calculation/source context for the angle line.
5. Run AI calculation separately per item with line-specific reviewed source and
   rule context.
6. Patch workbook line fields separately, then aggregate summary totals from line
   subtotals.
7. If one item is medium confidence and the other is high confidence, preserve confidence per item instead of lowering the whole order to one undifferentiated status.

Expected evidence handling:

- Each item keeps its own calculation prompt/source context and validation
  summary.
- Calculation/source summaries for one material line must not overwrite another
  line.
- Later accepted workbook updates overwrite current workbook values instead of
  creating retained historical versions.

Backend guard:

- Workbook `報價明細` rows reference their own row-level calculation/source status
  when needed.
- `總結` aggregates accepted line subtotals only.
- Concise `價格來源` / `判讀備註` summaries stay line-specific so users can revise one material without corrupting another.
- Workbook `version` only tells the user/UI that the latest state has updated; it does not mean old database rows are preserved for rollback.
