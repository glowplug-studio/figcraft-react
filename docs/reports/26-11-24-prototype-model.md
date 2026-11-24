# Roadmap row 15, item 7a: prototype model rules

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `17083a6`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

The player needs native's rules for how animations ease and how long they play, how Back reverses a transition, which drag starts an on-drag animation, and which keys and controller buttons fire a key trigger. [`prototype-model.ts`](../../src/engine/prototype-model.ts) restates them from `doc/src/proto.rs`: the curves, physical springs (a spring plays until it settles, whatever the duration says), transition reversal and drag direction, key combinations with their other spellings and aliases, and the standard controller buttons.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| Restated native tests | `proto_behaviour_tests.rs` (on drag, key triggers, easing and springs, Back and reverting), `proto_tail_tests.rs` (controller buttons) | Five cases pass; they failed before (no such module) |

No native observation file: the cases restate native's own tests.

## Recorded differences

- **No browser case.** The presenter (item 10) plays these rules and takes the browser case, in the deferred queue.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/proto.rs::{Easing, Spring, cubic_bezier}` | `prototype-model.ts` `evalEasing`, `easingSeconds`, `easingSpring` |
| `crates/doc/src/proto.rs::Transition::{reversed, accepts_drag}` | `reversedTransition`, `acceptsDrag` |
| `crates/doc/src/proto.rs::{Trigger::fires_on_key, KeyMods, key_alias, GAMEPAD_BUTTONS, uses_gamepad}` | `firesOnKey`, `splitKey`, `keyCombo`, `keyAlias`, `gamepadButtons`, `usesGamepad` |

[Property matrix](26-11-24-prototype-model-parity.html) · [Plan](../planning/26-11-24-prototype-model.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-model.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `17083a6`, native reference `bad07e44` |
| Failing fixtures first | The parity cases failed before |
| Full pure suite | 5,611 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 18.0-minute run at `17083a6` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 18.85 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,172 nodes/39,023 edges at `17083a6`; native 28,939/92,127 at `bad07e44`; combined 38,111/129,938. `evalEasing`, `easingSeconds`, `reversedTransition`, `firesOnKey` and `splitKey` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-model.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 7b to 10.
