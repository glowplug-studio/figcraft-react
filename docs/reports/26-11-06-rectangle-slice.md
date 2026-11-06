# Rectangle slice verification — 2026-11-06

## Outcome

Implemented and locally verified the first browser-relevant slice: create a rectangle in a fresh local design document, display its selected geometry, and undo/redo creation. The dependency-ordered roadmap is in [the plan](../planning/26-11-06-rectangle-slice.md). The reusable editor receives host identity and capabilities; the Next.js example owns Supabase password login, verified route protection, session refresh, callback handling and logout.

**Production is verified at [figcraft-react.vercel.app](https://figcraft-react.vercel.app).** Six Playwright tests passed on the staged deployment and again on the stable URL. The same production build was promoted without rebuilding. Supabase Site URL and exact callback are configured, local callbacks retained, and temporary Auth fixture/automation bypass removed. GitHub homepage metadata is the only outstanding publication item; the connector lacks that write operation, browser control repeatedly timed out, and no CLI credential is available.

## Reference and commits

- Requested starting commit: `5cf5837372aaa27842311737441d77168c257ad9` on dev. Actual clean dev was `f6450d5cd2d07ab9f07f5cafb7eed93c99f38963`, one prompt-only delegation-guidance commit ahead; preserved. Remote dev matched it.
- Upstream original, fork, submodule and parity reference: `8eb0b87646c5aef712326d6c431ccde5408630de`. `npm run upstream:sync` succeeded; fork push was already up to date.
- Core engine commit: `d71b73d`.
- Reviewed and tested React implementation: `5314525b2f6ad9ef793091e082d7199a3537c07d` on `prompt/rectangle-slice` (version 0.2.0).
- The evidence commit follows that source revision and changes documentation only. The release and demo documentation are published on `prompt/rectangle-slice`; `main` remains unchanged.
- Rust Graphify index matched the reference. React Graphify remained stale at `b3b8a1b`; current local files supplied its authority. Both explicitly authorised repositories were queryable.

## Scope and substitutions

Normalised Document/Page/Rectangle subset, upstream solid colours and geometry defaults, decimal-string stable ids, immutable command snapshots and a React-independent Canvas 2D controller. The supported creation parameter subset is explicit; unknown kinds/properties are rejected atomically. Canvas gestures preserve reverse extents, Shift square, Alt centre, Rust pixel rounding, 100×100 click placement, cancellation and return to Move. React chrome observes committed snapshots; pointer preview remains transient.

Canvas 2D replaces native CPU rendering for flat rectangles. Browser pointer capture/resize/keyboard events replace native input. Browser sans-serif chrome and a bounded creation form substitute for the full native panels. This is **not full application visual parity**. No desktop window/process integration, Rust bridge, native file import, save/load, object snapping, viewport navigation, existing-layer manipulation, advanced paint/shape/layout, online files, sharing, comments or collaboration is claimed. Reload discards the unsaved document. Local undo is per editor instance.

## Backend evidence

- Real scoped Supabase MCP public-table read succeeded; no application tables existed. Hosted URL/key obtained through MCP matched the previously configured hosted environment; publishable Auth settings connectivity returned 200 without exposing credentials.
- Local stack uses distinct 553xx ports; the unrelated stack on 543xx was left running. Local environment values are ignored; previous ignored host configuration was preserved in an ignored backup.
- `auth.users` remains the identity source. No application-owned profile data is used, so no profile table was invented. No persisted document, RLS policy, Storage bucket or Realtime publication is needed for this unsaved workflow.
- `supabase/schemas/00_public.sql` declares only the existing namespace. Empty-input planning initially failed; the explicit namespace resolved it. Declarative sync then reported **No schema changes found**; no migration was generated or applied. Local reset passed, the public application-table count was zero, and local security/performance advisers returned no findings.
- Both shared adapter suites ran. The Supabase identity suite deliberately uses memory access for the unchanged local access contract; it does not claim document RLS coverage. Real backend tests deny account administration to both anonymous callers and ordinary users with spoofed role metadata.
- Host validation uses `getClaims()`, never server `getSession()` trust. Provider tokens never enter core snapshots. Signed-out/expired identity removes edit access; stale async validations cannot restore a signed-out identity. Issued provider JWTs retain the provider's normal lifetime; this slice stores no backend document resources.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` (library, tests and preview) | Passed |
| `FIGCRAFT_LOCAL_INTEGRATION=1 npm test` | 68 passed, 0 failed, 0 skipped; includes 35 parity/transaction cases |
| `npm run preview:build` | Package and Next.js production build passed |
| `npm run test:e2e` | 6 Chromium tests passed; no skipped browser tests |
| Fixed canvas screenshot | Passed against committed 1440×900, scale-1 baseline; upstream colours also sampled numerically |
| Browser flows | Denied route, safe destination, bad password, invalid callback, login, creation, reverse/Shift/Alt/click/cancel, keyboard history, resize at 390/700/1440, forced refresh with token rotation, logout, unavailable Canvas 2D |
| `npm run preview:dev` | Additional login/create/logout run passed; no page errors; reviewed desktop capture |
| Local declarative sync/reset/advisers | Passed/no changes/zero findings |
| Hosted Auth configuration | Passed — stable Site URL and exact callback configured; management read-back HTTP 200; local callbacks preserved |
| Phase 8 deployment | Passed — staged 6/6; stable 6/6; same build promoted; runtime-error scan clean |
| GitHub homepage metadata | Blocked — authenticated MCP verified the repository; manual Website update requested |

Test environment: Node 24.20.0, Next.js 16.4.5, Playwright 1.65.0 bundled Chromium, macOS; fixed scale 1 and browser sans-serif chrome. Counts are executed tests, not line/branch coverage percentages. Geometry fixture provenance distinguishes the existing Rust `create_select_undo_redo` test from inspection-derived expected values; no React test executes Rust.

Measured browser performance: 10,000 rectangles across 110 measured frames, p95 **1.00 ms**, maximum **1.30 ms** (target <16.7 ms). Continuous drawing: pointer p95 **0.10 ms**, render p95 **0.10 ms**, with zero React commits during 40 pointer moves. These are fixture/device measurements, not universal guarantees.

Evidence: [property-level HTML report](26-11-06-rectangle-slice-parity.html), [sanitised verification record](evidence/rectangle-slice/verification.json), [reviewed desktop screenshot](evidence/rectangle-slice/desktop.png), [canvas baseline](../../tests/e2e/preview.spec.ts-snapshots/rectangle-canvas.png).

Local preview and this project’s Supabase processes were stopped cleanly after verification. The unrelated local project was left running.

## Publication evidence

| Property | Verified value |
|---|---|
| Vercel account / team / project | `glowplug-studio` / `glowplug` / `figcraft-react` |
| Deployment | `dpl_Gvr7N6fX3hL1SKu9qrZyjTYTHzNa` |
| Exact deployed commit | `f64d9c77745742a2b427d2bf02e0cb4752998743` |
| Branch / root | `prompt/rectangle-slice` / `examples/nextjs` |
| Build / install | `cd ../.. && npm run preview:build` / `cd ../.. && npm ci`; Node 24.x |
| Source isolation | CLI dry run: 78 source files plus directory entries; no Rust reference, environment files or local test/build artefacts |
| Environment | Required public Supabase URL and publishable key verified in production and preview via MCP; values not logged |
| Staged URL | `https://figcraft-react-vcb69t30u-glowplug.vercel.app` |
| Stable URL | `https://figcraft-react.vercel.app` |
| Staged / stable Playwright | 6/6, no skips or flaky tests; stable run used no Vercel bypass cookie |
| Runtime check | MCP: zero runtime errors and no error/fatal logs in the deployment's 30-minute window |
| Rollback target | None: first deployment. Pre-recorded first-release fallback was to pause the project and withdraw a failed release. Stable verification passed, so no rollback was needed. |
| Cleanup | Temporary hosted Auth fixture deleted and absence verified; CLI-created automation bypass revoked and read-back verified; protection policy unchanged |
| GitHub metadata | MCP verified `glowplug-studio/figcraft-react`; homepage update pending manual action |

The README demo link is committed on the working branch. It will not appear in the default-branch README until reviewed and merged. No main merge or pull request is authorised.

## Resume

Verify that the repository Website field is `https://figcraft-react.vercel.app`, then update the remaining metadata evidence row and checkpoint. The deployed application is already verified; no rebuild is needed for this metadata change.
