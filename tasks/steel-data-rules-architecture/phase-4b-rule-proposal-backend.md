# Phase 4B: Rule Proposal Backend

Goal: implement the backend slice that lets a quote conversation create a structured `needs_review` rule proposal, without building the Admin review UI yet.

## Scope

This phase creates the proposal record only. It does not approve, publish, reject, or render Admin review screens.

Implemented surface:

- Public request/response schemas for rule proposals.
- Explicit Mongo schema for `steel_memory_candidates` as the proposal collection.
- Backend service and repository for creating pending proposals.
- Authenticated quote-facing route for saving a reusable-default proposal after the user explicitly asks for it.
- Focused tests proving missing required selectors are rejected and successful proposals start as `needs_review`.

Deferred surface:

- Admin review UI.
- Admin approval/rejection API.
- Promotion into `steel.calculation_rule_defaults`.
- Global/site-managed lesson/memory extension module, including publishing into `steel.lesson_memory_entries`.
- Lesson/memory retrieval tools for that extension module.

## Data Contract

Use the existing Mongo collection name `steel_memory_candidates` as the proposal surface. Phase 4A already reserves this as an acceptable proposal collection, and keeping the collection avoids inventing another storage location before the Admin review workflow exists.

Required create fields:

- `proposalType`: `customer_default`, `material_rule`, `price_override`, or `formula_default`.
- `scopeType`: `customer`, `customer_tier`, `material_family`, `product_family`, or `company`.
- `chargeType`: `material`, `cutting`, `hole`, `slotting`, `bending`, or `processing`.
- `formulaCode`: reviewed formula identity selected by backend-visible context.
- `selector`: typed task selector keys, such as product family, material family, spec, work type, or other normalized quote context.
- `proposedDefaultParameters`: adjustable parameter keys and values.
- `sourceRefs`: conversation/workbook/source evidence refs.
- `createdFromConversationId`.
- `reason`.
- `confidence`: `low`, `medium`, or `high`.

Scope-specific requirements:

- `customer` requires `customerId`.
- `customer_tier` requires `customerTierId`.
- `material_family` requires `materialFamily`.
- `product_family` requires `productFamily`.
- `company` requires no customer selector but still requires task selectors, charge type, formula code, parameters, source refs, and reason.

Derived fields:

- `status` always starts as `needs_review`.
- `createdByUserId` comes from the authenticated request user.
- `reviewedByUserId`, `reviewedAt`, and `reviewNote` stay empty until a later Admin slice.

## Route Contract

`POST /api/steel/rule-proposals`

Rules:

- Requires normal authenticated Steel user access.
- Does not accept guest tokens.
- Does not accept client-supplied `status`, reviewer fields, or publish fields.
- Returns `201` with a sanitized proposal response on success.
- Returns `400` when required scope, source, formula, or parameter fields are missing.
- Returns `401/403` through existing auth middleware before the handler when the user is not authenticated.

## AI Tool Boundary

The quote assistant may ask whether to save a quote override as a future default only after this backend create path exists.

The intended AI integration is tool calling: AI decides whether the current conversation has enough confirmed structure, then calls a backend tool/API that maps to `POST /api/steel/rule-proposals`. The AI does not write Mongo, Supabase, or lesson/memory directly.

If the AI is uncertain or backend lookup found multiple plausible options, it must ask the user to confirm before calling the create path. The create path is not a substitute for disambiguation; it only persists a structured proposal after the required fields are known.

Pending proposals must not participate in deterministic quote lookup, lesson/memory retrieval, or `selectedCalculationRule` validation.

## Confirmed Conversation Scenarios

These scenarios define how the quote assistant should behave before any future Admin review or global lesson/memory extension exists.

### Scenario 1: Current Quote Only

User says:

```text
這張單 C 型鋼切不算錢，孔也不算錢。
```

Assistant response:

```text
已套用到本次報價線：C 型鋼切工 = 0、孔工 = 0。這只影響本次報價，不會存成客戶預設。
```

Behavior:

- Do not call `create_rule_proposal`.
- Store or apply only a quote-specific adjustment for the current workbook line.
- Do not mutate formal prices, rules, defaults, or lesson/memory.

### Scenario 2: User Explicitly Requests A Future Default

User says:

```text
這個客戶以後 C 型鋼切跟孔都不用算錢。
```

Assistant response:

```text
我可以建立一筆待審核的客戶預設規則。Admin 審核前，它不會自動套用到正式預設或 lesson/memory。
```

Behavior:

- AI may call `create_rule_proposal` through backend tool calling.
- The tool maps to `POST /api/steel/rule-proposals`.
- The backend stores a Mongo `steel_memory_candidates` row with `status = needs_review`.
- Do not write reviewed Supabase facts.
- Do not publish global/site-managed lesson/memory.

Future Admin-approved behavior:

- After a later Admin approval/publish workflow creates a customer-scoped reviewed default and publishes the matching task-scoped lesson/memory entry, the next matching order for that customer may retrieve it.
- When such a customer default is applied, the assistant should explicitly tell the user which customer rule was applied.

### Scenario 2A: Future Default For H-Type

User says:

```text
這個客戶以後 H 型鋼切跟孔都不用算錢。
```

Assistant response:

```text
我可以建立一筆待審核的客戶預設規則。Admin 審核前，它不會自動套用到正式預設或 lesson/memory。審核通過後，下次此客戶的 H 型鋼訂單會明確提示已套用該客戶規則。
```

Behavior:

- AI may call `create_rule_proposal` only after customer and H-type scope are clear.
- The proposal selector must include customer scope and material family H-type.
- Pending proposal must not affect current/future quote lookup until approved.
- After future Admin approval and lesson/memory publication, a matching H-type order should disclose the applied customer default, such as `已套用此客戶預設規則：H 型鋼切工與孔工不計價。`

### Scenario 3: Scope Is Unclear

User says:

```text
以後這種都不要算切工。
```

Assistant response:

```text
這裡的「這種」我需要確認，是指：1. 只有這個客戶的 C 型鋼，2. 所有客戶的 C 型鋼，還是 3. 只有這張報價？
```

Behavior:

- Do not call `create_rule_proposal`.
- Ask for the missing scope.
- Create a proposal only after the user confirms the intended customer/material/company scope.

### Scenario 4: Multiple Product Or Spec Candidates

User says:

```text
這客戶 C100 以後照這個算法。
```

Assistant response:

```text
我查到多個可能規格：C100x50、C100x50x20、C100x50x20x2.3。請確認要套用哪一個，或是否套用整個 C 型鋼家族。
```

Behavior:

- Do not guess and save.
- Present bounded candidate options.
- Create a proposal only after the user confirms the exact spec or broader family scope.

### Scenario 5: Product Price Source Has Zero

User says:

```text
產品價格表這個是 0，就當免費吧。
```

Assistant response:

```text
產品價格來源中的 0 視為無價格，不代表免費。若你要把某個 charge 設成免費，需要明確指定範圍，我會建立待審核 proposal。
```

Behavior:

- Treat `產品價格.xlsx` price `0` as missing price.
- Do not treat source zero as a true-zero/free-charge rule.
- If the user confirms a free-charge rule with enough scope and source context, create only a `needs_review` proposal.

### Scenario 6: User Asks AI To Remember Globally

User says:

```text
那這規則以後讓 AI 都記住。
```

Assistant response:

```text
目前我只能建立待審核規則 proposal。全站 global lesson/memory 是未來 extension module，等 Admin review backend/UI 和 publish 流程規劃後才會處理。
```

Behavior:

- Create only a pending proposal when required fields are known.
- Do not write global/site-managed lesson/memory.
- Do not let the AI permanently remember a Steel business rule outside the reviewed extension module.

## Closeout Boundary

Phase 4B closes after the rule proposal backend and the confirmed conversation scenarios are documented and verified. Remaining Admin review backend/UI, approval/rejection, and global/site-managed lesson/memory extension work should stay deferred.

The next implementation focus should return to the core order quoting path: parse customer order evidence, normalize quote items, retrieve reviewed price/rule/formula facts, ask for confirmation when needed, calculate the quote, and persist the accepted workbook result.

## Verification Gate

- Data-provider schemas accept a complete create payload and reject missing parameters/source refs.
- Mongo schema indexes proposal status, creator, and review queues.
- Backend service creates only `needs_review` proposals and fills `createdByUserId` from the request user.
- Handler rejects unauthenticated or malformed create requests.
- Express route registers `/api/steel/rule-proposals` under JWT auth.
- Confirmed conversation scenarios cover current quote-only adjustments, explicit future defaults, unclear scope, multiple candidates, product-price zero handling, and global memory requests.
- Build and diff checks pass.
