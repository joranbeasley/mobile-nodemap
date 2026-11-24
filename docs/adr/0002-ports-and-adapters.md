# 0002. Ports and adapters around a DOM-free core

- Status: Accepted
- Date: 2026-11-24

## Context

The same node map has to work in very different places: a phone browser, a React app, a plain HTML page through a custom element, a Node.js service, and generated code with no library at all. Layout, storage and execution also need to be swappable: ELK or our own layout, localStorage or a server, dataflow or a network analysis. If the core imports any one of these, every other host pays for it.

## Decision

We use a hexagonal (ports and adapters) architecture.

- **Core** (`src/core`, `src/runtime`): the graph model (`Graph`), the definitions (`Registry`, `NodeType`) and the compiler. It has no DOM access and no dependencies.
- **Ports** (`src/ports`) are the standard interfaces the core exposes or needs:
  - `GraphPort`: the standard graph interface. `Graph` implements it.
  - `NodeDefinition`: the standard node interface (`NodeType`).
  - Driving ports: `CompilerPort` (compile, emit) and `RenderPort` (a UI that mounts a session).
  - Driven ports: `EnginePort` (how a map runs), `StoragePort` (where maps live), `LayoutEnginePort`, `RouterPort`, and `NodeRunner` (how generated code calls nodes).
- **Adapters** (`src/adapters` and the feature folders) implement ports. Examples: `NodeEditor` / `domEditor`, `<NodeMap>`, `<node-map>`, `dataflowEngine`, `networkEngine`, `layered()`, `elkLayout()`, `Router`, `memoryStore()`, `localStorageStore()` and `registryRunner()`.

Adapters depend on ports, never on each other. A new host is a new adapter.

## Consequences

- The core runs in Node and tests without a browser (`dist/core` and `dist/runtime` import cleanly).
- Generated code depends on one tiny interface, `NodeRunner`, or on nothing at all (see 0007).
- Every swappable concern has exactly one interface to learn.
- There is some indirection. For example, `EnginePort` is an alias of `GraphEngine` so the names line up across docs.

## Alternatives considered

- **A framework-first library** (React components as the core), as several existing node editors do. Rejected: it ties every host to React and to desktop assumptions.
- **No formal ports, just exports.** Rejected: third parties then couple to internals, and swapping a concern means forking.
