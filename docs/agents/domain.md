# Domain Docs

## Layout

This repository uses single-context domain documentation:
root `GLOSSARY.md` and `docs/adr/`. Preserve the existing Steel vocabulary and ADRs;
do not split or relocate them merely because the repository is a monorepo.

## Before exploring

Read the glossary and the ADRs relevant to the area being changed.
If domain files are absent, proceed silently; do not require upfront scaffolding.
The domain-modeling skill creates vocabulary and decisions lazily as concepts settle.

## Vocabulary and decisions

- Use glossary terms in specifications, issue titles, interfaces, and test names.
- Avoid synonyms the glossary explicitly excludes.
- Surface conflicts with an ADR explicitly instead of silently overriding it.
- Distinguish confirmed product decisions from technical proposals.
- If a future `GLOSSARY-MAP.md` is adopted, read the contexts it identifies;
  do not invent context directories without an explicit layout decision.
