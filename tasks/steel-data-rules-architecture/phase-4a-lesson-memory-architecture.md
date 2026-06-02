# Phase 4A: Lesson And Memory Promotion Architecture

Goal: define how conversation-specific adjustments can become reviewed customer defaults without letting chat directly mutate formal rules, prices, formulas, or prompt memory.

## Core Boundary

Lessons and memories are retrieval surfaces, not the source of truth.

Formal truth lives in reviewed database facts:

- `steel.formula_versions` owns fixed formula identity and reviewed formula bodies.
- `steel.material_rules` owns reviewed company/material rule behavior.
- Future reviewed default-rule tables own customer-scoped default parameters when a rule is customer-specific.
- Mongo workbook state owns quote-specific adjustments for the current conversation/workbook line.

AI can propose, select, and explain rules. It cannot publish permanent lessons/memory or update formal rule tables without Admin review.

## Memory Layers

Steel must keep two memory concepts separate.

### Steel Admin-Reviewed Lesson/Memory

Steel Admin-reviewed lesson/memory is the site-managed default retrieval layer. It is generated from reviewed Steel database facts and applies according to business scope such as customer, customer tier, material family, product family, charge type, and formula code.

Implementation note: global or site-managed lesson/memory belongs to a future extension module. The current core backend slice may create structured `needs_review` rule proposals, but it must not publish global lessons/memory until that extension module is explicitly planned.

Rules:

- It is owned by Steel Admin review, not by ordinary chat users.
- It is published from reviewed Supabase facts such as formulas, material rules, price rows, and future default-rule rows.
- It can be customer-scoped, tier-scoped, material-scoped, or company-wide, but all variants are still Admin-reviewed defaults.
- It can be rebuilt or invalidated from source facts without losing the source of truth.

### LibreChat User Memory

LibreChat user memory is the user's custom memory framework. It can carry user-specific preferences or remembered quoting preferences, but it is not a Steel reviewed business fact.

Rules:

- It is scoped to the LibreChat user/account memory owner.
- It can override the priority of matching Admin-reviewed defaults for that user's quote workflow.
- It must not mutate Steel Admin-reviewed facts, formula versions, material rules, prices, or published Steel lesson/memory entries.
- It must be surfaced as a separate `userMemoryCandidate` layer with source/user scope, confidence, and reason, not merged into Admin-reviewed origins.
- It cannot create a new `formulaCode`, bypass formula validation, or turn an unreviewed business fact into a reviewed default.

Layer priority for quote-time rule selection:

1. explicit quote override from the current conversation/workbook line
2. applicable LibreChat user custom memory
3. Steel Admin-reviewed customer default
4. Steel Admin-reviewed customer-tier default
5. Steel Admin-reviewed material/product/company default

User memory priority affects which reviewed default or adjustable parameters the AI tries first. Backend validation still decides whether the selected result can become `selectedCalculationRule`.

## State Model

### Quote Override

Quote override is a one-workbook-line adjustment from the customer conversation.

Examples:

- "這張單切工一支 25"
- "這次孔不用算"
- "這批照 12M 算，不要算餘料"

Rules:

- Applies only to the current quote/workbook line unless promoted later.
- Stored with conversation/workbook source refs and audit data.
- Can override adjustable parameters such as `unitPrice`, count, rate, surcharge, or skip behavior.
- Does not update `steel.material_rules`, price tables, formula tables, or lesson/memory indexes.

### Rule Proposal

Rule proposal is a pending Admin-review item created when the user asks to reuse a quote override as a future default, or when AI detects a repeated pattern worth suggesting.

Rules:

- Status starts as `needs_review`.
- Stores scope selectors: customer, product/material family, charge type, formula code, parameter keys, and optional conditions.
- Stores proposed default parameters separately from the fixed formula identity.
- Stores source refs back to the quote conversation, workbook line, and any supporting reviewed source facts.
- Cannot participate in deterministic quote lookup while unreviewed.

### Reviewed Rule Default

Reviewed rule default is the Admin-approved durable business fact.

Rules:

- Admin chooses whether the proposal updates a material rule, creates a customer-scoped default, creates a formula version, updates a price row, or rejects the proposal.
- Approval writes a reviewed database row in one transaction with source refs and audit trail.
- If the change needs a new formula path, Admin must approve a reviewed `formula_versions` row first. AI cannot invent a new `formulaCode`.
- If only numbers change, Admin updates reviewed default parameters, not code.

### Published Lesson/Memory

Published lesson/memory is generated from reviewed facts.

Rules:

- It references reviewed database rows by origin table, origin ID, revision, and source refs.
- It is task-scoped at retrieval time. The AI receives only relevant lessons/memory for the current customer, material family, charge type, and formula path.
- It can be rebuilt or invalidated from reviewed database changes.
- It is never the only copy of a business rule.

## AI Retrieval Architecture

AI should not receive all lessons/memory in the prompt. It should receive a bounded retrieval packet produced by backend tools from normalized quote context.

Retrieval inputs:

- customer ID, customer tier, and aliases when known
- current LibreChat user/account memory scope
- normalized product/spec candidates
- product family and material family
- charge type: material, cutting, hole, slotting, bending, or processing
- reviewed `formulaCode` candidates when a formula path is already known
- explicit quote-specific adjustments from the current conversation
- source refs and confidence for the normalized inputs

Retrieval hard filters:

- Steel Admin-reviewed lesson/memory entries require `review_state = reviewed`
- Steel Admin-reviewed lesson/memory entries require `active = true`
- not invalidated or superseded
- scope matches the current task: customer-specific, material/product family, charge type, formula code, or company-global fallback
- proposal rows with `needs_review` or `rejected` status are excluded
- LibreChat user memory candidates must match the current user/account memory owner and task context

Retrieval ranking:

1. explicit quote override from the current conversation/workbook line
2. LibreChat user custom memory matching the current user/account and task
3. exact Admin-reviewed customer + product/spec + charge type + formula code
4. exact Admin-reviewed customer + material family + charge type
5. Admin-reviewed customer tier + material family + charge type
6. Admin-reviewed company material rule for product/material family + charge type
7. Admin-reviewed company formula/default for charge type

When Admin-reviewed ranks tie, use reviewed priority first, then newer reviewed revision, then stronger source confidence. When user memory candidates tie, use stronger task specificity first, then newer user memory revision, then stronger source confidence.

Retrieval output:

```text
lessonMemoryCandidates[]
- lessonMemoryEntryId
- entryType: calculation_default | material_rule | preference_rule | formula_hint | true_zero_rule
- originTable
- originId
- originRevision
- scope: customer | customer_tier | material_family | product_family | company
- selector
- chargeType
- formulaCode nullable
- effect
- defaultParameters
- sourceRefs
- confidence
- relevanceReason
- supersedes nullable

userMemoryCandidates[]
- userMemoryEntryId
- memoryOwnerUserId
- scope: user | account
- selector
- chargeType nullable
- formulaCode nullable
- effect
- defaultParameters
- sourceRefs
- confidence
- relevanceReason
- overridesLessonMemoryEntryId nullable
```

AI use:

- AI may select one candidate as `selectedCalculationRule`.
- AI may select an applicable LibreChat user memory candidate before an Admin-reviewed default when the user memory is task-scoped and high confidence.
- AI may combine one reviewed lesson/memory default with explicit quote-specific `parameterOverrides`.
- AI must ask the user when candidates conflict, confidence is not high, or required selectors are missing.
- AI must not invent `lessonMemoryEntryId`, `userMemoryEntryId`, `formulaCode`, default parameters, or origin refs.

Backend validation after AI selection:

- selected Admin-reviewed lesson/memory entry still exists, is reviewed, active, and in scope
- selected LibreChat user memory entry still exists, belongs to the current user/account scope, and is in task scope
- selected formula code is reviewed and active
- selected effect applies to the requested charge type
- default parameters satisfy the formula's allowed variables
- quote-specific overrides are explicit, sourced, and high confidence

## Retrieval Tool Plan

Future provider-neutral tools should keep lesson/memory retrieval behind backend validation.

Quote-facing tools:

- `retrieve_lesson_memory`: returns bounded reviewed candidates for normalized customer/item/charge context.
- `retrieve_user_memory`: returns bounded LibreChat user custom memory candidates for the current user/account and normalized task context.
- `rank_lesson_memory`: validates/ranks retrieved candidates when more than one applies.
- `select_calculation_rule`: validates the AI-selected candidate and converts it into `selectedCalculationRule`.

Admin-only tools or APIs:

- `create_rule_proposal`: creates a `needs_review` proposal after required fields are known.
- `approve_rule_proposal`: writes reviewed database facts and audit refs.
- `publish_lesson_memory`: rebuilds lesson/memory entries from reviewed facts.
- `invalidate_lesson_memory`: invalidates generated entries when reviewed origin facts change.

Quote-facing AI must not call Admin-only publication tools.

Quote-facing tools may return both Admin-reviewed lesson/memory and LibreChat user memory, but they must keep the two layers separately labeled through ranking and validation.

## Promotion Flow

```text
customer conversation
  -> quote override for current workbook line
  -> optional "save as customer default?" prompt
  -> rule proposal with needs_review status
  -> Admin review and validation
  -> reviewed database rule/default/formula/price row
  -> generated task-scoped lesson/memory entry
  -> future AI rule selection
```

## Data Shape Plan

Future schema work should plan three distinct storage surfaces.

### Proposal Surface

Purpose: hold candidate defaults created from conversation context before Admin approval.

Suggested table or Mongo collection:

```text
steel_rule_proposals or steel_memory_candidates
- id
- proposal_type: customer_default | material_rule | price_override | formula_default
- status: needs_review | reviewed | rejected
- customer_id nullable
- material_family nullable
- charge_type nullable
- formula_code nullable
- selector JSONB
- proposed_default_parameters JSONB array
- source_refs JSONB array
- created_from_conversation_id
- created_from_workbook_line_id
- created_by_user_id
- reviewed_by_user_id nullable
- reviewed_at nullable
- review_note nullable
- created_at
- updated_at
```

### Reviewed Default Surface

Purpose: deterministic quote lookup after Admin approval.

Implemented table:

```text
steel.calculation_rule_defaults
- id
- code
- name
- scope_type: customer | customer_tier | material_family | product_family | company
- customer_id nullable
- customer_tier_id nullable
- material_family nullable
- product_family nullable
- charge_type
- formula_code
- formula_version_id nullable
- selector JSONB
- effect
- default_parameters JSONB array
- priority
- confidence
- active
- review_state
- source_refs JSONB array
- approved_by nullable
- approved_at nullable
- created_at
- updated_at
```

This table should not duplicate formula bodies. It stores the reviewed `formula_code`, can pin a `formula_version_id` when Admin approval selects one, and stores only adjustable defaults.

### Published Retrieval Surface

Purpose: let AI retrieve the matching reviewed lesson/memory without scanning all rules or prompt text.

Implemented table:

```text
steel.lesson_memory_entries
- id
- entry_type
- origin_table
- origin_id
- origin_revision
- scope_type: customer | customer_tier | material_family | product_family | company
- customer_id nullable
- customer_tier_id nullable
- material_family nullable
- product_family nullable
- charge_type nullable
- formula_code nullable
- selector JSONB
- effect
- default_parameters JSONB array
- priority
- confidence
- source_refs JSONB array
- active
- review_state
- supersedes_entry_id nullable
- published_at
- invalidated_at nullable
- created_at
- updated_at
```

Optional vector/search columns can support semantic matching later, but typed filters must run before semantic ranking so unrelated or unreviewed memory cannot leak into the AI prompt.

### User Memory Adapter Surface

Purpose: connect existing LibreChat user memory to Steel quote-time rule selection without confusing it with Admin-reviewed Steel facts.

Suggested retrieval shape:

```text
LibreChat user memory adapter
- user_memory_entry_id
- memory_owner_user_id
- scope_type: user | account
- selector
- effect
- default_parameters
- confidence
- source_refs
- overrides_lesson_memory_entry_id nullable
- created_at
- updated_at
```

This surface should adapt existing LibreChat memory records where possible. It should not duplicate Steel Admin-reviewed facts or write into `steel.lesson_memory_entries`.

## Tool Contract

AI orchestration can ask to save a customer default only after the backend has enough structured data to create a rule proposal.

Required fields:

- customer identity or explicit global/company scope
- normalized product/material family
- charge type
- fixed `formulaCode` from a reviewed formula
- adjustable parameter keys and values
- source refs for the conversation instruction
- confidence and reason

If any required field is missing, the assistant should ask a targeted question instead of creating a proposal.

When user memory conflicts with an Admin-reviewed default, the assistant may prefer the user memory only if:

- it belongs to the current user/account memory scope
- it is specific enough for the customer/material/product/charge/formula task
- it does not require a new unreviewed formula or forbidden parameter
- backend validation can tie the final selected rule to reviewed formula/default origins or explicit user-sourced overrides

If those checks cannot pass, the assistant must ask the user which option to use and leave Admin-reviewed facts unchanged.

## Admin Review Requirements

Admin UI or API must show:

- the original customer instruction
- affected customer/material/charge scope
- current reviewed database value, when one exists
- proposed default parameters
- selected formula code and formula version
- conflicts with existing reviewed rules/defaults
- future effect summary
- source refs and audit trail

Approval options:

- approve as customer default
- approve as company/material default
- approve as one-time quote adjustment only
- reject
- request more information

## Non-Goals

- Do not let chat write reviewed rules directly.
- Do not let AI publish persistent lessons/memory directly.
- Do not store LibreChat user memory as if it were an Admin-reviewed Steel fact.
- Do not store formulas only as natural-language memory.
- Do not promote quote overrides automatically because they repeat.
- Do not ask "save as default?" until the proposal and Admin review path exists.

## Verification Gate

Future implementation must prove:

- quote override writes do not mutate formal rule tables
- rule proposal records are excluded from quote lookup until reviewed
- Admin approval writes source refs and audit trail
- published lessons/memory can be rebuilt from reviewed database rows
- stale memory is invalidated after reviewed rule updates
- AI receives only task-scoped reviewed lessons/memory
- AI receives only task-scoped LibreChat user memory for the current user/account scope
- LibreChat user memory can override retrieval priority without mutating Admin-reviewed facts
- lesson/memory retrieval applies typed filters before semantic ranking
- AI-selected `selectedCalculationRule` is rejected when its origin lesson/memory entry is stale, unreviewed, inactive, or out of scope
- AI-selected `selectedCalculationRule` is rejected when its origin user memory belongs to a different user/account, is out of scope, or tries to bypass reviewed formula validation
