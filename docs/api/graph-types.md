# Graph types and packs

## `defineGraphType(def): GraphType`

A kind of map: which nodes it offers, which wires are legal, and how it runs.

```ts
const lab = defineGraphType({
  id: 'acme/lab', title: 'Lab', description?, icon?,
  extends: [mathGraph, 'network'],     // objects, or ids of registered types
  packs: [unitsPack],
  nodes: [myNode],
  portTypes: [...], paramKinds: [...],
  exclude: ['async/*', 'text/case'],
  rules: { ... },                      // below
  engine: myEngine,                    // replaces dataflow
  editor: { wires: 'smart', autoLayout: true, direction: 'TB' }, // direction: 'auto' | 'LR' | 'TB'
  examples: [{ id, name, description?, graph }],
  setup(registry) { ... },             // last word
});
```

| `GraphType` member | |
| --- | --- |
| `createRegistry()` | A fresh `Registry`: parents first, then port types, param kinds, packs, nodes, `exclude`, rules, engine and `setup`. |
| `extend(def)` | A new graph type based on this one. |
| all `GraphTypeDef` fields | |

## Registering

| Function | |
| --- | --- |
| `registerGraphType(type)` | Make it findable by id: saved JSON, `extends: ['id']` and `<node-map graph-type>`. Returns the type. |
| `getGraphType(id)` / `listGraphTypes()` | |
| `registryFor(json, fallback?)` | The registry for a saved map, from its `type`. Throws for unknown types. |

Built-ins are registered on import: `math`, `network` and `function`.

## Rules

```ts
interface GraphRules {
  allowCycles?: boolean;                                         // default false
  canConnect?(from: ConnectionEnd, to: ConnectionEnd, graph): string | null | void;
  canAddNode?(type: string, graph): string | null | void;       // vetoed types are hidden from the add menu
  validate?(graph): GraphIssue[];
}
interface ConnectionEnd extends PortRef { def: PortDef; nodeType: string }
interface GraphIssue { level: 'error' | 'warning'; message: string; node?: string }
```

## Engines

```ts
interface GraphEngine {
  name?: string;
  callable?: boolean;            // can maps be called as functions? (tools hide "Call" when false)
  run(ctx: EngineContext): Promise<{ outputs?: Record<string, unknown> } | void>;
}
interface EngineContext {
  graph: Graph; registry: Registry; inputs: Record<string, unknown>; signal: AbortSignal;
  publish(nodeId: string, result: NodeResult): void;     // show a node's result in the editor
}
```

`Evaluator` uses `registry.engine` when it is set. The shipped engines are `dataflowEngine` and `networkEngine`.

## `definePack(pack): NodePack`

What a library publishes.

```ts
interface NodePack {
  id: string; title?: string; version?: string;
  nodes?: NodeSpec[];
  portTypes?: PortTypeDef[];
  paramKinds?: ParamKind[];
  conversions?: [from, to][];
  css?: string;                  // injected once per document or shadow root
  setup?(registry): void;
}
```

Install it with `registry.use(pack)`, or list it in a graph type's `packs`.

## Built-in graph types and packs

| Export | id | |
| --- | --- | --- |
| `mathGraph` | `math` | Dataflow; `mathPack` (`nodemap/math`): values, math, logic, text, lists, async, display, graph I/O, constants, remap, sum all, plot function. Conversions number→string and boolean→number. |
| `networkGraph` | `network` | `networkPack` (`nodemap/network`): internet, router, firewall, switch, Wi-Fi access point, server, laptop, phone; port type `link`; `networkEngine`; `allowCycles`; endpoints can't connect straight to the internet. Every device has editable `up`, `ip`, `latency` and `bandwidth`, and a name (`label`). Servers add `kind` (Application, Web, Database, File / NAS, Mail, DNS, Media, Game, Backup, Other: `SERVER_TYPES`), `cores`, `memory` (GB), `storage` (GB) and `os`; laptops and phones add `os`. `deviceSpecs(node)` gives the one-line summary shown on the node. **Data stores** (`net/disk`, `net/database`, `net/cache`, `net/bucket`, `net/queue`; `meta.role: 'data'`; derived from `networkDataStore`) attach to a server's `data` output (port type `data`). They have `up`, `size` / `used` (GB; size 0 = unlimited) and `latency`, plus their own settings: disk type and RAID; database engine and role; cache engine and hit rate; bucket provider and versioning; queue engine, backlog and retention. `validate` warns about bad or duplicate IPv4 addresses (`ipIssues(nodes)`) and data stores not attached to a server. |
| `umlGraph` | `uml` | `umlPack` (`nodemap/uml`): `uml/class` (name = `label`; `abstract`, `attributes`, `methods`), `uml/interface` (`methods`), `uml/enum` (`values`) and `uml/note` (`text`). Relationships are port types with UML wire styles: `uml-generalization` (hollow triangle), `uml-realization` (dashed, hollow triangle), `uml-association` (open arrow), `uml-composition` (filled diamond), `uml-aggregation` (hollow diamond), `uml-dependency` (dashed, open arrow), `uml-note` (dotted); the `referenced` input (`uml-ref`) accepts the reference kinds. Wires run parent → child and owner → part, and the type defaults to `direction: 'TB'`. Rules: a class extends one class, kinds must match, no inheritance cycles (associations may loop); `validate` flags invalid or duplicate type names. `umlEngine` checks that concrete classes implement their interfaces' methods and the abstract methods of their superclasses (counting inherited ones), and flags unused interfaces. `umlToTypeScript(graph, registry, ids?)` exports TypeScript (parents first); each classifier's details card shows its own. `parseUmlMembers(text)` parses lines like `- total(): number`, `{abstract} area(): number`, `static of(n: number): Sq`. |
| `dramaGraph` | `drama` | `dramaPack` (`nodemap/drama`): `drama/location` (name, `setting` INT/EXT, `description`, `images`), `drama/character` (name, `description`, `images`, `actor`), `drama/prop`, `drama/shot` (`number`, `framing`, `description`, `images` frames, `movement`, `duration` s; inputs: one `location`, many `characters` and `props`), `drama/scene` (`number`, `time`, `description`, optional `storyboard` images; many `shots`), `drama/episode` (title = name, `number`, optional `description`, and video `style` / `aspect`; many `scenes`) and `drama/season` (many `episodes`; `style`, `aspect`). A shot belongs to one scene, a scene to one episode, an episode to one season (`canConnect`); a second location replaces the first. `dramaEngine` publishes `outputs.drama` (`{ kind, line, sub?, strip?, warnings }`) per node: where characters, locations and props appear; sluglines (`INT. SCHOOL HALL — DAY`), cast and running times for scenes and episodes; warnings for shots without a location or scene, empty scenes and duplicate scene or episode numbers. The summary has `episodes, scenes, shots, characters, locations, runtime, warnings, summary`. Tapping a scene, episode or season shows its **Seedance script** with **Download pack (.zip)** and **script.md** buttons (see below); `shotList(graph, id?)` gives a plain shot list; tapping a character, location or prop lists its appearances (`appearances(graph, id)`). Also exports `shotInfo`, `sceneInfo`, `episodeInfo`. The **`images`** param kind (`imagesParam`) holds an array of image URLs: thumbnails, tap to view full screen (`openLightbox`), × to remove, + to add photos from the camera or library, shrunk to 1024 px JPEG first (`imageFileToDataUrl`). |
| `functionGraph` | `function` | Extends math. Input leaves are arguments and exactly one Output is required (`canAddNode` and `validate` via `functionIssues`). See [library](library.md). |
| `stdlib` | | The math node types as a plain array (kept for compatibility). |
| `networkDevice` | | The base device node, for `extendNode`. |
| `networkStatusView` | | The device status view, for reuse. |
| `builtinGraphTypes` | | `[mathGraph, networkGraph, functionGraph, umlGraph, dramaGraph]`. |

`umlEngine` publishes `outputs.uml` for each classifier: `{ kind, name, abstract?, attributes, methods, values?, parents, warnings }`, and a summary `{ classes, interfaces, enums, relationships, warnings }`.

`networkEngine` publishes `outputs.status` for each device: `{ state: 'source' | 'online' | 'offline' | 'down' | 'blocking', latency?, hops?, bandwidth?, redundant?, ip?, ipIssue? }`.

Data stores get `{ state: 'available' | 'unavailable' | 'down', hosts, latency, redundant, usage, usedGb, sizeGb, warning? }`:

- **Available** while any attached server is online, reached at that server's latency plus their own. `redundant` means 2+ online servers.
- **Warnings**: 85%+ full, a cache hit rate under 80%, or a queue backlog over 10,000.
- Data attachments don't count as cables for device reachability.

Its summary outputs are `{ online, offline, worstLatency, dataAvailable, dataUnavailable }`.

### Seedance export (drama)

`seedanceScript(graph, id?, opts?)` turns a scene, episode or season (or, with no id, the whole map) into Markdown for [Seedance](https://seed.bytedance.com/) video generation, and returns `{ title, markdown, assets, generations }`.

- **Generations.** A scene's shots are grouped into clips of at most `maxClip` seconds (default 15; at least `minClip`, default 4). A longer single shot is cut to 15 s with a note.
- **References.** Each generation lists the images to upload, in order, so they become `@Image1`, `@Image2`… (at most `maxImages`, default 9). The order is: characters' first pictures, then the location, then props, then each shot's first frame, then the scene storyboard, then extra location pictures. Anything over the cap is listed as left out.
- **Prompt.** A fenced `text` block with the style and aspect ratio, then characters (`Maya is @Image1 (Stage manager)`), setting, props and scene, then timed shots (`Shot 1 (0–8 s): Wide shot, slow dolly-in. On screen: … Match the composition of @Image7.`), then consistency and no-text instructions.
- **Style.** Comes from the episode's `style` and `aspect` params (under More), else the season's, else `opts.style` / `opts.aspect`.
- **Reference sheet.** Characters, locations and props in scope, with descriptions and their images, linked by relative path.
- **Assets.** `{ path, src, label }` for every image, named after what it shows: `assets/characters/maya-1.jpg`, `assets/locations/school-hall-2.png`, `assets/shots/e1-s1-shot2-1.png`, `assets/scenes/e1-s1-storyboard-1.jpg`.

`seedancePack(graph, id?, opts?)` resolves `{ filename, blob, script }`: a `.zip` with `script.md` and every asset at the path the script uses. SVG pictures are rasterised to 1280 px PNG (kept as `.svg`, with the script updated, where there is no canvas); web images are fetched, or linked by URL when they can't be. `zipFiles(files)` is the small store-only zip writer behind it.

Files reach the person through `saveDramaFile`, a browser download by default. A host can replace it with `setDramaFileSaver(fn)`; the demo uses the claude.ai artifact `downloads` capability when it is available.
