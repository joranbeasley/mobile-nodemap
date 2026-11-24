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

## UX notes

- Taps are ignored for 350 ms after the add sheet opens, so the lifting finger cannot pick an item.
- A tapped port shows a banner, "Tap an input, or + for a new node", with Cancel.
- Invalid connections explain themselves in a toast ("Type mismatch: string → number", "Connect devices to the internet through a router").

## Open questions

- Multi-select (lasso) on touch: two-finger box, or a select mode?
- Grouping and collapsing subgraphs into frames.
- Accessibility of the canvas for screen readers beyond labelled controls: an outline view?
