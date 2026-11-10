# Identity and access parity mapping

Upstream Figcraft does not yet have user accounts. This mapping separates its bearer-token and session concepts so provider adapters can add account-backed ownership without changing editor behaviour.

| Upstream concept | Upstream source | Provider-neutral target | Required parity evidence | Status |
|---|---|---|---|---|
| Edit, comment and view access | `crates/collab/src/message.rs` `Access` | `DocumentAccessLevel` plus capabilities | Server and UI refuse actions outside the granted level | Contract scaffolded |
| Server-side edit refusal | `crates/collab/src/server.rs` `Server::receive` | Backend enforcement independent of UI snapshot | Negative mutation tests for view and comment grants | Planned |
| File owner token | `apps/figcraft-server/src/store/files.rs` | File-management grant held by an adapter, optionally bound to a principal | Rename, remove and sharing management work only for the owner grant | Planned |
| Edit, comment and view links | `apps/figcraft-server/src/store/links.rs` | Revocable `shareLink` grant | Correct access, expiry and immediate revocation | Planned |
| Server operator key | `apps/figcraft-server/src/store/backend.rs` | Provider/operator administration outside document membership | Ordinary users cannot perform operator actions | Planned |
| Host and guest role | `crates/engine/src/sharing/live/types.rs` `Role` | Collaboration topology, not an authorisation role | Host/guest never changes capabilities by itself | Contract defined |
| Reconnect client secret | `crates/collab/src/message.rs` `Resume` | Transport-private resume credential | Reconnect cannot elevate or retain revoked access | Planned |
| Collaboration client id and peer | `crates/collab/src/message.rs` `Peer` | Ephemeral presence identity | Presence cannot authorise data access | Contract defined |
| Local online-file ownership record | `docs/server.md` “Your online files” | Principal-scoped IndexedDB IDs, server addresses and remembered names | The server revalidates ownership for remembered IDs. No bearer secret enters the document or list. | Verified with native projections and two browser contexts |
| Comment author ownership | `crates/doc/src/comments.rs`; `crates/engine/src/cmd/comment.rs` | Upstream author display string plus backend-verified principal attribution | A caller cannot edit or delete another author's message by spoofing a display name | Planned |
| Per-user live undo | `crates/collab/src/history.rs`; `docs/collab-protocol.md` | Per-collaboration-client accepted-batch history | Undo affects only that client's own accepted actions and does not become account-wide undo | Planned |
| Agent-authored comments | `crates/doc/src/comments.rs` `Message::agent` | Existing agent marker, separate from user identity | Agent attribution remains visible without introducing an account role | Planned |

For each implemented provider, append evidence showing how the target concept is enforced. The initial Supabase implementation uses server-validated claims and RLS. UI capability checks alone never satisfy parity.

## Local rectangle slice (0.2.0)

The Next.js host validates its account with `getClaims()` and supplies only the stable principal and existing `document.read`/`document.edit` capabilities for a fresh local document. This is not an online owner/membership/share grant. No provider roles or user-editable metadata confer authority. `SupabaseIdentityAdapter` strips provider data, expires identity and rejects stale validation after sign-out; the core disables commands on sign-out or missing edit capability.

Evidence: `tests/contracts/supabaseIdentity.contract.test.ts`, `tests/unit/hostAuth.test.ts`, `tests/integration/supabase.test.ts` and `tests/e2e/preview.spec.ts`. The shared access harness uses the memory adapter explicitly; it is not evidence of Supabase document RLS. Real Auth tests prove a signed-out caller and an ordinary user with spoofed role metadata cannot administer users. Document RLS and online grants remain planned because this slice persists no document or profile data.

## Online file ownership foundation

The local Supabase adapter validates a private immutable archive, publishes one listing for a stable file ID and returns the same listing after a lost response or concurrent retry. An owner can read the archive, rename the server listing and remove both through Storage. Anonymous callers and a second signed-in account cannot read or manage it. PostgreSQL restricts authenticated updates to the name column. These checks cover the owner path. Share-link grants, immediate revocation, and ordered collaboration remain open. Dashboard and device-local ownership records passed the signed-in browser case at a25f091. [Real owner and denial checks](../../tests/integration/online-file-ownership.test.ts) · [Effective SQL privileges](../../supabase/tests/online_file_privileges.test.sql).
