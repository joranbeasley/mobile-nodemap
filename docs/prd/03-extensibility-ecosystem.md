# 03. Extensibility and ecosystem

## Problem

Every domain needs its own nodes, value types, editors, rules and sometimes its own idea of "running". A closed editor forces forks.

## Goals

- Third parties can add anything the built-ins have, using the same API (ADR 0006).
- Adding a small domain takes one file.
- Composition: graph types extend and trim each other.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| X1 | `defineNode` with shorthand ports and typed `run`; `extendNode` to derive node types | Shipped |
| X2 | Node fields: `icon`, `tags`, `docs`, `width`, `flavor`, `view`, `emit`, `pure`, `ports(params)`, `onCreate`, `version`/`migrate`, `meta` | Shipped |
| X3 | `definePack`: nodes, port types (colour, accepts, coerce, inline editor), param kinds, conversions, CSS | Shipped |
| X4 | `defineGraphType`: extends, packs, nodes, exclude, rules (cycles, canConnect, canAddNode, validate), engine, editor defaults, examples | Shipped |
| X5 | `registerGraphType` and lookup by id for saved JSON and `<node-map graph-type>` | Shipped |
| X6 | Custom param kinds render in node bodies and as inline port editors, and update on undo | Shipped |
| X7 | Pack CSS injected once per document or shadow root | Shipped |
| X8 | A complete third-party example (the Palette pack in the demo) | Shipped |

## Ecosystem conventions

- Namespace ids: `acme/…` for graph types, `acme/…` for node types, `acme/…` for packs.
- Bump `version` and add `migrate` when a node's params change shape.
- Prefer `emit` for pure nodes, so maps export as self-contained code.

## Open questions

- A pack manifest for discovery (keywords, screenshots), and a gallery site.
- Sandboxing untrusted packs (iframes or workers).
- Per-pack localisation of titles and descriptions.
