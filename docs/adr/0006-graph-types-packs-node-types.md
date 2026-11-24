# 0006. Graph types, packs and node types as the extension model

- Status: Accepted
- Date: 2026-11-24

## Context

We want an ecosystem: unit libraries, shader nodes, home automation, CI pipelines. Each domain needs different nodes, different value types, different editors for params, different connection rules, and sometimes a different meaning of "run". Built-in features must not be privileged over third-party ones.

## Decision

There are three layers, and built-ins use exactly the public API:

1. **Node type** (`defineNode`, `extendNode`). Ports (shorthand `{ a: 'number' }` gives a typed `run`), params, `run`, `view`, `emit`, `flavor`, `icon`, `tags`, `version`/`migrate`, `onCreate`, `meta`.
2. **Pack** (`definePack`). What a library publishes: nodes, plus port types (colour, `accepts`, `coerce`, inline editor), param kinds (custom editors), conversions and CSS.
3. **Graph type** (`defineGraphType`). A kind of map:
   - It can `extend` other graph types and `exclude` nodes by pattern.
   - It adds packs and nodes.
   - It sets `rules`: `allowCycles`, `canConnect`, `canAddNode` and `validate`.
   - It can replace evaluation with an `engine`.
   - It suggests `editor` defaults and ships `examples`.

`registerGraphType` makes a type available by id to saved JSON (`type` field) and to `<node-map graph-type>`. Ids are namespaced (`acme/palette`).

The built-ins are `mathGraph`, `networkGraph` (a custom engine, loops allowed, a connection rule) and `functionGraph` (validate, canAddNode). The demo's Palette graph type is written as a third party would write it.

## Consequences

- One mental model, used by everyone.
- Registries are values: `createRegistry()` builds a fresh one, so composing types never mutates others.
- A pack's CSS and icons are trusted like its code.
