# Instruction Packets

Goal: design task-scoped `steel.instruction_packets` records retrieved through
the merged `lookup_quote_rules` runtime tool.

This document owns only Instruction Packet design and seed packet text. The
default every-turn Agent Instruction lives in
[`agent-instructions.md`](agent-instructions.md).

This is a docs/design baseline. When implementation adds or changes Steel
PostgreSQL schema, update both `supabase/schema.sql` and a new one-change
migration.

## Runtime Boundary

Instruction Packets are reviewed, task-scoped instructions:

1. AI starts every Steel quote turn with the active Agent Instruction already
   injected.
2. AI calls `lookup_quote_rules` when the current task needs scoped rules such
   as alias expansion, C-type behavior, cutting policy, drawing interpretation,
   workbook output, defaults, or confirmation policy.
3. `lookup_quote_rules` returns bounded reviewed active instruction packets plus
   reviewed quote defaults. It does not return the whole instruction corpus, raw
   source chunks, price rows, or final calculations.
4. Each `lookup_quote_rules` call is batched by interpreted order context. AI
   sends all detected catalog families, task types, processing types, formula
   candidates, customer/tier context, and low-confidence facets together instead
   of separate lookups for each small detail.
5. `lookup_quote_rules = lookup_instructions + lookup_defaults`: the merged
   runtime tool returns both the instruction-packet subset and reviewed quote
   defaults in one bounded response.
6. AI uses returned packet/default bodies to generate material/spec candidates and
   decide which reviewed lookup tool to call next.
7. Packets and defaults guide interpretation; they do not confirm source facts,
   prices, formulas, customer tiers, true-zero charges, or totals.
8. Reviewed data lookup and backend validation still decide confirmed values.

## Injection Language Rule

Instruction Packet bodies injected into AI prompts must be Traditional Chinese.

Canonical API/schema keys can remain English, for example `taskTypes`,
`catalogFamilies`, `requiredLookups`, and `blockingRules`. User-facing or
AI-instruction body text should be Traditional Chinese so runtime prompt
injection is consistent across Agent Instruction and Instruction Packets.

## Packet Use Cases

Use Instruction Packets for rules that should not be injected into every turn:

- 口語品名、錯別字、表面處理線索。
- 價格先於重量的任務細節。
- C 型鋼、H 型鋼、角鐵、管材、板材等材料別行為。
- 公式選擇、公式編號候選與公式適用材料分類。
- 長條料配料、修頭尾與切工判讀。
- H 型鋼常規/非常規米數與非常規加價判讀。
- H 型鋼、工字鐵、黑鐵管、黑角鐵、黑槽鐵、黑平鐵等切工價錢判讀。
- 圓孔、長孔、開槽、折工與圖面判讀。
- workbook output 與 confirmation policy。
- 經審核的 customer / tier / project scoped 判讀規則。

Instruction Packets 不可繞過 reviewed data lookup。Packet 只協助 AI 產生候選與
選擇工具；`lookup_quote_rules` 回傳的 defaults、`search_price_candidates`、
`lookup_formula` 與 backend validation 才能決定 confirmed facts。

## Storage Shape

Planned table: `steel.instruction_packets`.

Conceptual fields:

- `id`
- `slug`
- `title`
- `version`
- `locale`: `zh-TW`
- `reviewState`: `draft`, `needs_review`, `reviewed`, `retired`
- `active`
- `priority`
- `packetGroup`: stable group/bundle key for related material/task packets
- `groupRole`: `base`, `material`, `processing`, `formula`, `workbook`, or
  `confirmation`
- `relatedPacketSlugs`: reviewed sibling packets that should usually be returned
  together for the same interpreted order context
- `effectiveAt`
- `expiresAt`
- `supersedesId`
- `scope`: company/project/customer/tier selectors when applicable
- `selectors`: multi-axis task/material/process/formula selectors
- `body`: Traditional Chinese reviewed instruction text
- `examples`: Traditional Chinese positive/negative examples
- `requiredLookups`: tools the packet expects AI to consider
- `blockingRules`: Traditional Chinese actions AI must not take when the packet
  applies
- `sourceRefs`: structured refs to source documents, source versions, or admin
  review notes
- `createdBy`, `reviewedBy`, `createdAt`, `updatedAt`, `reviewedAt`

Implementation stores selectors/body as JSONB where that keeps Admin editing
flexible, but runtime APIs expose typed DTOs with canonical English keys.

As of the DB-backed runtime slice, this table is no longer only planned:
`lookup_quote_rules` must read active reviewed records from
`steel.instruction_packets` and reviewed defaults from `steel.quote_defaults`.
Static code packets may be used only as seed material, migration fixtures, or
tests; they must not be the normal runtime source of Admin-editable quote rules.

## Selector Model

Selectors are multi-axis. Material family is important but not enough.

Recommended selector keys:

- `packetGroups`: `global-quote-core`, `angle-zinc-quote-core`,
  `c-type-quote-core`, `h-type-quote-core`, `black-long-material-cutting-core`,
  `plate-processing-core`, `workbook-output-core`
- `taskTypes`: `candidate_generation`, `material_price_lookup`,
  `formula_selection`, `default_selection`, `drawing_interpretation`,
  `processing_detection`, `workbook_output`, `confirmation_policy`,
  `ocr_file_interpretation`
- `catalogFamilies`: `h_beam`, `c_type`, `angle`, `channel`, `flat_bar`,
  `rail`, `b_pipe`, `a_pipe`, `p_pipe`, `steel_pipe`, `piping`, `i_beam`,
  `round_bar`, `square_bar`, `rectangular_pipe`, `round_pipe`, `square_pipe`,
  `plate`, `galvanized_plate`, `ot_plate`, `black_plate`, `grating`,
  `wire_mesh`, `expanded_metal`, `floor_deck`, `corrugated_panel`
- `priceFields`: `unit`, `unitPrice`, `productPriceUnitWeight`,
  `productPriceUnitWeightUnit`, `metadata.sourceRatio`,
  `metadata.sourcePriceUnitBasis`, `metadata.sourceUnitWeightColumn`,
  `metadata.sourceUnitWeightOrigin`, `metadata.sourceParentheticalUnitWeight`,
  `metadata.productPriceWeightRuleScope`
- `productFamilies`: source/product-level categories when known
- `surfaceTreatments`: `black`, `stainless`, `galvanized`, `zinc_plated`,
  `aluminum_zinc`, `painted`, `hot_dip_galvanized`, `unknown`
- `processingTypes`: `cutting`, `head_tail_trim`, `holes`, `long_holes`,
  `slotting`, `bending`, `none`
- `formulaCodes`
- `customerIds`
- `customerTierIds`
- `projectIds`
- `sourceCategories`
- `confidenceFloor`

Conflict policy:

- 精準 customer/project selectors 優先於 tier/company selectors。
- 更具體的 material/process selectors 優先於寬泛 task-only selectors。
- selector specificity 相同時，較高 reviewed `priority` 優先。
- superseded 或 inactive packets 預設不回傳。
- 若同 specificity / priority 的 active reviewed packets 互相衝突，工具應同時回傳並
  標記 `conflict`，AI 必須請使用者確認或列入 manual review，不可靜默硬選。

## Packet Group Model

Instruction Packets should be organized into related rule bundles so one batched
`lookup_quote_rules` request can return every rule needed for the detected
material/task/process context.

Grouping policy:

- `packetGroup` is the retrieval bundle key. It is not user-facing wording and
  should stay stable across packet versions.
- Related material packets should sit in the same group or list each other in
  `relatedPacketSlugs`; do not leave hole, cut, formula, price, and workbook
  rules as isolated fragments that require separate tool calls.
- `lookup_quote_rules` should expand matching groups. If the request includes
  H 型鋼 with cutting and holes, return the H 型鋼 group plus shared cut/drawing/
  workbook packets in the same response.
- Global packets can belong to `global-quote-core` and also be returned as
  dependencies of material groups.
- A packet can match multiple groups when it is truly shared, such as
  `formula-code-selection-zh-v1`, `cut-count-and-trim-detection-zh-v1`, and
  `drawing-processing-detection-zh-v1`.

Seed group map:

| Packet group                       | Purpose                          | Packets usually returned together                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global-quote-core`                | 通用候選、價格來源、公式、確認   | `price-source-priority-zh-v1`, `product-price-unit-weight-calculation-zh-v1`, `oral-material-candidate-generation-zh-v1`, `formula-code-selection-zh-v1`, `workbook-provisional-confirmed-zh-v1`                              |
| `angle-zinc-quote-core`            | 角鐵 / 錏 / 鍍鋅角鐵候選與切工   | `angle-surface-oral-zh-v1`, `price-source-priority-zh-v1`, `product-price-unit-weight-calculation-zh-v1`, `oral-material-candidate-generation-zh-v1`, `black-steel-cutting-price-zh-v1`, `cut-count-and-trim-detection-zh-v1` |
| `c-type-quote-core`                | C 型鋼專用材料、公式與孔洞處理   | `c-type-basic-quote-zh-v1`, `price-source-priority-zh-v1`, `product-price-unit-weight-calculation-zh-v1`, `formula-code-selection-zh-v1`, `drawing-processing-detection-zh-v1`                                                |
| `h-type-quote-core`                | H 型鋼米數、加價、切工與加工另計 | `h-type-length-surcharge-zh-v1`, `h-and-i-beam-cutting-price-zh-v1`, `product-price-unit-weight-calculation-zh-v1`, `formula-code-selection-zh-v1`, `cut-count-and-trim-detection-zh-v1`                                      |
| `black-long-material-cutting-core` | 黑鐵管/角/槽/平鐵等長條切工      | `black-steel-cutting-price-zh-v1`, `cut-count-and-trim-detection-zh-v1`, `price-source-priority-zh-v1`, `product-price-unit-weight-calculation-zh-v1`                                                                         |
| `plate-processing-core`            | 板材孔洞、開槽、折工與公式候選   | `drawing-processing-detection-zh-v1`, `formula-code-selection-zh-v1`, `price-source-priority-zh-v1`, `product-price-unit-weight-calculation-zh-v1`                                                                            |
| `workbook-output-core`             | workbook provisional/confirmed   | `workbook-provisional-confirmed-zh-v1`, `workbook-output-columns-zh-v1`                                                                                                                                                       |

## `lookup_quote_rules` Contract

Input should be compact and task-scoped. Do not send full source files.

AI should batch the lookup by interpreted order context. A single order can
contain multiple steel material families and multiple processing needs; the
request should include all detected material, task, processing, formula, and
customer/tier facets together. Do not call `lookup_quote_rules` separately for
each small detail such as hole count, cut count, slotting path, or each single
line item when those details belong to the same interpreted order context.
The request may include `packetGroupHints`; the tool should use them to expand
related packets and return a complete rule bundle for each material context.

Use one batched lookup:

- after AI has an initial material/process interpretation for the current order
- before generating final price `candidateQueries`
- before deciding which formula/default/processing validation path is needed
- again only when later user input materially changes interpreted facets, such
  as adding another material family, a new processing type, or a different
  customer/tier scope

Example request:

```json
{
  "taskTypes": [
    "candidate_generation",
    "material_price_lookup",
    "formula_selection",
    "processing_detection",
    "drawing_interpretation",
    "workbook_output",
    "confirmation_policy"
  ],
  "packetGroupHints": [
    "angle-zinc-quote-core",
    "h-type-quote-core",
    "plate-processing-core",
    "workbook-output-core"
  ],
  "evidenceSummary": "order contains 亞L30x30, H 型鋼 8M with cutting, plate with 4-Ø22 holes and slotting lines",
  "materialContexts": [
    {
      "lineRefs": ["line-1"],
      "packetGroupHints": ["angle-zinc-quote-core"],
      "materialCandidates": ["angle"],
      "surfaceCandidates": ["zinc_plated", "galvanized", "unknown"],
      "sizeCandidates": [{ "aMm": 30, "bMm": 30 }],
      "processingTypes": ["none"],
      "lowConfidenceReasons": ["亞 is typo/surface clue", "thickness unknown"]
    },
    {
      "lineRefs": ["line-2"],
      "packetGroupHints": ["h-type-quote-core"],
      "materialCandidates": ["h_type"],
      "formulaCandidates": ["H"],
      "lengthCandidates": [{ "lengthM": 8 }],
      "processingTypes": ["cutting", "head_tail_trim"],
      "lowConfidenceReasons": ["head/tail trim not confirmed"]
    },
    {
      "lineRefs": ["line-3"],
      "packetGroupHints": ["plate-processing-core"],
      "materialCandidates": ["plate"],
      "formulaCandidates": ["BH", "BS4"],
      "processingTypes": ["holes", "slotting", "bending"],
      "drawingFacets": {
        "holeEvidence": ["4-Ø22"],
        "slottingPathKnown": false,
        "bendCountKnown": false
      },
      "lowConfidenceReasons": ["slotting continuous edge length unclear"]
    }
  ],
  "customerContext": {
    "customerName": "全華興",
    "tierKnown": false
  },
  "limit": 12
}
```

Expected response groups:

- `instructionPacketGroups`: packet-group summary and returned slugs.
- `instructionPackets`: reviewed packets with body, blocking rules, required
  lookups, matched facets, and source refs.
- `quoteDefaults`: reviewed defaults matched by catalog/customer/charge/formula
  facets.
- `requiredLookups`: deduped follow-up tools the AI should consider, such as
  `search_price_candidates`, `lookup_formula`, or processing price lookup.
- `userVisibleNotes`: concise assumptions/defaults AI may show to the user.
- `confirmationQuestions`: concise user-confirmation prompts.
- `conflicts`: conflicting packets/defaults that require manual review or user
  confirmation.

## Merged Rule Response Composition

`lookup_quote_rules = lookup_instructions + lookup_defaults`. The names
`lookup_instructions` and `lookup_defaults` describe internal response facets,
not separate AI-callable runtime tools. The instruction facet uses the same
`steel.instruction_packets` repository and returns:

- `packetGroups`
- `packets`
- `notReturnedReason`
- `conflicts`

The defaults facet returns targeted reviewed quote defaults from
`steel.quote_defaults`.

Runtime instructions should call `lookup_quote_rules` when AI needs
task-scoped interpretation rules, defaults, or both in the same turn.

Response should be bounded and source-backed:

```json
{
  "packetGroups": [
    {
      "group": "angle-zinc-quote-core",
      "lineRefs": ["line-1"],
      "returnedPacketSlugs": ["angle-surface-oral-zh-v1", "price-source-priority-zh-v1"]
    }
  ],
  "packets": [
    {
      "id": "packet_angle_surface_zh_v1",
      "slug": "angle-surface-oral-zh",
      "version": 1,
      "title": "角鐵口語與表面處理候選",
      "priority": 80,
      "confidence": "medium",
      "packetGroup": "angle-zinc-quote-core",
      "matchedFacets": {
        "lineRefs": ["line-1"],
        "taskTypes": ["candidate_generation", "material_price_lookup"],
        "materialFamilies": ["angle"],
        "processingTypes": ["none"]
      },
      "instruction": "L30x30 可作為等邊角鐵候選；亞只能作低信心表面處理線索，需查 reviewed price rows 驗證。",
      "requiredLookups": ["search_price_candidates"],
      "blockingRules": ["不要把 亞L30x30 當作價格表 canonical key"],
      "sourceRefs": []
    }
  ],
  "notReturnedReason": null,
  "conflicts": []
}
```

Tool rules:

- 預設只回傳 reviewed active packets。
- 一次回傳符合整個 `materialContexts` / `taskTypes` / `processingTypes`
  組合的 bounded packets，並標示每個 packet match 到哪些
  line/material/process facets。
- 依 `packetGroupHints` 與 selector match 展開相關 packet groups。回傳應盡量是完整
  規則包，而不是只回單一最高相似 packet；若因 limit 無法完整回傳，必須在
  `notReturnedReason` 或 group summary 標明哪些 sibling packets 被省略。
- 不要要求 AI 針對孔洞、切刀數、開槽、折工、公式或單一材料行各自拆成多次
  `lookup_quote_rules`。只有當使用者後續新增材料或改變加工需求時，才需要重新查。
- 回傳數量不得超過 requested limit，加上必要 conflict markers。
- context refs 必須包含 `sourceRefs`、packet ID 與 version。
- sanitize raw source excerpts，不可回傳 full instruction corpus。
- 保留 packet labels，讓 assistant response 可在必要時說明套用了哪個 reviewed
  instruction rule。

## Admin Lifecycle

Admin review UI is paused, but backend/Admin lifecycle should be planned now:

1. 從 `docs/reference/instruction.txt` seed draft packets。
2. Admin/backend review 後，packet 進入 `reviewed`。
3. active reviewed packet 才可由 `lookup_quote_rules` 回傳。
4. 編輯 packet 時建立新版本；舊 active rows 需 supersede 或 retire。
5. Runtime 在 prompt context refs、tool logs、workbook source notes、calculation
   audit 記錄實際回傳且影響報價的 packet IDs/versions。
6. Pending 或 draft packets 不可進入 quote runtime，除非未來另開 explicit admin
   preview mode。

## Seed Packet Groups And Examples

Each seed packet declares packet group membership. Runtime retrieval should use
these groups to return related rules together for one interpreted order context.
The grouping below is part of the contract, not only documentation order.

### `angle-surface-oral-zh-v1`

Packet groups:

- `angle-zinc-quote-core`

Selectors:

- `taskTypes`: `candidate_generation`, `material_price_lookup`,
  `confirmation_policy`
- `materialFamilies`: `angle`
- `surfaceTreatments`: `zinc_plated`, `galvanized`, `unknown`

Body:

- `L30x30`、`L38` 與類似 `L + 尺寸` 的口語寫法，可以作為角鐵 / L 鐵候選。
- `亞` 不能直接當作 confirmed canonical product word。只能作為低信心表面處理
  線索，可能代表 `錏`、鍍鋅、zinc-plated 或客戶錯字。
- 查價格前必須產生多組 candidate queries：
  - `錏角鐵 30x30`
  - `錏成型角鐵 30x30`
  - `鍍鋅角鐵 30x30`
  - `角鐵 30x30`
  - `L30x30`
- 若使用者或價格表品名已明確給出 `錏成型角鐵30*2.5*6M`、
  `熱浸鍍鋅角鐵30*3.0` 這類單邊尺寸/厚度/長度規格，不能只查等邊
  `30x30`。必須同時產生 `30x2.5x6M`、`30x2.5`、`30x3.0` 等價格表
  `specKeyContains` 候選，再用 reviewed price rows 驗證。
- 若 `search_price_candidates` 回傳多個厚度或品名，必須列出所有 bounded
  options，包含產品、規格、厚度、tier price、unit 與 source context。
- 對 `一支多少` 這類快速報價，若回傳一個或多個 reviewed positive approximate
  candidates，先用最高信心且有來源支撐的候選作 provisional quote，再列出其他
  bounded options 讓使用者確認。
- 若只有一個最近似 reviewed positive candidate，可用於 provisional estimate；
  但回覆必須說明採用的產品/規格假設，並請使用者確認。
- 若沒有 positive source-backed price candidate，不可編造價格；說明已查的候選並
  請使用者補厚度、長度、表面處理、客戶/分級或提供單價。

Blocking rules:

- 不要把 `亞L30x30` 當作價格表 canonical key。
- 不要只列最高相似候選，省略其他 bounded options。

### `c-type-basic-quote-zh-v1`

Packet groups:

- `c-type-quote-core`

Selectors:

- `taskTypes`: `formula_selection`, `default_selection`,
  `material_price_lookup`, `processing_detection`, `confirmation_policy`
- `catalogFamilies`: `c_type`
- `processingTypes`: `cutting`, `holes`, `none`

Body:

- C 型鋼仍必須先查 reviewed product-price rows，不可只用重量推價。
- C 型鋼口語品名通常對應產品價格列的輕型鋼品名；例如
  `C型鋼 100x50x20 2.3t` 應以 `catalogFamilies: ['c_type']` 搭配
  `100x2.3` 等尺寸/厚度片段查價。
- 材質不明時，AI 使用 `productNames: [錏輕型鋼]` 作為通常情況的高信心
  候選。同時列出白鐵輕型鋼、黑鐵輕型鋼等 bounded alternatives 並請確認。
- 第一輪若材質/表面不明，回覆必須列出同規格、不同材質的 reviewed bounded
  options；第二輪若使用者沒有指定其他材質/表面，視為確認預設錏輕型鋼。
- 未指定客戶或找不到客戶價格等級時，查價使用全域預設 B 價分級
  `customerTierId: 2`；回覆必須簡短提醒目前用價格B，例如
  `目前用 價格B：26.8 元/kg`，若提供客戶名稱可再查該客戶報價；不要加最高/最貴說明。
- 對使用者顯示價格 bullet 時，用 `價格：<單價>`，不要寫
  `reviewed 價格：<單價>`；reviewed/source 狀態放在來源或備註即可。
- 快速報價若已顯示整支總重，例如 `6M 一支重量：4 × 6 = 24 kg`，不要再另列
  `單位重` bullet；有總重即可，接著列單價與報價金額。
- C 型鋼通常是成品長度鋼捲抽料 / 成型下料，不套一般 6M 素材配料邏輯。
- C 型鋼切工與孔費預設免費，可列為 true-zero/no-charge。
- C 型鋼切工/孔費免費不代表材料單價、特殊加工、非 C 型鋼加工或其他 charge 免費。
- AI 應呼叫 `lookup_formula` 查 reviewed formula candidates，並透過
  `lookup_quote_rules` 取得 reviewed no-charge/default behavior 與適用範圍。

Blocking rules:

- 不要把 `C型鋼` 當作 `productNames` 候選卡死價格查詢；已選 `c_type`
  時，優先用尺寸/厚度 spec fragments 查 reviewed price rows。
- 不要在 customer/tier 未知時把 `customerTierId` 設為 A/tier 1；查價必須使用
  B 價分級 `customerTierId: 2`。
- 不要在已經由 `search_customers` 找到可用客戶分級時，仍用 B 預設價覆蓋該客戶
  分級。
- 不要在材質不明的第一輪只顯示錏輕型鋼，省略同規格其他材質候選。
- 不要只用 `100x50x20 2.3t` 這類完整斷面字串查 C 型鋼價格；產品價格表以
  `100x2.3` 這類寬度/厚度片段命中。
- 不要把 C 型鋼切工/孔費免費規則套用到材料單價、特殊加工或非 C 型鋼品項。
- 不要把 C 型鋼套用一般長條料 6M 配料、餘料與一般切工邏輯。

### `workbook-provisional-confirmed-zh-v1`

Packet groups:

- `workbook-output-core`
- `global-quote-core`

Selectors:

- `taskTypes`: `workbook_output`, `confirmation_policy`

Body:

- 有 reviewed candidates 但材料、厚度、長度、單位、客戶分級或價格仍未確認時，
  只能寫 provisional workbook notes。
- unresolved ambiguity 不可寫 confirmed customer-facing totals。
- workbook notes 應包含 candidate options、source refs、confidence、adopted
  assumption 與 required user confirmation。
- workbook context 存在時，才可透過 provider-facing workbook output tool 寫入。
  所有 AI workbook 更新統一用 `patch_quote_workbook` 輸出 semantic quote data；
  backend 再投影成 typed workbook operations。
- 同一筆 line 若改變客戶、分級、重量、單價、小計或數量，必須用相同 `lineId`
  重新輸出 semantic quote patch，讓所有相關 workbook sheets 可同步投影更新。
- workbook output tool 成功後，chat 回覆只需簡短說明訂單資訊與 workbook 改動重點；
  不可列逐欄 diff、長搜尋關鍵字或長候選品項，也不可只回 `已更新 workbook：N 個欄位`。

Blocking rules:

- 不要要求使用者提供 workbook internal IDs。
- 不要在缺價或歧義未確認時寫 confirmed total。
- 不要只回 workbook 更新欄位數而不說明更新了哪些資訊。

## Reference-Derived Seed Packet Additions

These additions classify fine-grained rules from
`docs/reference/instruction.txt`, `docs/reference/H型鋼.txt`,
`docs/reference/切工價錢.xlsx`, and `docs/reference/公式編號.xlsx`.

### `price-source-priority-zh-v1`

Packet groups:

- `global-quote-core`
- `angle-zinc-quote-core`
- `c-type-quote-core`
- `h-type-quote-core`
- `black-long-material-cutting-core`
- `plate-processing-core`

Source refs:

- `docs/reference/instruction.txt`: 固定資料來源、資料優先順序、價格先於重量、
  產品價格搜尋規則、價格比對決策。

Selectors:

- `taskTypes`: `candidate_generation`, `material_price_lookup`,
  `confirmation_policy`
- `materialFamilies`: `c_type`, `h_type`, `angle`, `channel`, `flat_bar`,
  `round_bar`, `square_bar`, `round_pipe`, `square_pipe`, `plate`, `stainless`,
  `galvanized`, `misc`

Body:

- 除非使用者明確提供單價，材料與加工報價必須先查 reviewed product-price rows，
  再依客戶分級與該列計價單位取價。
- 手冊、重量表或公式只能用於重量、尺寸對照與公式計算，不可取代產品價格列的單價。
- 若產品價格列是支價、片價、尺價、kg 價、孔價、刀價、M 價或式價，必須依來源列
  的計價單位計算，不可擅自轉成其他單位。
- 找不到完全匹配時，可以列出最接近 reviewed candidates 做 provisional estimate，
  但必須標示低信心、差異、source context，並請使用者確認。
- 單價空白或 `0` 預設是 missing price，不可填 0；可列「未確認」或找相近有價候選
  作暫估。
- 價格來源要保留原始品名、標準化品名、candidate queries、候選品項、採用品項、
  單價欄位、計價單位、客戶分級、匹配程度、差異與未採用原因。

Blocking rules:

- 不要只用手冊重量推價。
- 不要把 blank / `0` product price 當作免費或 true-zero。
- 不要將 kg 價、支價、片價、孔價、刀價、M 價互相轉換，除非 reviewed formula /
  backend validation 明確支持。

### `product-price-unit-weight-calculation-zh-v1`

Packet groups:

- `global-quote-core`
- `angle-zinc-quote-core`
- `c-type-quote-core`
- `h-type-quote-core`
- `black-long-material-cutting-core`
- `plate-processing-core`

Source refs:

- `docs/reference/產品價格.xlsx`: 售價欄、產品品名/規格、單位重。
- User correction: product-price unit weight and sale-price calculation rules.

Selectors:

- `taskTypes`: `material_price_lookup`, `formula_selection`,
  `confirmation_policy`
- `catalogFamilies`: `c_type`, `h_beam`, `angle`, `channel`, `flat_bar`,
  `round_bar`, `square_bar`, `round_pipe`, `square_pipe`, `plate`, `stainless`,
  `galvanized`, `misc`

Body:

- `產品價格.xlsx` 的 `unitPrice` 必須搭配 `productPriceUnitWeight` 與
  `productPriceUnitWeightUnit`、以及 reviewed row 的 `unit` 解讀，不可只因
  使用者問 `一支多少` 就把 `unitPrice` 當作每支總價。
- `unit` 表示售價欄單位；`productPriceUnitWeightUnit` 表示重量欄語意。
- 此規則只套用在鋼材/材料 stock catalog families，例如 `h_beam`（含
  `輕量H`）、`c_type`、`angle`、`channel`、`flat_bar`、`rail`、pipe
  families、plate families、mesh、grating、floor deck。非鋼材或非材料產品/
  accessory rows，例如彈簧、螺絲、門鎖、角輪、鋁窗、樹脂、鐵門、伸縮門、量尺等，
  不套用這套 kg/m、kg/支換算規則；除非有另外 reviewed rule，否則按該 row 的
  `unitPrice` 直接作件/組/支價或 manual review。
- 普遍鋼材的 `productPriceUnitWeightUnit = kg_per_m`。此時
  `productPriceUnitWeight` 是 kg/m。若 `unit=kg`，`unitPrice` 是每 kg 售價。
  計算材料金額：`weightKg = kgPerM * lengthM * quantity`，
  `amount = weightKg * unitPrice`。
- 例：`C型鋼 C100x50x20x2.3t 6M 一支多少`。若 reviewed row 是
  `錏輕型鋼 100x2.3`、`unit=kg`、`unitPrice = 25-26.8`、
  `productPriceUnitWeight = 4kg/m`，則一支 6M 是 24kg，暫估材料價約
  `NT$600-643.2`。不可回答 `NT$25-26.8/支`。
- 品名或規格有固定長度 `M` 且 `productPriceUnitWeightUnit = kg_per_piece`
  時，`productPriceUnitWeight` 是重量/支。若 `unit=kg`，整支金額為
  `pieceWeightKg * quantityPieces * unitPrice`；若 `unit=piece`，`unitPrice`
  已是整支金額，整支計價為 `quantityPieces * unitPrice`。
- 只有使用者明確說餘料不計價時，才可把重量/支除以來源長度得到 kg/m，再乘以
  實際切料長度與 `unitPrice` 計算本次材料金額。
- 若 `單位重` 欄位是 0，但品名最後括號內有數字，且 reviewed row 可用
  `售價 = 括號重量 * 比率` 驗證，括號數字就是重量/支補漏來源。例：
  `白鐵平鐵 50 *8.0( 19.7)` 的 A 價 `2107.90`、比率 `107.00`，所以
  `19.7 * 107 = 2107.9`；此 row 應以 `19.7kg/支`、`unit=piece` 判讀。
- 若 `單位重` 欄位已有正值，欄位值優先於品名括號；括號只能作補漏來源，不能覆蓋
  reviewed 欄位值。例：`6K鐵軌 6M(38)` 的 `單位重=36`，且
  `9K鐵軌 6M(54)` 可佐證比例，因此 6K 鐵軌採 `36kg/支`，不可採括號 `(38)`。
- 固定長度材料 row 若有正值 `比率` 欄且 `售價` 欄為整支價，即使該整支價看起來是
  用錯誤括號重量算出，也不可把 `售價` 當每 kg 單價。例：`6K鐵軌 6M(38)`
  的 A 價 `2090` 與比率 `55` 對應錯誤括號 38，但重量仍採 `單位重=36`；報價可先把
  `2090` 視為整支價，並把重量矛盾標示為待確認/推論。
- 若單位重缺失或來源互相矛盾，可以查相同系列、相同規格、不同長度或相近材料的
  reviewed rows，用長度比例或規格比例換算作推論 evidence。這類結果必須標示
  inferred/low confidence 或待確認，不可靜默覆蓋 reviewed 欄位值。
- 若固定長度品名的單位重為 0 或缺失，應查相同規格、不同長度且有 reviewed 單位重
  的 row，先推回 kg/m，再依本次長度換算。找不到可驗證重量時，標示
  missing/low confidence 並請使用者確認。
- `輕量H` 例如 `輕量H150*75*3.2/4.5*6M(53)` 屬於 H 型鋼材料；`BNH`
  屬於鋼材/板材材料。這兩類不可留在 fallback ERP family 後跳過材料計價規則。

Blocking rules:

- 不要把 `productPriceUnitWeightUnit = kg_per_m` 的 `unitPrice` 當成
  per-piece price。
- 不要只看 `productPriceUnitWeightUnit` 就決定售價單位；必須同時看 reviewed
  row 的 `unit`。
- 不要把非鋼材或非材料產品/accessory row 套用鋼材 kg/m、kg/支計算規則。
- 不要用品名括號覆蓋正值 `單位重` 欄位；括號只在欄位為 0/缺失且可驗證時補漏。
- 不要把固定長度材料 row 的整支 `售價` 誤當每 kg 單價。
- 不要把相近材料比例推論當成 reviewed 欄位值；推論值必須標示 inferred/low
  confidence 或待確認。
- 不要因 source row 的 `unit` 顯示支/件，就忽略 `productPriceUnitWeightUnit`
  所代表的 kg/m 或 kg/支計算語意。
- 不要用 0 或空白單位重計算材料金額。

### `oral-material-candidate-generation-zh-v1`

Packet groups:

- `global-quote-core`
- `angle-zinc-quote-core`
- `black-long-material-cutting-core`

Source refs:

- `docs/reference/instruction.txt`: 口語品名通用轉換規則、基本流程、產品價格搜尋規則。

Selectors:

- `taskTypes`: `candidate_generation`, `material_price_lookup`,
  `confirmation_policy`
- `surfaceTreatments`: `black`, `stainless`, `galvanized`, `zinc_plated`,
  `aluminum_zinc`, `painted`, `hot_dip_galvanized`, `unknown`

Body:

- 客戶口語品名要先拆成材料類別、材質/表面、尺寸、厚度、長度、數量與加工註記。
- 候選類別包含板材、型鋼、C 型鋼、H 型鋼、角鐵、槽鐵、扁鐵、圓鐵、方鋼、
  圓管、方管、扁方管、網材、門窗、浪板與加工。
- 表面處理候選包含黑鐵、白鐵、不鏽鋼、鍍鋅、錏、亞、鋁鋅、彩色、烤漆與熱浸
  鍍鋅。
- 常見轉換只能作為候選：`1 英吋` 約 25mm；`1 英半` / `1 1/2` 可作為管外徑
  約 48.3mm 候選；`C75` 可展開為 `C75x45x15` 候選；`C100` 可展開為
  `C100x50x20` 候選；`L38` 可作為 `38x38` 角鐵候選。
- `黑圓管48.1` 不可只查 `48.1`，還要產生黑圓管、黑管、黑 A、黑 B、黑 AB
  圓管、`1 1/2`、`48.3` 等 candidate queries。
- 口語轉換只代表候選，不代表完全匹配；厚度、材質、長度、單位或表面處理不明時，
  必須降低信心並列出確認選項。

Blocking rules:

- 不要把口語轉換當作 confirmed source fact。
- 不要只產生單一最高相似候選；有多個合理 reviewed candidates 時必須列出 bounded
  options。

### `formula-code-selection-zh-v1`

Packet groups:

- `global-quote-core`
- `c-type-quote-core`
- `h-type-quote-core`
- `plate-processing-core`

Source refs:

- `docs/reference/公式編號.xlsx`: `Sheet1` 公式明細表。
- `docs/reference/instruction.txt`: 材料重量與材料費、C 型鋼專用計價規則。

Selectors:

- `taskTypes`: `formula_selection`, `material_price_lookup`,
  `default_selection`, `confirmation_policy`
- `formulaCodes`: `BDF`, `BDH`, `BDS`, `BF`, `BH`, `BR`, `BS0`, `BS4`,
  `BS6`, `BTA`, `BTB`, `C`, `H`, `M`, `O`, `PA`, `PB`, `PC`, `PD`, `PP`,
  `PVC`, `Q`, `R`, `T`, `W`, `W1`, `WPC`, `X`

Body:

- AI 可用此 packet 判斷應查哪些 formula candidates；runtime 必須透過
  `lookup_formula` 查 reviewed active formula rows，不可在 prompt 內直接以試算表
  文字作最終公式來源。
- 板類公式候選：`BDF` 厚板切割方形花板、`BDH` 厚板切割方形黑鐵、`BDS` 厚板
  切割方形白鐵、`BF` 黑花板、`BH` 黑鐵、`BR` 鋁、`BS0` 不鏽鋼 430、
  `BS4` 不鏽鋼 304、`BS6` 不鏽鋼 316、`BTA` 紅銅、`BTB` 青銅、`T` 特殊鋼。
- C 型鋼候選公式為 `C`；仍必須先查 reviewed product-price rows，並依產品價格列
  計價單位決定材料費。
- H 型鋼與一般型鋼候選公式為 `H`；H 型鋼非常規米數加價與切工需由對應 packet /
  reviewed data 另行判斷。
- 管材公式候選：`PA` 圓管、`PB` 方管、`PC` 橢圓管、`PD` 扁管、`PP` 鋼管。
- 圓鐵/丸條候選公式：`O` 圓鐵、`Q` 丸條；六角可查 `M`。
- 規格品可查 `R`；浪板可查 `W`、`W1`、`WPC`；貼膜可查 `PVC`；`X`
  可作為面積型候選，但仍需 backend validation。
- 如果材料類別或公式代碼不明，AI 必須呼叫 `lookup_formula` 回 bounded candidates，
  並請使用者確認，不可直接自創公式。

Blocking rules:

- 不要從 `公式編號.xlsx` 直接讀出公式後在 AI 端當作 confirmed calculator。
- 不要跳過 `lookup_formula` 或 reviewed formula validation。

### `h-type-length-surcharge-zh-v1`

Packet groups:

- `h-type-quote-core`

Source refs:

- `docs/reference/H型鋼.txt`: H 型鋼常規/非常規米數與非常規加價。
- `docs/reference/instruction.txt`: H 型鋼材料重量與材料費、長條料配料、切工。

Selectors:

- `taskTypes`: `candidate_generation`, `material_price_lookup`,
  `formula_selection`, `processing_detection`, `confirmation_policy`
- `materialFamilies`: `h_type`
- `formulaCodes`: `H`
- `processingTypes`: `cutting`, `head_tail_trim`, `none`

Body:

- H 型鋼常規米數為 `6M`、`9M`、`10M`、`12M`。
- H 型鋼非常規米數為 `7M`、`8M`、`11M`、`13M`、`14M`、`15M`。
- 非常規米數理論上比一般米數材料 kg 單價 `+0.3 元/kg`。
- `產品價格.xlsx` 的 H 型鋼 exact reviewed 非常規米數列已含非常規
  `+0.3 元/kg`。例如 `125*125*6.5/9*6M(142)` 與 `7M(165)` 的價格表列
  已反映 7M 比 6M 多 `0.3/kg`。查到 `7M`、`8M`、`11M`、`13M`、`14M`、
  `15M` exact reviewed price row 時，不可再加一次。
- 只有缺 exact reviewed 非常規米數價格列、需要從常規米數 kg 單價推估時，才可把
  `+0.3 元/kg` 當 provisional/default derivation，並要求使用者確認。
- 此加價調整材料 kg 單價，不代表切工免費或切工已含。
- H 型鋼總重仍依 reviewed formula / weight data 計算；切工費要依切工 packet
  或 reviewed cutting rows 另算。
- 如果長度不在常規或非常規列表，必須標 low confidence，列出目前可識別長度並請
  使用者確認。

Blocking rules:

- 不要把非常規 `+0.3/kg` 套到非 H 型鋼。
- 不要在 exact reviewed 非常規米數產品價格列上重複加 `+0.3/kg`。
- 不要因非常規加價而省略切工判斷。

### `h-and-i-beam-cutting-price-zh-v1`

Packet groups:

- `h-type-quote-core`

Source refs:

- `docs/reference/切工價錢.xlsx`: `全部整理資料`, `H型鋼切工`,
  `斜切加價備註`, `判讀備註`。
- `docs/reference/instruction.txt`: 切工規則。

Selectors:

- `taskTypes`: `processing_detection`, `default_selection`,
  `confirmation_policy`, `material_price_lookup`
- `materialFamilies`: `h_type`
- `productFamilies`: `i_beam`, `steel_beam`
- `processingTypes`: `cutting`, `head_tail_trim`, `slotting`, `holes`
- `customerTierIds`: `A`, `B`, `C`, `F`

Body:

- H 型鋼切工優先查 reviewed cutting rows。H 型鋼切工表依尺寸與客戶分級欄位
  `A/C/F`、`B` 取價。
- H 型鋼高信心切工候選包含：`150*75` 80/85、`175*90` 90/95、`198*99`
  80/85、`100*100` 80/85、`150*150` 100/105、`200*100` 120/125、
  `250*125` 120/125、`300*150` 120/125、`350*175` 170/180、
  `400*200` 170/180、`400*400` 450/480、`692*300` 550/580、
  `700*300` 550/580、`800*300` 700/735。
- H 型鋼表中 `400*408`、`414*405`、`708*302`、`792*300`、`808*302`
  為未確認價格，不能填 0；必須回 missing / manual review 或相近候選。
- 工字鐵切工參考表可作 i-beam / beam candidate。若用於 H 型鋼，來源備註指出
  `H 依大小另 +30~50`，必須標示為需 backend validation / manual review，不能
  直接硬套。
- H 14m/m 以上的開槽、沖孔、倒角另計；整理列提供 `開槽 KZZB10 140/150`、
  `沖孔 KZZB11 16/17`、`倒角 KZZB12 140/150`。使用前仍要確認加工需求與
  是否匹配產品價格明確加工品項。
- 需要開槽、沖孔、倒角加工時，先用 `search_price_candidates` 查 reviewed
  processing price rows，例如 `productNames: [開槽加工, 沖孔加工, 倒角加工]`
  或 `specKeyContains: KZZB10` / `KZZB11` / `KZZB12`，再標示仍需確認加工
  數量、路徑、孔數與是否適用 H 型鋼厚度。
- 斜切加價：切平行斜刀為原切工單價 `X2 - 10`；切梯形斜刀為 `X2`；
  翼板切斜為 `X2 + 50`，但翼板備註信心為中。
- 手寫備註如量多另計、疑似鋼材刀價等信心低，必須列人工複核，不可進 confirmed
  calculation。

Blocking rules:

- 不要把未確認切工價填 0。
- 不要把工字鐵切工參考表直接當成 H 型鋼 confirmed price。
- 不要忽略斜切、修頭尾、特別加工造成的切工次數或加價。

### `black-steel-cutting-price-zh-v1`

Packet groups:

- `black-long-material-cutting-core`
- `angle-zinc-quote-core`

Source refs:

- `docs/reference/切工價錢.xlsx`: `全部整理資料`, `黑鐵類切工`,
  `判讀備註`。
- `docs/reference/instruction.txt`: 切工、長條料配料。

Selectors:

- `taskTypes`: `processing_detection`, `default_selection`,
  `confirmation_policy`
- `materialFamilies`: `angle`, `channel`, `flat_bar`, `round_pipe`,
  `square_pipe`, `round_bar`
- `surfaceTreatments`: `black`, `stainless`, `zinc_plated`, `unknown`
- `processingTypes`: `cutting`, `head_tail_trim`

Body:

- 黑鐵管類切工候選：`1/2"`、`3/4"` 為 10；`1"`、`1 1/4"` 為 15；
  `1 1/2"`、`2"` 為 20；`2 1/2"`、`3"` 為 25；`4"` 為 30；
  `5"` 為 35；`6"` 為 40；`8"` 為 90；`250` 為 110。
- 黑角鐵切工候選：`1"`、`1 1/4"` 為 10；`1 1/2"`、`40` 為 15；
  `2"` 為 20；`65`、`3"` 為 25；`90` 為 30；`100` 為 35；
  `130` 為 50；`150` 為 60；`200` 為 80。
- 黑槽鐵切工候選：`2"` 為 15；`75` 為 20；`100` 為 25；`125` 為 30；
  `150` 為 35；`150X9.0` 為 40；`180` 為 80；`200` 為 100；
  `200X90` 為 110；`250` 為 180；`300` 為 220；`380` 為 250。
- 黑平鐵切工候選：`5/8~2"` 厚度 `3/4.5/6` 為 10；`1"~2"` 厚度
  `9/12` 為 15；`65~100` 厚度 6 為 20、厚度 9/12 為 25、
  厚度 16/19 為 30、厚度 25 為 35；`125~200` 厚度 6/9 為 30、
  厚度 12 為 35、厚度 16/19 為 40、厚度 25 為 45。
- 黑鐵管類手寫加價為 `切斜 X2 -5`。若斜切證據不明，必須標低信心並請確認。
- 管類厚度厚的另計；方管厚度 1.2 以下不切。
- 白 A / 錏方管加 5 元；白鐵 100 以下加 5 元；白鐵 100 以上加 10 元；
  白鐵角鐵加 5 元。
- 1" 以下小方管量少加價；圓條不切；1" 以下圓條不切或需外切；白鐵平鐵另計，
  1" 以下平鐵量少加價。
- 黑槽鐵特長或修頭尾外加 30 元；特短 500 以內外加 10 元。
- 黑鐵類表中的不清楚適用範圍如 `OTA、OT□` 信心低，不能自動套用。

Blocking rules:

- 不要將黑鐵類切工價自動套到白鐵、錏材或厚料而不加價/不另計。
- 方管厚度 1.2 以下不可直接列一般切工；需標示不切或請使用者確認外切。
- 圓條類不可自動套一般切工；需依不切/外切規則處理。

### `cut-count-and-trim-detection-zh-v1`

Packet groups:

- `h-type-quote-core`
- `black-long-material-cutting-core`
- `angle-zinc-quote-core`

Source refs:

- `docs/reference/instruction.txt`: 切工。
- `docs/reference/切工價錢.xlsx`: `斜切加價備註`, `黑鐵類切工`。

Selectors:

- `taskTypes`: `processing_detection`, `confirmation_policy`
- `processingTypes`: `cutting`, `head_tail_trim`

Body:

- 一個切口預設為 1 刀。
- 對半切且不修頭尾時，中間切斷為 1 刀。
- 修頭尾時，預設為頭修 1 刀 + 中間切 1 刀 + 尾修 1 刀，共 3 刀。
- 出現 `修`、`修頭`、`修頭尾`、`+修`，不可只算中間切斷。
- 斜切、翼板切斜、特殊角度、手寫不清，必須列 low confidence 或 manual review。
- 切工費計算應由 backend validation 依 selected cutting row、加價、切工次數與數量
  決定；AI 不直接產生 confirmed calculator result。

Blocking rules:

- 不要把「修頭尾」算成 1 刀。
- 不要把手寫不清的斜切/量多另計內容放入 confirmed total。

### `drawing-processing-detection-zh-v1`

Packet groups:

- `plate-processing-core`
- `c-type-quote-core`
- `h-type-quote-core`

Source refs:

- `docs/reference/instruction.txt`: 孔洞、開槽、折工、圖片/PDF OCR 規則、低信心與
  錯誤修正記憶規則。
- `docs/reference/產品價格.xlsx`: 明確沖孔/孔洞加工品項。

Selectors:

- `taskTypes`: `drawing_interpretation`, `processing_detection`,
  `ocr_file_interpretation`, `confirmation_policy`
- `processingTypes`: `holes`, `long_holes`, `slotting`, `bending`, `cutting`

Body:

- 【孔洞】孔數依表格孔數優先、圖面孔位交叉確認。圓孔、長孔、螺栓孔、沖孔、
  `4-Ø22`、`6-Ø26` 等都要計入；`4-Ø22` = 每片 4 孔。1 個圓孔或長孔算
  1 孔，除非規則另定。總孔數 = 每片/每支孔數 × 數量。中心線、尺寸線、虛線、
  R 角、折線、切角、焊接符號不可誤判為孔。若 `產品價格.xlsx` 有明確沖孔加工
  品項，優先用該品項。C 型鋼孔費預設免費。
- 圖面孔位用於交叉確認表格孔數是否合理。若表格孔數與實際孔位數、局部放大圖、
  手寫備註或 OCR/vision 判讀不一致，必須列出差異並標記人工複核，不能靜默改用
  圖面孔位覆蓋表格數字，也不能直接假設表格填錯。
- 若沒有表格孔數、表格欄位不清、表格列對應不到材料行，才改用清楚的圖面孔位或
  vision evidence 估算孔數，並標示信心與來源。
- 有 `開槽`、`開K槽`、槽線、缺口加工、連續折邊槽或明確邊緣開槽者，才產生
  slotting candidates；一般外框切割或無開槽標示不可自動算開槽。
- 開槽費依連續開槽邊長判斷，L 型兩段相加、U/ㄇ型三段相加，不相連路徑分別
  加總。路徑不明不能當 0。
- 折工刀數要看側視圖或局部放大圖；每一次方向改變算一刀。尺寸線、中心線、孔線、
  外框、切角與開槽不可誤判為折線。
- 圖片、掃描 PDF、照片、截圖或手寫單要先判斷方向，必要時考慮 0/90/180/270 度；
  OCR 破碎、欄位錯位、解析度低、反光、裁切、手寫遮住、方向不明或 OCR 與視覺
  不一致時，必須標 low confidence。

Blocking rules:

- 不要只依 OCR 算孔洞、開槽、折工。
- 不要因路徑或刀數不明就填 0；應列人工複核或請使用者確認。

### `workbook-output-columns-zh-v1`

Packet groups:

- `workbook-output-core`

Source refs:

- `docs/reference/instruction.txt`: Excel 輸出、報價明細欄位、總結欄位、人工複核
  清單欄位、價格來源欄位、判讀備註欄位、系統訂單分頁。

Selectors:

- `taskTypes`: `workbook_output`, `confirmation_policy`

Body:

- 若要產出 workbook，至少要能支援報價明細、總結、人工複核清單、價格來源、
  判讀備註、系統訂單等資訊；實際 visible sheet order 仍依目前 workbook contract。
- 報價明細要保留材料、尺寸、數量、素材/成品長度、重量、單價、計價單位、
  材料費、切工、孔洞、開槽、折工、其他費、小計、信心、低信心原因、判斷依據與建議複核；
  報價金額統一使用 `小計`，不要另加與 `小計` 重複的可見 `報價` 欄位。
- 價格來源要保留客戶、分級、原始品名、標準化品名、搜尋關鍵字、候選品項、
  採用品項、採用單價、單價欄位、單位、來源檔案/工作表/列號或頁碼、匹配程度、
  未採用原因、差異與備註。
- 判讀備註要記錄圖面不清、尺寸/孔數/配料/切工/開槽/折刀推定、不一致處、
  OCR 方向判斷、圖片旋轉判斷、人工判讀依據、公司內部固定計價習慣與 C 型鋼規則
  套用狀態。
- 系統訂單分頁應保留公司編號、項次、倉庫編號、型號、品名規格、材質編號、廠別
  編號、單位、數量、單重、總數、單價、計價基準、公式編號、厚度、寬度、長度、
  類別、交貨日期、備註等欄位概念。
- 未確認單價或金額不可填 0。confirmed total 不足時，只能寫 provisional notes、
  candidate options 或人工複核項目。

Blocking rules:

- 不要只回總價或只寫單一總額。
- 不要把未確認價格、低信心加工費或缺少使用者確認的 candidate 寫入 confirmed
  customer-facing total。

## MVP Tool Coverage Check

No additional MVP query tool is needed for this design.

`lookup_quote_rules` covers reviewed interpretation policy and quote-default
retrieval. `search_price_candidates`, `lookup_formula`, and `search_customers`
cover reviewed data lookup. Backend internal repositories can still read price,
weight, cutting, processing, formula, and workbook data during
validation/execution without exposing them as AI-callable MVP tools.

Keep `search_source_chunks` out of the MVP quote inference path. It is too broad
for this flow and would make future agents reintroduce raw source-text search
instead of reviewed task-scoped packets.
