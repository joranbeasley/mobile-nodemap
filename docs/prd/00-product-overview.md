# 00. Product overview

## Problem

Visual node editors are powerful for expressing computations, pipelines and systems, but the good ones are desktop-bound: mouse-only gestures, tiny targets, and layouts that assume a wide screen. They are also usually closed. Adding a domain (networks, colour, audio) means forking the editor or settling for generic nodes.

## Vision

A node map library that is pleasant on a phone first, open to anyone who wants to add a domain, and whose maps are real code: callable, exportable and testable.

## Users

| User | Needs |
| --- | --- |
| **End user** building a map | Build, wire and tidy maps with a thumb; see results live; reuse their own nodes |
| **App developer** embedding the editor | Drop it into React or plain HTML, theme it, store maps, run them server-side |
| **Pack author** in the ecosystem | Ship nodes, value types, editors and engines for a domain, without patching the core |

## Principles

1. **Touch is primary**. Every action works with one finger; nothing depends on hover.
2. **Built-ins are plug-ins**. Math, network and function maps use the same public API as third parties.
3. **A map is a function**. Compiling yields one plain function, or its source.
4. **The core has no DOM and no dependencies**. Hosts are adapters (ADR 0002, 0010).
5. **Arrange it for me**. Layout, placement and routing are automatic and good enough that people rarely drag.

## Scope

In scope:

- the editor, with gestures, add menus, undo, themes, layout and routing;
- runtime execution, compilation and code export;
- the extension API (graph types, packs, node types, engines, themes);
- React and custom-element integrations;
- a function builder and a node library;
- docs and a demo.

Out of scope for now: real-time collaboration, server persistence products, and a hosted marketplace (packs are npm packages).

## Success measures

- A new user builds and runs a three-node map on a phone in under a minute, without instructions.
- A pack author ships a working pack (port type, param editor, three nodes) in under 200 lines. The demo's Palette pack is about 200.
- Compiled maps match editor results (enforced by tests) and export as a single readable function.
- No runtime dependencies; the core runs in Node.
