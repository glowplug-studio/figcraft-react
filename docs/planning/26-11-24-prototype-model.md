# Roadmap row 15, item 7a: prototype model rules

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `17083a6`: [report](../reports/26-11-24-prototype-model.md), [matrix](../reports/26-11-24-prototype-model-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `5603b72` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-model.ts` (new: `evalEasing`, `easingSeconds`, `easingSpring`, `acceptsDrag`, `reversedTransition`, `splitKey`, `keyCombo`, `keyAlias`, `firesOnKey`, `gamepadButtons`, `usesGamepad`, `triggerLabel`); test `tests/parity/prototype-model.test.ts`.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract (`doc/src/proto.rs`)

- **Easing**: linear, cubic ease in, out and in-and-out, back curves (1.70158), CSS cubic bezier (x clamped, 48 bisections), and physical springs (the four presets and custom ones, mass, stiffness and damping bounded): a spring plays until it settles within about 0.1% (at most 10 seconds), whatever the duration says; a curve plays for the duration.
- **Transitions**: reversed for Back and for a hover or press state reverting (move in becomes move out the other way, push pushes back, slide in becomes slide out); an on-drag trigger starts a directional transition only for a drag mostly its way.
- **Key triggers**: a key with exactly the modifiers of its combination (other spellings of the modifiers accepted, ASCII case ignored, common key aliases), combinations stored as `Ctrl+Alt+Shift+Cmd+Key`; controller buttons by the standard layout's names, pressed alone; the player polls controllers only for prototypes that use them.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/proto.rs::{Easing, Spring, cubic_bezier}` | `prototype-model.ts` `evalEasing`, `easingSeconds`, `easingSpring` | Restated `easing_curves_and_springs` |
| `doc/src/proto.rs::Transition::{reversed, accepts_drag}` | `reversedTransition`, `acceptsDrag` | Restated `back_and_reverting_play_the_animation_the_other_way`, `on_drag_starts_only_a_drag_its_animation_goes` |
| `doc/src/proto.rs::{Trigger::fires_on_key, KeyMods, key_alias, GAMEPAD_BUTTONS, uses_gamepad}` | `firesOnKey`, `splitKey`, `keyCombo`, `keyAlias`, `gamepadButtons`, `usesGamepad` | Restated `key_triggers_fire_for_their_key_or_combination`, `controller_buttons_fire_key_gamepad_triggers` |

## Acceptance

- Five restated native tests pass; they failed before (no such module).
- No browser case: the presenter (item 10) plays these, in the deferred queue.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
