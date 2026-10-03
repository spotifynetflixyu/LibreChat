# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `spotifynetflixyu/LibreChat`.
Use the `gh` CLI and explicitly pass `--repo spotifynetflixyu/LibreChat`;
for `gh api`, explicitly use `repos/spotifynetflixyu/LibreChat/...`.
Do not infer the destination from upstream or the CLI's resolved repository.

## Conventions

- Publish one issue per spec or ticket. Use `gh issue create` with `--body-file`
  for multiline bodies; preserve actual newlines and literal text.
- Read an issue's complete body, comments, labels, and blocking relationships
  before working on it. Use `gh issue view <number> --comments` and structured JSON.
- List issues with state and label filters; inspect existing matches before creating duplicates.
- Use the label vocabulary in `triage-labels.md`; specs and approved tickets use
  `ready-for-agent` as required by the publishing skill.
- Use GitHub native blocking relationships when available. Obtain a blocker's
  numeric database ID for the dependency API, not its issue number or node ID.
  If native dependencies are unavailable, include explicit `Blocked by` issue links.
- Publish blockers before blocked tickets; work only on the ready frontier.
- Do not change or close a parent issue when publishing its tickets.
- A draft PR records closing references for the spec and tickets. Creating a draft
  or pushing code does not resolve an issue; retain open issues until the actual
  merge/completion policy permits closure. Close resolved issues manually when a
  non-default base prevents GitHub's automatic closing, following contributor guidance.
- Comments, labels, assignment, and closure are tracker operations; they require
  authorization from the user or an explicitly invoked skill.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

- “Publish to the issue tracker” means create a GitHub issue in the repository above.
- “Fetch the relevant ticket” means read the issue, comments, labels, and blockers.
- A local spec or ticket mirror is a context pointer; GitHub remains the tracker.
