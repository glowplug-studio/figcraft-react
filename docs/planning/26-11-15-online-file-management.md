# Individual online file management

## Checkpoint

Phase 7 complete at implementation `1ba3837`, native reference `bad07e44`. Verified 4,652 pure checks, strict types, both builds, 448 SQL checks after reset, all 31 provider integrations, clean declarative drift/advisers and all 375 Chromium cases across the final 253-case host run plus 122 same-build non-host cases. The final host run took 887.196 seconds with zero retries/skips/flakes/errors; all eleven cleanup counts are zero. Three test-fixture corrections and their prior failures are recorded in the [report](../reports/26-11-15-online-file-management.md) and [property matrix](../reports/26-11-15-online-file-management-parity.html). The preview was stopped. Scoped hosted public tables remain empty; no hosted writes or publication occurred. Continue with [server preferences](26-11-15-online-server-preference.md), then peer bounds and the [command audit](26-11-15-collaboration-command-audit.md).

## Observable contracts and authority

Port all seven `collab.manageFile` actions. Preserve the existing native fixture in `tests/fixtures/native-online-publication-commands.json`, and extend native observations for error, idempotence and lifecycle cases where the fixture is insufficient. No React test may execute the reference engine.

| Native symbol / behaviour | Existing React target or gap | Acceptance evidence |
|---|---|---|
| `online::manager`: explicit server/owner or recorded values; ambiguous file IDs refuse | `OnlineWorkspace`, device registry, configured per-server adapter; public management dispatch absent | Explicit/default server, same file ID on two servers, unknown record and unsupported authority contracts |
| `manage_file`: `links` returns only id/access/label/created | Link rows exist; status currently returns only identifiers/revision | Exact native projection including epoch units; no digest, token or account/session credentials in list |
| `manage_file`: `createLink` defaults to view; custom label; returns id/access/full join link | Existing issuer creates publication/share groups, not arbitrary individual links | Default view and explicit edit/comment, Unicode label rules, single issuance and failed admission; full link only at creation |
| `manage_file`: `revoke` trims link ID and returns done after acknowledgement | Existing group change and revocation triggers; no individual command | Exact target grant retired, affected guests disconnected, unaffected grants preserved, missing/foreign ID response |
| `online::set_shared`: share/unshare use the remembered group; matching state avoids network | `BrowserOwnerSharing` has group receipts and replay handling; command needs native full receipt | No extra publication, idempotence, unknown-group unshare refusal and full null/code/link projection |
| `online::managed`: rename updates recorded listing only after success | Existing `OnlineWorkspace.rename` / owner management endpoint | Native clean name, rejection leaves registry unchanged; title in immutable archive is not rewritten |
| `online::removed`: confirmed remove forgets record and ends matching live sessions while retaining open copies | Existing storage retirement and owner removal; command/session orchestration missing | Remove all sessions for the same canonical server/file only after acknowledgement; editable copies survive; object cleanup verified |

**Authority distinction established from source:** `sharing/live/host.rs::hosting_request`, `collab-net/src/link.rs::hosting` and `exchange.rs::background` use the file-owner path for links/createLink/revoke/rename/remove. That path discards the server URL query; a URL key does not automatically elevate those five command actions. In contrast, `NetRequest::Share` / `link.rs::share` use an operator key from the server URL when present. The separate server administrative interface can manage files with its operator key. Keep these paths distinct; do not invent operator elevation for every public command merely because the server administrator can perform the underlying operation.

The account-backed host remains authoritative. A caller-supplied `owner` string is not an authenticated account or proof of ownership. Map supported owner management through the host contract; explicitly reject unsupported native bearer credentials rather than silently ignoring them. A configured operator share must validate its key, TLS/loopback destination and real request origin before any request. Native `online::manager` parameter validation still applies before the share action.

## Implementation order and file ownership

1. Extend the provider-neutral management contract in `src/backends/online-files.ts` and command dispatch in `src/engine/sharing/online-workspace.ts`. Reuse the existing account registry, server resolver and live workspace lifecycle; do not persist secrets in documents or identity snapshots.
2. Implement host link management alongside `examples/nextjs/lib/sharing/links.ts`, `browser-online-host.ts` and the existing authenticated API routes. Reuse the production adapter in browser fixtures. Do not use cached browser roles or caller-selected principals for backend decisions.
3. Add only the necessary declarative SQL changes under `supabase/schemas/`. Existing `20_online_file_links.sql`, `24_owner_share_changes.sql`, `35_operator_publication.sql`, `39_owner_file_admission.sql` and revocation/retirement schemas are the foundation. Inspect current CLI help, generate a migration with the mandated declarative workflow, review it and verify locally. Never migrate the hosted project during this slice.
4. Add command contracts and focused local SQL/provider tests, integrate centrally, then verify real authenticated browser management, denial and disconnected-copy behaviour at desktop and narrow viewport sizes.
5. Run the required full pure/type/build/provider/browser gates, refresh the local graph and update property matrices, access mapping and checkpoint. Continue with persisted server preferences, hostile-peer bounds and the remaining collaboration audit before the next roadmap slice.

## Database, concurrency and secrecy requirements

- Listing requires verified management authority but consumes no native mutation allowance (`store/backend.rs::changes_files`). Individual create/revoke/rename/remove each consume the relevant native administrative allowance. Preserve existing group create/code costs and address-block accounting; do not route single-link writes around admission.
- Retain link count limits, collision rollback, file ownership checks under lock and existing guest-revocation triggers. Grant metadata and plaintext issuance responses must remain separate.
- Keep SQL entry points callable only by the verified server where necessary; anonymous/authenticated direct RPCs must not impersonate the host or operator. Existing private schema and table RLS boundaries remain enforced.
- Preserve lock ordering with reporting, room departure and object retirement. A refusal or contention must not partially update local records or consume destructive state.
- Removal must target the original immutable Storage object and retain its bounded cleanup credential/retry semantics. Do not use an unrestricted service-role delete based on a browser path.
- Acknowledgement loss must not silently mint extra links or revive a revoked grant. Establish native expected behaviour and explicit retry handling before choosing the receipt design.
- Dates require epoch seconds and safe integer handling; label trimming/control/length rules must come from server source rather than UI assumptions.

## Verification and delegation boundaries

Run owner, unrelated account, edit/comment/view guest, revoked guest and appropriate operator cases. Test unsupported server, blocked address, exhausted admission, concurrent grant creation/revocation, stale device group, lost response, removal contention and session cleanup. Keep exact fixtures and commands in the resulting report.

Delegate independent fixture extraction or narrowly owned adapter tests only after the access gate clears. The coordinator owns authority design, SQL lock ordering, cross-layer integration and final verification. Contract and provider tests were delegated separately and integrated. The coordinator owns all product and security changes. No new canvas renderer or frame-frequency state is required; preserve the existing performance gates. Native LAN listening and binary socket interoperability remain documented browser limitations; they do not excuse missing account-backed management.

Rollback boundary: the source pin and planning checkpoint are separate from implementation. Any future schema change must include a reproducible local reset/drift check and preserve prior migrations; no hosted rollback is needed because this slice changes only local development resources.
