# Retry New Chat Title Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Try title generation after every user message while the conversation still has no real title (`New Chat`, empty, or null).

**Architecture:** Reuse the existing server-side `addTitle()` and frontend title queue. Backend controllers decide whether the just-saved conversation still needs a title; frontend final-event handling queues `/gen_title` fetches for the same no-real-title state.

**Tech Stack:** Legacy `/api` JavaScript controllers, React/TypeScript SSE hooks, Jest.

---

### Task 1: Backend Title Eligibility

**Files:**
- Modify: `api/server/controllers/agents/request.js`
- Test: `api/server/controllers/agents/__tests__/request.resumeMetadata.spec.js`

**Step 1: Write the failing test**

Add a controller test for a follow-up request whose saved conversation title is `New Chat`; assert `addTitle` is called even though the request is not an initial new conversation.

**Step 2: Run test to verify it fails**

Run:

```bash
cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js --runInBand --watch=false --coverage=false --testNamePattern "New Chat title"
```

Expected: FAIL because the existing controller only title-generates for initial new conversations.

**Step 3: Write minimal implementation**

Add a small `hasRealTitle()` helper and use it in both resumable and non-resumable controller tails. Generate titles for successful, non-temporary turns when the saved conversation lacks a real title.

**Step 4: Run test to verify it passes**

Run the same focused Jest command. Expected: PASS.

### Task 2: Frontend Queue On Final Event

**Files:**
- Modify: `client/src/hooks/SSE/useEventHandlers.ts`
- Test: `client/src/hooks/SSE/__tests__/useEventHandlers.spec.ts`

**Step 1: Write the failing test**

Export a small helper that determines whether a final event should queue title generation. Test that follow-up turns with `conversation.title === "New Chat"` queue, while real titles and temporary conversations do not.

**Step 2: Run test to verify it fails**

Run:

```bash
cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts --runInBand --watch=false --coverage=false --testNamePattern "title queue"
```

Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

Add the helper and use it in `finalHandler` before the current `queueTitleGeneration()` call.

**Step 4: Run test to verify it passes**

Run the same focused Jest command. Expected: PASS.

### Task 3: Final Verification

Run:

```bash
cd api && rtk npx jest server/controllers/agents/__tests__/request.resumeMetadata.spec.js server/services/Endpoints/agents/title.test.js --runInBand --watch=false --coverage=false --testNamePattern "New Chat title|agents addTitle"
cd client && rtk npx jest src/hooks/SSE/__tests__/useEventHandlers.spec.ts src/data-provider/SSE/__tests__/useTitleGeneration.test.ts --runInBand --watch=false --coverage=false --testNamePattern "title queue|useTitleGeneration"
rtk node --check api/server/controllers/agents/request.js
rtk git diff --check
```

Update `tasks/todo.md` with results.
