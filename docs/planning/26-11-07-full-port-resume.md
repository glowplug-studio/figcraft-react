# Full Figcraft port resume checkpoint

Resumed on 8 November. The objective is still full browser-relevant parity and final verified publication under [the governing prompt](../prompts/26-11-06-astra-high-step-port.md). Use the [master roadmap](26-11-06-complete-figcraft-port.md) and [feature inventory](../parity/full-port-feature-inventory.md). The live demo is the earlier rectangle release.

## Checkout and release state

- Use the established canonical figcraft-react checkout, branch `prompt/full-figcraft-port`. The branch already contains updated dev and the rectangle slice. Resume the existing branch. The remote branch contains the pause checkpoint. The latest smoothing regression correction is local.
- Latest implementation is c93010f, React package 0.37.0. The implementation reference for closed-vector smoothing is `3daa9d3293c5973bc8811e9b1108cea3224690aa`.
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
4. Selected-region solid fills passed all 115 Chromium checks at a9f8ec6. Cut, Eraser and Lasso at b737b56 passed 922 pure checks, both local Auth checks and all 119 Chromium workflows. Winding commands c93010f passed 928 pure checks, both local Auth checks and all 122 Chromium workflows. Continue with the [live boolean group plan](26-11-09-live-boolean-groups.md).
5. Graphify is local throughout the port. The current combined index has 29,499 nodes and 96,678 edges. Refresh it using AGENTS.md after source changes or a new upstream pin.
6. The incoming 3daa9d32..beaa01a4 range added 27 commits, 14 files, 211 insertions and 30 deletions. Route 7f62fc14 to prototype settings (reject unknown device and return settings), e9ec7564 to collaboration log and snapshot accounting, a23c9df9 to Vue Code Connect escaping, ff564b1e to Georgian text-wrap localisation, and 15bd7338/3c9d943f/9783af93 to Alt field scrubbing and touch scrolling. Earlier arrowhead, render-bounds, layers, baseline and REST-variable follow-ups are in the [smoothing plan](26-11-07-closed-vector-smoothing.md).
7. Continue through the remaining roadmap automatically after resumption. Keep the full parity audit, browser tests and publication gates. Work sequentially in the canonical checkout under the user's latest execution rules.

## Resume instruction

“Resume the paused full Figcraft port goal. Read docs/planning/26-11-07-full-port-resume.md and the master checkpoint, then continue from the existing local prompt/full-figcraft-port branch through full browser-relevant parity and final verified publication. Do not merge to main.”
