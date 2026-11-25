# Library: custom nodes

`import { compileNode, NodeLibrary } from 'mobile-nodemap'`

Build a node visually in a `functionGraph` map, then compile it into a node type and keep it in a library.

## `compileNode(graph, registry, meta, options?): NodeType`

```ts
const node = compileNode(graph, registry, {
  name: 'Cylinder volume',            // required: the title, and the generated function's name (camelCased)
  description: 'πr²h',                // optional
  type: 'lib/cylinder-volume',        // optional: defaults to `lib/<name-as-slug>`
  category: 'Library', color, icon,   // optional
}, {
  onEdit: (info) => openBuilder(info.graph),   // optional: adds "Edit in graph" to the node's details
});
```

- **Name is required.** A missing or blank `name` throws `"A custom node needs a name"`. Names are trimmed, and a blank description becomes `undefined`.
- **The map must be valid.** It throws if `graph.validate()` reports errors, or if the map does not have exactly one output.
- **The resulting node:**
  - inputs: the Input nodes, top to bottom, with their types and default values;
  - output: one port, named after the Output node, with the type flowing into it;
  - `run`: the compiled map (`compileFunction`);
  - `flavor: 'transform'`, `icon: 'λ'`, `category: 'Library'`;
  - `details()`: the JavaScript source (one function, from `emitSource`) and, with `onEdit`, an **Edit in graph** action;
  - `meta`: `{ source: GraphJSON, compiledFrom: registryId, custom: true }`.

### Types

```ts
interface CustomNodeMeta { name: string; description?: string; type?: string; category?: string; color?: string; icon?: string }
interface CustomNodeInfo { name: string; type: string; description?: string; graph: GraphJSON }
interface CompileNodeOptions { onEdit?(info: CustomNodeInfo): void }
```

`resolveMeta(meta)` applies the same checks and defaults without compiling. `slug(name)` and `camel(name)` are the naming helpers.


In the editor, a compiled node also has a ↘ button that opens its source map, running on the node's live inputs. It's view only: edits there aren't kept, and changing the node goes through "Edit in graph" (`onEdit`).

## `NodeLibrary`

A collection of custom nodes, stored as plain JSON.

```ts
const library = new NodeLibrary(entries?);
library.add({ name: 'Cylinder volume', description? }, graph, registry);  // compiles first; returns the NodeType
library.add({ name: 'Renamed', type: 'lib/cylinder-volume' }, graph, registry);   // same type = update in place
library.remove(type);
library.get(type); library.list();
library.edit(type);                       // fires 'edit' with the entry
library.source(type, registry, 'ts');     // one standalone function
library.toPack(id = 'library');           // a NodePack; install with registry.use() or a graph type's packs
library.toJSON(); NodeLibrary.fromJSON(entries); library.load(entries);
```

```ts
interface LibraryEntry {
  type: string; name: string; description?: string;
  category?: string; color?: string; icon?: string;
  graph: GraphJSON; updatedAt: number;
}
```

Events:

- `change` (all entries): persist here, for example `library.on('change', (e) => store.put('library', e))` with any [`StoragePort`](ports-and-adapters.md).
- `edit` (one entry): someone chose **Edit in graph** on a library node. Open `entry.graph` in a function builder, and save with the same `type` to update it.

`toPack()` compiles entries against the registry they are installed into, in insertion order, so entries may use earlier ones. An entry that no longer compiles is skipped with a console warning. Libraries saved before names were required (with `title`) load with that title as the name.
