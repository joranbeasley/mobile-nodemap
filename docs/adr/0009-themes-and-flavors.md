# 0009. Themes as data; node flavors

- Status: Accepted
- Date: 2026-11-24

## Context

The editor is embedded in many products, each with its own look and light or dark preference. Zoomed out on a phone, colour and silhouette are the only cues for what a node does.

## Decision

- **Themes are plain objects** (`defineTheme`): colours, flavor colours, header style (`tint` | `solid` | `line`), corner radius, shadow, fonts, and whether node types' own colours are kept.
  - `themeCss()` turns a theme into CSS custom properties scoped to `.nm-root[data-nm-theme]`.
  - Six themes ship: Daylight, Paper and Mint (light); Midnight, Graphite and Synthwave (dark).
  - `editor.setTheme(id | theme | { light, dark })` applies one. The pair form follows the system setting.
  - Without a theme, the editor follows the host page's `--nm-*` variables and `prefers-color-scheme`.
- **Every node has a flavor**: `source`, `transform`, `sink`, `view`, `control`, or a pack's own name. It is inferred from the ports when not declared.
  - Themes colour flavors.
  - The editor gives each a silhouette: a rounded leading edge for sources, a trailing edge for sinks, a halo for views, and dashed borders for control.
- All colours go through private variables (`--_x: var(--nm-x, default)`), so themes, page variables and shadow DOM all compose.

## Consequences

- Hosts can theme with CSS alone, or ship a theme object in a pack.
- Flavor shapes are fixed in the editor; themes only colour them. A theme cannot invent new silhouettes.
