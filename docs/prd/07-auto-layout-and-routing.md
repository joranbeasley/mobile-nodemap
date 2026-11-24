# 07. Auto-layout, routing and placement

## Problem

On phones, dragging nodes into tidy positions and untangling wires is tedious. Maps should arrange themselves.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| L1 | Tidy (button or `L`): a layered layout, animated | Shipped |
| L2 | On narrow portrait screens, the layout wraps into rows that fit at a readable zoom | Shipped |
| L3 | Orthogonal wires route around nodes and spread into separate channels; curved wires optional | Shipped |
| L4 | While dragging, only the dragged node's wires re-route; all re-route on drop | Shipped |
| L5 | New connected nodes line up with their port; they join siblings' columns or open a column, and neighbours animate aside | Shipped |
| L6 | Dropped nodes slide off overlaps; growing nodes push the nodes below down in order | Shipped |
| L7 | Loops (network maps) lay out correctly | Shipped |
| L8 | `elkLayout(new ELK())` as an optional engine | Shipped |

## Open questions

- Incremental layout that keeps the user's manual arrangement mostly intact.
- Edge bundling for very dense fan-out.
- Performance budget for 500+ nodes (spatial indexing in the router).
