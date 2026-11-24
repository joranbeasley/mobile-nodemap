# 08. Built-in graph types: math, network and UML

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

## Function builder (`functionGraph`, id `function`)

See [04](04-function-builder-and-library.md).

## Open questions

- Network: VLANs, link capacity on wires (edge params), packet loss.
- UML: sequence and state diagrams; multiplicities and role names on wires (edge params); import from TypeScript.
- Math: units on port types (metres vs feet) with automatic conversion.
