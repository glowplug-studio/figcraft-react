# Live boolean groups

## Dependencies and scope

The preceding slice supplies verified winding rules, shared vector loops, native recovery and a solid-region renderer. The next geometry dependency is the contour result of boolean operations. Simplify, Offset, Outline stroke and Shape Builder also consume it. Build the kernel through a complete live group workflow. Preserve editable operands, per-child operations and native group identity.

| Native anchor | TypeScript owner and implementation | Acceptance evidence |
|---|---|---|
| pathops/src/budget.rs, budget_tests.rs and geom/src/measure.rs | Curve bounds, same-coordinate sweep ordering, ranked interval counts and fold accounting before any boolean operation | 250,000 segments, 2 million potential crossings, 4 million cumulative folded segments, finite coordinates bounded to 1.5 billion. Count touching and non-intersecting boxes like native. Exercise 10,000 dots, dense crossing bars and oversized paths. |
| pathops/src/lib.rs binary_by, boolean_ops, simplify_with_rule and ops_tests.rs | Independent contour operations preserving cubic segments, open-subpath closure and input winding | All four operations, mixed fold order, empty/lone inputs, winding under overlap, curved intersections, 4,097 disjoint contours, invalid input and failure atomicity. Check in Node and Chromium. |
| doc node kind BooleanOp and optional bool_op, doc/src/boolean_hit_tests.rs, format native codec | Document type, immutable hierarchy, native file reader/writer and recovery | Preserve group identity, ordered children, per-operand operation, nested groups, transforms and edits across save/open. Existing ordinary groups and legacy files must retain behaviour. |
| engine/src/canvas/booleans.rs apply, distinct_op, shown_op and engine/src/booleans_tests.rs | Command runner and hierarchy transactions | Group or reconfigure selection, retain custom names, clear redundant overrides, apply operand overrides in order and undo atomically. Flatten via the resulting silhouette. |
| render/src/boolean.rs, boolean_cache_tests.rs and boolean_budget_tests.rs | Cached operand prefix results, fill painting, highlight overlays, viewport hit testing and flatten | Holes pass clicks through, selected operands remain accessible, nested transformed results and invalidation match native; measure edits to the first and last operand in a complex scene. |
| ui-egui/src/panels/right.rs, bool_menu_icon_tests.rs and vector_tail_ui_tests.rs | Existing inspector, layers, keyboard and pointer controller | Four real actions, distinct operand indicators, direct/child selection, editable operands, drag, undo and local authenticated file recovery. Capture desktop and narrow interactions with Playwright. |

## Geometry library evaluation

Paper.js 0.17.0 (MIT) exposes cubic boolean operations and winding-aware orientation. A headless trial of its core build produced the expected areas for overlapping circles, a same-direction nested ring under both rules, a self-crossing bow and a twice-traced square. The core distribution measured 106,143 bytes gzipped. Its direct normalisation of 4,097 disjoint square contours took 5.2 seconds on the development machine. Use spatial separation and the native operation budgets, benchmark both in Chromium, and measure the actual package and host bundle change before accepting it. Keep the library out of React state. Keep separate scene state and disable library item insertion. Compare all observable results against the native fixture expectations. [Paper.js path API](https://paperjs.org/reference/path/).

## Resumable execution order

1. Implement and test exact complexity limits; adapt cubic contours and prove winding, precision, cleanup and timings with primary-source fixtures. Confirm both browser and server imports work.
2. Add native group and operand metadata, grouping commands, undo and codec round-trips. Implement the prefix-cached silhouette, native caps and the group’s rendering and hit behaviour. Integrate vector flattening with that result.
3. Connect the controls, operand selection, pointer drag and outlines. Run the local Auth success/denial suite, full preview and Chromium tests, frame and memory checks. Report each property and carry remaining dependencies forward.

Phases 1–3. Source and fork main at 8a7ebc2484a6d64d80a13c19c18ffb814325e347. Global supported baseline 8eb0b876. React source c93010f. The local combined code graph has 29,499 nodes and 96,678 edges. Code-only extraction omits prose and optional SQL parsing. The scoped Figcraft Supabase MCP returned zero public tables. These in-document commands use existing Auth and device recovery. Online files and collaboration keep their own schema milestones. Rollback c93010f.

## Verified checkpoint

Phases 4–7 complete at be059b7. Passed 944 pure checks, two local Auth tests, strict types, package and Next.js production builds and 124 Chromium workflows with zero retries or skips. Checked editable operands, hole pixels, real pointer drag, native files, device recovery and narrow-screen flatten. Six Next.js editor chunks grew by 113,402 gzip bytes. The React graph has 1,992 nodes and 9,644 edges, and the combined graph has 29,586 nodes and 97,082 edges. Local extraction omitted a declaration/fixture with no extracted symbols and non-code assets. [Report](../reports/26-11-09-live-boolean-groups.md). Continue with [Outline stroke](26-11-09-outline-stroke.md).
