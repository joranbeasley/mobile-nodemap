# 04. Function builder and node library

## Problem

People repeat the same sub-maps. They want to package one as a node, reuse it elsewhere and share it, without writing code.

## Goals

- A canvas where the map is a function: Inputs are arguments and exactly one Output is the result (ADR 0008).
- One action compiles it into a node type and adds it to a library.
- Library nodes appear in other graph types' add menus and can be exported as code.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| F1 | `functionGraph`: Input leaves are arguments (top to bottom); exactly one Output | Shipped |
| F2 | A second Output is hidden from the add menu and refused by the API | Shipped |
| F3 | Live validation: missing or unconnected output, invalid or duplicate input names, unused nodes, constant leaves | Shipped |
| F4 | `compileNode()` builds a `NodeType` (typed inputs, single typed output, compiled `run`) and refuses invalid maps | Shipped |
| F5 | `NodeLibrary`: add, replace, remove, `toPack()`, `source()`, JSON in and out, change events | Shipped |
| F6 | Persistence through `StoragePort` (`localStorageStore`, `memoryStore`, or a custom adapter) | Shipped |
| F7 | Demo: a Build panel with checks, signature, name, "Add to library", generated TypeScript and the library list | Shipped |

## UX

The status line shows the first problem, or "ready · 2 inputs → 1 output". The Build panel lists every check with ✓, ! or ✕. The generated code updates as you edit.

## Open questions

- Editing a library node opens its map again ("open definition").
- Versioning library entries, and updating maps that use an older version.
- Sharing libraries via URL or file import and export in the demo.
