# Roadmap row 15, item 6: the prototype runtime

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `60b9ae9` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-runtime.ts` (new: `literal`, `setVariable`, `setMode`, `setModeById`, `branch`, `navigateTarget`, `rememberSections`, `playInteractions`, `changeToTarget`, `hotspots`); `src/engine/component-instances.ts` and `src/engine/component-sync.ts` (an instance root's interactions are its own); test `tests/parity/prototype-runtime.test.ts`; fixture `tests/fixtures/native-instance-interactions.json` with provenance.
- Next action: record the item.
- Blockers: none.

## Native contract (`engine/src/proto_run.rs`)

- **`literal`, `set_variable`**: a value parsed by the variable's type, or an expression evaluated in the modes of the layer whose interaction runs (numbers and booleans become text for a text variable), written to every mode; bound layers and styles follow. Nothing changes when the value does not fit, the expression gives nothing or the variable is missing.
- **`set_mode`, `set_mode_by_id`**: the page the frame is on, and its top-level layers that chose another mode of the collection, switch; modes chosen deeper inside still win.
- **`branch`**: the actions of the first block whose condition gives true (a block without one is the else); a condition that errors is false.
- **`navigate_target`, `remember_sections`**: navigating to a layer shows its top-level frame; to a section, the frame shown there last, else its first frame in reading order.
- **`play_interactions`**: on the player's copy, every instance plays its main's interactions except for triggers it has its own for; interactions it holds that equal a variant's are copies and give way to the variant shown. **`change_to_target`**: the nearest of the layer and the instances around it showing a variant of the destination's set, else the innermost instance holding it.
- **`hotspots`**: a screen's visible layers with interactions, bottom-most first, clipped by the clipping frames around them.
- **`assets/components/instances.rs`, `patch.rs`**: a new instance's own interactions start empty and stay its own when the main changes.

## What the port had

Nothing ran prototype actions. A new instance copied its main's interactions, and refreshing an instance replaced its own with the main's: in a prototype the main's would then play twice and the instance's own were lost.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/proto_run.rs` | `prototype-runtime.ts` | Native tests restated (`proto_run_tests.rs`, `proto_behaviour_tests.rs`, `section_contents_tests.rs`) |
| `assets/components/instances.rs::create_instance_at`, `patch.rs` root rule | `component-instances.ts` `rootInstance`, `component-sync.ts` `refreshRoot` | Native observation |

## Acceptance

- Seven restated native tests and one native observation pass; the instance case and the runtime cases failed before.
- No browser case: the presenter (item 10) runs the runtime, in the deferred queue.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
