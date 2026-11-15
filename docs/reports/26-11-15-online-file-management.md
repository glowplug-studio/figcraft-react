# Individual online file management

Verified implementation `1ba3837` on `prompt/full-figcraft-port`, 15 November 2026. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. This bounded slice passes; the full port remains in progress.

## Implemented behaviour

`collab.manageFile` exposes all seven upstream actions: `links`, `createLink`, `revoke`, `share`, `unshare`, `rename` and `remove`. The [provider-neutral contract](../../src/backends/online-files.ts) and [command dispatcher](../../src/engine/sharing/online-workspace.ts) preserve recorded-server resolution, ambiguity refusal, native input trimming and receipt shapes. The [synthetic native fixture](../../tests/fixtures/native-online-publication-commands.json) supplies independent command receipts.

Individual links list only id, access, label and epoch-second creation time in insertion order. Creation defaults to view, supports edit/comment, cleans Unicode labels and returns a full invitation only at issuance. A lost successful creation reply does not trigger hidden reissuance; an explicit retry is a separate creation. Revocation targets the exact grant and disconnects its guests. Share/unshare reuse the remembered group and return complete nullable code/link fields. Rename changes the matching device record only after acknowledgement. Removal forgets the matching server/file and ends its live copies while retaining editable drawings, including invitations whose address is a bare host and port.

Native `sharing/live/host.rs::manage_file`, `sharing/online.rs::{manager,managed,removed,set_shared}` and `store/links.rs::{links,create_link,revoke}` map to these independent TypeScript implementations. React runtime and tests do not execute or depend on the native engine.

## Authority and database boundary

The browser host substitutes validated account ownership for native bearer owner tokens. Explicit owner strings are rejected except on keyed share/unshare. URL keys elevate only the native Share path; they never elevate listing, individual creation/revocation, rename or removal. A verified operator share resolves the immutable file owner on the server. Destination/origin transport checks remain enforced.

The [declaration](../../supabase/schemas/45_online_individual_links.sql), [ordered-link column](../../supabase/schemas/20_online_file_links.sql), [initial generated migration](../../supabase/migrations/20261115033203_individual_online_links.sql) and [configured-cap migration](../../supabase/migrations/20261115034851_configured_individual_link_limit.sql) keep the RPC service-only. Ownership and mutation limits are checked under file locks. Listing spends no mutation allowance; refused mutations do. Lowering the configured cap preserves existing grants and still permits revocation. Issued secrets are stored only as digests. Existing revocation/retirement triggers provide session and object cleanup.

Migration review/replay found Supabase default grants surviving PUBLIC-only revocation. The generated SQL now includes the explicit role revocations already required by the declaration. Local reset, effective RPC-denial checks, declarative drift and advisers pass. The scoped hosted Supabase MCP read succeeded with zero public tables. No hosted schema changes or Vercel actions were made.

## Verification

| Gate | Result at the verified implementation |
|---|---|
| Strict TypeScript, reusable library and production Next.js build | Passed; test types rechecked after fixture corrections |
| Local SQL after reset | 448 assertions passed, including 11 management ACL/configured-cap assertions |
| Declarative schema drift / advisers | No changes / no findings |
| Real local provider integrations | 31 passed in 21.70 seconds |
| Full pure suite | 4,652 passed; the later integration addition is covered by the separate 31-case run |
| Final complete authenticated host suite | 253 passed in 887.196 seconds; zero retries, skips, flakes or suite errors |
| Remaining Chromium renderer/export/performance cases | All 122 passed on the same product build in the preceding full attempt |
| Combined browser coverage | All 375 cases passed across those two retained results; not a single green full invocation |
| Local fixture cleanup | All 11 counts zero: Auth users, files, objects, links, connections, rooms, clients, batches, presence, retirements and team libraries |
| Report/tracker rendering | 17 property rows, 11 columns, valid local evidence links and no page errors; tracker bars valid |

The management browser workflow covers all seven actions, wrong/correct operator keys, unrelated-account denial, guest revocation and editable removed copies. Desktop is 1440 × 900 at scale 1; phone is 390 × 844. [Property matrix](26-11-15-online-file-management-parity.html) · [Command contracts](../../tests/contracts/online-management-commands.test.ts) · [Provider tests](../../tests/integration/online-individual-links.test.ts) · [SQL checks](../../supabase/tests/online_individual_links.test.sql) · [Browser cases](../../tests/e2e/preview.spec.ts).

Verification exposed three fixture issues, all retained in the checkpoint history: premature revocation before a new invite attached; accumulated management allowance across independent local cases; and optimistic comment assertions preceding a slow successful server acknowledgement. The fixtures now await admission/extra-tab creation, initialise only the local loopback admin allowance per case, and await comment/reaction acknowledgements. Production limits and general assertion timeouts were not raised. The corrected management and comment workflows each passed three consecutive runs; the budget-isolation group passed all four cases, including its explicit 429 refusal. Earlier attempts had 132/136/13 passing cases with one failure each and serial skips; the final host rerun closes those gaps.

Reproduce from the repository root: `npm run typecheck`, `npm run preview:build`, `supabase db reset --local`, `supabase test db --local`, `npm run test:integration`, `npx vitest run --maxWorkers=2`, then `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0`. Start the built preview with the configured local test allowance as documented in the [handover](../planning/26-11-07-full-port-resume.md). Never reset during provider/browser checks. The production preview was stopped after verification; local Supabase remains available.

## Continuation

Local Graphify indexes React `1ba3837` and native `bad07e44`: React 8,381 nodes/35,935 edges; combined 37,320/126,951. Both management implementations are present. SQL and data-only configuration still require direct inspection.

Next is the [persisted server preference](../planning/26-11-15-online-server-preference.md), followed by incoming peer bounds and the [collaboration command audit](../planning/26-11-15-collaboration-command-audit.md). The wider roadmap and upstream delta remain required. Native LAN listening and OS link registration are browser exclusions; plugins/widgets remain user-deferred. No push or merge to main is authorised by this slice. The local tracker remains uncommitted.
