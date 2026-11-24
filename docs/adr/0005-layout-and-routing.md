# 0005. Own layered layout and wire router; ELK optional

- Status: Accepted
- Date: 2026-11-24

## Context

On a phone, auto placement and readable wires matter more than anything else: dragging nodes precisely is hard and the screen is narrow. Off-the-shelf options: ELK (excellent, about 1.5 MB, asynchronous), dagre (layout only, no obstacle-aware routing of our ports), and Rete's auto-arrange (a wrapper around ELK).

## Decision

We ship our own small, synchronous pieces:

- `layered()`: a Sugiyama-style layout.
  - Longest-path layering, with back edges removed by depth-first search so loops are fine.
  - Barycentre ordering that respects port order, and port-aligned vertical placement.
  - With `maxWidth`, it wraps columns into bands (opt-in; see the addendum).
- `Router`: orthogonal wires that avoid nodes, using A* over a sparse grid of node edges and channel midpoints. Bends cost extra, and sharing a segment with a wire from another output costs extra.
- Placement:
  - New connected nodes join their siblings' column (pushing nodes below down), or open a column (shifting downstream nodes).
  - A node dropped on another slides off it.
  - A node that grows pushes the nodes below it down.

ELK is supported through `elkLayout(new ELK())` as an optional adapter of `LayoutEnginePort`.

## Consequences

- No layout dependency by default. Layout and routing are synchronous, so dragging re-routes live.
- Our layout is simpler than ELK's. Teams that need more pass ELK in.
- Readable spacing is preferred over fitting the whole map on screen.

## Addendum: one flow, no wrapped rows

Wrapping columns into rows on phones produced long wires that doubled back between rows, and crowded maps to fit the width. We changed course:

- Maps flow one way: **left to right**, or **top to bottom** on narrow portrait screens (`direction: 'auto'`).
- Top to bottom, inputs sit on the top edge of each node and outputs on the bottom. The router leaves outputs downwards and enters inputs from above, so wires run with the flow.
- The editor never wraps. Gaps are generous (120 between layers, 56 within a layer), and the view opens at a readable zoom rather than fitting everything.
- Placement follows the flow (new layers open below, top to bottom). When a node grows top to bottom, the rows below reflow to keep a full gap.
- A map remembers the flow it was tidied for (`graph.meta.flow`), and is re-tidied when opened in the other flow.
- `maxWidth` wrapping stays in `layered()` as an opt-in for hosts that want it.
