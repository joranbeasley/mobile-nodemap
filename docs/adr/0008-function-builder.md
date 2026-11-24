# 0008. Function builder: Input leaves, exactly one Output

- Status: Accepted
- Date: 2026-11-24

## Context

People want to build their own nodes visually, then reuse them in other maps and share them. A node is a function: some arguments, one result. A general map can have any number of outputs and constants anywhere, which does not map cleanly to a node.

## Decision

`functionGraph` is a graph type for building nodes:

- **Input** nodes (leaves) are the arguments, ordered top to bottom. Other leaves are constants, and the validator says so.
- Exactly **one Output** node is required. `rules.canAddNode` hides a second one from the add menu and refuses it in the API. `rules.validate` reports:
  - a missing output;
  - an unconnected output;
  - invalid or duplicate input names;
  - nodes that do not affect the output.
- `compileNode(graph, registry, meta)` turns a valid map into a `NodeType`: Inputs become its inputs, the Output becomes its single output (with the inferred type), and `run` is the compiled function. It refuses maps with errors.
- `NodeLibrary` stores entries as plain JSON (meta plus graph).
  - `toPack()` compiles them into any registry; entries may use earlier entries.
  - `source(type)` emits a single TypeScript function.
  - Persistence goes through `StoragePort`.

## Consequences

- Building, validating, compiling, sharing and exporting are one flow, on a phone.
- Library entries are recompiled against the registry they are installed into, so they pick up fixes to the nodes they use. If a node they depend on disappears, the entry is skipped with a warning.
- Recursion (a library node using itself) is not supported.
