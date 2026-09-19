# Project Agent Instructions

Read `CLAUDE.md` before making project changes. It is the canonical project
agent document for this repository.

Use the relevant scope in `CLAUDE.md`: keep Steel database and rule changes on
the documented Supabase and synchronization workflows, compose frontend work
from the shared semantic theme system, and invalidate the auth user-document
cache when user documents change. Choose verification from the affected
workspace and risk; prose-only changes do not need tests.

## AI 規則撰寫

撰寫或修改 AI 規則與提示詞時，只寫 AI 會使用的資訊與指示，例如輸入、判斷條件、行為限制及輸出格式。不要加入後端的執行流程、資料合併、DB 儲存、UI 更新或 debug 留存邏輯。

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
