# Phase 3: Material Rule Architecture

Goal: make material-specific company rules queryable, testable, and task-scoped.

## Rule Table Shape

Rules should be stored as data, not hard-coded prompt blocks:

```text
steel.material_rules
- code
- name
- rule_type
- active
- priority
- material_family or selector fields required for lookup
- source_refs JSONB
- rule_body JSONB
```

`rule_body` should be validated by code per `rule_type`. Fields needed for lookup, ranking, or activation should be typed columns instead of hidden inside `rule_body`.

Material rules are company defaults. A customer can still request a quote-specific adjustment in chat, such as excluding a charge, using a special price, adding a surcharge, or overriding the default rule for one workbook line.

## Formula And Rule Selection

Formula/rule selection is an AI orchestration decision over reviewed backend data, not a product-family `if` statement inside calculators.

The intended flow is:

1. AI reads the customer's natural-language order, file evidence, or workbook context and proposes normalized quote item candidates.
2. Backend tools validate the candidate shape and ambiguity state.
3. AI uses normalized material family, product family, spec, dimensions, length, quantity, and processing intent to call formula/rule lookup tools.
4. AI selects a reviewed `formulaCode` and `selectedCalculationRule` when the returned candidates support the item.
5. Backend tools validate that selected formula/rule origin, review state, active state, material selector, formula compatibility, and source refs still match before calculating.
6. Calculators execute the selected formula/rule with explicit numeric inputs and parameter overrides; they do not rediscover business rules from raw text.

`docs/reference/公式編號.xlsx` is the source reference for formula meaning. For example, formula code `C` maps to `C型鋼` with the source expression `四捨五入(單位重*長度,2)/100`. Runtime calculators should use reviewed database formula rows derived from that source, not read the spreadsheet directly.

For C-type steel, AI may select the C-type finished-length calculation rule when the normalized quote item strongly matches C-type aliases/specs. Backend validation then allows that selected rule to:

- use finished length for material quantity
- skip long-material stock allocation
- mark cutting and hole charges as true zero when the selected rule or quote-specific override explicitly supports that effect
- keep physical cut or hole evidence as notes/system-order facts when useful

Backend code must reject a silent zero if AI sends `cutting = 0` or `hole = 0` without a selected rule, reviewed true-zero fact, or explicit quote-specific override.

The C-type no-charge cutting/hole behavior must exist as a configured site-managed quote default or reviewed rule before quote runs can select it. This default can be seeded or Admin-reviewed, but it must be data/retrieval-owned. Backend pricing and calculator code must not create the behavior from product family alone.

## MVP Rule Types

### C-Type Roll Forming

Applies to C-type steel, galvanized C-type steel, and related aliases.

Behavior:

- Apply only through canonical product family/alias matching or a top-ranked normalized C-type candidate; weak substring matches should ask for clarification.
- Use finished length for material quantity.
- Do not run long-material stock allocation.
- Do not calculate stock pieces, remainder length, or remainder weight.
- Do not add general cutting fee by default.
- Do not add hole fee by default.
- Add cutting/hole fees only when user explicitly says separately charged or when product price contains a reviewed explicit chargeable C-type cutting/hole item.
- In system order output, default to material rows only; processing rows appear only when separately charged.

### H-Type Non-Standard Length Surcharge

Applies to H-type steel.

Behavior:

- Regular lengths: 6M, 9M, 10M, 12M.
- Non-standard lengths: any normalized H-type length outside 6M, 9M, 10M, and 12M.
- Non-standard material unit price = regular material unit price + 0.3 per kg.
- Cutting price remains separately resolved from cutting-price data.

### Long-Material Allocation

Applies to non-C long materials such as angle, flat bar, channel, I-beam, round bar, square bar, pipe, and square tube.

Behavior:

- Unless the customer explicitly allows exact finished-length pricing, quote by sellable stock length rather than finished net length.
- Return stock length, stock pieces, pieces per stock, produced finished pieces, remainder length/weight, confidence, and reason.

### Cutting Rule

Applies when cutting is required or requested.

Behavior:

- Product price explicit reviewed cutting item wins.
- Otherwise use cutting-price data.
- For every material whose matched facts can include cutting price, if the order requires cutting and head/tail trimming is not already explicit, ask whether to cut head, cut tail, no-head/no-tail, or split-only before confirmed cutting fee calculation.
- If cutting is not required or the user explicitly says no cutting, workbook cutting fields should still record zero cutting, zero fee, and the no-cut reason.
- H-type cutting and black-iron cutting have different source sections.
- Repair head/tail, no-head/no-tail, angled cuts, and remainder behavior produce cutting-count or adjustment behavior only when confirmed by quote evidence, a reviewed rule, or explicit user instruction.
- Generic labels, blank prices, and `0.00` rows do not override cutting-price lookup unless Admin review marks them as a true zero price or confirmed charge behavior.
- Count physical cutting operations separately from billable cutting charges:
  - `operationCutCount` is the physical/system-order count.
  - `billableCutCount` is the quote charge count after selected calculation rules and quote-specific adjustments.
  - C-type true-zero cutting can set `billableCutCount = 0` while still allowing `operationCutCount` to be recorded for system order or notes.
- The AI extracts cutting intent into structured fields before calculation:
  - `cutMode`: `none`, `single_cut`, `split`, `multi_piece`, or `unknown`.
  - `headTrim`: `required`, `not_required`, or `unknown`.
  - `tailTrim`: `required`, `not_required`, or `unknown`.
  - `omitTailTrimWhenRemainder`: boolean when explicitly stated or selected by rule.
  - `angleCut` / `specialCut`: confirmed flags with source refs.
  - `finishedPiecesPerStock`, `stockPieceCount`, and `remainderLengthMm` from allocation when applicable.
- Confirmed default cut-count semantics:
  - One confirmed cut line is one operation.
  - Split in half without head/tail trim is one middle cut.
  - Head trim + middle cut + tail trim is three operations.
  - For one stock piece producing `n` finished pieces with no remainder and no tail trim, separation cuts are `n - 1`.
  - For one stock piece producing `n` finished pieces with a remainder, separation cuts are `n`; the last finished piece still needs to be separated from the remainder.
  - "Remainder omits tail trim" omits only the extra tail trim/finish cut. It does not omit the separation cut between the last finished piece and the remainder.
  - When a remainder exists and the selected rule omits tail trim, assistant text and workbook notes must explicitly say tail trim is not counted.
  - Head trim adds one operation per stock piece when required.
  - Tail trim adds one operation per stock piece when required, unless `omitTailTrimWhenRemainder` is active and a remainder exists.
- If head/tail trimming is unclear, the rule result should ask the user or mark the cutting count low confidence instead of silently choosing the cheaper path.

### Hole Processing Rule

Applies when the item has round holes, oval holes, long holes, rectangular holes, bolt holes, punched holes, or notation such as `4-Ø22`, `6-Ø26`, `橢圓孔`, `長孔`, `長方孔`, `開孔`, or `沖孔`.

Behavior:

- Product price explicit reviewed hole/punching item wins.
- Otherwise use reviewed hole-processing data through processing-price lookup.
- Runtime lookup and calculators must support future Admin-reviewed non-round hole prices even when the current source price row is `0` or missing.
- C-type holes do not use the generic hole-fee path by default; they follow the selected C-type special pricing rule/default. Hole count can still be recorded in notes and system output.
- Hole count follows table count first, with drawing hole positions used for cross-check.
- Clear drawing/order table counts are high-confidence primary evidence for hole count. If `產品價格.xlsx` has a clear punching/hole-processing item for the requested work, that item wins over generic hole-fee lookup.
- Drawing/vision hole positions are cross-check evidence. If the table count and visible hole positions differ, record both, mark manual review, and ask the user/admin to confirm whether the table or drawing is wrong instead of silently replacing the table count.
- A notation such as `4-Ø22` in a clearly matched table row means four holes per piece unless the table row is ambiguous or conflicting evidence requires manual review.
- One round, oval, long, rectangular, bolt, or punched hole counts as one hole unless a reviewed rule explicitly defines a different unit.
- Total holes are calculated as the sum of per-piece/per-stock hole groups multiplied by the item quantity.
- Center lines, dimension lines, hidden lines, R corners, bend lines, cut-angle markers, and welding symbols must not be counted as holes.
- If the hole count, hole type, diameter, or quantity multiplier is unclear, return low confidence and a targeted confirmation question. Do not fill the fee with `0`.
- The AI extracts hole evidence into structured groups:
  - `holeType`: `round`, `oval`, `long`, `rectangular`, `bolt`, `punched`, `custom`, or `unknown`.
  - `diameterMm` for round holes when known.
  - `lengthMm` and `widthMm` for oval, long, rectangular, or custom non-round holes when known.
  - `dimensionLabel` when the source gives a textual size that cannot be safely normalized yet.
  - `countPerPiece`.
  - `pieceQuantityMultiplier`.
  - source refs and confidence for the drawing/table/notation evidence.

### Slotting Rule

Applies when the item has `開槽`, `開K槽`, groove/slot marks, notch processing, continuous edge slots, or a clear instruction that an edge/path needs slotting.

Behavior:

- Product price explicit reviewed slotting item wins.
- Otherwise use reviewed slotting-processing data through processing-price lookup.
- Slotting fee is based on continuous slot path length, not the whole part length.
- Edge slotting still counts when the evidence says the edge is slotted. A normal outside profile or ordinary plate edge does not become slotting by itself.
- L-shaped slot paths sum two connected segments. U/ㄇ-shaped paths sum three connected segments. Multiple disconnected paths are calculated separately and then summed.
- Total slotting length is per-piece slotting length multiplied by item quantity, then converted to meters for `元/M` pricing.
- Unclear path shape, missing segment length, or OCR/vision conflict returns low confidence and a targeted confirmation question. Do not fill slotting fee with `0`.
- The AI extracts slotting evidence into structured paths:
  - `slotPathType`: `straight`, `L`, `U`, `multi_segment`, or `unknown`.
  - `segmentLengthsMm`.
  - `pathQuantityPerPiece`.
  - `pieceQuantityMultiplier`.
  - source refs and confidence for each path.

## Rule Disclosure To AI

The prompt bundle should not include all material rules. It should include:

- normalized quote item facts
- matching material rules only
- source refs and confidence
- a short explanation of blocked default paths, such as C-type blocking long-material allocation

## Exit Criteria

- AI can access relevant rules through task-scoped prompt context,
  `lookup_instructions`, `lookup_defaults`, `lookup_formula`, or backend
  validation without exposing a separate MVP `lookup_material_rules` tool.
- Irrelevant rules are not injected into unrelated quote items.
- Material rules are covered by unit tests and manual scenario tests.
