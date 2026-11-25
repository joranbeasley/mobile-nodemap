# 08. Built-in graph types: math, network, UML, drama and drama boards

## Problem

The library needs proof that the extension model handles very different domains: one about computing values, and one about structure and reachability.

## Math (`mathGraph`, id `math`)

- Dataflow over numbers, lists, logic, text and async nodes, with displays and plots.
- Graph inputs and outputs make maps callable.
- Extras: constants, remap, "Sum all" (any number of wires) and "Plot function".
- Most pure nodes have `emit` hooks, so math maps export as self-contained code.

## Network (`networkGraph`, id `network`)

- Devices: internet, router, firewall, switch, Wi-Fi access point, server, laptop and phone. All are derived from one base device with `extendNode`.
- Data stores: disk / volume, database, cache, object storage and message queue. They attach to servers through a `data` port and show whether they're reachable (through which and how many servers), how full they are, and warnings: nearly full, low cache hit rate, growing queue backlog, or not attached to any server.
- Every device is editable: name, power, IP address, latency and bandwidth. Servers also have a type, CPU cores, RAM, storage and OS (summarised on the node, e.g. "Database · 32 cores · 256 GB RAM · 4 TB · Linux"); laptops and phones have an OS. Double-tap a device for the full-size Edit sheet. Bad or duplicate IPv4 addresses are flagged on the device and by `graph.validate()`.
- Wires are cables, and loops are allowed.
- A rule stops endpoints from connecting straight to the internet.
- The engine finds each device's fastest path to the internet: latency, hops, bottleneck bandwidth, and whether a backup path exists. Powered-off devices and closed firewalls cut traffic. The summary reports online and offline counts and the worst latency.

## UML (`umlGraph`, id `uml`)

- Class diagrams: classes (abstract or not, with attributes and methods), interfaces, enums and notes. The node's name is the class name; members are typed one per line in UML notation (`+ name: string`, `- total(): number`, `{abstract} area(): number`).
- Relationships are drawn the UML way: inheritance with a hollow triangle, implementation dashed with a hollow triangle, association with an open arrow, composition with a filled diamond, aggregation with a hollow diamond, dependency dashed with an arrow, notes dotted. These are ordinary port types with a `wire` style, so any pack can use them.
- Diagrams flow top to bottom: superclasses and owners above their children and parts. Crowded nodes only label their linked ports until selected.
- Rules: single inheritance for classes, classes extend classes and interfaces extend interfaces, and no inheritance cycles. Associations may loop.
- The engine checks that each concrete class implements every method its interfaces require, plus its superclasses' abstract methods, counting inherited methods. It also flags interfaces nobody implements. The status line counts classes, interfaces, enums and warnings.
- Tapping a classifier shows its TypeScript; `umlToTypeScript` exports the whole diagram.
- Examples: "Shapes" (interface, abstract class, inheritance chain, composition, enum, note) and "Shop" (associations, composition, a payment interface, and one implementation missing `refund()` to show the warning).

## Drama (`dramaGraph`, id `drama`)

- For drama clubs, student films and web series: plan a production as a map.
- Characters (name, description, appearance, pictures, played by), costumes (what a character wears, with pictures, wired into the scenes where they wear it), locations (name, INT/EXT, description, pictures) and props feed shots.
- A shot has exactly one location and any number of characters and props, plus a number, framing, camera movement, length, description and storyboard frames. Its header reads "Shot 2 · Close-up".
- Numbered scenes are made of shots and have a time of day, a description and an optional storyboard. With no storyboard, the scene shows a filmstrip of its shots' first frames.
- Episodes (title, number, optional description) are made of scenes, and seasons of episodes. Each piece belongs to one parent; characters and locations are reused freely.
- Pictures: tap + on a selected node to add photos from the camera or library (shrunk before they are stored), tap a picture to view it full screen, × to remove it.
- The engine shows on each node where it is used ("3 scenes · 5 shots"), scene sluglines ("INT. SCHOOL HALL — DAY"), cast lists and running times, and flags shots with no location or scene, empty scenes and duplicate scene numbers.
- Tapping a character, location or prop lists every shot they are in.
- **Video generation.** Every shot is one Seedance generation. Tapping a shot shows its `shot.md`: duration, the reference images to upload, numbered in upload order (`images/01-maya.jpg` becomes @Image1), and a ready-to-paste prompt. **Download shot (.zip)** saves `shot.md` with those images. A scene downloads as `scene.md`, one zip per shot and its optional storyboard. An episode or season downloads as `script.md`, the shot zips in story order and the storyboards. The root file lists every shot's pack, length and prompt. Each Seedance generation starts from nothing, so consistency comes from repeating the same evidence: the character's picture, their appearance text word for word, and in costume scenes the costume's description and pictures. A video style, aspect ratio, images per clip (default 9) and clip length (default 15 s) can be set per episode or season.

## Drama boards (`drama2Graph`, id `drama2`)

A production isn't really a flow, and wiring many characters into many shots gets busy, so Drama boards edit the same model as tabs of cards with no wires.

- **Tabs.** Cast, Locations and Props are grids. Scenes (a row per scene: the scene, then its shots) and Episodes (a row per episode: the episode, then its scenes) are rows. On a phone, grids are one column and rows scroll sideways.
- **Props.** A prop is either an Object or an Outfit, set by its type. An outfit has a wearer: put it on a shot and that character wears it there (in the video prompt it replaces their usual clothes, with its pictures). Objects have pictures too, which go into the prompts of the shots that use them. Outfits are listed first, grouped by wearer.
- **No wires.** Cards can't be connected. A shot picks one location and any characters and props, a scene picks its shots, and an episode picks its scenes. The pickers only offer valid choices: a shot already in another scene isn't offered.
- **Jumping around.** Every reference is a chip and every list entry a link. Tapping one switches to the tab that shows it, centres it and selects it; ← Back returns. They work without selecting the card first.
- **What each card lists.**
  - Characters, locations and props: the scenes and episodes they appear in (characters also their outfits).
  - Shots: their scene and episodes.
  - Scenes: their episode, characters, locations and props.
  - Episodes: their actors and locations.
- **Adding.** + adds a type the current tab shows. With a scene selected, a new shot joins it, numbered next. With an episode selected, a new scene joins it. With a prop selected, a new prop has the same type and wearer.
- **Same engine.** Underneath it's the drama model: the same checks, details cards and Seedance export. A shot's prompt is identical to the wired version's.

## Function builder (`functionGraph`, id `function`)

See [04](04-function-builder-and-library.md).

## Open questions

- Network: VLANs, link capacity on wires (edge params), packet loss.
- Drama: call sheets per shooting day, script pages linked to scenes, costume continuity.
- UML: sequence and state diagrams; multiplicities and role names on wires (edge params); import from TypeScript.
- Math: units on port types (metres vs feet) with automatic conversion.
