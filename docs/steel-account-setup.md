# Steel Local Account Setup

This runbook is the Phase 1 prerequisite for testing Steel admin routes, user-facing Steel routes, and guest-mode behavior in local development.

## Prerequisites

- Start local LibreChat with the sequence in `docs/local-dev.md`.
- Use a local or development MongoDB database. Do not run account setup against production data.
- Keep local email registration enabled while creating test accounts:

```env
ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
```

`librechat.example.yaml` also documents optional `registration` settings such as social login providers and allowed domains. Keep those settings simple for local Steel testing unless the route under test specifically needs them.

## Role Rule To Rely On

Current LibreChat registration code assigns roles during local registration:

- The first registered non-anonymous user becomes `ADMIN`.
- Later registered users become `USER`.

This behavior is implemented in `api/server/services/AuthService.js`, where `countUsers() === 0` selects `SystemRoles.ADMIN`; otherwise the role is `SystemRoles.USER`.

If the local database already contains users, the "first registered user" rule has already been consumed. In that case, use the existing admin account or reset only the local development database before creating these Steel test accounts.

## Create Test Accounts

1. Start backend and frontend.
2. Open `http://localhost:3090`.
3. Register the first local test account, for example `steel.admin.local@example.com`.
4. Sign out.
5. Register a second local test account, for example `steel.user.local@example.com`.
6. Sign out and sign back in as each account before running Steel route checks.

Expected roles:

| Account | Expected role | Purpose |
|---|---|---|
| First registered account | `ADMIN` | Steel Admin pages and `/api/admin/steel/...` route tests |
| Second registered account | `USER` | Normal Steel quote/user route tests and admin-denial tests |

## Steel Route Verification Contract

When Phase 1 route shells exist:

- `ADMIN` can reach Steel admin diagnostics such as `POST /api/admin/steel/ai/capability-smoke`, subject to local-dev/admin-only guard policy.
- `USER` cannot reach `/api/admin/steel/...`; expected result is `403` or the project-standard access-denied response.
- `USER` can reach authenticated quote/user-facing Steel routes under `/api/steel/...` when the route's own permission rules allow it.
- Guest access is controlled only by `STEEL_GUEST_MODE`; admin routes stay admin-only regardless of guest mode.

Do not create Steel-specific role shortcuts. Steel should consume LibreChat's existing auth/session and role model through service-level guards.
