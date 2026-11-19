# Presence command readiness

19 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `f88246b`. **This bounded slice passes. The full port remains unfinished.**

## Implemented boundary

Cursor chat and spotlight now follow the native readiness rules instead of only checking that a presence room exists.

[LivePeople](../../src/engine/sharing/live-people.ts) exposes one provider-neutral `signalBlocker`. A room is live between an authoritative identity and the next reconnect or stop; outside that window the reason is the native live-session text. A live room whose host has not confirmed signal support gives the native older-host text. `signals` is true only when there is no blocker, so a suspended or stopped room no longer reports stale support.

- `openChat` asks the host UI for the chat box only when unblocked and returns whether it did.
- `setChat` cleans first. Empty over empty succeeds anywhere. Every other request needs readiness, including repeating the current text; the value is stored and sent only when it changes. Oversized text cleans to the native default empty signal and therefore closes an open chat.
- `setSpotlight` compares the requested state first, so on-while-on succeeds during a reconnect. Starting needs readiness. Stopping never does, and an intent stopped during a reconnect is not announced after resuming.
- Stopping the room forgets chat, spotlight and signal support, as native leaving does. A retained reference cannot reopen, restart or resend anything.
- `executePeople` reads a null `text` or `on` as omitted, validates types before any readiness check, uses the exact native `BadParams` and `Disabled` messages and returns the stored chat and spotlight state. `collab.cursor` and `collab.follow` are unchanged: native does not gate them.

The [People controls](../../src/LivePeopleControls.tsx) report a refused spotlight through the existing notice, close the chat box when its session starts reconnecting and ignore a keystroke refused in that instant. The native window does the same: its chat box is dropped when the session is not live and typing discards the command result.

No provider, schema, access or transport-contract change was needed. The existing lifecycle callbacks already express the native distinction.

## Coordinator decisions recorded against the plan

1. **A room without an authoritative identity is not live.** The plan left this mapping to the coordinator. Native `Status::Live` is set by the welcome, the welcome supplies `info.me`, and READY counts only when it comes from `info.me`. A started room that has neither a welcome nor an acknowledged sample therefore reports the live-session reason, not the older-host reason. The first acknowledged sample or a welcome makes it live.
2. **Stopping clears local chat and spotlight.** Native `collab.leave` forgets them (`spotlighting_yourself`, final assertions). This also makes local closes on a stopped room harmless no-ops.
3. **The retained-non-empty-chat-while-blocked ordering has no reachable state.** Reconnect and stop both clear chat, and nothing else removes readiness. The implementation still checks the blocker before the changed-value comparison, as native does, but no fixture can observe that order through public or direct calls. It is verified by source review only.

## Browser substitutions

- The bundled provider's subscribed callback stands in for the native host's own READY signal. A custom provider that never invokes it is treated as an older host. Another client's packet, or another document's ready room, grants nothing.
- Presence travels as full samples, not individual signals. A resumed room sends its sample, including a retained spotlight, after the welcome and again with `hello` when the provider resubscribes. Native sends the spotlight signal once on READY. The observable result for peers is the same; the extra pre-ready sample is a property of the existing sample transport and was not changed here.
- Readiness is delivered once per provider subscription. The bundled Supabase watcher subscribes again after every recovery, and the real-reconnect Chromium workflow confirms cursor chat returns after an actual recovery. A custom provider that replaced a room without resubscribing would leave it reporting the older-host reason; that is a provider obligation, not a verified failure.

## Native mapping and independent evidence

Native [events.rs](../../original/figcraft/crates/engine/src/sharing/live/events.rs) `signal_blocker`, `live_chat`, `live_spotlight` and `reset_for_reconnect` map to `signalBlocker`, `setChat`, `setSpotlight` and `reconnect`. Native [join.rs](../../original/figcraft/crates/engine/src/sharing/live/join.rs) `cursor_chat` and `spotlight` map to `executePeople`. [params.rs](../../original/figcraft/crates/engine/src/automation/params.rs) `get` supplies null-as-omitted. [error.rs](../../original/figcraft/crates/engine/src/error.rs) supplies the two message formats. Native [live_signal_tests.rs](../../original/figcraft/crates/engine/src/live_signal_tests.rs) `chat_needs_a_session_whose_host_reads_it`, `your_chat_goes_out_cleaned_once_per_change` and `spotlighting_yourself`, and `live_docs_tests.rs` `chat_and_spotlight_stay_in_their_session`, supply the observable assertions. Native [ui-egui/live.rs](../../original/figcraft/crates/ui-egui/src/live.rs) `chat_box` and `app/commands.rs` `run` supply the window behaviour.

The independent fixtures restate the expected messages and outcomes without importing product constants or native code. No Rust was executed for this slice; the native observations are source and test readings at the pinned revision.

[Property matrix](26-11-19-presence-readiness-parity.html) · [Plan and source mapping](../planning/26-11-15-presence-readiness.md) · [Readiness contracts](../../tests/contracts/presence-readiness.test.ts) · [Presence parity](../../tests/parity/live-presence.test.ts) · [Browser fixture](../../tests/fixtures/browser-online-directory.ts) · [Chromium workflows](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `f88246b`, native reference `bad07e44`; global supported baseline remains `8eb0b876` |
| Failing fixture first | Before the change, 7 of the 8 new contracts failed against `606a9e0`; the send-once contract already passed |
| Focused checks | 37 passed: 8 readiness contracts, 11 presence parity, incoming peer bounds and session summary |
| Full pure suite | 4,790 passed in 26.08 seconds with four workers; 32 provider checks skipped in this invocation |
| Strict types / production builds | Library, tests and Next.js host passed on final source |
| Focused browser | Held readiness, release, reconnect and resumed welcome passed in 4.8 seconds; the existing view-only pointer, chat and spotlight workflow passed in 3.7 seconds |
| Cumulative Chromium | All 381 cumulative Chromium cases passed in one 1,020.723-second run with zero skips, retries, flakes or suite errors. |
| Real reconnect | The invite workflow now opens cursor chat once subscribed, finds it unavailable while the viewer is reconnecting after its heartbeat and redeem requests are cut, and opens it again after recovery: passed in 57.0 seconds |
| Real local provider integrations | 32 passed in 15.29 seconds after the cumulative browser run. The working tree then also held uncommitted core edits for the next slice; no provider or SQL source differed from `f88246b` |
| Schema | No declaration, migration, provider or access change |
| Local Supabase | `supabase status` reports the local stack running; a real local read returned PostgreSQL 17.6 with all 40 repository migrations applied, latest `20261115045709`. The hosted project was not read: the user directed verification to the local stack on 19 November and the slice makes no hosted call |
| Upstream | Read-only check: upstream `main` is 289 commits ahead of the fork and pin (`bad07e44..b45255bb`), fast-forwardable. Not synchronised, by the user's decision on 19 November |
| Fixture cleanup | All twelve counts zero: Auth users, files, stored objects, links, connections, rooms, clients, batches, presence connections, peer names, retirements and team libraries |
| Local graph | React 8,479 nodes/36,312 edges at `f88246b`; native 28,939/92,127 at `bad07e44`; combined 37,418/127,302. `signalBlocker` and `signal_blocker` verified. Unsupported extensions and data-only test modules require direct inspection |

## Verification corrections retained

Two existing parity cases started a spotlight or opened chat on a room that had never been told its host reads signals. That expectation was the mismatch the plan identified. Both now assert the refusal first, then establish readiness explicitly. No assertion was weakened and no timeout changed.

The first cumulative attempt passed 354, failed two and did not run 25. Both failures were `spawnSync pdftoppm ENOENT`: three PDF cases rasterise with Poppler's `pdftoppm`, which earlier runs found on the previous agent's runtime path and which is not installed on this machine. `preview.spec.ts` is serial, so the 25 cases after the first failure were skipped. The prerequisite is now in the [tests README](../../tests/README.md). With the existing binary's directory prepended to `PATH` and the real-reconnect assertions added, all 381 cases passed in one run. No product or test expectation changed for this correction.

## Reproduction

From the checkout root:

```sh
npx vitest run tests/contracts/presence-readiness.test.ts tests/parity/live-presence.test.ts tests/contracts/incoming-peer-bounds.test.ts tests/parity/live-session-summary.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview from `examples/nextjs` with `FIGCRAFT_PUBLISHES_PER_HOUR=1000 npx next start --hostname 127.0.0.1 --port 3101` and run, from the root:

```sh
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --grep "cursor chat and spotlight wait|view-only phone sees a live pointer" --workers=1 --retries=0
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --grep "published view and edit invites open" --workers=1 --retries=0
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0
npm run test:integration
```

Pass condition: every case passes with zero skips, retries or flakes in the cumulative run, and the focused readiness case reports the exact native refusals while the provider's subscribed callback is withheld.

## Remaining gaps

- No second physical participant observes the refused or resumed states in the held-readiness browser case; peer-visible chat and spotlight remain covered by the existing two-account workflow.
- The ordering in decision 3 is unobservable and unverified by execution.
- [Missing-comment-grant compatibility](../planning/26-11-15-missing-comment-grant.md) is the next slice.
