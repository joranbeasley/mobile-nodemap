# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-24

## Context

mobile-nodemap is meant to grow an ecosystem of third-party packs and graph types. Contributors need to know why the core looks the way it does, and which choices are deliberate rather than accidental, before they extend or change it.

## Decision

We keep Architecture Decision Records in `docs/adr`, one Markdown file per decision, numbered in order and written from [template.md](template.md). Product intent lives separately in `docs/prd`.

## Consequences

- Decisions are reviewable in pull requests like code.
- Superseding a decision is explicit: a new ADR, plus a status change on the old one.
- Writing a record costs a little time per significant change.
