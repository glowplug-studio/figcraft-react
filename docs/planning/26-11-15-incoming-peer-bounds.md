# Incoming peer identity bounds

## Execution checkpoint

- Complete at implementation `6818860`, native `bad07e44`, verified 2026-11-15 12:53 ICT.
- 4,713 pure, 23 focused, 32 provider checks, strict types and both builds pass. Final host 256 passed in 699.007 seconds; all 122 non-host cases passed on the same build. Two-run accounting, timeout/setup corrections and all twelve zero cleanup counts are retained in [the report](../reports/26-11-15-incoming-peer-bounds.md).
- Production preview stopped. No hosted writes, Vercel, branch push or main merge. Tracker remains uncommitted.
- Next: execute [public collaboration diff](26-11-15-public-collaboration-diff.md) after renewed preflight; then the remaining full-port roadmap.
- Tracker reweighting: the narrow incoming compatibility delta uses weight 0.1 alongside three remaining broad families at weight 1 each, avoiding treating this small correction as one quarter of all upstream updates. Remaining active work reassessed to 18–42 hours.

## Source contract and mapping

All native paths below are beneath `original/figcraft/`; native source is reference material, never a product/build/test dependency.

| Native source / symbol | Observed behaviour | React owner / target |
|---|---|---|
| `crates/collab-net/src/join.rs::bounded`, `MAX_PEER_NAME`, `MAX_COLOR` | Keep the first 256 Unicode scalar values of `Peer.name` and first 32 of `Peer.color`. Do not trim, remove controls, require a palette colour or enforce a byte limit here. | `src/engine/sharing/live-presence.ts`: separate incoming identity bounds from outgoing signal cleaning. |
| `join.rs::take`, `ServerMsg::Welcome` | Take the first `MAX_PEERS` roster entries, bound every retained identity, store that roster in `Seen`, replace the welcome message's own `peers`, then deliver both UI welcome and sync event. The sync consumer receives the bounded roster rather than a second raw copy. | `readPeopleWelcome`, `LivePeople.welcome/start`, `LiveTransport.people.welcome`, browser `Grant.welcome` and reconnect paths. React drawing sync has a different transport shape: audit retained transport references rather than invent a Rust wire-message dependency. |
| `crates/collab/src/message.rs::MAX_PEERS` | `4_096`. Excess welcome entries are left out; an oversized roster is not rejected wholesale. | `readPeopleWelcome`: truncate before mapping retained entries; `LivePeople`: cap retained entries and permit existing-entry updates at capacity. |
| `join.rs::take`, `ServerMsg::PeerJoined` | Bound identity before storage. A self update changes confirmed name/colour and emits a welcome without adding self to the other-peer roster. Existing peers can update at capacity; a new peer is omitted until someone leaves. | `readPeerMessage`, `LivePeople.accept`, bounded send receipts/self identity and reconnect welcome handling. React uses provider samples rather than a separate native `PeerJoined` event; preserve its generation/sequence checks. |
| `join.rs::take`, `PeerLeft` | Remove the peer, making room for later joins. | Existing `LivePeople` departure/expiry handling and `departed` cap; regression tests. |
| `crates/collab-net/src/client_cap_tests.rs` | Named fixtures listed below establish cap, update, departure, truncation and sync-welcome replacement. | Independent TypeScript fixtures in `tests/parity/live-presence.test.ts` and a focused provider-neutral welcome contract test. |

## Observed React mismatches

1. `readPeerIdentity` currently delegates names to `cleanPresenceSignal(kind: name)`: it trims, removes controls, applies a 64-scalar outgoing limit and first rejects signals over 1,024 UTF-8 bytes. Long hostile incoming names can therefore reject a welcome or packet instead of becoming a 256-scalar identity.
2. Incoming colours currently must equal one of `presenceColours`. Native accepts arbitrary strings and bounds them to 32 scalars, including empty colours. Outgoing provider palette assignment must remain separate.
3. `readPeopleWelcome` rejects any roster over 4,096, then maps the entire allowed roster. Native retains the first 4,096. Invalid trailing entries outside that prefix must not invalidate the retained prefix.
4. `LivePeople.welcome` trusts its typed `PeopleWelcome` argument, retains `welcome.me` directly and iterates all supplied peers without its own bounded read. A custom host can bypass the browser adapter parser. Initial welcome through `start()` and reconnect welcome through `WorkspaceEditor.connectionChanged` both reach this method.
5. `readPeerMessage` invokes `readPeerSample` before merging `readPeerIdentity`, so merely fixing the identity reader still leaves incoming names subject to outgoing name validation. Split the shared sample fields from incoming identity handling; retain chat/presence validation and outgoing request validation.
6. `LivePeople.send` currently trusts `receipt.name` without a bound when updating confirmed identity and only accepts palette colours. An arbitrary provider's send acknowledgement is another incoming self-identity path. Bound/validate its identity before retention, preserving the current alive/suspended/epoch safeguards and client/generation checks where applicable.
7. The core currently retains the supplied `transport` object as a constructor property. Normalising only the UI entries would still allow its welcome object to retain a raw oversized roster. The implementation must also address this retained reference and provider storage, rather than claiming that a bounded visible list alone meets the native sync guarantee.

The first four are direct parity mismatches; the latter paths identify where a partial fix would leave the boundary incomplete. They are source observations, not executed regression results.

## Complete ingress and retention audit

- `src/engine/sharing/live-presence.ts`: incoming `readPeerIdentity`, `readPeopleWelcome`, `readPeerMessage`; outgoing `cleanPresenceSignal` and `readPeerSample` must retain their current contract. Existing `native-presence-signals.json` verifies outgoing signals, not incoming roster bounds.
- `src/engine/sharing/live-people.ts`: initial `start → welcome(transport.welcome)`, direct/reconnect `welcome`, `accept` broadcast updates, send acknowledgement identity, `entries`, `identity`, cached `list`, departed generation/sequence records and editor follow callbacks. No entry, identity or cached list may retain a raw identity string. Keep existing 4,096 cap and departure reuse behaviour.
- `src/engine/sharing/live-transport.ts`: document `people.welcome` as bounded before provider retention and still untrusted at core ingress. A TypeScript type is not validation. Core should retain only bounded initial welcome plus the send/listen operations it needs, rather than a private copy of a host object carrying a raw welcome. Preserve operation receiver semantics when wrapping methods.
- `src/WorkspaceEditor.tsx`: `LiveConnection` constructs `LivePeople` using `invitations.live(connection).people`; `connectionChanged` passes the current physical connection's welcome after reconnect. Both must use the same core normalisation; avoid a UI-only fix.
- `examples/nextjs/lib/sharing/browser-invites.ts`: `redeem` already calls `readPeopleWelcome` before `addGrant`; both `joinOwned` and `finishJoin` retain its result. `restore` replaces `Grant.welcome` following another `redeem`. `live().people.welcome` exposes that stored roster; `inspect` exposes its self identity. Confirm every stored welcome is the bounded replacement and no original response object is stored beside it. The monitor callback forwards messages via `peopleListeners`; they must be bounded before `LivePeople` retains them. Pending/cancelled/replaced connections must not restore stale rosters.
- `src/backends/supabase/live-presence.ts`: `welcomeLivePeople` maps trusted database palette indices; `sendLivePresence` validates client outgoing samples using `readPeerSample`, then overlays authoritative identity. Do not weaken this server-facing outgoing validator when admitting bounded arbitrary incoming colours. `presenceBroadcaster` continues byte/channel bounds. No provider-specific policy belongs in core readers.
- `src/engine/sharing/live-peer.ts` and `LiveTransport`: drawing replication uses archive/journal data, not a Rust `ServerMsg::Welcome.peers` field. Verify the transport retained by drawing sync exposes only the bounded provider welcome. There must be no parallel raw roster field in the browser grant, reconnect cache or a new wrapper.
- `src/LivePeopleControls.tsx`: names become React text/canvas text; colours reach canvas styles and React style values. Preserve the bounded incoming string in the model; use a rendering fallback for unsupported colour syntax if necessary without rejecting or replacing the identity itself. Do not interpret it as HTML, a stylesheet or a remote resource.

The application cannot erase memory owned independently by an arbitrary external host. Its contract can require bounded provider retention, and core-owned retained objects must not add a raw duplicate. Verify the bundled provider and the provider-neutral core independently.

## Smallest complete implementation

1. In `live-presence.ts`, add a bounded scalar-prefix helper that stops after the cap rather than materialising a whole hostile string with spread. JavaScript iteration counts supplementary characters together; account explicitly for isolated UTF-16 surrogates because native strings contain valid Unicode scalars. Retain existing numeric client/generation validation and strict string types. Define incoming name/colour bounds once. Bound the first 4,096 welcome entries, preserving order. Make incoming sample decoding bypass outgoing name cleaning while preserving the existing chat/presence checks.
2. In `live-people.ts`, normalise every initial/direct/reconnect welcome and self receipt before storing it; use incoming identity decoding for broadcasts. Do not retain the caller's raw welcome/identity or the transport object containing it. Keep only the bounded data and necessary transport operations. Preserve generation ordering, departures, self omission, cap-aware updates, follow/spotlight and cancellation. A malformed incoming identity must not partially mutate the roster. Keep current fresh-connection reconnect clearing; test repeated welcomes before deciding whether any broader replacement semantics need changing.
3. In `live-transport.ts`, state the bounded provider retention contract. Audit `browser-invites.ts`; its existing parser-before-Grant path should inherit the new bounds without a product edit unless evidence identifies another raw retention path. Change the adapter only if required to close such a path. The outgoing Supabase reader should remain unchanged if the split is correct.
4. Tests: extend `tests/parity/live-presence.test.ts`; add `tests/contracts/incoming-peer-bounds.test.ts` for an arbitrary host transport and a retained browser/reconnect welcome if an existing fixture cannot cover it. Extend `tests/e2e/preview.spec.ts` with the focused welcome/update/reconnect browser cases below. Keep any new generated native fixture independent and under `tests/fixtures/`; do not execute or import Rust during tests.
5. Record source mapping and results in this checkpoint, `docs/parity/cross-repository-mapping.md`, the row-14 command/roadmap record and resume handover; refresh React/combined Graphify at the checkpoint. No hosted database, migration, authentication or Vercel changes are required for these client bounds.

Expected mandatory product files: `live-presence.ts`, `live-people.ts`, `live-transport.ts`. Adapter or UI changes are conditional on retention/rendering evidence; do not broaden this into a transport or presence redesign.

## Native fixtures and verification

Available native tests in `client_cap_tests.rs`:

- `presence_from_more_people_than_the_cap_is_left_out`: bounded pending presence and existing-client updates.
- `joins_past_the_cap_are_left_out_until_someone_leaves`: 4,096 retained peers, existing-client rename at capacity, new-client omission, departure then admission.
- `a_hosts_long_names_and_colours_are_cut_where_they_are_kept`: 100,000 ASCII characters become exactly 256/32.
- `the_welcome_handed_to_the_sync_client_carries_the_bounded_roster`: the sync welcome itself holds 256/32; a separately bounded UI projection is insufficient.

No dedicated incoming-peer JSON fixture was found during this audit. The existing `tests/fixtures/native-presence-signals.json` has 14 outgoing signal cases and must remain unchanged unless regenerated for an independently justified outgoing change. Translate the named native assertions into independent TypeScript fixtures, supplementing ASCII with supplementary Unicode, combining sequences and boundary lengths 255/256/257 and 31/32/33. Truncate scalars, not grapheme clusters, UTF-16 units or UTF-8 bytes. Include whitespace/control characters, arbitrary/non-palette/empty colours, empty names and malformed non-string fields. A 256-scalar multibyte name must survive despite exceeding the outgoing signal byte budget.

Provider-neutral tests must cover direct unparsed transport welcome, reconnect/direct callback welcome, broadcast identity updates, self acknowledgements, the first 4,096 entries of a 4,097+ welcome, ignored malformed trailing entries, updates at capacity, leave-and-reuse and late packets after reconnect/dispose. Inspect the stored provider welcome and core-owned state, not only `getSnapshot()`, to establish absence of a raw duplicate. Keep outgoing 64-scalar names, signal 1,024-byte limit and provider palette assignment regressions passing unchanged.

Browser strategy: use the existing local `withSharedDrawing` and `/api/online-files/presence` route interception pattern in `preview.spec.ts`. Intercept the guest's welcome response to insert a long name/colour and over-cap roster; hold normal pointer samples where necessary so they cannot overwrite the welcome before assertion. Assert the People menu is usable, shows the bounded name and retained count, and the drawing still synchronises. Inject a later hostile update through the existing realtime/provider harness and exercise a reconnect welcome; verify the same bounds and no stale identity restoration. If the standard browser fixture cannot inject arbitrary provider callbacks or inspect bounded retention, add a small local provider-neutral test host rather than changing production auth or relying solely on request interception. Do not claim a rendered menu proves absence of a retained raw duplicate; that requires the contract/adapter assertions above.

Reproducible focused checks after implementation (not run for this planning slice):

```sh
npx vitest run tests/parity/live-presence.test.ts tests/contracts/incoming-peer-bounds.test.ts
npx tsc -p tsconfig.tests.json --noEmit --pretty false
```

Run the new Chromium cases and the existing People initial-welcome, reconnect, pointer/chat/follow/spotlight and generation/departure cases using their actual final test titles. Record exact commands, tested revision, results and any local provider substitution here before marking row 14 reconciled. Historical browser passes at the prior native pin do not verify this slice.

## Coordinator rendering follow-up

The incoming-colour change also requires an actual rendering boundary. Native `ui-egui/src/live.rs::color` calls `engine/sharing/live/types.rs::parse_color` and falls back to the native accent for anything except its accepted RGB form. React `LivePeopleControls.tsx` currently puts retained colours directly into CSS `color`, Canvas `fillStyle`/`strokeStyle`, and `textOn` parsing. Previously the incoming palette restriction hid this mismatch. Preserve the arbitrary bounded string in protocol/inspection state, but derive the native accepted display colour or accent before drawing/menu styles. An invalid Canvas colour otherwise retains the previous drawing style instead of showing the accent. Make this UI file an explicit slice dependency, with native hex/fallback fixtures and a browser invalid-colour overlay assertion; do not weaken outgoing identity validation or mutate the inspected colour string merely for rendering.

## Active implementation checkpoint

Preflight on 15 November: authorised fork sync remained at `bad07e44`; scoped Supabase public-table read succeeded with an empty list. No hosted writes. Local Graphify source snapshot `6d03c89` matches the implementation preceding this slice: React 8,417 nodes/36,077 edges, native 28,939/92,127. Queried `LivePeople`, the three ingress readers and native `bounded`/`take`; 63 React and 22 native linked edges include the tests and driver/guest consumers. Refresh after this slice.

Root owns readers, lifecycle and transport contract. Delegates own colour rendering/fixtures, core/parity tests and the authenticated browser fixture. The Unicode decision is to reject an isolated UTF-16 surrogate in the retained prefix, which cannot occur in native Rust strings; ignored tails are not validated. Bound provider methods preserve receiver semantics and can retain provider-owned state. Core keeps no direct raw welcome/transport duplicate; the bundled provider stores the normalised result. This does not claim to erase arbitrary external-host or closure-owned memory.

Initial focused run: 19 tests passed across live-presence, incoming-peer-bounds and peer-colour. A further invalid-acknowledgement regression is being included in cumulative verification. Full pure tests and both builds are running; retained temporary log names are `fc-bounds-pure.log` and `fc-bounds-build.log`. Next collect those results, run strict types/provider integrations, then start the production preview on unused port 3101 and run the hostile-welcome and existing People/reconnect browser flows. Preserve the application on port 3100. No schema change is needed. Full cumulative Chromium, reports, graph refresh and implementation commit remain outstanding.

### Review correction and current checks

The first unrestricted pure run alongside a production build reported four timeouts: session-Postcard, wide-page file format, paint clipboard and the new retained-state assertion. The assertion unnecessarily rescanned the retained graph per peer; replacing it with Set membership makes that check linear. The next run with two workers passed 4,710 checks (32 integration checks skipped); timeouts were not increased.

Review then found two direct-welcome lifecycle gaps: pending same-generation receipts could overwrite the new self identity, and a changed-generation peer could leave stale presenter state. Accepted welcomes now invalidate pending receipt epochs; a replacement without spotlight clears presenter and only its associated follow. Both new regressions pass. The first cumulative browser attempt was interrupted to rebuild these corrections, not counted as a final gate.

The updated production build passed. Final full pure run (`fc-bounds-pure-release.log`), strict types (`fc-bounds-types-final.log`) and all 378 Chromium cases (`fc-bounds-release-browser.log`, one worker, zero retries) are running against this source. Production preview uses port 3101. The new browser adapter contract independently verifies actual initial/reconnect Grant storage and exposed welcome/inspection values. Before the final lifecycle corrections, all 32 real provider integrations passed in 26.72 seconds and four focused Chromium cases passed in 25.9 seconds, including hostile welcome, phone initial roster and view-only pointer/follow/spotlight. No database declarations changed; the prior 448-assertion empty replay, drift and advisers remain the applicable schema evidence.

### Committed implementation, cumulative browser gate running

Implementation `6818860` is the exact source of the final production build. Final pure suite: 4,713 passed, 32 provider checks skipped in that invocation; all 32 provider integrations passed separately. All 23 focused boundary checks, final strict types and both builds pass. The latest f32 contrast fixtures were independently checked using the native arithmetic in a disposable Rust process; no runtime dependency was added.

Final cumulative Chromium is running with one worker and zero retries, log `fc-bounds-final-browser.log`, tool session 87233; production preview session 3214 on port 3101. Do not launch another run before collecting its result. Earlier interrupted runs are not final evidence. Local Graphify covers this committed source: React 8,436 nodes/36,153 edges; native 28,939/92,127 at bad07e44; combined 37,375/127,157. Eighty-eight unsupported-extension files and data-only test modules require direct source inspection.

Next collect all 378 browser results, verify twelve fixture counts zero and stop preview cleanly; finalise property report/mappings, tracker percentage/time estimate and handover, then commit documentation excluding the tracker. Begin [public collaboration diff](26-11-15-public-collaboration-diff.md) immediately afterwards. Scope remains the full browser port; no publication or merge to main yet.

### Cumulative test setup correction

The first completed cumulative attempt at `6818860` is failing on owner crash recovery before that feature is exercised: the publication dialog reports the native hourly allowance refusal. The coordinator omitted the documented cumulative-only `FIGCRAFT_PUBLISHES_PER_HOUR=1000` when launching the production server. Default admission therefore correctly refuses further publications; production defaults and policy source remain unchanged. Collect the completed JSON and non-host results, stop the preview, restart only the idle local Figcraft database (ephemeral admission reset), relaunch production with that explicit setting, and rerun host verification. Do not weaken or skip the dedicated default/one-per-hour tests. Source: `supabase/README.md` cumulative verification instructions. This setup failure must remain distinct from product parity results.

### Host rerun started with documented admission setup

The completed full attempt at `6818860` passed 131, failed one and serial-skipped 246; all 122 non-host render/export/performance cases passed. Owner recovery failed before exercise due to the default hourly publication refusal. Preserved JSON `fc-bounds-rate-limited-browser.json` and trace `fc-bounds-rate-limit-trace.zip`. All twelve fixture counts were zero afterwards. Stopped the preview, restarted only the idle local Figcraft database, verified readiness and relaunched the same production build with `FIGCRAFT_PUBLISHES_PER_HOUR=1000`. The 256-case host rerun now uses `fc-bounds-final-host.log`, one worker and zero retries. Preview session 96869. Keep this two-run accounting explicit; there is not one green full invocation.
