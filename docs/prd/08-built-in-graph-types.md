# 08. Built-in graph types: math and network

## Problem

The library needs proof that the extension model handles very different domains: one about computing values, and one about structure and reachability.

## Math (`mathGraph`, id `math`)

- Dataflow over numbers, lists, logic, text and async nodes, with displays and plots.
- Graph inputs and outputs make maps callable.
- Extras: constants, remap, "Sum all" (any number of wires) and "Plot function".
- Most pure nodes have `emit` hooks, so math maps export as self-contained code.

## Network (`networkGraph`, id `network`)

- Devices: internet, router, firewall, switch, Wi-Fi access point, server, laptop and phone. All are derived from one base device with `extendNode`.
- Every device is editable: name, power, IP address, latency and bandwidth. Servers also have a type, CPU cores, RAM, storage and OS (summarised on the node, e.g. "Database · 32 cores · 256 GB RAM · 4 TB · Linux"); laptops and phones have an OS. Double-tap a device for the full-size Edit sheet. Bad or duplicate IPv4 addresses are flagged on the device and by `graph.validate()`.
- Wires are cables, and loops are allowed.
- A rule stops endpoints from connecting straight to the internet.
- The engine finds each device's fastest path to the internet: latency, hops, bottleneck bandwidth, and whether a backup path exists. Powered-off devices and closed firewalls cut traffic. The summary reports online and offline counts and the worst latency.

## Function builder (`functionGraph`, id `function`)

See [04](04-function-builder-and-library.md).

## Open questions

- Network: VLANs, link capacity on wires (edge params), packet loss.
- Math: units on port types (metres vs feet) with automatic conversion.
