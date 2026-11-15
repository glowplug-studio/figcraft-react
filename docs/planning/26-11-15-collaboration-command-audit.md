# Collaboration command registry audit

Read-only source audit on 15 November 2026: React `ac1d371` plus the existing uncommitted management work; native `bad07e44`. No tests were run by this audit. Test references below identify existing assertions, not newly verified results. The coordinator owns integrated verification and security decisions.

Scope: public `collab.*` entries from `sharing/live/join.rs`, `sharing/online.rs`, `sharing/collab.rs` and `sharing/invite_links.rs`. `cmd.rs` registers all four sources. There are 22 native commands; React registers 19. Of the three absent commands, `collab.diff` remains required and two are native-only omissions.

## Registry and evidence

Paths below are relative to the repository root. Native sharing paths begin `original/figcraft/crates/engine/src/sharing/`.

| Native command/source | Actual React route and existing evidence | Remaining gap |
| --- | --- | --- |
| `collab.diff`, `collab.rs:26–55` | Absent from `src/engine/editor.ts::commandSpecs`; underlying `sharing/live-changes.ts::diffLive` has native batch fixture comparisons in `tests/parity/live-changes.test.ts`. | Required public handler, baseline selection, native JSON receipt conversion and binary byte count; detailed slice below. |
| `collab.host`, `live/join.rs:195`, `live/host.rs::start_host` | Absent; `collab.peers` explicitly returns `canHost:false`; local `collab.share` rejects browser listening. | Native TCP/LAN listening is outside the browser target. Retain this explicit omission; do not claim command implementation. |
| `collab.registerLinks`, `invite_links.rs:55–82` | Absent. Native command invokes an OS URL-scheme registrar and changes its preference. | Native installed-app registration is outside the browser target. Existing web invitation joining is a separate workflow. |
| `collab.join`, `live/join.rs:7` | `editor.ts` → `sessionCommands` → `workspace.ts::#sessionAction` → `OnlineInvitations.beginJoin`; `tests/contracts/live-session-actions.test.ts` checks independent joins, invalid input, cancellation and late grants. | Persisted default-server selection is already planned separately; do not count it twice. No additional missing handler found. |
| `collab.leave`, `live/join.rs:37` | Same dispatcher, numeric logical-session lookup, local-copy retention and pending-edit notice; `live-session-actions.test.ts`, `live-session-summary.test.ts`. | No additional gap established by this source audit. |
| `collab.reconnect`, `live/join.rs:58` | Same dispatcher; immediate retry during backoff, failed-session rejoin and stable logical handle; `live-session-actions.test.ts:78–113`. | Presence command gating during reconnect needs the branch review below. |
| `collab.publish`, `live/join.rs:237` | `executeAsync` → `OnlineWorkspace.publishCommand` → staged publication/owner join; `tests/contracts/online-publication-commands.test.ts` compares native connecting receipts, source locking, cancellation and replacement. | No additional missing handler found. Transport and publication checks remain subject to coordinator verification. |
| `collab.share`, `live/join.rs:202` | Same route; online creation, pending access selection and existing-owner reshare; `online-publication-commands.test.ts`; actual host `examples/nextjs/lib/sharing/owner-sharing.ts::change` avoids duplicate groups. | Missing-grant access selection branch below. Browser local-host rejection is intentional. Default preference already planned. |
| `collab.stop`, `live/join.rs:77` | `editor.ts::executeAsync` revokes recorded group and retains owner session, otherwise calls leave; `online-publication-commands.test.ts:9–33` covers idle/shared/unshared and failed revocation receipts. | No additional missing handler found. |
| `collab.serverInfo`, `live/join.rs:244` | Async editor route → host serverInfo → `hostingSummary`; `live-session-summary.test.ts:209–239`, `live-session-details.test.ts` check selected endpoint and native hosting fields. | No additional gap established. |
| `collab.report`, `live/join.rs:258` | Editor `#sendReport`, queued synchronous receipt and awaited async receipt, provider report; `live-session-summary.test.ts:172–207` checks sanitation, live/feature gates and stale delivery notices. | No additional gap established. |
| `collab.removePerson`, `live/join.rs:107` | Async editor route → authorised guest host method; `live-session-summary.test.ts:142–170` checks client range, roster, authority, receipt and reconnect refusal. | Native locally hosted removal is covered by the local-host omission. No additional browser handler gap established. |
| `collab.peers`, `live/join.rs:265` | Editor session inspector → `LiveSessions` summary; `live-session-summary.test.ts` compares all fields against nine native lifecycle receipts, handles and text editing. | Incoming hostile-peer bounds are already queued separately. |
| `collab.cursor`, `live/join.rs:156` | Editor → `executePeople` → `LivePeople.point`; `tests/parity/live-presence.test.ts:116–134` covers paired coordinates, hide and no room. | No additional gap established. |
| `collab.follow`, `live/join.rs:90` | Same route → peer lookup/setFollow; `live-presence.test.ts` checks missing peers, follow/unfollow and page/view behaviour. | No additional gap established beyond the separately queued incoming bounds. |
| `collab.cursorChat`, `live/join.rs:169` | Same route → openChat/setChat; native sanitation fixtures and command calls in `live-presence.test.ts`. | Missing live/feature-ready branch guard below. |
| `collab.spotlight`, `live/join.rs:182` | Same route → setSpotlight; `live-presence.test.ts` checks toggle, follow cancellation and presenter handoff. | Missing live/feature-ready branch guard below. |
| `collab.files`, `online.rs:456` | Async editor → `OnlineWorkspace.execute`; `tests/contracts/online-workspace.test.ts:326–412,537–549` checks native directory fixtures, explicit refresh/cached results, multi-server records, privacy, sessions and errors. | No additional gap established. |
| `collab.forgetFile`, `online.rs:543` | Same route → `forgetRecord`; directory tests check ambiguity, atomic local forgetting and retained remote state. | No additional gap established. |
| `collab.openFile`, `online.rs:475` | Same route → `openRecorded`/`beginRecorded`; `online-workspace.test.ts:473–535,551` compares native duplicate/switched-tab receipts, cancellation, failed welcome and target errors. | No additional gap established. |
| `collab.recoverFile`, `online.rs:524` | Same route → recovery note validation, original-owner join and workspace merge; `tests/contracts/online-crash-recovery.test.ts` and native recovery archives exercise the recovery flow. | No additional missing handler established. Recheck existing coordinator recovery evidence before declaring full parity. |
| `collab.manageFile`, `live/join.rs:251` | Async editor → `OnlineWorkspace.manageFile` → host management. All seven action branches exist: links/createLink/revoke/share/unshare/rename/remove. `online-management-commands.test.ts` compares native receipts/target lookup/key forwarding/record updates; provider and browser management evidence is recorded in the management plan. | Full regression was running during this audit. Do not equate implemented branches with a fresh passing run. |

## Required bounded follow-ups

### 1. Public document diff

This is explicit remaining roadmap work, not a browser omission. Native `sharing/collab.rs::diff_cmd` selects the last undo document by default, refuses that baseline when the document is live, permits `against:"saved"`, rejects unknown modes and returns exactly `{changes,count,bytes}`. Empty undo history is an error. `count` is the number of changes. `bytes` is `message::encode(&d.changes).len()`.

Existing dependencies:

- `src/engine/sharing/live-changes.ts::liveReplica` and async `diffLive` already implement ordered document changes. `tests/parity/live-changes.test.ts:13` compares complete batches from `native-ordered-changes.zip`, including edits, reparenting, replies, deletion, page changes and undo.
- `src/engine/editor.ts` holds private `#undo:HistoryEntry[]` and `#saved:Document|null`. `newTab` establishes an initial saved document, but ordinary decoded-file installation resets `#saved` to null. Establish the correct native saved comparison baseline without changing the existing dirty/save UX as an incidental side effect. Native `ds.saved_doc` exists independently of whether the browser has downloaded the file.
- Native JSON serialises externally tagged changes and decoded property values (`crates/collab/src/change.rs::Change`). React's `LiveChange` uses a `type` discriminator and compact JSON strings. Add an explicit public receipt conversion, preserving full-width IDs and values. `tests/support/nativeLiveChange.ts` currently converts only in the opposite direction.
- `src/engine/sharing/session-postcard.ts` already independently implements the native property/entry variant order and UTF-8/Postcard sizing. Its writer only accepts create/setDoc/put and wraps an initial session. Extend or extract the reusable writer for all six change variants, including set/delete/remove, and a raw change-vector encoder/count. Do not count the initial-session envelope or 17-byte disk header.

Native `crates/collab/src/message.rs:960–969` defines the byte form as one wire-version byte followed by Postcard. For this command, the payload is the change vector alone. Therefore JSON transport request size and `liveChangeWeight` are not interchangeable with `bytes`. Exact native diagnostic sizing is feasible in independent TypeScript even though browser transport differs.

Verification plan: capture native complete receipts for no undo, rectangle create, property set, delete, document set, entry put/remove, saved versus undo baselines, saved empty diff, invalid mode, live default refusal and live saved success. Include non-ASCII strings and u64 IDs. Compare every public field and exact encoded length through the public async dispatcher; use an automated browser call for at least ordinary and live documents. Run relevant existing diff/Postcard/undo suites after implementation. Native starting tests are `collab_tests.rs::collab_diff_shows_the_last_edit` (177–188) and `collab_live_tests.rs::edits_sync_and_undo_takes_back_only_your_own` (204–206 for the diff assertions). No native code may become a runtime dependency.

### 2. Presence command readiness

Native `live/events.rs::signal_blocker` (325–336) requires `Status::Live` and negotiated signal support. `live_chat` and `live_spotlight` preserve no-op exceptions for already-empty chat/already-selected spotlight state; opening cursor chat returns `{open:false}` when blocked.

React `executePeople` currently checks room existence, not `LivePeople.signals` or live status. `LivePeople.reconnect` suspends the existing object, clears roster/chat and disables signal readiness, while `openChat`, `setChat` and `setSpotlight` remain callable. `WorkspaceEditor.tsx` attaches the room for the connection independently of that readiness. This supplies a concrete branch mismatch: a retained reconnecting room can accept commands that native refuses. The existing command parity test covers room/no-room but does not assert suspended or unsupported-signal behaviour.

Next: reproduce through the public dispatcher with a room whose signal transport has not become ready, then reconnect an existing live room. Verify open-chat receipt, non-empty chat refusal, empty-chat no-op, spotlight start refusal and spotlight stop/no-op behaviour. Retain provider-neutral readiness in the core; the coordinator decides the integration boundary. Do not conflate this with incoming hostile-peer bounds.

### 3. Existing share without requested grant

Native `live/host.rs::share` checks whether the selected access has a link and returns `NO_COMMENT_LINK` rather than selecting an absent grant. React `OnlineWorkspace.publishCommand` calls `selectAccess` after `change(true)`; `BrowserOwnerSharing.selectAccess` changes the selected access without checking its link. An existing edit/view group without a comment grant can therefore report selected comment access with null comment code/link.

The chosen host currently issues exactly three grants on new sharing groups, so this audit does not establish a fault in newly issued current-host groups. It establishes a missing compatibility branch and missing test. Reproduce with a retained two-grant device record and an already-live owner session; confirm no republish, no new grants and an explicit error when requesting comment access. Also check omitted access preserves the current selection. Keep unsupported native network interoperability outside this slice.

## Resumable checkpoint

- Audit complete; only this document was added. No source, tests, native checkout or hosted resources changed by the audit.
- First implementation action: finish the already-planned persisted-server preference and incoming bounds slices according to the coordinator's order, then implement the public diff slice above before declaring collaboration registry parity.
- Following independent checks: presence readiness and missing-grant selection. Existing handlers in the table remain subject to integrated regression, not this source-only review.
- Native-only omissions: local TCP/LAN host commands and OS invite-link registration. Document them as omissions rather than silently counting them as implemented registry entries.
