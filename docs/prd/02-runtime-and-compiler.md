# 02. Runtime and compiler

## Problem

Maps must produce results live while editing, and must also run outside the editor: in tests, on servers, or as exported code.

## Goals

- Live, incremental, cancellable evaluation in the editor.
- One plain function per map for programmatic use (ADR 0007).
- Exportable source for review, versioning or running without the library.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| R1 | `Evaluator.run()` / `live()`: parallel async branches, memoised per node, aborts stale runs | Shipped |
| R2 | Errors mark the node and skip downstream nodes; the report lists them | Shipped |
| R3 | `multiple` inputs collect every wire, top to bottom; port types coerce values | Shipped |
| R4 | `compile(graph, registry)` returns a single async function with no extra properties | Shipped |
| R5 | `compileFunction()` for single-output maps returns the value directly | Shipped |
| R6 | `signature(graph)` lists inputs (with types and defaults) and outputs | Shipped |
| R7 | `emitSource()` emits one JS/TS function: nodes with `emit` are inlined, others go through `NodeRunner` | Shipped |
| R8 | `NodeRunError` names the failing node | Shipped |
| R9 | Graph types may replace dataflow with an engine (`GraphEngine`) | Shipped |

## Open questions

- Streaming or reactive outputs (observables) for nodes that emit over time.
- Web Worker execution for heavy maps.
- Source maps from generated code back to node ids.
