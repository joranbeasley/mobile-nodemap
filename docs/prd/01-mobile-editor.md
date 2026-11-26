# 01. Mobile-first editor

## Problem

Wiring nodes on a phone with desktop editors means mis-taps, accidental zooms and hunting for 8 px ports.

## Goals

- Every editing action works with touch, and works equally well with a mouse or keyboard.
- People rarely have to place nodes or route wires by hand.
- Results show on the nodes as they edit.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| E1 | Pan by dragging the background, pinch to zoom, trackpad and wheel on desktop | Shipped |
| E2 | Move nodes by dragging anywhere on them except their controls | Shipped |
| E3 | Connect by dragging port to port, or by tapping a port then a port or node | Shipped |
| E4 | Ports have 44 px touch targets; compatible ports highlight while connecting | Shipped |
| E5 | Long-press or **+** opens a bottom-sheet add menu with search, filtered to compatible nodes when connecting | Shipped |
| E6 | **+** with a node, port or wire selected adds a connected node on the right side, or inserts it into the wire | Shipped |
| E7 | Dropping a wire on empty space opens the add menu and connects the new node | Shipped |
| E8 | Undo and redo, delete, duplicate, tidy and fit, from a toolbar within thumb reach | Shipped |
| E9 | Inline editors for unconnected primitive inputs; 16 px fields so iOS does not zoom | Shipped |
| E10 | `advanced` params fold behind "More" to keep nodes short | Shipped |
| E11 | Keyboard: Delete, ⌘Z / ⌘⇧Z, ⌘D, A or Space to add, F to fit, L to tidy, Esc | Shipped |
| E12 | Live results, errors and running state on each node; custom previews via `view` | Shipped |
| E13 | Every node can be edited in a full-size sheet (double-tap, toolbar pencil, or E / Enter): name, all params including advanced ones, unconnected input values, Duplicate and Delete | Shipped |
| E14 | Any node can be renamed; the name is saved in the map and undoable | Shipped |
| E16 | When zoomed in, connected nodes that are off screen show as ghost chips on the nearest screen edge; tapping one pans to that node and selects it | Shipped |
| E17 | A node's fields only respond once the node is selected; the first tap on a node (even on a field) selects it | Shipped |
| E18 | Connection dots are 18 px with touch areas that reach outward from the node, so they're easy to hit without stealing taps from the header | Shipped |
| E15 | When zoomed out (below the readable zoom, 60% by default), tapping a node never edits its fields or starts a wire: it zooms in on that node and selects it | Shipped |
| E19 | Views: graph types can make the editor a set of tabs, each showing some node types as a grid (shaped to fill the screen when zoomed out), in rows, or with their own layout | Shipped |
| E20 | Links: chips and list entries jump to a node, switching tab when needed; ← Back returns. They work before their card is selected | Shipped |
| E21 | Nodes made of maps open in place (↘) on their live inputs, with Back and Escape; edits can recompile the node type | Shipped |
| E22 | Long reference lists open a searchable chooser (a bottom sheet above any other sheet) | Shipped |
| E23 | Params can show only when they apply (`when`); the card and the Edit sheet follow | Shipped |
| E24 | The Edit sheet stays in step with changes made elsewhere (the card, undo, the API), custom controls included | Shipped |
| E25 | View-only mode: everything can be looked at and nothing changed | Shipped |

## UX notes

- Taps are ignored for 350 ms after the add sheet opens, so the lifting finger cannot pick an item.
- A tapped port shows a banner, "Tap an input, or + for a new node", with Cancel.
- Invalid connections explain themselves in a toast ("Type mismatch: string → number", "Connect devices to the internet through a router").

## Open questions

- Multi-select (lasso) on touch: two-finger box, or a select mode?
- Grouping and collapsing subgraphs into frames.
- Accessibility of the canvas for screen readers beyond labelled controls: an outline view?
