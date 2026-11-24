# Editor

`import { NodeEditor } from 'mobile-nodemap/editor'`

The touch-first DOM editor. It is the `domEditor` [render adapter](ports-and-adapters.md).

```ts
const editor = new NodeEditor(container: HTMLElement, options: EditorOptions);
```

Give `container` a size. The editor adds `.nm-root`, makes it focusable and injects its stylesheet once per document or shadow root.

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
| `layout` | `layered()` | Engine used by `autoLayout()`. |
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
| `autoLayout({ animate?, fit?, maxWidth? })` | Tidy. On narrow portrait screens `maxWidth` defaults to fit at a readable zoom. |
| `setLayout(engine)` / `setWires(style)` / `setTheme(theme \| null)` | |
| `fit({ padding?, minScale? })` | `minScale` (default 0.6) keeps text readable; pass `0` to show everything. |
| `zoomToNode(id, { animate?, zoom? })` | Centre a node at a comfortable zoom (100%, or smaller if it wouldn't fit). |
| `zoomAt(factor, cx?, cy?)` / `setViewport({ x?, y?, k? })` / `screenToWorld(cx, cy)` / `ensureVisible(id)` | |
| `layoutInput()` / `suggestedMaxWidth()` | What layout engines receive. |
| `notify(message)` | A short toast. |
| `destroy()` | Removes everything and unsubscribes. |

## Events

`editor.on(name, fn)`:

- `select` `{ node?, edge? }`;
- `viewport` `{ x, y, k }`;
- `error` (the message shown in the toast);
- `theme` (the `Theme`);
- `details` `{ node }`.

## Gestures and keys

| | Touch | Mouse and keyboard |
| --- | --- | --- |
| Pan, zoom | drag the background, pinch | drag, two-finger scroll, ctrl/⌘ + wheel |
| Connect | drag port → port, or tap port then port or node | same |
| Add | long-press, **+** | **+**, A, Space |
| Add connected | select a node, port or wire, then **+** | same |
| Zoom in on a node | tap it while zoomed out (below `overviewZoom`) | click it while zoomed out |
| Edit a node | double-tap it, or select it and tap the pencil | double-click, or select and press E / Enter |
| Details | tap a node that has `details` | click |
| Undo, redo | toolbar | ⌘Z, ⌘⇧Z or ⌘Y |
| Other | toolbar | Delete, ⌘D, F (fit), L (tidy), Esc |

## Styles

- `css` is the stylesheet string; `injectStyles(root)` adds it to a document or shadow root.
- CSS variables (`--nm-*`) are listed under [themes](themes.md#css-variables).
- Node elements carry `data-id`, `data-flavor` and `data-status`. Ports carry `data-dir`, `data-port` and `data-type`.
