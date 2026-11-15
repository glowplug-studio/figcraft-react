# Public collaboration diff

## Execution checkpoint

- Phase: source analysis and independent native oracle preparation. This slice is not implemented; no React checks have run for it.
- Native pin: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React source checkpoint supplied by the coordinator: `414e457`, with incoming-peer-bounds changes still dirty during this analysis. This is not a verified implementation revision.
- Prerequisite: finish the incoming-peer-bounds checkpoint. Renew branch/dirty-file, instruction, native-pin and Graphify preflight afterwards; record the actual starting revision and preserve unrelated work.
- Next action: reconcile the comparison-baseline lifecycle below, add the shared six-variant change writer and public async command, then verify independent fixtures and browser dispatch. No hosted resources, migrations or Vercel changes are required.
- Coordinator owns editor state, security and integration. Allocate any independent fixtures/tests to separate files before delegation.

## Source contract and mapping

All native references are beneath `original/figcraft/`, reference material only. Product code and tests must not import, execute, link or depend upon it.

| Native source / symbol | Observed contract | React owner |
|---|---|---|
| `crates/engine/src/sharing/collab.rs::specs/diff_cmd` | Read-only `collab.diff`; `against` defaults to `undo`; compare a fresh `Replica` of the selected baseline against `ds.doc`; return `{changes,count,bytes}`. | `src/engine/editor.ts` command spec, synchronous async-required guard and `executeAsync` dispatch; `src/engine/sharing/live-changes.ts::liveReplica/diffLive`. |
| `crates/engine/src/doc_state.rs::DocState::new` | Repair/settle the loaded document before setting `saved_doc` to that document. The absence of a file path does not imply an empty comparison baseline. | Constructor and settled file-open installation; separate comparison baseline. |
| `doc_state.rs::unsaved/mark_saved` | Recovery baseline is `Document::new(current.name)`; saving baseline is the actual saved document. | Recovery installation and accepted `file.markSaved` acknowledgement. |
| `crates/engine/src/cmd/file/open.rs::open/open_data/revert` | Normal loaded native/imported/base64 documents start with their own settled document as baseline, including pathless documents. | `#executeFileCommand` successful document replacement and `openTabFile`. |
| `crates/engine/src/cmd/file/load.rs::recovered_from` | Explicitly applies `.unsaved()` after loading the recovery archive. | `file.recover` only. |
| `crates/engine/src/cmd/file/save.rs::FileSnapshot::of/save`, `mark_saved` | A successful snapshot save advances the baseline to the captured snapshot; subsequent edits remain unsaved. Stale snapshot saves do not replace the baseline. | Existing `#pendingSaves` captured documents and accepted revision acknowledgement. |
| `crates/engine/src/cmd/file.rs::file.duplicate/version.duplicate` | Duplicate content is named before constructing `DocState`, so the renamed duplicate is its own baseline. | `#copyTab` ordinary copies and duplicate versions. |
| `crates/engine/src/sharing/live/events.rs::live_merge_offline_work` | Constructs `DocState::new(local)` then renames `copy.doc` to the offline-copy name. Its baseline remains the unrenamed local document. | `offlineCopy/#copyTab`: explicit source comparison baseline; do not infer recovery semantics from its dirty flag. |
| `crates/engine/src/automation/params.rs::string` | String/number/boolean values become text; null/arrays/objects are absent, so default to `undo`. The public dispatcher rejects unknown parameter keys before `diff_cmd`. | Existing `parseString(parameters(input).against) ?? "undo"`, with JSON-compatible inputs. |
| `crates/collab/src/change.rs::Change/Entry/Json` | Externally tagged camelCase JSON changes; wrapped JSON values are actual JSON in readable receipts, compact strings in binary; numeric node/comment IDs are u64. | Native receipt projection, separate from internal `LiveChange` DTO. |
| `crates/collab/src/message.rs::encode/encode_into` | Binary message is wire version byte `1`, then postcard for the actual argument. For a change vector: vector-length varint plus the changes. | Shared Postcard six-variant writer and standalone vector measure/encoder. |
| `crates/engine/src/collab_tests.rs::collab_diff_shows_the_last_edit`, `collab_live_tests.rs` | No undo target errors; rectangle produces a create change; saved comparison works; invalid target errors; live undo comparison disabled but saved comparison allowed. | Independent public command parity/contracts and browser calls. |

## Smallest complete design

### Independent saved comparison baseline

React's `#saved: Document | null`, `#downloaded`, saved version/branch references and `dirty` implement browser save/download UX. Constructor and generic open currently leave `#saved` null, while `newTab/openTabFile` mark content clean. Reusing `#saved` would turn an untouched normal open into an all-content diff or change existing dirty/save behaviour. Add a distinct non-null document field, for example `#comparisonSaved`, and leave those UX fields unchanged.

Initialise and update it at these owning transitions:

- Constructor: the freshly created document itself, despite existing browser dirty state.
- Successful normal `file.open`, including raster/design/base64 import as a document: fully decoded and settled installed document. Failed/cancelled opens leave it untouched.
- `file.recover`: `newDocument(decoded.document.name)`, matching native `.unsaved()`; recovery edits are compared to this empty default document.
- `file.markSaved`: the accepted captured `saved.document`, including revision-specific pending saves. Do not use a newer current document, update on export/encoding alone, or advance after rejected acknowledgement.
- `newTab/openTabFile`, ordinary duplicate and duplicate version: their initial installed/renamed document. Avoid leaving the temporary constructor document as baseline when replacing it.
- `openBranch`: the branch's installed head document; verify its native branch-opening owner during preflight.
- `offlineCopy`: the unrenamed source document, with only the offline-copy rename in the first saved diff. Pass this baseline explicitly rather than using `dirty ? empty : document`.

Undo/redo, remote edits, preview/restore, page selection, follow, rename and ordinary edits must not advance the saved baseline. Add no new dirty/save controls. Native comparison uses shown `ds.doc`, including a version preview, whereas dirty detection uses `document_itself()`; do not automatically substitute React `#fileDocument()` for the command's current document. Audit the existing live shared-page/local-page projection so following another page does not accidentally become a synced document preference change. Reuse that projection where appropriate and test it.

### Undo target and public dispatcher

Use the current last `#undo` entry's document without popping or modifying it; this is the exact snapshot the native command selects, not a rendered inverse batch or the redo stack. Reject `undo` whenever `#liveHistory` represents a live document, even if a per-user live undo is available. Saved comparison remains available in live/read-only sessions.

Register `collab.diff` as `undo:false`, label `Show sync changes`. Synchronous `execute` should report that it requires `executeAsync`, consistently with existing async-only commands. Add an early `executeAsync` branch before generic file dispatch and any preview-ending/text-preparation code. Capture baseline and current document together before awaiting `diffLive`; return a coherent snapshot result without mutating editing/history/selection/preview state. Async image reads must not mix a later document into the captured pair.

Parameter resolution must preserve native coercion/defaults and reject unknown keys through the public command contract. Exact native failure text from `error.rs` plus `diff_cmd`:

```text
command `collab.diff` is not available right now: nothing to undo
command `collab.diff` is not available right now: in a live session undo is per user: compare against "saved"
invalid parameters for `collab.diff`: `against` is "undo" or "saved", not <Rust-debug-quoted target>
```

Use correct string quoting/escaping for the final invalid value; do not substitute a generic unsupported-parameter error. Number/boolean targets stringify before producing that error. Null/array/object targets select the default.

### Standalone binary size and readable receipt

Reuse the existing Postcard primitive writer in `session-postcard.ts`, preserving `InitialChange` and all initial-session APIs. Extend the shared change-writing implementation to all six `LiveChange` variants with native discriminants: create `0`, set `1`, delete `2`, setDoc `3`, put `4`, remove `5`. Preserve property/entry enum order, option tags, UTF-8 lengths and unsigned varints. Both put/remove use a numeric u64 key for comment/devSnapshot entries; other supported entry keys are strings.

Expose a standalone vector size function, and an encoder only if useful for verification. Its framing is exactly:

`wire version 1 + varint(change count) + encoded changes`

Do not include the 17-byte session disk header, session fields, next-client fields, catch-up wrapper or a ServerMsg envelope. An empty vector is two bytes. Existing initial-session measures must remain byte-identical.

The public `changes` array must project internal tagged/string-wrapped `LiveChange` into native externally tagged readable JSON. Parse kind/property/entry JSON losslessly; do not expose `{type:"create",kind:"<JSON string>"}` as the native receipt. Preserve every u64 digit and integers nested inside JSON values. Decide and document the JS API's existing safe-number/large-ID representation before implementation: ordinary JS numbers cannot faithfully represent every native JSON integer. Follow existing inspected-ID conventions where required, or use an explicit lossless representation with a serialisation contract; never silently round via `JSON.parse`/`Number` or return an accidental library-internal object shape. `count` is vector length; `bytes` comes from the encoded internal vector, independently of how JS presents IDs.

## Acceptance and verification

Independent TypeScript tests must cover:

1. Public `executeAsync("collab.diff")` with default/explicit undo; no-undo failure; known rectangle creation; non-mutating repeated calls; stable undo/redo depth and selection.
2. Saved baseline on initial constructor/new tab, settled file.open, openTabFile, recovery, duplicate/version copy/branch and offline copy. Normal open has empty saved diff even where browser dirty remains true; recovery compares to a fresh name-matched default document; offline copy initially reports its rename.
3. Acknowledged save snapshot A followed by edit B compares saved against A; stale/rejected acknowledgement does not advance baseline; encoding/export alone does not advance it; undoing to saved state returns an empty saved diff.
4. Live undo rejects with native text even if live canUndo is true; live saved comparison works. Existing local follow/page and remote drawing behaviour remain unchanged. Version preview comparison uses the native shown-document contract without closing the preview.
5. `against` values absent, undo, saved, invalid string, number, boolean, null, array/object; extra keys reproduce the public dispatcher refusal. Validate error text including escaped strings.
6. All six readable change forms; create/set/delete/setDoc/put/remove binary bytes; numeric comment/devSnapshot keys; large u64 IDs and nested values; UTF-8/supplementary strings; count-varint boundary 127/128 and key/string varint boundaries; empty vector two-byte size.
7. Existing native ordered-change fixtures paired with independent expected readable receipts and binary lengths. A separate temporary reference generator may produce fixture data against the pinned native source outside runtime tests; record pin, generator command and fixture provenance. No product/build/test import or runtime execution of Rust source/artefacts. Do not derive expected bytes by invoking the same TS writer under test.
8. Existing initial snapshot postcard fixtures and live diff/order/property tests remain passing; outgoing live transport format and dirty/download/save UX remain unchanged.

Use the existing browser automation host/public command bridge for automated `executeAsync` calls: initial no-undo error, rectangle default diff receipt, saved baseline after acknowledgement and read-only/live saved access. Also record a reproducible manual browser invocation through that same public bridge, its receipt and unchanged editor state. No new button, panel or command UI is required. Determine exact fixture/bridge names from the current checkout during implementation, rather than inventing a production inspection API.

After implementation record actual focused test files/titles, TypeScript command, browser command, fixture provenance, tested revision and pass/failure evidence here. Refresh React/combined Graphify and cross-repository mapping, upstream command/roadmap record and resume handover at the checkpoint. Source analysis is not completion evidence.

## Prepared native oracle evidence

A disposable, independently compiled Rust wire oracle against `bad07e44` has emitted 52 candidate cases outside the checkout. It covers all six changes, all seven put/remove entry types, empty/mixed vectors, count and UTF-8/key boundaries 127/128, u64 limits and nested numeric values. Verified observations: empty `[1,0]` is two bytes; mixed-six vector is 299 bytes; vector counts 127 and 128 begin `[1,127]` and `[1,128,1]`; floating `1.0` occupies nine bytes in its set-change case versus seven for integer `1`. Canonical readable JSON retains full u64 digits.

Temporary workspace name: `fc-native-public-diff`, files `src/bin/wire.rs`, `wire-observed.json`, `wire-build.log`. The Cargo project mounts the pinned source read-only at `/source`, uses the existing native registry/target cache and runs `cargo run --offline --quiet --bin wire` with one CPU/build job. No React source, build or test invokes it. Review and copy immutable data plus generator provenance into repository fixtures only when implementing this slice. Its current candidate data are not yet React verification.

An optional engine-receipt oracle was separated into `engine/Cargo.toml` because Cargo also resolves optional engine Git dependencies in offline wire-only runs. Engine execution is pending the pinned `craft-libs` dependency cache/network fetch. That is local oracle preparation, not a port-access blocker. Next command is `cargo run --manifest-path /oracle/engine/Cargo.toml --bin engine` under the same read-only native source mount and its own persistent Git cache.

### Readable JavaScript receipt decision

Existing `src/engine/parameters.ts::inspectedId` exposes safe native IDs as numbers and larger u64s as decimal strings; `inspect.ts` and live-session summaries use that convention. Use the same convention for change IDs, parent IDs and numeric entry keys. Recursively decode wrapped property/kind JSON losslessly, returning safe integers as numbers and unsafe integer tokens as their exact decimal spelling; finite floating tokens become JavaScript numbers. This is an explicit browser API substitution for native JSON integers outside JavaScript's safe range. Keep the six externally tagged shapes, actual JSON arrays/objects/null/booleans/strings and property values; never leak LosslessNumber implementation fields. Test the serialised public object for exact large-number digits and document the number/string boundary. Binary bytes are measured from the original canonical JSON strings and remain exact, including `1.0` versus `1`, independently of JavaScript's public floating-point presentation.

### Engine oracle correction

The pinned engine oracle now runs successfully from the independent temporary workspace. Its first 17 stages establish: initial saved and undo-to-saved return `{changes:[],count:0,bytes:2}`; an ordinary rectangle emits one create change with exact binary size 56; renaming to `Renamed é🙂` emits one document-name change of 21 bytes. The no-undo and invalid-mode errors match the owning source. Number and boolean modes are stringified; null/array/object default to undo.

Actual public-dispatch evidence corrects the source-only analysis: `Session::execute` rejects unknown parameters before `diff_cmd`. `{against:"undo",ignored:true}` produces `invalid parameters for collab.diff: unknown parameter ignored (it takes against)` with command/key backticks in the exact oracle data. Do not implement the previously proposed permissiveness merely because the leaf function ignores extra keys. The final engine oracle has 22 stages and nine intentional command errors. Clean explicit undo equals default/repeated calls; NUL, ESC, U+2028 and quotes/backslash establish exact native Debug escaping. The successful engine result and a validation script are retained beside the 52 wire cases. This correction is precisely why full public receipts are required alongside leaf writer fixtures.


Native Debug escaping observations from the final engine oracle: NUL uses `\0`, ESC uses `\u{1b}`, U+2028 uses `\u{2028}`, and double quotes/backslashes use their escaped forms. JSON.stringify is not sufficient for every native invalid-target error. The engine oracle compiled with the source mounted read-only, one CPU/build job and exact pinned craft-libs revision; source/outputs are temporary evidence, not runtime dependencies.
