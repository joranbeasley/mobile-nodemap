# 0010. No runtime dependencies

- Status: Accepted
- Date: 2026-11-24

## Context

Node editors are often embedded in larger apps where bundle size and supply-chain risk matter. Mobile users pay for every kilobyte.

## Decision

The library has no runtime dependencies. React, react-dom and elkjs are optional peer dependencies, used only by the `react` entry point and the `elkLayout` adapter respectively. Everything else (layout, routing, evaluation, compilation, theming and the editor) is in-house and tree-shakeable through subpath exports.

## Consequences

- A modest footprint: the full IIFE bundle (editor, layout, router, runtime, three graph types and six themes) is about 125 KB minified, about 40 KB gzipped. Subpath imports shrink it further.
- We own the maintenance of the layout, routing and editor code.
- Tests cover these pieces directly (`test/layout.test.ts` and the browser checks).
