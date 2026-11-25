# Architecture decision records

Each record explains one significant decision: the context, what we chose, and what it costs. Records are append-only. To change a decision, add a new record that supersedes the old one and update the old one's status.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-ports-and-adapters.md) | Ports and adapters around a DOM-free core | Accepted |
| [0003](0003-mobile-first-interaction.md) | Mobile-first interaction model | Accepted |
| [0004](0004-dataflow-evaluation.md) | Dataflow evaluation with memoisation and cancellation | Accepted |
| [0005](0005-layout-and-routing.md) | Own layered layout and wire router; ELK optional | Accepted |
| [0006](0006-graph-types-packs-node-types.md) | Graph types, packs and node types as the extension model | Accepted |
| [0007](0007-compile-to-a-single-function.md) | Compile a map to a single function | Accepted |
| [0008](0008-function-builder.md) | Function builder: Input leaves, exactly one Output | Accepted |
| [0009](0009-themes-and-flavors.md) | Themes as data; node flavors | Accepted |
| [0010](0010-no-runtime-dependencies.md) | No runtime dependencies | Accepted |
| [0011](0011-views-boards-without-wires.md) | Views: boards without wires | Accepted |

New records copy [template.md](template.md).
