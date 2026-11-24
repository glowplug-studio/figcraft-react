# Roadmap row 15, item 6: the prototype runtime

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `5603b72`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

The prototype player changes its own copy of the document as a prototype runs. [`prototype-runtime.ts`](../../src/engine/prototype-runtime.ts) restates native's runtime: set variable (a value or an expression evaluated where the layer is, in every mode, with bound layers and styles following), set variable mode for the page and the top-level frames that chose another mode, the branch a conditional runs, where navigating to a section goes, interactive components (an instance plays its variant's interactions but for its own), the instance Change to changes, and the hotspots a screen offers. A new instance no longer copies its main's interactions, and refreshing an instance keeps its own ([`component-instances.ts`](../../src/engine/component-instances.ts), [`component-sync.ts`](../../src/engine/component-sync.ts)); before, a prototype would have played the main's twice and lost the instance's own.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-instance-interactions.json](../../tests/fixtures/native-instance-interactions.json) | A component with interactions, an instance with one of its own, a later change to the main | The instance keeps only its own; failed before |
| Restated native tests | `proto_run_tests.rs` (literals, set variable, set mode, branches), `proto_behaviour_tests.rs` (interactive components, Change to, hotspots), `section_contents_tests.rs` (sections) | Seven cases pass; they failed before (no runtime) |

Provenance: [an instance's own interactions](../../tests/fixtures/native-instance-interactions.provenance.md).

## Recorded differences

- **No browser case.** The presenter (item 10) runs the runtime and takes the browser case, in the deferred queue.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/proto_run.rs` | `prototype-runtime.ts` |
| `crates/engine/src/assets/components/instances.rs::create_instance_at`, `patch.rs` (an instance root's own interactions) | `component-instances.ts` `rootInstance`, `component-sync.ts` `refreshRoot` |

[Property matrix](26-11-24-prototype-runtime-parity.html) · [Plan](../planning/26-11-24-prototype-runtime.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-runtime.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `5603b72`, native reference `bad07e44` |
| Failing fixtures first | The parity cases failed before |
| Full pure suite | 5,606 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 16.5-minute run at `5603b72` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 18.85 seconds, run once after the browser gates of items 5 to 7a (runs are spaced an hour apart to stay within the local publication rate limit) |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,143 nodes/38,951 edges at `5603b72`; native 28,939/92,127 at `bad07e44`; combined 38,082/129,866. `setVariable`, `setModeById`, `navigateTarget`, `playInteractions` and `changeToTarget` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-runtime.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 7 to 10.
