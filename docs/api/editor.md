# Editor

`import { NodeEditor } from 'mobile-nodemap/editor'`

The touch-first DOM editor. It is the `domEditor` [render adapter](ports-and-adapters.md).

```ts
const editor = new NodeEditor(container: HTMLElement, options: EditorOptions);
```

Give `container` a size. The editor adds `.nm-root`, makes it focusable and injects its stylesheet once per document or shadow root.

**Fields need a selected node.** A node's inputs, selects and toggles respond only while the node is selected. On any other node a tap, even one right on a field, selects the node, and the next tap edits. Connection dots work either way. Their touch areas are generous (18 px dots), and reach outward, away from the node.

**Ghosts.** When zoomed in, connected nodes that are off screen appear as small chips on the screen edge nearest to them, with an arrow and the node's name. With a node selected, the chips are its connections; otherwise they're the far ends of wires that start on screen (up to 5, or 3 on phones; a selected node shows up to 8). Tapping one pans there (`goToNode`). They live in `.nm-ghosts` and are styled by `.nm-ghost[data-side]`.

Bottom sheets (the add menu and the Edit sheet) open in an overlay layer over the whole page, `.nm-root.nm-overlay` on `<body>` (or inside the shadow root), so on phones they can rise to near the top of the screen. The overlay copies the editor's resolved colours and fonts, and is removed when the sheet closes.

## `EditorOptions`

| Option | Default | |
| --- | --- | --- |
| `graph` | required | `Graph` |
| `registry` | required | `Registry` |
| `evaluator` | none | When given, results show live and the evaluator re-runs on edits. |
| `toolbar` | `true` | Delete, edit, duplicate, undo, redo, tidy, fit and add. On screens narrower than 520 px it spans the width and its buttons share it. |
| `history` | `true` | Undo and redo. |
| `minZoom`, `maxZoom` | `0.2`, `2.5` | |
| `longPressMs` | `450` | Long-press time before the add sheet opens. |
| `overviewZoom` | `0.6` | Below this zoom the map is an overview: tapping a node (even on a field or port) zooms in on it instead of editing. `0` turns it off. |
| `wires` | `'smart'` | `'smart'` (routed around nodes) or `'curved'`. |
| `direction` | `'auto'` | `'LR'` (left to right), `'TB'` (top to bottom: inputs on the top edge, outputs on the bottom, wires run down) or `'auto'` (top to bottom on narrow portrait screens, else left to right; follows rotation). A graph type can set it with `editor.direction`. Top to bottom, ports with no editor or value lose their row (their label sits beside the dot), and nodes with four or more ports on an edge label only linked ports until selected. |
| `layout` | `layered()` | Engine used by `autoLayout()`. |
| `edgeStyle` | none | `(edge, graph) => EdgeStyle`: per-wire arrows, dash, colour, class and label, on top of the port type's style. A graph type sets it with `editor.edgeStyle`. See [Wires](#wires-layers-and-pulses). |
| `readOnly` | `false` | View only: no adding, deleting, wiring, moving or editing, and the toolbar keeps only Tidy and Fit. Panning, zooming, selecting, details cards, links (`data-nm-open`) and expanders still work. Image viewers marked `data-nm-view` still open. Dragging a node pans. |
| `plugins` | none | `EditorPlugin`s to install, as well as those from the registry's packs. See [graph types](graph-types.md#editorplugin). |
| `views` | none | Tabs, each showing some node types as a grid, in rows or as a flow. See [Views](#views). A graph type sets them with `editor.views`. |
| `placement` | `true` | Place new and dropped nodes in free space; push nodes aside. |
| `theme` | page colours | A theme id or object, or `{ light, dark }`. See [themes](themes.md). |

## Properties

`root`, `graph`, `registry`, `evaluator`, `history`, `viewport` (`{ x, y, k }`), `selection` (`{ node?, edge? }`), `wireMode`, `theme`, `isOverview` (zoomed out below `overviewZoom`; the root also gets the `nm-overview` class).

## Methods

| Method | |
| --- | --- |
| `addNode(type, at?, connectFrom?)` | Add a node. With `connectFrom` (an `Anchor`: `{ node, port, dir }`), wire it and place it beside, making room. |
| `spliceNode(type, edgeId)` | Insert a node into a wire; downstream nodes shift right. |
| `openAddSheet()` | What **+** does: a tapped port, then a selected wire or node, then a free node. |
| `openPalette(at?, connectFrom?, { around?, splice? })` / `closePalette()` | The add sheet, directly. |
| `suggestConnection(nodeId)` | Which side and port a new node should attach to. |
| `select({ node?, edge? })` / `deleteSelection()` / `duplicateSelection()` | |
| `openNodeEditor(nodeId)` | A full-size Edit sheet: name, every param (advanced ones too), values of unconnected inputs, Duplicate and Delete. Opened by double-tapping a node, the toolbar pencil, or E / Enter. |
| `showDetails(nodeId)` / `hideDetails()` | A node type's `details()` card (code, actions). Tapping such a node calls it. |
| `autoLayout({ animate?, fit?, maxWidth? })` | Tidy in the current flow, as one roomy flow (never wrapped unless you pass `maxWidth`). Records the flow in `graph.meta.flow`; a map arranged for the other flow is tidied automatically when it opens. |
| `setLayout(engine)` / `setWires(style)` / `setTheme(theme \| null)` | |
| `fit({ padding?, minScale? })` | `minScale` (default 0.6) keeps text readable; pass `0` to show everything. |
| `panIntoView(id)` | Glide (keeping the zoom) so a node is fully on screen; one bigger than the screen shows from its top. Selecting a node with a tap does this. |
| `goToNode(id)` | Pan (keeping the zoom) so a node is centred, and select it. What tapping a ghost does. |
| `renderGhosts()` | Redraw the edge ghosts now (they redraw by themselves on pan, zoom, edits and selection). |
| `zoomToNode(id, { animate?, zoom? })` | Centre a node at a comfortable zoom (100%, or smaller if it wouldn't fit). |
| `zoomAt(factor, cx?, cy?)` / `setViewport({ x?, y?, k? })` / `screenToWorld(cx, cy)` / `ensureVisible(id)` | |
| `layoutInput()` | What layout engines receive. |
| `setDirection('auto' \| 'LR' \| 'TB')` / `flow` | Change, or read, which way the map flows. Ports move to the matching edges, wires re-route and the map is tidied. |
| `notify(message)` | A short toast. |
| `destroy()` | Removes everything and unsubscribes. |

## Events

`editor.on(name, fn)`:

- `select` `{ node?, edge? }`;
- `viewport` `{ x, y, k }`;
- `error` (the message shown in the toast);
- `theme` (the `Theme`);
- `details` `{ node }`;
- `view` `{ id }` (the shown view changed);
- `enter` / `leave` `{ node }` (a node's inner map opened or closed);
- `route` `{ edges }` (these wires were redrawn or re-routed: redraw anything tied to their shape).

## Wires, layers and pulses

For plugins that draw on or along the map. Use these rather than the editor's internal elements.

| Method | |
| --- | --- |
| `edgePath(id)` | A wire's SVG path (`d`) in map coordinates, as last drawn. |
| `edgePointAt(id, t)` | The point a fraction `t` (0–1) of the way along a wire, in map coordinates. |
| `addLayer({ position?, svg?, className? })` | An element (a `div`, or an `svg` with `svg: true`) that pans and zooms with the map. `below` puts it under the wires and nodes; `above` (the default) puts it over them. It ignores taps unless you set `pointer-events` on what you put in it. Remove it with `.remove()`. |
| `pulse(id, { color?, reverse?, ms?, size? })` | Send a dot along a wire (default 900 ms, in the wire's colour). `reverse` runs it from the input end back. Resolves when the dot arrives. |
| `refreshEdges(ids?)` | Re-apply wire styles after the data an `edgeStyle` reads changes. A node's wires restyle by themselves when its params change. |
| `setReadOnly(on)` / `readOnly` | Switch view-only mode, or read it. |

`EdgeStyle` is `{ start?, end?, dash?, color?, className?, label? }`. Markers are the port types' (`arrow`, `triangle`, `triangle-filled`, `diamond`, `diamond-filled`, `circle`), and `'none'` removes one the port type would draw. `className` goes on the wire's group. `label` is drawn by the editor at the wire's midpoint, in the wire's colour, and follows it as it re-routes. The `route` event tells you when wires change shape.

## Plugins and nested maps

| Method | |
| --- | --- |
| `addToolbarButton({ id, label, icon, run, primary? })` | Add a toolbar button before +. `icon` is an `<svg>` string, an emoji or short text. Returns a function that removes it. |
| `enterNode(id)` | Open the map inside a node (`NodeType.subgraph`) in a layer over this one, with a Back bar. Its Input nodes get the node's live input values, and it re-runs when they change. With `save`, edits are saved after a short pause: every node of that type is rebuilt and re-run, and a map that can't compile is refused with a message. Escape or Back closes it, and inner maps can be opened in turn. Returns the inner `NodeEditor`. |
| `leaveNode()` / `innerEditor` | Close the inner map, or reach its editor. |
| `choose({ title, placeholder?, items })` | A searchable list in a bottom sheet, above anything else open (the Edit sheet too). Items are `{ id, label, hint?, image? }` (`image` shows a thumbnail); the search matches labels and hints, ignoring accents. Enter picks the first match and Escape or the backdrop closes it. Resolves with the picked id or `undefined`. Param controls get it as `ctx.choose`. |

## Views

With `views`, the editor is a set of boards instead of one canvas. A tab bar runs across the top, one tab per view with a count of its nodes, and each view shows only its node types. Graph types set views in `editor.views`:

```ts
views: [
  { id: 'shots', title: 'Shots', types: ['drama2/shot'], layout: 'grid', order: (g) => [...shotIdsInStoryOrder] },
  { id: 'scenes', title: 'Scenes', types: ['drama2/scene'], layout: 'rows', rows: (g) => sceneIds.map((id) => [id]) },
]
```

| `EditorView` field | |
| --- | --- |
| `id`, `title` | The tab. |
| `types` | Node types shown in the view and offered by its + button. |
| `layout` | `'grid'`: cards in the number of columns that makes the whole grid, zoomed out, fill the screen best. The count is chosen when the view opens, is tidied, the screen changes size or cards are added or removed, and kept while cards are edited. The view opens zoomed out to show it all; tap a card to zoom in. `'rows'`: one row per group, its first card heading the row. `'flow'` (default): the usual layered layout. Or your own function `(nodes, { graph, width }) => positions` (`ViewLayout`). |
| `rows(graph)` | Rows layout: node ids per row, in order. Nodes left out go in a last row. |
| `order(graph)` | Grid layout: node ids in order (default: by `types`, then as added). |
| `groups(graph)` | Grid layout in boxes: `[{ id, title, subtitle?, nodes, open?, color? }]` (`ViewGroup`). Each group's cards in rows inside a box with a header (tap it to open `open`, on its own tab); the same column count for every box. A card in several groups shows in each: a faded copy after the first, which goes to the card. Cards in no group go in a last box. |
| `onAdd(node, { graph, selected })` | After + adds a node in this view, link it to what was selected (a shot to the selected scene), number it, and so on. |

Grid and rows views lay themselves out:
- after nodes are added or removed, params change or cards change size;
- after cards change size.

Cards in grid and rows views don't move: dragging one pans the view, so the map is easy to grab on a phone even when zoomed in on a card. Taps still select (or, zoomed out, zoom in).

Tidy re-runs the layout and returns to the top-left. Fit fits the view's own nodes.

**Links.** Any element inside a node or a sheet with `data-nm-open="<node id>"` jumps to that node. The editor switches to a view that shows it (the current one when it can), centres it and selects it, and a **← Back** button appears in the tab bar. Such links, and elements marked `data-nm-live`, work before their node is selected. All other controls in an unselected node stay inert.

| Method | |
| --- | --- |
| `setView(id, { home? })` / `currentView` | Show a view, or read which one is shown. |
| `openNode(id)` | Jump to a node, switching view when needed (what links do). |
| `back()` | Return to the view and node before the last jump. |
| `layoutView({ animate?, home? })` | Lay the current grid or rows view out now. |

## Gestures and keys

| | Touch | Mouse and keyboard |
| --- | --- | --- |
| Pan, zoom | drag the background, pinch | drag, two-finger scroll, ctrl/⌘ + wheel |
| Connect | drag port → port, or tap port then port or node | same |
| Add | long-press, **+** | **+**, A, Space |
| Add connected | select a node, port or wire, then **+** | same |
| Zoom in on a node | tap it while zoomed out (below `overviewZoom`) | click it while zoomed out |
| Go to a connected node off screen | tap its ghost on the screen edge | click the ghost |
| Edit a node's fields | tap the node to select it, then tap the field | same |
| Edit a node | double-tap it, or select it and tap the pencil | double-click, or select and press E / Enter |
| Details | tap a node that has `details` | click |
| Undo, redo | toolbar | ⌘Z, ⌘⇧Z or ⌘Y |
| Other | toolbar | Delete, ⌘D, F (fit), L (tidy), Esc |

## Styles

- `css` is the stylesheet string; `injectStyles(root)` adds it to a document or shadow root.
- CSS variables (`--nm-*`) are listed under [themes](themes.md#css-variables).
- Node elements carry `data-id`, `data-flavor` and `data-status`. Ports carry `data-dir`, `data-port` and `data-type`.
