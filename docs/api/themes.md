# Themes

`import { defineTheme, registerTheme, getTheme, listThemes, themeCss, flavorOf } from 'mobile-nodemap'`

## Using a theme

```ts
new NodeEditor(el, { graph, registry, theme: 'midnight' });
editor.setTheme('paper');
editor.setTheme({ light: 'paper', dark: 'graphite' });   // follows the system setting
editor.setTheme(null);                                    // page colours
```

Also available as `<node-map theme="synthwave">` and `<NodeMap theme="mint" />`.

## Built-in themes

| Export / id | Mode | Header style | Notes |
| --- | --- | --- | --- |
| `daylight` | light | tint | the default palette |
| `paper` | light | line | serif text, square corners, colours nodes by flavor |
| `mint` | light | solid | rounded corners, colours nodes by flavor |
| `midnight` | dark | tint | the default dark palette |
| `graphite` | dark | line | monochrome, square corners |
| `synthwave` | dark | solid | neon |

`builtinThemes` lists all six.

## `Theme`

```ts
interface Theme {
  id: string; name: string; mode: 'light' | 'dark';
  colors: { bg, dot, node, node2, border, text, muted, accent, wire, danger, ok, number, string, boolean, list, any };
  flavors: { source, transform, sink, view, control, ...custom };   // colours
  header?: 'tint' | 'solid' | 'line';
  radius?: number; shadow?: string; font?: string; mono?: string;
  nodeColors?: boolean;   // default true: a node type's own colour beats its flavor colour
}
```

| Function | |
| --- | --- |
| `defineTheme(t)` | Identity helper, for typing. |
| `registerTheme(t)` / `getTheme(id)` / `listThemes()` | |
| `themeCss(t)` | The theme's CSS, scoped to `.nm-root[data-nm-theme="<id>"]`. The editor injects it. |

## Flavors

`flavorOf(def, inputs, outputs)` decides a node's role:

1. the node type's `flavor`, if set;
2. `view` if it has a view and no outputs;
3. `source` if it has no inputs;
4. `sink` if it has no outputs;
5. `control` if its category matches logic, async, control or flow;
6. otherwise `transform`.

The editor gives each flavor a silhouette:

| Flavor | Silhouette |
| --- | --- |
| `source` | rounded leading edge |
| `sink` | rounded trailing edge |
| `view` | halo |
| `control` | dashed border |
| `transform` | plain |

Themes colour each flavor; a custom flavor name gets its colour from `flavors[name]`.

## CSS variables

Without a theme, set these on `.nm-root`, any ancestor or `<node-map>`:

| Group | Variables |
| --- | --- |
| Surfaces and text | `--nm-bg`, `--nm-dot`, `--nm-node`, `--nm-node-2`, `--nm-border`, `--nm-text`, `--nm-muted` |
| Accents and status | `--nm-accent`, `--nm-wire`, `--nm-danger`, `--nm-ok` |
| Shape and type | `--nm-shadow`, `--nm-radius`, `--nm-font`, `--nm-mono` |
| Port colours | `--nm-t-number`, `--nm-t-string`, `--nm-t-boolean`, `--nm-t-list`, `--nm-t-any` |
| Flavor colours | `--nm-f-source`, `--nm-f-transform`, `--nm-f-sink`, `--nm-f-view`, `--nm-f-control` |

`data-theme="light" | "dark"` on the container picks the default palette's mode.
