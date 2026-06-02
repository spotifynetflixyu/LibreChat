# Steel OAuth Chat Workbook Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update `/steel/oauth-chat` so it uses only `gpt-5.5`, supports a toggleable workbook panel, and lets desktop users drag the workbook divider.

**Architecture:** Keep the change local to the Steel OAuth chat route and workbook preview mount. `SteelOAuthChat` owns layout state, panel visibility, and drag math; `SteelWorkbookPreview` remains a render-only workbook surface.

**Tech Stack:** React, TypeScript, lucide-react icons, Testing Library/Jest, Tailwind utility classes.

---

### Task 1: Red Tests

**Files:**

- Modify: `client/src/routes/SteelOAuthChat.spec.tsx`

**Steps:**

- Add tests proving `gpt-5.4` and the model segmented control are no longer visible.
- Assert submitted chat payloads use `model: 'gpt-5.5'`.
- Add tests for `Hide workbook` / `Show workbook` toggling.
- Add a drag test that checks the workbook panel width changes and clamps to the requested constraints.

**Command:**
`cd client && rtk npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false`

**Expected before implementation:** focused tests fail because the current UI still exposes `gpt-5.4`, has no workbook toggle, and has no draggable divider.

### Task 2: Route Implementation

**Files:**

- Modify: `client/src/routes/SteelOAuthChat.tsx`

**Steps:**

- Replace model state/options with a single `steelModel = 'gpt-5.5'`.
- Remove the model segmented control from the header.
- Add workbook panel visibility state and a header icon button using `PanelRightOpen` / `PanelRightClose`.
- Add desktop drag divider state with default 1:1 sizing, min workbook width `100px`, and max workbook width equal to layout width minus `200px`.
- Hide the panel without clearing workbook state.

### Task 3: Verification

**Commands:**

- `cd client && rtk npx jest src/routes/SteelOAuthChat.spec.tsx --runInBand --coverage=false`
- `cd client && rtk npx prettier --write src/routes/SteelOAuthChat.tsx src/routes/SteelOAuthChat.spec.tsx src/features/steel/workbook/Preview.tsx`
- `cd client && rtk npm run typecheck 2>&1 | rtk rg "SteelOAuthChat|features/steel|workbook/Preview"`
- `rtk git diff --check`

**Expected after implementation:** focused tests pass, formatting passes, no Steel UI typecheck diagnostics appear, and diff check passes.
