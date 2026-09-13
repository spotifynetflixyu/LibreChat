# Project Agent Instructions

Read `CLAUDE.md` before making project changes. It is the canonical project
agent document for this repository.

Use the relevant scope in `CLAUDE.md`: keep Steel database and rule changes on
the documented Supabase and synchronization workflows, compose frontend work
from the shared semantic theme system, and invalidate the auth user-document
cache when user documents change. Choose verification from the affected
workspace and risk; prose-only changes do not need tests.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
