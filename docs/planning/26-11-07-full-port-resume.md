# Full Figcraft port resume checkpoint

Resumed on 8 November. The objective is still full browser-relevant parity and final verified publication under [the governing prompt](../prompts/26-11-06-astra-high-step-port.md). Use the [master roadmap](26-11-06-complete-figcraft-port.md) and [feature inventory](../parity/full-port-feature-inventory.md). The live demo is the earlier rectangle release.

## Current checkpoint

Raw two- and four-component JPEG TIFFs at f64eeb0 passed 156/156 Chromium checks. Streamed archive I/O and Blob recovery at 6bcdf5b passed three authenticated production browser flows. Archive image budgets at beb8ddc passed 157/157 Chromium workflows. Ordered image rendering at 17fabdd passed 160/160 production Chromium checks. Large native document JSON is in progress. The active image work and exact next action are in the [master checkpoint](26-11-06-complete-figcraft-port.md#execution-checkpoint). The sections below record earlier restart points in chronological order.

## Checkout and release state

- Use the established canonical figcraft-react checkout, branch `prompt/full-figcraft-port`. The branch already contains updated dev and the rectangle slice. Resume the existing branch. The remote branch contains the pause checkpoint. The latest smoothing regression correction is local.
- Latest verified implementation is a132b69, React package 0.42.0. The implementation reference for closed-vector smoothing is `3daa9d3293c5973bc8811e9b1108cea3224690aa`.
- The authorised read-only source comparison and fork sync for the next slice fast-forwarded `original/figcraft` to `beaa01a496c55491d87ca59480ff49626a07138f`. Original main, fork main and the local submodule agreed at that revision. The pause commit records its gitlink. The supported global parity baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`.
- No React branch push, PR, Vercel change or merge to main during the full-port run. Final publication is gated on all required browser features, the full-product audit and all Phase 8 checks. Scoped hosted Supabase read during the current work returned zero public tables. Current features use host Auth, native files and local device recovery. Cloud tables, Storage, RLS, Realtime and multi-user tests remain future work.

## Implementation and verification

| Implementation | Scope and evidence |
|---|---|
| `4b86d41`, `2a37b75` | [Snap priority](../reports/26-11-07-snap-priority.md) and [strict command validation and layer order](../reports/26-11-07-command-validation.md). |
| `04b64a2` | [Join and Smooth join](../reports/26-11-07-vector-join.md), repaired region winding and native round-trip. 106 Chromium checks passed. |
| `242b5d0`, screenshots `6b3529a` | [Width-point authoring](../reports/26-11-07-width-point-authoring.md). Local package and host builds, 879 pure tests, two real local Auth tests, 108 Chromium checks. |
| `43ddc4b` | [Closed-vector smoothing](../reports/26-11-07-closed-vector-smoothing.md). Shared corner geometry, 32 region-direction combinations, pixel and pointer checks, native save and recovery, mobile preset and the 10,000-node fixture. See the report for exact final results. |

The master roadmap lists earlier verified implementations from rectangles through Pen, Pencil, history and stroke authoring. A feature being listed in the upstream command inventory does not establish verification. Largest open areas include vector operations, paints/effects/images, rich text, auto layout, components, libraries, file interoperability, online files, collaboration, prototypes, boards, Dev Mode, plugins and the complete UI. Whole-host memory, long sessions and final parity/publication remain open.

## Exact restart point

1. From the canonical checkout, verify directory, top level, branch, remote, worktrees and status. Inspect the pause commit and master checkpoint. Preserve any intervening user changes. Continue from the local branch tip without recreating the branch or re-merging the rectangle slice.
2. Closed-vector smoothing passed its Phase 6 and 7 gates at ca85638. The two affected browser tests passed, followed by all 109 Chromium tests. The report, measurements and ten-row parity matrix are current.
3. Paint bucket implementation 94273da and two reviewed toolbar screenshots at 50370fe passed 900 pure tests, two real Auth checks and all 111 Chromium tests. [Report](../reports/26-11-09-vector-paint-bucket.md). The Rust reference and fork were synchronised to 8a7ebc24. Use these verified commits for recovery. Full parity and deployment remain outstanding.
4. Selected-region solid fills passed all 115 Chromium checks at a9f8ec6. Cut, Eraser and Lasso at b737b56 passed 922 pure checks, both local Auth checks and all 119 Chromium workflows. Winding commands c93010f passed 928 pure checks, both local Auth checks and all 122 Chromium workflows. Live booleans at be059b7 passed 944 pure, two local Auth and 124 Chromium checks. Outline stroke at 70cf052 passed 950 pure, two local Auth and 126 Chromium checks. Offset path at dfdffca passed 956 pure, two local Auth and 128 Chromium checks. Simplify vector passed 963 pure, two local Auth and 130 Chromium checks. Shape Builder passed 980 pure, two real Auth and 133 Chromium checks. Continue with the [gradient paint plan](26-11-09-gradient-paints.md).
5. Graphify is local throughout the port. The current combined index has 29,681 nodes and 97,722 edges. Refresh it using AGENTS.md after source changes or a new upstream pin.
6. The incoming 3daa9d32..beaa01a4 range added 27 commits, 14 files, 211 insertions and 30 deletions. Route 7f62fc14 to prototype settings (reject unknown device and return settings), e9ec7564 to collaboration log and snapshot accounting, a23c9df9 to Vue Code Connect escaping, ff564b1e to Georgian text-wrap localisation, and 15bd7338/3c9d943f/9783af93 to Alt field scrubbing and touch scrolling. Earlier arrowhead, render-bounds, layers, baseline and REST-variable follow-ups are in the [smoothing plan](26-11-07-closed-vector-smoothing.md).
7. Continue through the remaining roadmap automatically after resumption. Keep the full parity audit, browser tests and publication gates. Work sequentially in the canonical checkout under the user's latest execution rules.

## Resume instruction

“Resume the paused full Figcraft port goal. Read docs/planning/26-11-07-full-port-resume.md and the master checkpoint, then continue from the existing local prompt/full-figcraft-port branch through full browser-relevant parity and final verified publication. Do not merge to main.”

## 9 November gradient checkpoint

The [gradient matrix](../reports/26-11-09-gradient-paints-parity.html) passed at 113507a. The [image plan](26-11-09-image-paints.md) records the current source, local graph, scoped Supabase read and exact next actions. The production host was stopped after 137/137 Chromium checks.


## 9 November image archive checkpoint

Resume Phase 4 from 7b32853 on the full-port branch. The [image plan](26-11-09-image-paints.md) records the archive and preset checkpoints, six-format byte comparisons, production browser results, TIFF decoding gap and next paint integration work. The Rust pin is 8a7ebc24. The local combined graph has 29,788 nodes and 98,190 edges. Final parity audit and publication are pending.

## 9 November image rendering and commands

Resume Phase 4 from image picker checkpoint 35ac0bd on the canonical branch. The [active image plan](26-11-09-image-paints.md#image-picker-checkpoint) records implementation, graph revisions, exact verification and open rows. Next wire raster file.import, canvas drop and image paste, then canvas crop, animated images, embedded profiles and cache stress. Complete all subsequent roadmap and publication gates.

## 9 November crop checkpoint

Resume image Phase 4 after 34a3e3d. Raster import/drop/paste and crop gestures passed strict types, production builds, 1,046 pure tests, two local Auth tests and 146/146 production browser workflows. The local graph and source mapping are recorded in the [image plan](26-11-09-image-paints.md#raster-import-and-crop). Next verify float-predictor TIFFs, progressive JPEG sampling and animated GIF editor idle. Then finish colour management, cache bounds, performance fixtures and remaining image gates. Final publication remains pending.

The decoder checkpoint at 8ca195d passed 147/147 production Chromium checks. The image plan lists the newly verified formats and native GIF editor behaviour. Magnified canvas pixels, cache pressure, input profiles and native archive budgeting remain in progress.

## 9 November image sampling and source colour

The full suite passed 148/148 at ba25ef5. Resume from 3c80225 with PNG gamma and chromaticity labelling verified by 1,055 pure tests, both local Auth checks, strict types, production builds and three focused Chromium workflows. The [image plan](26-11-09-image-paints.md#raster-import-and-crop) lists the exact embedded ICC acceptance cases, remaining image limits and subsequent gates. No hosted change accompanied these checkpoints.
