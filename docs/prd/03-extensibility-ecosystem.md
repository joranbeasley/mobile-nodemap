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
| X9 | Editor plugins from packs and graph types (`EditorPlugin`), with `addToolbarButton` and the editor's public API | Shipped |
| X10 | Graph types declare views (tabs with grid, rows, flow or custom layouts) and navigation links (`data-nm-open`) | Shipped |
| X11 | Node types made of maps (`subgraph`) open in place on live inputs; edits recompile the type | Shipped |
| X12 | Param kinds receive the graph, so controls can refer to other nodes | Shipped |
| X13 | Plugins draw on the map through public API: wire geometry (`edgePath`, `edgePointAt`), layers (`addLayer`), a `route` event, `pulse`, and per-wire styles (`edgeStyle`) with labels | Shipped |
| X14 | A view-only mode (`readOnly`), for share viewers | Shipped |

## Ecosystem conventions

- Namespace ids: `acme/…` for graph types, `acme/…` for node types, `acme/…` for packs.
- Bump `version` and add `migrate` when a node's params change shape.
- Prefer `emit` for pure nodes, so maps export as self-contained code.

## Open questions

- A pack manifest for discovery (keywords, screenshots), and a gallery site.
- Sandboxing untrusted packs (iframes or workers).
- Per-pack localisation of titles and descriptions.
