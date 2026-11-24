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
  - With `maxWidth`, it wraps columns into rows. The editor sets this on narrow portrait screens.
- `Router`: orthogonal wires that avoid nodes, using A* over a sparse grid of node edges and channel midpoints. Bends cost extra, and sharing a segment with a wire from another output costs extra.
- Placement:
  - New connected nodes join their siblings' column (pushing nodes below down), or open a column (shifting downstream nodes).
  - A node dropped on another slides off it.
  - A node that grows pushes the nodes below it down.

ELK is supported through `elkLayout(new ELK())` as an optional adapter of `LayoutEnginePort`.

## Consequences

- No layout dependency by default. Layout and routing are synchronous, so dragging re-routes live.
- Our layout is simpler than ELK's. Teams that need more pass ELK in.
- Wires that wrap between rows on phones are long, because a wire must come back around. This is accepted.
