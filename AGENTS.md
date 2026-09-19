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

撰寫資料來源、判斷條件與保留要求前，先核對該次 AI 實際收到的輸入。引用資料時使用實際可見的 data key、Markdown section／欄名或明確的輸入區段位置；沒有 key 的內容不得虛構 key。不同流程的輸入結構須分別對應，不得以後端內部變數或自定義的其他 AI 角色名稱（例如 Organizer、主 Agent、子 Agent）代替資料來源，也不得假設當下 AI 知道其他角色的職責或處理結果。

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
