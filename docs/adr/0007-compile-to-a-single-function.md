# 0007. Compile a map to a single function

- Status: Accepted (supersedes the evaluator-backed `compile` of the first release)
- Date: 2026-11-24

## Context

A map is only useful outside the editor if it can be called like code. The first `compile()` wrapped an `Evaluator` and attached metadata properties, which dragged editor-oriented machinery (caching, events) into callers and returned something that was more than a function.

## Decision

- `compile(graph, registry, name?)` returns **one plain async function**: `(inputs?, { signal? }) => Promise<outputs>`.
  - It composes the nodes' `run` functions directly from a precomputed plan: no evaluator, no events, no cache.
  - It has a meaningful `name` and no extra properties.
  - Failures throw `NodeRunError` naming the node.
- `compileFunction()` does the same for maps with exactly one output and returns that value directly.
- `signature(graph)` describes inputs and outputs separately, so the function stays a function.
- `emitSource(graph, registry, { name, lang, single })` emits the **source of one standalone JS/TS function**:
  - Nodes with an `emit` hook are inlined as plain expressions.
  - Others are called through the `NodeRunner` port.
  - A map built only from inlinable nodes needs no runtime at all.
- `plan()` and `execute()` are shared by `compile`, `dataflowEngine` and the code generator.

## Consequences

- Compiled maps can be passed anywhere a function is expected, and exported as reviewable code.
- Node authors who want zero-runtime export write an `emit` hook. This is optional.
- Breaking change: `compile(...).inputs` and `.outputs` are gone; use `signature()`.
