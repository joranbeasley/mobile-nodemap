# 0012. Editor plugins and nested maps

- Status: Accepted
- Date: 2026-11-25

## Context

Building Drama boards (0011) showed where the extension model stopped. Packs could add nodes, port types, param kinds, CSS and engines, but nothing that changes the *editor*: tabs, navigation, toolbar buttons, layouts. Those had to be written into `NodeEditor`. Param kinds couldn't see the graph, so a control could not name or pick other nodes.

Separately, `graphNode()` builds a node type from a node map, but the map was invisible once compiled. People expect to open such a node and see, or change, what is inside.

## Decision

- **`EditorPlugin`**: `{ id, install(editor) → undo? }`. Packs contribute them (`editorPlugins`), graph types list them (`editor.plugins`), and callers pass them (`plugins`). Each id is installed once per editor and undone on destroy. Plugins use the public editor API, which gains `addToolbarButton`.
- **Declarative editor features stay data on the graph type**: views (tabs), with built-in `grid`, `rows` and `flow` layouts or a `ViewLayout` function, and `onAdd`. Navigation is the `data-nm-open` attribute plus `openNode` / `back`.
- **Param kinds receive `graph`** in their context.
- **`NodeType.subgraph(node)`** returns the map inside a node, the registry its nodes come from, and optionally `save`. `editor.enterNode(id)` opens it in a nested `NodeEditor` in a layer with a Back bar, fed with the node's live inputs. Saved edits recompile the type and re-run every node of it. A map with errors or without an Output is refused, and the node keeps working as before. `graphNode()` sets `subgraph` with `save`; library nodes set it without `save` (they change through the function builder).

## Consequences

- A board-like domain such as Drama boards is now a graph type plus a pack: views as data, references as param kinds, extra behaviour as a plugin. The core changes made for it are general features.
- Plugins get a lot of power through the editor API, and with it the duty to clean up: install returns an undo function.
- A nested editor is a full editor (touch, sheets, themes, history), so opening maps inside maps costs no extra code.
- Editing a `graphNode` changes the type for the session only. Persisting it is the host's job, as with the library.

## Alternatives considered

- **Hooks for every editor event in the pack itself** (`onSelect`, `onToolbar`…). That makes for a bigger, more rigid surface. One install function with the public API covers it.
- **Swapping the editor's graph in place to show an inner map.** That would mean rebinding every listener and keeping a stack of viewports. A nested editor is simpler and isolates gestures.
