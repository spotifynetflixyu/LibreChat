# Markdown Table Cell Comments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add modal-only cell comments for rendered Markdown tables, show pending comment counts under the composer, and append grouped comments to the next user message.

**Architecture:** Keep comments as client-side pending-submit state keyed by conversation. Each rendered Markdown table is one Markdown unit; group submitted comments by AI message timestamp plus Markdown index. Do not change Markdown parsing, table export behavior, backend schemas, Steel storage, or the normal chat layout.

**Tech Stack:** LibreChat client, React, TypeScript, Recoil, React Hook Form, existing Markdown table modal, existing chat composer submit path, Jest/Testing Library.

---

## Locked Contract

- Comment UI appears only in the expanded Markdown table modal.
- Every rendered Markdown table is one Markdown unit containing one table.
- Labels use AI message timestamp plus Markdown index, for example `2026-06-27 14:32 / Markdown 2`.
- Role is not shown because comments only target AI Markdown tables.
- Internal identity must still include stable fields: conversation id, message id, markdown index, source fingerprint, row index, and column index.
- One cell can have only one pending comment. Saving the same cell again replaces the comment; saving blank text removes it.
- Comment input is single-line. Enter and blur save. Escape cancels.
- Pending comments survive modal close/reopen, conversation navigation, browser
  refresh, and back-forward accidents through conversation-scoped
  `localStorage` until successful fresh submit clears them.
- Successful fresh chat submit drains and clears pending comments, so the helper/count under the chat input becomes zero immediately.
- LibreChat browser/route leave warnings are always enabled across the route
  tree and do not depend on whether pending Markdown table comments exist.
- The submitted user message must visibly include the appended comments list.
- The appended comments list groups by message timestamp / Markdown index.
- The appended comments list ends with: `請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。`

## Current Code Paths

- Table modal and actions:
  - `client/src/components/Chat/Messages/Content/MarkdownTableActions.tsx`
  - `client/src/components/Chat/Messages/Content/MarkdownComponents.tsx`
  - `client/src/style.css`
- Markdown/message metadata:
  - `client/src/Providers/MessageContext.tsx`
  - `client/src/components/Chat/Messages/ui/MessageRender.tsx`
  - `client/src/components/Chat/Messages/Content/ContentParts.tsx`
  - `client/src/components/Chat/Messages/Content/Markdown.tsx`
  - `client/src/components/Chat/Messages/Content/MarkdownBlocks.tsx`
- Composer and submit:
  - `client/src/components/Chat/Input/ChatForm.tsx`
  - `client/src/components/Chat/Input/SendButton.tsx`
  - `client/src/hooks/Messages/useSubmitMessage.ts`
  - `client/src/hooks/Chat/useChatFunctions.ts`
  - `client/src/store/families.ts`
- Localization:
  - `client/src/locales/en/translation.json`
- Tests:
  - `client/src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx`
  - `client/src/hooks/Messages/__tests__/useSubmitMessage.spec.ts`
  - Add focused composer/formatter tests where needed.

## Submit Format

```markdown
<typed user message, if any>

---

Markdown table comments:

### 2026-06-27 14:32 / Markdown 2

1. Cell: row 3, column "品名規格"
   Old value: 白鐵板 3mm
   Comment: 改成 No1 白鐵板 3mm

2. Cell: row 5, column "數量"
   Old value: 8
   Comment: 改成 10

### 2026-06-27 14:32 / Markdown 3

1. Cell: row 2, column "備註"
   Old value: 依圖施工
   Comment: 補上：含折彎與孔加工

請依照以上 comments，分別輸出每個 Markdown 的完整新表格；不要只輸出修改過的 cell 或 row。
```

If the typed user message is empty, the submitted text starts at `Markdown table comments:`.

## Data Model

Create a client-only type, preferably in `client/src/common/markdown.ts`, and export it from `client/src/common/index.ts`.

```ts
export type MarkdownTableComment = {
  id: string;
  conversationId: string;
  messageId: string;
  messageTimestampLabel: string;
  markdownIndex: number;
  markdownLabel: string;
  tableFingerprint: string;
  rowIndex: number;
  columnIndex: number;
  columnHeader: string;
  rowLabel?: string;
  oldValue: string;
  comment: string;
};

export function buildMarkdownTableCommentId(input: {
  messageId: string;
  markdownIndex: number;
  rowIndex: number;
  columnIndex: number;
}): string {
  return `${input.messageId}:${input.markdownIndex}:${input.rowIndex}:${input.columnIndex}`;
}
```

Use the `id` to upsert/remove comments in Recoil. Keep the timestamp label for display and submitted text, but never use it as the only identity.

## Task 1: Formatter And Type Tests

**Files:**
- Create: `client/src/common/markdown.ts`
- Modify: `client/src/common/index.ts`
- Test: `client/src/common/markdown.test.ts`

**Step 1: Write failing formatter tests**

Cover:
- groups comments by `messageId + markdownIndex`
- heading uses `messageTimestampLabel / Markdown <n>`
- same group lists multiple cells once under one heading
- final instruction is appended once
- empty typed text starts directly with `Markdown table comments:`
- non-empty typed text gets the `---` separator first

Run:

```bash
cd client && rtk npx jest src/common/markdown.test.ts --runInBand --watch=false --coverage=false
```

Expected: fail because `markdown.ts` does not exist.

**Step 2: Implement types and formatter**

Implement:
- `MarkdownTableComment`
- `buildMarkdownTableCommentId`
- `formatMarkdownTableComments(comments: MarkdownTableComment[]): string`
- `appendMarkdownTableComments(text: string, comments: MarkdownTableComment[]): string`

Keep ordering stable by first appearance in the pending comment array.

**Step 3: Run tests**

Run:

```bash
cd client && rtk npx jest src/common/markdown.test.ts --runInBand --watch=false --coverage=false
```

Expected: pass.

## Task 2: Pending Comment State

**Files:**
- Modify: `client/src/store/families.ts`
- Modify: `client/src/hooks/Config/useClearStates.ts`
- Test: add coverage to the formatter/composer tests or a focused state test if existing patterns support it.

**Step 1: Add Recoil atom family**

Add `pendingMarkdownTableCommentsByConvoId` near `pendingQuotesByConvoId`.

```ts
const pendingMarkdownTableCommentsByConvoId = atomFamily<MarkdownTableComment[], string>({
  key: 'pendingMarkdownTableCommentsByConvoId',
  default: [],
});
```

Export it from the store object.

**Step 2: Clear state when conversation state clears**

Update `useClearStates` so clearing conversation-local pending state also resets this atom, matching pending quotes/manual skills.

**Step 3: Verify typecheck later**

This task is mostly wiring; run full client typecheck in the final verification task.

## Task 3: Pass Message Timestamp And Markdown Index To Tables

**Files:**
- Modify: `client/src/Providers/MessageContext.tsx`
- Modify: `client/src/components/Chat/Messages/ui/MessageRender.tsx`
- Modify: `client/src/components/Chat/Messages/Content/ContentParts.tsx`
- Modify: `client/src/components/Chat/Messages/Content/Markdown.tsx`
- Modify: `client/src/components/Chat/Messages/Content/MarkdownBlocks.tsx`
- Modify: `client/src/components/Chat/Messages/Content/markdownConfig.ts`
- Modify: `client/src/components/Chat/Messages/Content/MarkdownComponents.tsx`
- Test: `client/src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx`

**Step 1: Write failing test for label identity**

Render a message with two Markdown tables in the same message and verify the comment group labels distinguish `Markdown 1` and `Markdown 2` under the same timestamp.

**Step 2: Extend MessageContext**

Add:

```ts
messageTimestamp?: string | null;
```

Pass `msg.createdAt ?? msg.clientTimestamp` from `MessageRender`.

For `ContentParts`, pass `createdAt` through the local `MessageContext.Provider`.

**Step 3: Compute display timestamp**

Use `getMessageTimestamp(value, i18n.language)?.absolute` where display labels are built. If unavailable, fall back to the raw timestamp string, then `Unknown time`.

**Step 4: Track Markdown table index**

The table component needs a stable per-message table index. Prefer a small context/provider around Markdown rendering that increments when the `table` component renders. If that creates avoidable complexity, keep an index ref in `Markdown`/`MarkdownBlocks` and pass it into the component factory.

Requirement: in one message with two rendered tables, the labels must be `Markdown 1` and `Markdown 2`.

**Step 5: Run focused test**

```bash
cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false
```

Expected: pass after implementation.

## Task 4: Modal Cell Comment UI

**Files:**
- Create: `client/src/components/Chat/Messages/Content/table/comments.tsx`
- Modify: `client/src/components/Chat/Messages/Content/MarkdownTableActions.tsx`
- Modify: `client/src/style.css`
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx`

**Step 1: Write failing UI tests**

Cover:
- comment buttons exist only in expanded modal cells
- empty-comment cell button appears on hover/focus only
- entering text with Enter saves one comment
- blur saves one comment
- Escape cancels without saving
- same cell edit replaces the existing comment
- blanking input removes the comment
- commented cell keeps button visible
- commented cells show comment text directly in the cell and fade the original
  cell value

**Step 2: Implement cell comment controls**

Use `MessageCircle` from `lucide-react`.

Implement a small component that wraps modal `th`/`td` content or overlays a button inside cells. Use existing LibreChat surface classes and CSS variables. Keep normal inline tables unchanged.

Input behavior:
- one-line input
- Enter: save trimmed value
- blur: save trimmed value
- Escape: close and restore previous value
- blank save: remove comment

Upsert behavior:
- compute comment id from `messageId`, `markdownIndex`, `rowIndex`, `columnIndex`
- if id exists, replace `comment`
- if blank, remove id

**Step 3: Run focused tests**

```bash
cd client && rtk npx jest src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx --runInBand --watch=false --coverage=false
```

Expected: pass.

## Task 5: Composer Helper And Send Enablement

**Files:**
- Create: `client/src/components/Chat/Input/PendingMarkdownTableComments.tsx`
- Modify: `client/src/components/Chat/Input/ChatForm.tsx`
- Modify: `client/src/components/Chat/Input/SendButton.tsx`
- Modify: `client/src/locales/en/translation.json`
- Test: add `client/src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx`
- Test: update `client/src/components/Chat/Input/__tests__/SendButton.spec.tsx` if needed.

**Step 1: Write failing composer tests**

Cover:
- helper is hidden at zero pending comments
- helper shows grouped counts by timestamp/Markdown
- empty textarea plus pending comments enables send
- helper disappears after the pending queue is cleared

**Step 2: Implement helper component**

Read `pendingMarkdownTableCommentsByConvoId(conversationId)`.

Render concise helper text below existing pending chips/header area and above or near the textarea. Do not change the broader chat layout.

Example helper text:

```text
Markdown table comments: 2026-06-27 14:32 / Markdown 2: 2
```

If multiple groups exist, join with `, `.

**Step 3: Update SendButton**

Add a prop such as `hasPendingMarkdownTableComments?: boolean` and treat it like `hasFiles`.

**Step 4: Update form validation**

In `ChatForm`, include pending comments in the `validate` condition so empty text with pending comments is submit-capable.

**Step 5: Run tests**

```bash
cd client && rtk npx jest src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx src/components/Chat/Input/__tests__/SendButton.spec.tsx --runInBand --watch=false --coverage=false
```

Expected: pass.

## Task 6: Drain And Append On Submit

**Files:**
- Modify: `client/src/hooks/Chat/useChatFunctions.ts`
- Modify: `client/src/hooks/Messages/useSubmitMessage.ts`
- Test: `client/src/hooks/Messages/__tests__/useSubmitMessage.spec.ts`
- Test: add/update `client/src/hooks/Chat/__tests__/useChatFunctions.markdownComments.spec.tsx` if existing hook test setup supports it.

**Step 1: Write failing submit tests**

Cover:
- typed user text plus pending comments appends the formatted comment block
- empty typed text sends the comment block
- successful fresh submit clears pending comments
- if `ask()` returns `false`, pending comments are not cleared
- regenerate/edit/continue do not drain pending composer comments
- submitted user message text contains the appended comments list

**Step 2: Drain atomically**

Mirror `drainPendingQuotes` in `useChatFunctions`.

Only drain on fresh submit. Keep pending comments untouched for regenerate/edit/continue.

**Step 3: Append before constructing current user message**

Use `appendMarkdownTableComments(text, comments)` before `currentMsg` is built so the optimistic user message visibly contains the appended list.

**Step 4: Preserve failed-submit behavior**

If the request is rejected before constructing/submitting the message, do not clear pending comments. If the implementation drains early, restore on failure or move drain to the point where submit is accepted.

**Step 5: Run tests**

```bash
cd client && rtk npx jest src/hooks/Messages/__tests__/useSubmitMessage.spec.ts --runInBand --watch=false --coverage=false
```

Run any added `useChatFunctions` test directly.

Expected: pass.

## Task 7: Final Verification

**Files:**
- Update: `tasks/todo.md`
- Maybe update: `tasks/lessons.md` only if implementation reveals a new correction/pattern.

**Step 1: Run focused frontend suites**

```bash
cd client && rtk npx jest src/common/markdown.test.ts src/components/Chat/Messages/Content/__tests__/Markdown.mcpui.test.tsx src/components/Chat/Input/__tests__/PendingMarkdownTableComments.test.tsx src/components/Chat/Input/__tests__/SendButton.spec.tsx src/hooks/Messages/__tests__/useSubmitMessage.spec.ts --runInBand --watch=false --coverage=false
```

Expected: pass.

**Step 2: Run client typecheck**

```bash
cd client && rtk npm run typecheck
```

Expected: pass.

**Step 3: Run diff check**

```bash
rtk git diff --check
```

Expected: pass.

**Step 4: Update task tracker**

Update `tasks/todo.md` with:
- completed implementation bullets
- exact verification commands and outcomes
- any skipped verification and why

Do not mark complete without the commands above passing or documenting the blocker.
