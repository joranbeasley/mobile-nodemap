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
  editor: { wires: 'smart', autoLayout: true, direction: 'TB' }, // direction: 'auto' | 'LR' | 'TB'; views: tabs (see editor.md); plugins: EditorPlugin[]; edgeStyle: (edge, graph) => EdgeStyle
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
  editorPlugins?: EditorPlugin[];  // installed by every editor showing a map that uses this pack
  conversions?: [from, to][];
  css?: string;                  // injected once per document or shadow root
  setup?(registry): void;
}
```

Install it with `registry.use(pack)`, or list it in a graph type's `packs`.

### `EditorPlugin`

Behaviour a pack or graph type adds to the editor: toolbar buttons, shortcuts, panels, reactions to selection or views.

```ts
const exportPlugin: EditorPlugin<NodeEditor> = {
  id: 'acme/export',
  install(editor) {
    const off = editor.addToolbarButton({ id: 'export', label: 'Export', icon: '⇩', run: () => save(editor.graph.toJSON()) });
    const unsub = editor.on('select', ({ node }) => …);
    return () => { off(); unsub(); };     // optional: undo on destroy
  },
};
```

Plugins come from packs (`editorPlugins`), from a graph type (`editor.plugins`) and from the editor's `plugins` option. Each id is installed once. A plugin gets the whole public `NodeEditor` API: events, `addToolbarButton`, `openNode`, `setView`, `enterNode`, `notify`, `graph`, `registry` and so on.

## Built-in graph types and packs

| Export | id | |
| --- | --- | --- |
| `mathGraph` | `math` | Dataflow; `mathPack` (`nodemap/math`): values, math, logic, text, lists, async, display, graph I/O, constants, remap, sum all, plot function. Conversions number→string and boolean→number. |
| `networkGraph` | `network` | `networkPack` (`nodemap/network`): internet, router, firewall, switch, Wi-Fi access point, server, laptop, phone; port type `link`; `networkEngine`; `allowCycles`; endpoints can't connect straight to the internet. Every device has editable `up`, `ip`, `latency` and `bandwidth`, and a name (`label`). Servers add `kind` (Application, Web, Database, File / NAS, Mail, DNS, Media, Game, Backup, Other: `SERVER_TYPES`), `cores`, `memory` (GB), `storage` (GB) and `os`; laptops and phones add `os`. `deviceSpecs(node)` gives the one-line summary shown on the node. **Data stores** (`net/disk`, `net/database`, `net/cache`, `net/bucket`, `net/queue`; `meta.role: 'data'`; derived from `networkDataStore`) attach to a server's `data` output (port type `data`). They have `up`, `size` / `used` (GB; size 0 = unlimited) and `latency`, plus their own settings: disk type and RAID; database engine and role; cache engine and hit rate; bucket provider and versioning; queue engine, backlog and retention. `validate` warns about bad or duplicate IPv4 addresses (`ipIssues(nodes)`) and data stores not attached to a server. |
| `umlGraph` | `uml` | `umlPack` (`nodemap/uml`): `uml/class` (name = `label`; `abstract`, `attributes`, `methods`), `uml/interface` (`methods`), `uml/enum` (`values`) and `uml/note` (`text`). Relationships are port types with UML wire styles: `uml-generalization` (hollow triangle), `uml-realization` (dashed, hollow triangle), `uml-association` (open arrow), `uml-composition` (filled diamond), `uml-aggregation` (hollow diamond), `uml-dependency` (dashed, open arrow), `uml-note` (dotted); the `referenced` input (`uml-ref`) accepts the reference kinds. Wires run parent → child and owner → part, and the type defaults to `direction: 'TB'`. Rules: a class extends one class, kinds must match, no inheritance cycles (associations may loop); `validate` flags invalid or duplicate type names. `umlEngine` checks that concrete classes implement their interfaces' methods and the abstract methods of their superclasses (counting inherited ones), and flags unused interfaces. `umlToTypeScript(graph, registry, ids?)` exports TypeScript (parents first); each classifier's details card shows its own. `parseUmlMembers(text)` parses lines like `- total(): number`, `{abstract} area(): number`, `static of(n: number): Sq`. |
| `dramaGraph` | `drama` | `dramaPack` (`nodemap/drama`): `drama/location` (name, `setting` INT/EXT, `description`, `images`), `drama/character` (name, `description`, `appearance`, `images`, `actor`), `drama/costume` (name, `description`, `images`; one `character` input, wired into any number of scenes), `drama/prop`, `drama/shot` (`number`, `framing`, `description`, `images` frames, `movement`, `duration` s; inputs: one `location`, many `characters` and `props`), `drama/scene` (`number`, `time`, `description`, optional `storyboard` images; many `shots` and `costumes`), `drama/episode` (title = name, `number`, optional `description`, and video `style`, `aspect`, `maxImages`, `maxClip`; many `scenes`) and `drama/season` (many `episodes`; the same video settings). A shot belongs to one scene, a scene to one episode, an episode to one season (`canConnect`); a second location replaces the first. `dramaEngine` publishes `outputs.drama` (`{ kind, line, sub?, strip?, warnings }`) per node: where characters, locations and props appear; sluglines (`INT. SCHOOL HALL — DAY`), cast and running times for scenes and episodes; warnings for shots without a location or scene, empty scenes and duplicate scene or episode numbers. The summary has `episodes, scenes, shots, characters, locations, runtime, warnings, summary`. Tapping a shot, scene, episode or season shows its **Seedance** markdown with a zip download (see below); `shotList(graph, id?)` gives a plain shot list; tapping a character, location or prop lists its appearances (`appearances(graph, id)`). Also exports `shotInfo`, `sceneInfo`, `episodeInfo`. The **`images`** param kind (`imagesParam`) holds an array of image URLs: thumbnails, tap to view full screen (`openLightbox`), × to remove, ‹ › to reorder (the first picture or frame leads the video prompt; `sortable: false` turns it off), + to add photos from the camera or library, shrunk to 1024 px JPEG first (`imageFileToDataUrl`). |
| `drama2Graph` | `drama2` | **Drama boards**: the drama model without wires. Six views: Cast (characters), Locations, Props and Shots (in story order) as grids; Scenes (one wide scene card per row, its shots as chips that open them on the Shots tab) and Episodes (one wide episode card per row, its scenes as chips that open them on the Scenes tab) in rows. `drama2Pack` node types have no ports. They refer to each other with `ref` / `refs` params: a shot's `location`, `characters` and `props`, a scene's `shots`, an episode's `scenes`. A **prop** (`drama2/prop`) has a `kind`, `Object` or `Outfit`, and an outfit has an optional `wornBy`, its usual wearer (the field only shows for outfits). **Any character can wear any outfit, and use any object.** Who wears what is the **wardrobe** (`wardrobe` param: character id → outfit id, or `''` for usual clothes) on an **episode**, a **scene** or a **shot**, each shown as a row per character there with a dropdown. An episode's wardrobe dresses its characters in all its scenes and shots; a scene's overrides the episode for its shots; a shot's overrides both, including back to *Usual clothes*. Each row's first choice, *X (from scene)* / *(from episode)*, keeps what the level above says; *+ New outfit…* creates one usually worn by that character. `dressOf(board, node, characterId)` resolves it and says where it came from (`{ outfit?, from: 'shot' | 'scene' | 'episode' | 'none' }`); `castOf(board, node)` is who a wardrobe lists. An outfit left in a shot's props (as boards used to do it) counts as set on that shot, with an *on [character]* picker on its chip (`wearerOf`); shots' prop pickers now offer objects only. In the drama model (`toDrama`), each shot gets exactly what its characters wear (a `costumes` input on the shot, `costumesExact`) and each scene what it says (its `costumes`), with an outfit on someone other than its usual wearer as a copy with id `<outfit>@<character>`. `shotCostumes(graph, shotId)` reads it (the scene's costumes with the shot's own over them; in wired drama maps, a shot can override its scene the same way), and picture prompts, reference pictures and the Seedance export use it, describing the outfit in place of usual clothes. Objects are props with pictures and no owner. The Props tab shows outfits grouped by usual wearer, then objects. Characters list every outfit they wear (`outfitsOf`), usual or picked in a shot. Each node lists where it appears (`drama2Lists`): characters and locations list scenes and episodes (characters also outfits), props list scenes and episodes, shots list their scene and episodes, scenes list their episode, characters, locations and props, and episodes list actors and locations. Every list title jumps to its node. + links new nodes to the selection: a shot joins the selected shot's scene (Shots tab), a scene joins the selected scene's episode (Scenes tab), and a prop copies the selected prop's type and wearer, each numbered next. `toDrama(board)` builds the wired drama graph with the same ids, and `fromDrama(json)` goes the other way (the examples are the drama ones; costumes become outfit props on the shots their wearer is in). `drama2Engine` runs `dramaEngine` on the wired graph, so its checks, details cards, shot lists and Seedance export are the drama ones. |
| `functionGraph` | `function` | Extends math. Input leaves are arguments and exactly one Output is required (`canAddNode` and `validate` via `functionIssues`). See [library](library.md). |
| `stdlib` | | The math node types as a plain array (kept for compatibility). |
| `networkDevice` | | The base device node, for `extendNode`. |
| `networkStatusView` | | The device status view, for reuse. |
| `builtinGraphTypes` | | `[mathGraph, networkGraph, functionGraph, umlGraph, dramaGraph, drama2Graph]`. |

`umlEngine` publishes `outputs.uml` for each classifier: `{ kind, name, abstract?, attributes, methods, values?, parents, warnings }`, and a summary `{ classes, interfaces, enums, relationships, warnings }`.

`networkEngine` publishes `outputs.status` for each device: `{ state: 'source' | 'online' | 'offline' | 'down' | 'blocking', latency?, hops?, bandwidth?, redundant?, ip?, ipIssue? }`.

Data stores get `{ state: 'available' | 'unavailable' | 'down', hosts, latency, redundant, usage, usedGb, sizeGb, warning? }`:

- **Available** while any attached server is online, reached at that server's latency plus their own. `redundant` means 2+ online servers.
- **Warnings**: 85%+ full, a cache hit rate under 80%, or a queue backlog over 10,000.
- Data attachments don't count as cables for device reachability.

Its summary outputs are `{ online, offline, worstLatency, dataAvailable, dataUnavailable }`.

### Seedance export (drama)

Every **shot is one Seedance generation**. `seedanceShot(graph, shotId, opts?)` returns `{ id, title, zipPath, duration, refs, dropped, prompt, markdown }`:

- **Images.** `refs` are the shot's reference images in upload order, named `images/01-maya.jpg`, `images/02-theo.jpg`… so the order is obvious; the first becomes `@Image1`. The order is: each character's first picture, their costume for this scene (the scene's `costumes` input; the first wired in wins), the location, props, the shot's storyboard frames, then extra angles of the same people and places. A card's picture can be picked per shot (`referencePicks` on the shot, card id → picture; the ⇄ switch in the ✨ and 🎬 panels): the picked one is used instead of the first, and that card's other pictures are left out. The number is capped by `maxImages` (default 9); the rest are listed in `dropped`.
- **Prompt.** Style and aspect ratio, then one line per character: `- Maya is @Image1, stage manager. Appearance: <the character's appearance, word for word>. Costume in this scene: <costume> (@Image2); it replaces their usual clothes.` (with `more angles: @Image7` when there are more pictures). Then setting, props and scene context, then the shot (`Shot (0–8 s): Wide shot, slow dolly-in. On screen: … Match the composition of @Image6.`), then consistency and no-text instructions.
- **Duration** is the shot's length, kept between `minClip` (4) and `maxClip` (15); `shot.md` notes a cut or a short shot.
- **`markdown`** is the shot's `shot.md`: duration, aspect ratio, the image table (with relative links) and the prompt.

`seedanceScript(graph, id?, opts?)` returns `{ title, kind, rootFile, markdown, shots, storyboard }` for a shot, scene, episode or season (by id), or the whole map. A shot gives its `shot.md`. Anything larger gives a root file listing every shot's pack, length, image count and prompt, plus each scene's storyboard: `scene.md` for a scene, `script.md` otherwise.

`seedancePack(graph, id?, opts?)` resolves `{ filename, blob, script }`:

| Export | Zip contents |
| --- | --- |
| Shot | `shot.md`, `images/01-….jpg`, `images/02-….jpg`… |
| Scene | `scene.md`, `shots/01-shot-1.zip`, `shots/02-shot-2.zip`…, optional `storyboard/scene-1-01.jpg`… |
| Episode | `script.md`, `shots/01-scene-1-shot-1.zip`…, optional `storyboard/scene-1-01.jpg`… |
| Season / whole map | `script.md`, `shots/01-ep-1-scene-1-shot-1.zip`…, optional storyboards |

Each shot zip inside a pack is the same as that shot's own download. SVG pictures are rasterised to 1024 px JPEG (kept as `.svg`, with the markdown updated, where there is no canvas); web images are fetched, or linked by URL when they can't be. `zipFiles(files)` is the small store-only zip writer behind it.

**Costumes and appearance.** A character's `appearance` (age, build, hair, face, usual clothes) is repeated word for word in every prompt they are in: fixed wording is what keeps separately generated clips consistent. A costume wired into a scene overrides their usual clothes for every shot in that scene, and its pictures go in right after the character's. `sceneCostumes(graph, sceneId)` maps character ids to the costume they wear there. The engine warns about a costume with no character, two costumes for one character in a scene, and a costume for someone who isn't in any of the scene's shots.

**Cuts, continuations and finished clips.** Shots have two more fields (`SHOT_CLIP_PARAMS`, on wired and board shots):

- **clip** (`lastFrame`, the `clipframe` param kind, `clipFrameParam`): add the finished video and its last frame is kept as a JPEG data URL (`lastFrameOf(file)`, in the browser; the video itself isn't stored). × removes it.
- **continues previous shot** (`continues`): one camera take carried on from the shot before it in the scene (`previousShot(graph, shot)`, by shot number).

How the shot before ended then shapes the next one. A shot that **continues** it starts on that frame: it's `@Image1`, labelled the first frame, the prompt opens *Start exactly on @Image1 … and carry the action on from there without a cut*, and its own storyboard frames are left out (they'd fight the continuation). If the shot before has no clip yet, `shot.md` says to add it. A shot that **cuts** from it gets that frame as a lower-priority continuity reference (*keep props, positions and lighting continuous with how shot N ended*). The ✨ picture panel offers the same frame first (continuing) or last (a cut). A shot longer than the clip limit gets a **Part 2** prompt in `shot.md`: generated from part 1's last frame as its first frame. Transitions between shots or scenes (dissolves, fades) aren't generated: do them in the edit.

**Cost estimate.** Every `shot.md` and root file states the seconds of video and the credits for one take per model, plus a budget line for several takes. The rates default to Dreamina's published 720p Seedance 2.0 credits per generated second (`SEEDANCE_RATES`: Pro 17, Fast 8, Mini 5); pass `rates` and `takes` (default 3) to change them. `seedanceCost(seconds, opts)` does the sum, and `script.cost` / `shot.cost` carry it. The details card shows the first model's figure. Prices change, so check before you buy.

**Settings.** `style`, `aspect`, `maxImages` ("reference images", default 9) and `maxClip` ("clip seconds", default 15) come from the shot's episode (under More), else its season, else `opts`. Set `maxImages` above 9 only for a model or platform that accepts more images per generation; Seedance 2.0 takes 9.

Files reach the person through `saveDramaFile`, a browser download by default. A host can replace it with `setDramaFileSaver(fn)`; the demo uses the claude.ai artifact `downloads` capability when it is available.

### Image generation (✨ Generate)

`setImageGenerator(generator)` turns on **✨** next to + in every `images` field (on a selected card and in the Edit sheet). It opens a panel with:
- a prompt, written by the field's `prompt(node, graph)` option when it has one;
- a model picker and an aspect ratio picker;
- for generators that take reference pictures, the pictures to send, as toggles (see below);
- the generator's API key field, until a key is given.

The pictures are copied into the field (shrunk to 1024 px JPEG), because generators' links expire. If a picture can't be downloaded, its link is kept and the field says so. Pass `null` to turn it off.

```ts
interface ImageGenerator {
  id: string; name: string;
  models?: { id; label }[]; defaultModel?: string;
  maxReferences?: number;                                               // reference pictures per request (0: text only)
  key?: { label; help?; get(): string | null; set(v: string): void };   // the host decides where it's kept
  generate({ prompt, aspect?, model?, references?, signal?, onProgress? }): Promise<{ images: string[]; credits?: number; balance?: number }>;
  balance?(): Promise<number | undefined>;                                      // credits left
  estimate?({ model?, references? }): Promise<{ credits; basis } | undefined>;   // what the next picture will probably cost
}
```

`meshyImageGenerator({ key | apiKey, model?, baseUrl?, pollMs?, timeoutMs?, fetch? })` calls Meshy's text-to-image API straight from the browser (`POST /openapi/v1/text-to-image` with `ai_model`, `prompt` and `aspect_ratio`, then polls the task). With `references`, it uses image-to-image instead (`POST /openapi/v1/image-to-image` with `reference_image_urls`: up to 5 (`MESHY_MAX_REFERENCES`), https URLs or data: URIs of PNG, JPEG or WebP). Models: `MESHY_IMAGE_MODELS` (Nano Banana, Nano Banana 2 / 2 Lite / Pro, GPT Image 2; default `nano-banana`). Aspect ratios Meshy doesn't take are mapped to the nearest of 1:1, 16:9, 9:16, 4:3, 3:4, 3:2 and 2:3. Errors explain themselves: no key, a bad key, no credits, a failed task. The credits a picture used are shown after it's added.

**Cost.** With `estimate` and `balance`, the panel shows what a picture will probably cost and the credits left, and updates when the model or the references change; after it's added, the note shows what it cost and what's left. Meshy's adapter measures each picture's cost from the balance before and after (Meshy's own `consumed_credits` is often 0), remembers it per model and kind (text or references) for the session, and otherwise estimates from the last picture like it in your Meshy history. A recorded 0 counts as unknown.

**Several services.** `setImageGenerators([...])` offers a choice in the ✨ panel (a *Service* picker, remembered in the browser); `setImageGenerator(g)` still sets just one.

**Video (🎬 Generate clip).** `setVideoGenerators([...])` adds **🎬 Generate clip** to every shot's clip field. A `VideoGenerator` has `{ id, name, models, defaultModel?, key?, site?, generate(req) }`, where each model says its durations, aspect ratios, resolutions, how many reference pictures it takes and whether it does sound, and `generate({ prompt, references?, firstFrame?, lastFrame?, duration?, aspect?, resolution?, model?, audio?, signal?, onProgress? })` returns `{ videos, cost? }`. The panel starts from the shot's own Seedance export (`shotClipSuggestion(graph, shotId)`): the same prompt, the reference pictures in the same order (the prompt calls them @Image1…, so switching one off means editing the prompt), the clip length and aspect ratio, and, for a continuing shot, the previous clip's last frame. The finished clip's link is kept in the shot's `clipUrl` (*▶ Watch clip*), and its last frame is taken into **clip** like a clip added by hand; where the clip can't be downloaded (the host blocks it), the field says to add it with 🎞.

**fal.** `falVideoGenerator({ key | apiKey })` runs these on fal (`FAL_VIDEO_MODELS`), each with its own input names: **Seedance 2.0, 2.0 Fast, 2.0 Mini and 2.5** (up to 9 reference pictures; Fast and Mini stop at 720p; 2.5 goes to 30 s), **Kling O3 Pro and Standard** (`fal-ai/kling-video/o3/<tier>/…`, up to 4 reference pictures, called @Image1… as in Seedance; 3–15 s), **Veo 3.1 and 3.1 Fast** (`fal-ai/veo3.1[/fast]…`, up to 3 reference pictures, with which it makes 8 s clips; otherwise 4, 6 or 8 s; the @Image tags become *reference image 1*…; a first and last frame use `…/first-last-frame-to-video`), **Wan 2.6** (`wan/v2.6/…`, no reference pictures, 5/10/15 s, prompts up to 1,500 characters) and **MiniMax H3 Max** (`minimax/h3-max/…`, no reference pictures, prompt rewriting off). With reference pictures (models that take them) it uses `…/reference-to-video`; with only a first frame, `…/image-to-video` (with an end frame where the model takes one); otherwise text-to-video. Durations (`VideoModel.durations` when only some lengths work), aspect ratios and resolutions snap to what each model takes; the 🎬 panel says when a model takes fewer reference pictures than are switched on. Sound (`generate_audio`) is offered where the model makes it; Kling and Veo charge more for it (`perSecondAudio`), Seedance doesn't. `falImageGenerator({ key | apiKey })` runs **Nano Banana 2, Pro and the original** (`FAL_IMAGE_MODELS`), using `…/edit` with `image_urls` when there are reference pictures. Both call fal's queue from the browser with the person's own key, as fal's client does (`POST https://queue.fal.run/<endpoint>`, then `…/requests/<id>/status` and `…/requests/<id>` under the owner/alias), and upload pictures fal can't fetch (data: URIs, the site's own links) to fal storage first. Inputs follow the types fal publishes in `@fal-ai/client`. **Prices.** Both adapters estimate from fal's listed prices (`FAL_PRICE_BASIS`, taken from each model's `https://fal.ai/models/<endpoint>/llms.txt`): Seedance per second of video by resolution (`FAL_VIDEO_MODELS[].perSecond`, e.g. Mini $0.0721/s at 480p, 2.0 $0.3024/s at 720p), Nano Banana per picture (`FAL_IMAGE_MODELS[].perImage`, $0.04 / $0.08 / $0.15). Only the model, resolution and length decide the price, not the prompt, pictures or sound, so the 🎬 panel shows *About $0.36 for 5 s at 480p* as the settings change, and the ✨ panel *About $0.08*. `VideoGenerator.estimate({ model, duration, resolution, audio, references })` returns `{ amount, unit, basis, seconds? }` (`seconds` when the model makes another length, as Veo does with references); image estimates can say `unit: 'USD'`. These are list prices: an account's own discounts aren't applied, and fal bills what it bills.

**Searching existing assets.** A generator can also offer `browse()`: the person's existing pictures on the service, newest first, as `{ id, label, hint, thumb, url }`. Image fields with `browse: true` then get a 🔍 button next to ✨. It opens the editor's searchable chooser (now with thumbnails), matching each asset's prompt or name, and copies the chosen picture in. For Meshy, `browse()` lists your text-to-image pictures and the thumbnails of your text-to-3D, image-to-3D and multi-image-to-3D models (the newest 50 of each that succeeded). In the drama types, props and costumes have it (on boards, objects and outfits).

`dramaImagePrompt(graph, node, param?)` writes the drama prompts, and every drama and drama-board image field uses it:

| Card | Prompt | Aspect |
| --- | --- | --- |
| Character | Reference portrait from their appearance and description | 3:4 |
| Location | Establishing shot, interior or exterior, no people | 16:9 |
| Object | Product-style reference photo of the object on its own: no people, no hands | 1:1 |
| Outfit | The costume on a headless dress form, made for its wearer (by name only): no person, no face, so it doesn't fight the actor's portrait when both are references for a shot | 3:4 |
| Shot frames | Storyboard frame: framing, action, who is on screen (with their appearance, and the costume they wear in that scene *instead of their usual clothes*), setting and time, and the episode's or season's style | 16:9 |
| Scene storyboard | The same, for the scene | 16:9 |
| Episode poster | Poster artwork | 2:3 |

It also suggests **reference pictures** (`references: { src, label }[]`, also `dramaImageReferences(graph, node)`): the first picture of each card the new picture should match. For a shot: each character on screen, the location, the costumes they wear in that scene, then the props. A character in costume is labelled *face and hair; not the clothes*, and their costume *what they wear*, so the model takes the face from the portrait and the clothes from the costume. For a scene: its cast, locations and costumes. For an outfit: whoever wears it. Characters, locations, objects and episodes suggest none.

In the ✨ panel the suggested pictures come first, then the card's own pictures. The suggested ones are switched on up to the generator's limit, and the card's own are off (switch one on for a variation of it). On Generate, the chosen pictures are sent in order, converted where needed by `referencePicture(src)` (SVG drawings and very large pictures become JPEGs of at most 1024 px). The prompt gets a line naming them, e.g. *Reference pictures, in order: 1. Theo; 2. School hall (location).*, so the model knows whose face and which room each one is.

The demo uses Meshy with the visitor's own API key, kept in that browser only.
