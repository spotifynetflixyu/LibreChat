# Active: Steel Native LibreChat Master Plan Cleanup

Goal: reduce docs/tasks context noise so future work starts from the Steel
native LibreChat master framework, not older OAuth/v8.3 planning history.

Plan:

- [x] Keep the canonical master framework and current implementation plan.
- [x] Delete old Steel planning docs and task-package histories that are no
      longer the active architecture.
- [x] Replace `tasks/todo.md` with this compact active task file.
- [x] Replace `tasks/lessons.md` with only durable Steel-native lessons.
- [x] Run documentation hygiene checks and report remaining entrypoints.

Protected current entrypoints:

- `docs/steel-native-librechat-master-framework.md`
- `docs/plans/2026-06-24-steel-global-native-librechat-integration.md`
- `tasks/todo.md`
- `tasks/lessons.md`

Review - 2026-06-25:

- Deleted old Steel planning docs, old ADR docs, v8.3 task package, and
  steel-data-rules-architecture task package.
- Kept only the current Steel native LibreChat master framework and current
  implementation plan as planning entrypoints.
- Kept `docs/rules/`, `docs/產品價格_分類檔案_v3/`, and `docs/reference/`-style
  source areas out of the cleanup scope because they are runtime/source
  material, not just old planning context.
- Reduced `tasks/todo.md` and `tasks/lessons.md` to compact current guidance.
- Verified remaining docs/tasks do not reference deleted legacy planning paths.
