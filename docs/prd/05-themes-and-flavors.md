# 05. Themes and node flavors

## Problem

Embedders need the editor to match their product, in light or dark. On a small screen, people need to tell node roles apart at a glance.

## Goals

- A few good light and dark themes out of the box, and themes as plain data anyone can write (ADR 0009).
- Every node carries a flavor that themes colour and the editor shapes.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| T1 | Six built-in themes: Daylight, Paper, Mint (light); Midnight, Graphite, Synthwave (dark) | Shipped |
| T2 | `defineTheme` / `registerTheme`: colours, flavor colours, header style, radius, shadow, fonts, `nodeColors` | Shipped |
| T3 | `editor.setTheme(id \| theme \| { light, dark } \| null)`; the pair follows the system setting | Shipped |
| T4 | `<node-map theme="midnight">` and `<NodeMap theme="paper" />` | Shipped |
| T5 | Flavors `source`, `transform`, `sink`, `view` and `control`, inferred or declared; packs may add their own | Shipped |
| T6 | Distinct silhouettes per flavor, legible zoomed out | Shipped |
| T7 | Without a theme, the editor follows the page's `--nm-*` variables and colour scheme | Shipped |

## Open questions

- High-contrast and colour-blind-safe themes, with automated contrast checks.
- Per-theme port shapes for colour-blind users (port type, not only colour).
