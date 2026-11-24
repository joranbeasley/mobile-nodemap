# 0004. Dataflow evaluation with memoisation and cancellation

- Status: Accepted
- Date: 2026-11-24

## Context

Maps are edited live. Every slider drag changes a param, and results should update while the finger moves. Some nodes are async (timers, fetches), and some are slow.

## Decision

The default engine is dataflow:

- Nodes are topologically sorted. Each node starts as soon as its inputs resolve, so independent async branches run in parallel.
- Each node's result is memoised on its params and on the identity of its input values. A node re-runs only when one of those changes; `pure: false` opts out.
- Starting a run aborts the previous one through `ctx.signal`. Stale results are never shown.
- An error marks its node and skips everything downstream with a clear status.
- `multiple: true` inputs receive every wire's value, ordered by the source nodes' vertical position (what people see).

A graph type can replace this entirely with its own engine (see 0006). `dataflowEngine` is the same behaviour without memoisation, packaged as an engine adapter.

## Consequences

- Dragging a slider re-runs only the affected subgraph ("1/7 ran").
- Memoising on value identity means nodes must not mutate their inputs.
- Cycles are not allowed in dataflow maps. Graph types that need loops (networks) bring their own engine.
