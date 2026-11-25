# 0011. Views: boards without wires

- Status: Accepted
- Date: 2026-11-25

## Context

The drama graph type showed that some domains are not flows. A production links many characters to many shots, so the wires pile up, and nothing is computed along them: they only record membership ("this shot is in that scene"). People asked for tabs of cards (cast, locations, scenes, episodes) where cards refer to each other and link back, with no visible wires or ports.

## Decision

- **The editor gains views.** A view (`EditorView`) is a tab that shows some node types, lays them out as a grid, in rows or as the usual flow, and limits the + menu to its types. An `onAdd` hook links a new node to the selection. Graph types declare views in `editor.views`; with none, nothing changes.
- **Navigation is an attribute.** Any element with `data-nm-open="<id>"`, in a node view, a param control or a sheet, jumps to that node, switching view when needed, and Back returns. `data-nm-live` marks other controls that work before their node is selected.
- **References are params, not edges.** Node types without ports refer to each other through `ref` / `refs` param kinds. Param kinds now receive the graph so they can list and name other nodes.
- **Drama boards reuse drama.** `toDrama()` rebuilds the wired drama graph from the references (same ids). The drama engine, details cards and Seedance export run on that, unchanged.

## Consequences

- Board-like domains (casting, inventories, kanban, CRM) fit without inventing a second editor. One editor handles touch, sheets, themes, history and details for both styles.
- The graph's own edges stay meaningful for flows. Boards keep relationships in params, so `graph.edges` is empty there and anything that needs edges converts first, as `toDrama()` does.
- Node positions are owned by the layout in grid and rows views. Dragging snaps back, and positions saved in JSON are overwritten when a view is shown.
- One node type can appear in several views (scenes are in Scenes and in Episodes); its position follows whichever view is shown.

## Alternatives considered

- **Separate editors per tab.** Hidden editors measure as zero and duplicate state. One editor with a filter is simpler.
- **Hidden wires.** Keeping edges but not drawing them would have reused the drama types as they are. But editing membership would still mean wiring, and the many-to-many links would clutter `canConnect` rules and layout.
- **A separate board component outside the editor.** It would have had to rebuild touch handling, sheets, themes and details cards.
