# Existing share without a comment grant

## Execution checkpoint

- Phase: bounded source analysis and implementation plan only. No product changes, tests, builds, servers or hosted calls were made for this plan.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). Coordinator-supplied React preflight: `86a862a`, with the public-diff slice being verified separately. This is not a verified implementation revision for this slice.
- Source queue: item 3, “Existing share without requested grant”, in [the collaboration command audit](26-11-15-collaboration-command-audit.md).
- Next action: renew branch/dirty-file and instruction preflight after public diff; reconcile the persisted-record scope below; reproduce the missing-grant branch through the public async command before editing its owners.
- Keep this slice separate from presence signal readiness, incoming identity bounds and public diff. Do not change sharing authorisation, automatically rotate grants, publish another file or add native network hosting.

## Native contract and source mapping

All native paths below are reference-only beneath `original/figcraft/`; no product/build/runtime test may depend on them.

| Native owner | Observed behaviour | React owner |
| --- | --- | --- |
| `crates/engine/src/sharing/live/types.rs::Shared`, `Shared::of` | Edit link is required; view and comment links are optional. A missing comment link is explicitly documented for an older server or older share. Availability means a link exists, independently of whether it has a join code. | `SessionDetails.share` has nullable per-access links/codes; `OnlineOwnerSharing`, `OwnerShareSummary`; browser `DeviceOwnerSharing.links`. |
| `crates/engine/src/sharing/live/host.rs::share` | For an already active share, do not publish again. If links already exist, do not request replacements. An explicit requested access is checked with `links.of(access)` before changing `share.access`; an absent grant returns `NO_COMMENT_LINK` and leaves selection unchanged. Omitted access preserves selection. An unshared retained owner session may first request new links; validate the requested access against that returned group. | `src/engine/sharing/online-workspace.ts::publishCommand`, existing-live-owner branch; `examples/nextjs/lib/sharing/owner-sharing.ts::change/selectAccess`. |
| `host.rs::NO_COMMENT_LINK`; `crates/engine/src/error.rs::EngineError::BadParams`, `bad` | The public error is a bad-parameters error with the exact text shown below. Although the constant names comment, the check is whether the requested link exists. | Public async `collab.share` rejection; direct adapter selection must also refuse an unavailable grant before mutation. |
| `crates/ui-egui/src/live.rs::access_choice` | Filter all access levels through `Shared::of`. No selector when fewer than two choices remain. The remaining order is edit, comment, view. Selecting a choice dispatches `collab.share {access}`. | `src/OwnerShareControls.tsx`: access options, selected value, code and copy controls. |
| `crates/ui-egui/src/live_share_tests.rs::sharing_online_shows_the_code_copies_it_and_stops` | Two-link online share offers edit/view, omits “Can comment”, preserves its code/link and does not publish again when selection changes. | New focused UI/browser regression using a two-grant group. |
| `live_share_tests.rs::a_server_with_comment_links_offers_a_comment_code` | Three-link share offers comment between edit/view; comment copying and subsequent view selection use their own credentials; stopping revokes all three. | Preserve existing three-grant browser flows and add explicit offered-option coverage. |
| `crates/engine/src/live_share_tests.rs::links` and sharing tests | Existing test helper constructs edit/view with `comment:None`; native supports this representation. | Independent TypeScript fixtures, without importing/executing native code. |

Exact native error text, without Markdown ambiguity:

```text
invalid parameters for `collab.share`: this share has no comment code (its server is older than comment links, or it was shared before them): stop sharing and share again
```

## Current React findings

1. `OnlineWorkspace.publishCommand` recognises the live published owner and calls `sharing.change(file,true)`, then unconditionally `selectAccess(file,access)` when access was supplied. It does not check the selected link. Its omitted-access branch already avoids `selectAccess`; preserve that behaviour.
2. `BrowserOwnerSharing.change` returns the existing locally retained group without making status/change requests when it is already enabled and has no pending operation. This is the correct reuse path; keep it. `selectAccess` currently changes its cached summary without checking that access's link. `inspect` then exposes comment access alongside null comment code/link.
3. `OwnerShareControls` always renders edit/comment/view. It updates component state before calling `selectAccess`, and does not catch a selection failure. Adding only a throwing adapter guard would leave an incorrect visible selection and an uncaught event error. Filter unsupported choices and change local selection only after successful selection, with the existing status message for failures.
4. The bundled host creates three credentials on a new group. `BrowserOwnerSharing.submit` explicitly requires three returned links for a start and zero for a stop; retain that issuance validation. No current-host newly issued two-grant group was established by this source audit.
5. **The audit's proposed persisted two-grant fixture currently cannot reach selection.** `src/backends/browser/owner-sharing.ts::isSharedCredentials` accepts only zero or three entries; `readDeviceOwnerSharing` rejects a stored edit/view pair as “Invalid private sharing record”. `IndexedDbRecoveryStore.ownerSharing` uses that reader. Distinguish a provider-neutral two-grant session from an actually loadable bundled device record. A typed/mock two-grant row bypassing the reader is not evidence of persisted compatibility.
6. `OwnerShareSummary.codes` alone cannot express an available link from a server without join codes. Do not equate a null/missing code with an absent link in the provider-neutral command boundary. Native explicitly permits links without codes.

## Smallest complete implementation

The coordinator should own command/contract decisions; allocate adapter, component and tests only after those decisions are fixed.

1. Add one shared missing-grant diagnostic at the appropriate core boundary. In the existing-live-owner command path, after any necessary `change(true)` and before selection, inspect the current returned/retained grant availability. When `SessionDetails.share` explicitly has no requested link, reject with the exact public native error and preserve the selected access. Do not republish, create replacement credentials or stop sharing to make the request succeed. Check omission separately: an absent access is not a request to reset to edit.
2. Defend `BrowserOwnerSharing.selectAccess` itself using the retained link, before updating its cache. Both public command and UI/direct adapter callers then preserve selection. The adapter may expose the shared diagnostic; avoid duplicating slightly different error strings across owners.
3. Make grant availability explicit for the UI where codes are insufficient. A small additive `OwnerShareSummary` field such as `availableAccess` can carry roles from actual links; `BrowserOwnerSharing` can derive it from `row.links`. Use actual link availability when known; legacy adapters may derive supported choices from present code keys. Keep link-without-code distinguishable in the contract and tests. `OwnerShareControls` offers only available roles, in native order, and avoids a redundant selector with fewer than two. A failed explicit selection must not update local role or displayed code.
4. **Persisted compatibility scope:** if this slice is to fulfil the earlier audit's retained-device-record acceptance, extend the shared credential reader narrowly to accept a valid edit/view pair as well as existing empty/three-role groups. Keep all ID/token/code/uniqueness checks; reject edit/comment or view/comment pairs, duplicate roles and arbitrary one-role records. Keep `submit`'s explicit current-host three-grant start requirement unchanged. This is compatibility reading, not a change to issued groups. If the coordinator keeps storage compatibility out of scope, record that limitation and run the two-grant command/UI fixture through a provider-neutral test host instead; do not claim a real retained record works.
5. Correct existing publication fixtures that mark `shared:true` but leave every link null. They currently allow comment selection without proving that a comment grant exists. Positive fixtures should contain coherent edit/view/comment links; add an explicit two-grant fixture for refusal.

Expected owners: `src/engine/sharing/online-workspace.ts`, `src/backends/online-files.ts`, `examples/nextjs/lib/sharing/owner-sharing.ts`, `src/OwnerShareControls.tsx`; `src/backends/browser/owner-sharing.ts` only if persisted compatibility is included. No database/API/schema migration or credentials-issuance change is needed.

## Focused tests and browser acceptance

Before changing source, reproduce the public failure with an already-live owner, a coherent two-grant summary and a spy-backed provider. A successful refusal must leave document, session, selected access, edit/view links and codes unchanged.

- Public contracts: extend `tests/contracts/online-publication-commands.test.ts`. Explicit comment on a two-grant active share rejects with the native text; `collab.peers` still selects the prior edit or view grant; omitted access preserves the current view selection. Existing sharing is reused, `store.publish` remains at one call, and no new group/change request or leave occurs. Add successful three-grant comment selection and missing-view coverage using actual links, plus a link-present/code-null case to prevent a code-based guard.
- Adapter contracts: extend `tests/contracts/live-session-details.test.ts` or add a focused owner-sharing contract. Read a two-grant row, select view, refuse comment and retain the exact inspected state. Existing `change(true)` must make no fetch or persistent mutation. Verify three-grant comment selection and copying still succeed. If storage reading changes, use the actual `IndexedDbRecoveryStore`/fake IndexedDB reader rather than only a typed mock row, and reject malformed two-entry variants. Confirm current-host start receipts containing only two links remain invalid.
- UI: independently mount `OwnerShareControls` with a coherent two-grant provider. Only “Can edit” and “Can view” are offered; view selection changes the code and copied link correctly; no “Can comment” option is rendered. An explicit failing selection through the provider/public command leaves UI selection and code unchanged, and does not cause a page error. Three-grant groups retain all three choices in native order.
- Browser: use the existing authenticated local host/public command fixture and the real Share controls. Seed or intercept only a bounded test group; do not alter hosted state. If persisted compatibility is included, start from valid current-host sharing, retain the actual edit/view credentials as an older device group, omit/revoke the comment grant in the local fixture, and reopen the owner/share controls through the actual device reader. Observe only two offered access choices, working view code/link copying, the public missing-comment error and unchanged selected view/session/drawing. Count publication/sharing mutation requests before/after selection: refusal and omitted-access reuse must not issue replacements. Restore/remove every local fixture even on failure.
- If no authenticated fixture can safely represent the old group without broadening production/server behaviour, use a provider-neutral browser fixture. Label it as such; it verifies public command/UI compatibility, not older-server network interoperability. The current host still issuing three grants is a separate regression.

Run relevant focused Vitest files, tests TypeScript and the new Chromium case(s) using their actual final titles; retain existing three-role share/copy/stop checks. Record exact commands, revision, storage-fixture choice and results before marking the queue item complete. No checks in this section were run while writing this plan.

## Resumable next action

After the public-diff slice finishes, the coordinator must choose whether the bounded two-grant device-reader compatibility is included, then reproduce the command branch with an independently runnable fixture. Preserve the native link-versus-code distinction and the current host's strict three-grant issuance. Presence-readiness work has its own plan and must not be mixed into this change.
