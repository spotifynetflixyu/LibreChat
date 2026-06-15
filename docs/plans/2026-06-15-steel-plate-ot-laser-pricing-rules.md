# Steel Plate OT Laser Pricing Rules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure Steel plate quotes default unspecified plate material to OT black iron, search laser-cut plate product names, and calculate plate prices by square theoretical weight kg rather than piece or square-cut rows.

**Architecture:** Keep the rule in reviewed Steel rule docs and enforce the stable parts in local tool/provider tests. Use deterministic helpers where needed so PL oral specs produce OT laser-cut product-name candidates and workbook pricing keeps kg theoretical-weight semantics.

**Tech Stack:** TypeScript, Jest, Steel Supabase rule sync scripts, shared Steel tool schemas, provider prompt/tool loop tests.

---

### Task 1: RED Coverage

**Files:**
- Test: `packages/api/src/steel/tools/schemas.spec.ts` or existing focused schema/tool tests
- Test: `packages/api/src/steel/ai/provider.spec.ts`

**Steps:**
1. Add a failing test proving PL oral specs derive OT laser-cut candidates such as `6.0m/mOT板雷射切割` and not `四方切`.
2. Add a failing behavior test proving plate quote workbook output uses theoretical kg pricing even if a candidate row says `piece`.
3. Run focused tests and confirm they fail for the expected missing behavior.

### Task 2: Minimal Implementation

**Files:**
- Modify: `packages/api/src/steel/tools/schemas.ts` or nearby Steel price-search normalization helper
- Modify: `packages/api/src/steel/ai/provider.ts` only if provider reminders need deterministic candidate guidance
- Modify: `docs/rules/鋼材規則.txt`
- Modify: `docs/rules/agent規則.txt`

**Steps:**
1. Implement the smallest PL plate helper/normalizer needed by the failing tests.
2. Update Steel rule docs to state OT default, kg theoretical-weight pricing, and laser-cut-only plate price adoption.
3. Avoid brittle tests against exact human wording; verify through tool arguments and workbook patch behavior.

### Task 3: Rule Sync And Verification

**Files:**
- Modify: `tasks/todo.md`

**Steps:**
1. Run focused Jest tests.
2. Run `node packages/api/scripts/sync-steel-rules.cjs --dry-run`.
3. Run `node packages/api/scripts/sync-steel-rules.cjs --apply`.
4. Rebuild affected packages if shared types changed.
5. Run `git diff --check`.
6. Record review evidence in `tasks/todo.md`.
