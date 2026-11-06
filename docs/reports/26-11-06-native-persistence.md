# Native persistence checkpoint — 6 November 2026

Full browser-relevant parity remains **in progress**. This is a bounded persistence checkpoint following the merged rectangle slice, not a completed port or publication candidate.

## Scope and source baseline

Inspected upstream: `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Verified React implementation: `41d467b4bf96e71815d2669da59c421e89af46bd` on `prompt/full-figcraft-port`, following integration base `fc3b4a6b1440c03961915580c881eb602565d10a`. Later working-tree edits belong to subsequent checkpoints and are outside this report. The supported scope is the Page/Rectangle subset at this source baseline, not the whole upstream commit. Do not advance the global parity baseline on this evidence.

Implemented native version-1 JSON/ZIP import and ZIP export, exact u64 node IDs and allocator, multiple-page data ordering, translated rectangles, opaque byte sRGB colours and empty fills. Imports validate graph relationships and reject unsupported data atomically. ZIP metadata, decompression bounds and CRC32 are checked. Save acknowledgement applies to the captured revision; stale opens, identity revocation and edits during decoding cannot replace newer work. Undo retains allocator monotonicity.

The editor adds Open, Save as, native download, an unsaved-replacement dialog and error feedback. Host-owned recovery restores a native snapshot as unsaved, serialises writes and uses a transactional IndexedDB store keyed by host principal. These keys separate local accounts; they are not a server security boundary.

## Upstream evidence and browser substitutions

- `crates/format/src/lib.rs::DocumentJson`, `from_json`, `save_bytes` → [native codec](../../src/engine/file-format.ts).
- `crates/doc/src/lib.rs::Document`, `NodeId`, `IdAlloc`, `repair`; `crates/doc/src/node.rs::Node/NodeKind` → explicit wire adapter and exact numeric tokens.
- `crates/engine/src/cmd/file/save.rs::FileSnapshot` and save acknowledgement → [file transactions](../../src/engine/editor.ts).
- `apps/figcraft-web/src/recovery.rs::Unsaved/store/restore` → [recovery controller](../../src/engine/recovery.ts), [provider-neutral contract](../../src/backends/recovery.ts) and [IndexedDB implementation](../../src/backends/browser/recovery.ts).

Browser file input/download replace native paths and dialogs. Upstream file.open(data) creates a new unsaved tab; this checkpoint instead confirms replacement of its single current document. New-tab/workspace semantics remain an explicit parity gap. A download acknowledgement indicates browser hand-off, not verified durable filesystem storage. Recovery proactively writes after a 250 ms debounce and on hidden-page notification; upstream browser recovery follows unsaved snapshots for panic-hook localStorage recovery. This checkpoint stores one current document per principal rather than the upstream multi-file/history/branch workspace.

Browser limits are 16 MiB input/unpacked JSON and 10,000 nodes, below native limits. Unsupported properties and archive members are rejected rather than dropped. Structural graph repair is not ported; malformed graphs are rejected, with allocator repair implemented separately. Non-finite export geometry is rejected rather than normalised to zero as upstream does. Empty/default fields are accepted only within the explicit supported schema. Runtime dependencies: `fflate@0.8.3`, `lossless-json@4.3.3`, `@zip.js/zip.js@2.24.0`; the ZIP metadata reader uses its native-only JavaScript entry point. No Rust engine or WASM decoder is executed.

## Supabase verification

The coordinator’s scoped MCP read succeeded and found no public application tables. Existing provider-neutral Supabase Auth setup passed two real local integration tests. This slice makes no database schema, migration, RLS, Storage, Realtime or hosted Auth configuration changes. Online documents, ownership/share grants and collaboration remain required later roadmap work; local IndexedDB persistence does not implement them.

## Verification state

Environment: Darwin arm64, Node 24.20.0, npm 11.19.0, Vitest 5.1.0; browser configuration is Playwright 1.65.0 Chromium, 1440 × 900, scale 1.

| Check | Recorded result |
|---|---|
| `npm run typecheck` | Passed, coordinator verified |
| `npm test` | 135 pure tests passed; two opt-in integration tests skipped in the pure run |
| `FIGCRAFT_LOCAL_INTEGRATION=1 npm run test:integration` | Two real local Supabase Auth tests passed |
| Production package/Next.js build | Final package/Next.js production build passed |
| Codec parity | 41 cases passed |
| File command parity | 10 cases passed |
| Recovery lifecycle parity | 10 cases passed |
| IndexedDB contracts | Eight cases passed |
| Final production Playwright run | Eight passed; zero skipped, failed or flaky; 9.9 s against authenticated local production host |
| Native runtime-paired compatibility | **Not tested**; Rust not executed |
| Source-line coverage | Not measured |

Evidence: [codec assertions](../../tests/parity/file-format.test.ts), [inspection-derived native fixture](../../tests/fixtures/native-rectangle.json), [file transaction assertions](../../tests/parity/file-commands.test.ts), [recovery lifecycle assertions](../../tests/parity/recovery-controller.test.ts), [IndexedDB contract assertions](../../tests/contracts/recovery.test.ts), [real local Auth assertions](../../tests/integration/supabase.test.ts), [browser workflow assertions](../../tests/e2e/preview.spec.ts), [performance assertions](../../tests/e2e/performance.spec.ts).

Earlier browser attempts exposed a recovery-status layout overlap and an alert selector collision with Next.js’s route announcer. Both were corrected before the final production build and browser run. The final authenticated local production run passed all eight tests: Auth failures, 10,000-node performance, rectangle pixels/screenshot/resize, pointer modifiers/non-React frames, refresh/logout, unavailable canvas, native download/replacement cancellation/reopen/reload/invalid input, and denied storage with usable editing/download. The native workflow also asserted no page errors or failed requests. Hosted publication and other browser engines were not tested. The generated local browser result records 8 expected, 0 unexpected, 0 skipped and 0 flaky tests; test sources linked above are the durable assertions.

The fixture is assembled from inspected upstream definitions, not captured from a running native engine. Passing JavaScript tests cannot be described as runtime-paired native interoperability. The [self-contained property report](26-11-06-native-persistence-parity.html) contains 65 rows: 57 Passed, 0 Failed, 6 Partial, 0 Blocked, 2 Not tested. Passed rejection rows establish safety only, not implementation of rejected features. High confidence is limited to properties with both relevant parity assertions and passing browser evidence; other rows remain Medium or Low.

## Remaining gaps and continuation

Native image resources, thumbnails, versions, branches and libraries are rejected. Complete kinds/properties, non-translation transforms, arbitrary colour precision/alpha, paints/strokes/effects, text, layout, components/variables, multi-document workspace, cloud persistence and the rest of the product remain unimplemented. No complete-port audit or publication gate has passed. See the [master roadmap](../planning/26-11-06-complete-figcraft-port.md) and [full feature inventory](../parity/full-port-feature-inventory.md).

Next: immediately continue the typed document/page/hierarchy/affine dependencies. The verified persistence implementation is committed locally; report/checkpoint changes follow separately. No user action is currently required. No main merge, branch publication or Vercel deployment is claimed by this report.
