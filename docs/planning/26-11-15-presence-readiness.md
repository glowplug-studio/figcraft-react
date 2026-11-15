# Presence command readiness and missing-grant follow-up

## Execution checkpoint

- Phase: read-only source audit and implementation planning. Only this plan was written; no product/test edits, builds, native execution or hosted calls were made for this audit.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`).
- React starting HEAD observed: `86a862a82711260b49b98639ed3522ce8e21ebf0`, branch `prompt/full-figcraft-port`. Public-diff source/tests/planning are changing concurrently; this is not a verified revision for this follow-up.
- Prerequisite: finish the coordinator's public-diff checkpoint. Renew current branch/dirty state, repository instructions and local Graphify/native-pin checks before implementation. Preserve the in-progress public-diff work.
- Next action: implement and run a provider-neutral public-dispatch fixture for a started room with an authoritative identity but no subscribed/ready callback, reproducing blocked chat opening, non-empty chat and spotlight start. Then add the minimal core readiness boundary and reconnect/no-op fixtures below.
- Independent subsequent action: reproduce missing comment grant in an already-live owner session using a retained two-grant browser device record. Do not treat new three-grant group creation as proof of that legacy branch.
- Blockers: none established by this read-only audit. Final implementation allocation, exact test names/results and verified revision remain the coordinator's responsibility.

## Source mapping

Native paths are relative to `original/figcraft/`; native source remains reference material, with no runtime dependency.

| Native source / symbol | Observed contract | React owner / verification target |
|---|---|---|
| `crates/engine/src/sharing/live/events.rs:325` `signal_blocker` | First require `Status::Live`; then require negotiated signal support. The two failures have distinct text. | `src/engine/sharing/live-people.ts`: expose a provider-neutral blocker/readiness predicate; `executePeople` consumes it. |
| `events.rs:338` `live_chat` | Clean first; empty-to-empty returns before readiness check. Every other chat request checks readiness, even unchanged non-empty text. Mutate/send only when cleaned text differs. | `cleanPresenceSignal`, `LivePeople.setChat`, `executePeople(collab.cursorChat)`; contract with send/event counters. |
| `events.rs:356` `live_spotlight` | Identical requested/current state returns before readiness. Starting requires readiness; stopping does not. Starting cancels following and clears another presenter. | `LivePeople.setSpotlight`, public `executePeople`; retain existing follow/presenter semantics. |
| `crates/engine/src/sharing/live/join.rs:169` `cursor_chat` | Missing or null text opens only when unblocked and returns current chat; blocked opening is a successful `{open:false,chat}` with no UI request. Present non-string text is bad parameters. | `executePeople` text-null/default handling and chat-listener notification; public `EditorEngine.execute`. |
| `join.rs:182` `spotlight` | Missing/null `on` toggles; present value must be an actual boolean. Receipt reports actual spotlight state. | `executePeople` null/default handling and native error messages. |
| `events.rs:20` `reset_for_reconnect`; `events.rs:263` `live_signal_in` | Reconnect clears chat and signal support while retaining own spotlight intent; own-client READY re-enables support and resends own spotlight. A different client's READY does not grant support. | `LivePeople.reconnect/start/welcome`, provider `listen` subscribed callback and `signals` inspection; preserve host-neutral transport contract. |
| `crates/engine/src/live_signal_tests.rs` | `chat_needs_a_session_whose_host_reads_it`, `your_chat_goes_out_cleaned_once_per_change`, `spotlighting_yourself` establish readiness, no-op/send and reconnect behaviour. | Independent TypeScript public-dispatch fixtures in focused new `tests/contracts/presence-readiness.test.ts`, plus existing `tests/parity/live-presence.test.ts`. |
| `crates/engine/src/live_docs_tests.rs:299` `chat_and_spotlight_stay_in_their_session` | Readiness/chat/spotlight are per document/session; an unrelated live document does not authorise this document's commands. | Independent two-editor fixture with separate rooms. |
| `crates/engine/src/sharing/live/host.rs:92–132` `NO_COMMENT_LINK`, `share` | Existing active share selects only an available grant; missing grant returns an error without changing selected access. Omitted access preserves selection. Existing sharing is not published twice. | Separate compatibility branch in `src/engine/sharing/online-workspace.ts::publishCommand` and `examples/nextjs/lib/sharing/owner-sharing.ts::selectAccess`; proposed contracts below. |

## Exact readiness and command rules

Native Disabled errors are formatted by `crates/engine/src/error.rs:7`:

```text
command `collab.cursorChat` is not available right now: cursor chat and spotlight need a live session
command `collab.cursorChat` is not available right now: the session's host runs an older version without cursor chat and spotlight
command `collab.spotlight` is not available right now: cursor chat and spotlight need a live session
command `collab.spotlight` is not available right now: the session's host runs an older version without cursor chat and spotlight
```

Native parameter errors:

```text
invalid parameters for `collab.cursorChat`: `text` must be a string (empty closes the chat)
invalid parameters for `collab.spotlight`: `on` must be true or false
```

| Operation | No room / reconnecting / stopped | Live, support not ready | Live and ready |
|---|---|---|---|
| `collab.cursorChat` with omitted/null text | Return `{open:false,chat:currentChat}`; notify no chat listener. | Same blocked-opening receipt. | Return `{open:true,chat:currentChat}`; notify once. |
| Chat cleaning produces empty and current chat is empty | Return `{chat:""}` without requiring readiness or sending. | Same no-op. | Same no-op. |
| Non-empty cleaned chat; or clearing currently non-empty chat | Disabled with live-session reason; no mutation. | Disabled with older-host reason; no mutation. | Store cleaned value; send only when different. |
| Spotlight desired state equals current state | Succeed unchanged, including retained own `true` whilst reconnecting. | Same no-op. | Same no-op. |
| Start spotlight when currently off | Disabled with live-session reason. | Disabled with older-host reason. | Start, cancel follow and clear remote presenter. |
| Stop spotlight when currently on | Stop locally without readiness refusal. | Stop locally without readiness refusal. | Stop; one changed signal. |

The chat empty no-op uses the **cleaned** value, not raw `text === ""`. Controls/whitespace can clean to empty; oversized text becomes an empty/default signal through native `clean().unwrap_or_default()`. Preserve the existing 100-scalar chat limit, controls-to-spaces and 1,024-byte signal limit. Repeating the same non-empty chat still checks readiness before the changed-value optimisation; repeating the same spotlight state does not.

`collab.cursor` and `collab.follow` do not call `signal_blocker`. Do not add a generic gate over all People commands. Existing pointer/follow validation is outside this bounded readiness change.

## Smallest implementation boundary

Current `executePeople` checks room existence only. `openChat` unconditionally emits; `setChat` and `setSpotlight` accept calls while a retained room is suspended. Current `signals` is `signalReady && identity !== undefined`; disposal sets `alive=false` but does not clear `signalReady`, so using that getter alone would also permit a stale stopped object. `WorkspaceEditor` installs the room before `start()` and preserves it through connection-change callbacks; checking React visibility is insufficient.

1. Add one provider-neutral core blocker getter/method. A room which is not alive or is suspended gives the live-session reason; a started active room without confirmed identity/signal readiness gives the older-host reason. The coordinator should reconcile this mapping against the actual installed connection state; do not infer readiness from a roster entry or participant identity alone. A missing room has the live-session reason. Expose `signals` only when that blocker is absent so stopped/suspended inspection is truthful.
2. Gate opening chat before notifying listeners; return whether opening occurred. Apply the native no-op ordering in the core mutators as well as public dispatch so direct method calls cannot bypass it. Avoid duplicate cleaning/throwing paths; preserve public parameter validation before entering mutators.
3. In `executePeople`, treat null like omitted for `text` and `on`, validate actual types and use the exact errors above. Return actual stored chat/spotlight after the core action. No-room empty chat and spotlight-off remain successful no-ops.
4. Retain reconnect intent: chat resets; own spotlight stays true; stopping during suspension clears that intent so resume does not reannounce it. Preserve current coalescing, epochs, departure and stale-receipt logic. Readiness must be per room, never a global editor/workspace flag.
5. In the bundled browser transport, `listen`'s subscribed callback currently supplies capability readiness rather than a native READY wire message. Preserve that browser substitution and describe it in evidence. A fake provider can withhold the callback to represent an unsupported/unready host. Do not add native protocol negotiation, new permissions or provider-specific logic to the core.

Expected product ownership is confined to `src/engine/sharing/live-people.ts`, with adapter/WorkspaceEditor changes only if a reproducing fixture proves current lifecycle callbacks cannot express native live-versus-reconnecting distinction. No renderer or schema change is implied. Existing tests that create a room and immediately expect chat/spotlight before invoking `ready()` must be corrected to establish explicit readiness; that old fixture expectation is the mismatch, not evidence to preserve premature access.

## Independent acceptance fixtures

Proposed fixture names are not existing tests or passing results.

- **No room:** omitted/null chat returns `{open:false,chat:""}`; empty/whitespace/controls/oversized-cleaned chat returns `{chat:""}`; non-empty chat and spotlight-on fail with exact live-session error; spotlight-off succeeds.
- **Started room, welcome present, READY withheld:** `signals:false`; opening does not notify; non-empty chat/start spotlight fail with exact older-host reason. Malformed text/on fails with parameter error, not readiness error. Omitted/null `on` toggles from off and therefore fails here.
- **Readiness transition:** invoke this room's provider subscribed callback; public chat opens once and clean text stores correctly; spotlight starts. A packet/sample from another client alone cannot grant readiness. An independent second editor's ready room cannot unblock the first.
- **No-op order:** ready room sends cleaned chat once per change, including close; after readiness is lost, same non-empty chat still refuses if non-empty local state is retained in a controlled fixture. Empty-to-empty always succeeds; spotlight-on while already on succeeds even during reconnect. Include current-state comparison before blocker checking explicitly.
- **Reconnect:** begin with chat plus own spotlight; call reconnect; assert chat empty and signals false while own spotlight remains true. Opening stays closed, new chat/start-from-off refuse with live-session reason. Same-state spotlight-on succeeds. Spotlight-off succeeds whilst suspended and does not restore on after welcome/readiness resumes.
- **Reconnected, no support yet:** after welcome but before subscribed/ready callback, errors switch from live-session to older-host reason. On renewed support chat and new spotlight work again; an unmodified own spotlight is reannounced exactly once through the existing transport coalescing contract.
- **Disposal:** retain a reference to the stopped room and assert false signals; direct open/start/chat cannot mutate it. Local no-op closures remain harmless; no unexpected network send after the existing one-time leave.
- **Non-mutation:** all refused calls preserve chat, spotlight, follow, presenter, history, selection, document and send/event counts. Do not count pre-existing subscription/heartbeat samples as newly sent command signals.

Run the new contracts with `tests/parity/live-presence.test.ts`, `tests/contracts/incoming-peer-bounds.test.ts` and `tests/parity/live-session-summary.test.ts`, then strict types and relevant complete regression. Existing incoming-bound, epoch and presenter-replacement tests must remain valid. For Chromium, use the established public command bridge in the authenticated local preview: exercise a not-ready/reconnecting provider fixture, assert no chat input opens and exact public receipts, then release readiness and confirm ordinary chat/spotlight. If actual browser callback control is unavailable, add a local provider-neutral test host rather than weakening core tests or changing production authentication. Record exact final fixture/bridge identifiers before claiming browser coverage.

## Separate missing-grant compatibility branch

Continue the [dedicated missing-comment-grant plan](26-11-15-missing-comment-grant.md) after readiness. Its later source audit found that the current device reader rejects two-grant records, so a typed two-grant object does not establish persisted compatibility. It also distinguishes an available link from an unavailable join code; never infer link availability from codes alone. That plan owns the compatibility scope, fixture, exact refusal and UI requirements. No missing-grant implementation was started during this readiness analysis.
