# DeltaNet Protocol
#### `@mml-io/delta-net-protocol`

[![npm version](https://img.shields.io/npm/v/@mml-io/delta-net-protocol.svg?style=flat)](https://www.npmjs.com/package/@mml-io/delta-net-protocol)

This package contains TypeScript definitions and message types for the DeltaNet protocols (`delta-net-v0.1` and `delta-net-v0.2`) used by `@mml-io/delta-net-server` and `@mml-io/delta-net-web`.

## Protocol Versions

### v0.1
Per-component compression: each component's data is independently deflate-compressed, resulting in O(N) compression calls per message where N is the number of components.

### v0.2
Contiguous compression: all component data is concatenated into a single buffer and compressed in one deflate call, reducing framing overhead from O(N) to O(1). The decoded message shapes are identical to v0.1 — the difference is purely in the wire format.

## v0.1 vs v0.2 Benchmarks

Wire size advantage grows with component count, where contiguous compression avoids redundant deflate dictionary headers. At low component counts (e.g. 3d-web-experience's 6), the primary benefit is CPU throughput from fewer deflate calls.

### Tick Messages

| Scenario | v0.1 | v0.2 | Change |
|---|--:|--:|--:|
| 1 comp x 1 user | 18 B | 18 B | 0% |
| 3 comp x 1,000 users | 4,903 B | 4,766 B | -2.8% |
| **6 comp x 2,000 users** | **4,311 B** | **4,167 B** | **-3.3%** |
| 10 comp x 10 users | 218 B | 136 B | -37.6% |
| 50 comp x 3 users | 705 B | 268 B | -62.0% |
| 50 comp x 1,000 users | 107,020 B | 96,960 B | -9.4% |
| 100 comp x 5 users | 1,865 B | 840 B | -55.0% |
| 100 comp x 1,000 users | 229,073 B | 205,835 B | -10.1% |

### Initial Checkout Messages

| Scenario | v0.1 | v0.2 | Change |
|---|--:|--:|--:|
| 1 comp x 1 user | 28 B | 28 B | 0% |
| 3 comp x 1,000 users | 9,379 B | 3,611 B | -61.5% |
| **6 comp x 2,000 users** | **26,883 B** | **27,663 B** | **+2.9%** |
| 10 comp x 10 users | 554 B | 376 B | -32.1% |
| 50 comp x 100 users | 16,516 B | 10,135 B | -38.6% |
| 50 comp x 1,000 users | 155,575 B | 14,873 B | -90.4% |
| 50 comp x 5,000 users | 912,988 B | 37,283 B | -95.9% |
| 100 comp x 1,000 users | 318,904 B | 27,454 B | -91.4% |

### Throughput (6 components x 2,000 users — 3d-web-experience)

| Operation | v0.1 | v0.2 | Change |
|---|--:|--:|--:|
| Tick encode | 655 msg/s | 665 msg/s | +1% |
| Tick decode | 2,443 msg/s | 2,597 msg/s | +6% |
| Checkout encode | 416 msg/s | 494 msg/s | +19% |
| Checkout decode | 708 msg/s | 758 msg/s | +7% |
