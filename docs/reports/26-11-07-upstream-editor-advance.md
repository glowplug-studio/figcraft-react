# Upstream reference advance: editing, file formats and UI

The authorised fork fast-forwarded from `09e04e71765517975950403eec4cb6fbe8955359` to `7522c39ba594ed7e948b6d2626210c4a36b03497`: 65 commits including merges, 80 changed files, 2,119 additions and 322 deletions. Origin/main had zero unique commits before synchronisation. The reference fork and original now agree. No React branch was pushed or merged. The global supported baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`.

| Upstream evidence (non-merge commits) | Required port work / roadmap |
|---|---|
| `0e6fcf9b`, Pen path, session undo and new `pen_undo_tests.rs` | Undo while drawing removes one anchor; redo reinstates anchors and handles. This supersedes the earlier whole-preview cancellation behaviour. Prioritise this regression before width-point editing. Pencil finish is unchanged. |
| `39c58338`, tools/draw and drag, native transform/draw fixtures | Pixel rounding happens before object snapping on drawing, moving and resizing, so fractional object targets win on snapped axes. Audit all three existing controllers; board connector exclusions are tracked separately. |
| `1aa6b81d`, `65060159`, `41ec33ee`, `5244b007`; native create/page/edit/props tests | Reject malformed vector point entries atomically; reject negative/fractional page.move and node.reorder indices; unknown stroke caps enumerate supported values. Reconcile existing supported command surfaces. |
| `421a8e51`, doc/lib.rs and tests; `f2622659`, variables | Guard frame-relative lookup against parent cycles; audit hierarchy validation. Negative/fractional variable mode indices fail in the variables slice. |
| `19afdd21`, `37803cb1`, `7eac937a`, format/fig, rest, penpot | Deduplicate imported blobs across hashes. Index style-heavy import/export lookups and preserve first-match semantics for repeated names. Add native file interoperability/performance fixtures in format slice. |
| `6b46a9c8` and follow-ups, text/build.rs; `58af1a62` | Optional web font family embedding, unavailable-family diagnostics and native web build size policy; map to independent browser font delivery. Typed text updates its auto-generated layer name; preserve explicit renames. Native web size gate is not the Next.js bundle size. |
| `2dc7bed2`, `7be7c054`, board routes/tools/snap | Side connections start four points beyond their border; document when joined connectors share a run. Connectors/labels carried by a moved layer or an ancestor are excluded from snap candidates. |
| `a55a728c`, `19af9c9c`, render/export and JPG tests | JPEG quality control and embedded sRGB ICC profile; invalid JPG quality is rejected even when a different output format is requested. Map to export/backend-independent encoding. |
| `fb558724`, collab/merge, sharing/branches and tests | Auto-layout edits on both sides of one branch merge form one user-visible conflict. Include conflict count, granularity and resolution fixtures in branching/collaboration. |
| `84d9391b`, `967917db`, `06eb2a04`, `0b68405d`, `877d0c61`, `d7a78ac3`, `8842019a` | Match sidebar icons, shared selection colour/opacity field lifecycle, boolean toolbar/menu icon/check columns, full-height variable/style pickers. Route to relevant appearance, boolean, variable/style and final chrome slices. |
| `4cacc966`, `00fa951f`, `6cb724c5`, corresponding docs/roadmap | Track contributor/release credits and documentation changes. Native release CI is not a browser editing feature. Review user-visible credits in the UI audit. |

Graphify currently covers Rust at the previous `09e04e71` and React at README-only `b3b8a1b`. The newly pinned local source and upstream tests are authoritative. This report records incoming scope, not a claim that these changes are all implemented.

## Subsequent reference advance: 7522c39b to 909d68e0

39 commits; 55 files, 1,412 insertions and 100 deletions. Fork, original and submodule agree. The React implementation at 20fe465 and supported global baseline are unchanged. This range does not modify the three shape drawing, moving and resizing paths under active review.

| Evidence | Owning follow-up |
|---|---|
| SVG import 16d97cf8 / 8bc405ed / 8fb53baa; final diff in crates/svg/src/import.rs | Distinguish closed outlines, open lines, mixed subpaths and outlined text for dash offsets. Test fill/stroke splitting during SVG import. |
| 024b7fe4: cmd/file/import_ids.rs and import_ids_tests.rs | Remap colliding imported style/variable IDs and internal bindings without binding to unrelated assets. |
| de881846 / 9ff2105d / cacf73a0: canvas/vectoredit/ops.rs and tests.rs | Reconnect a broken region loop through the new segment only when continuous; retain winding and holes. Revisit existing vector authoring after snap and index corrections. |
| 23792e85 / 05d1b147 / cf1fed33: locale files and typography controls | Check measured German wrapping, tooltips and Spanish text-direction commands with UI/localisation. |
| f566f961: collab-net hub/queue and tests | Verify slow joins in busy rooms are not dropped because of cursor updates. |
| cd5c9aeb / c16c3676: doc/text.rs, text/layout.rs, format, codegen | Forced paragraph direction, alignment, paragraph-array length and trailing empty paragraphs in editing, import and CSS export. |
| 5bdedc39 / 104aa3de / d23cebb1: effects, style_vars and binding tests | Bind only existing effect fields, refuse unknown keys and wrap glass light angle at ±180°. |

## Reference 909d68e0 to 894d0246

The reference advanced by 35 commits across 24 files, with 454 insertions and 61 deletions. The fork fast-forwarded cleanly. The command-validation source and preceding snap-priority change are unaffected.

| Evidence | Roadmap work |
|---|---|
| `f35af507`, `971c82b8` | Browser input. Side buttons 4/5 pan the canvas and releasing the primary pointer during a pan still ends the primary drag. Cover held-button transitions and browser navigation suppression. |
| `ff862dcf` | Pages. Clicking a different page after an unchanged rename still opens the clicked page. Pair native test and React focus/blur workflow. |
| `f797cbe0`, `acbc9882` | .fig/Kiwi decoder. Reject duplicate schema field IDs. Valid fixtures require distinct IDs. Architecture guide correction `cd77b017` describes existing support. |
| `facc2a21`, `2c92a169`, `a63f0d79`, `bae4a4e8` | Localised chrome. Match script fallback for Ethiopic and Indic scripts, CJK path for Bengali/Thai, and 43 Finnish labels. |
| `853e8c6c` | Minimized Wayland window control is native process/window behaviour. Check browser command delivery independently when integrating the host command surface. |

## Reference 894d0246 to e9fc975a

The fork advanced by 26 commits, 44 files, 1,058 insertions and 138 deletions. Four commits arrived during the fast-forward. Graphify's Rust graph subsequently reached 7522c39b.

| Native evidence | Required work |
|---|---|
| `367f188b`, `56ad0ba1`, `90bec333`, `85a11f04`; place_crosshair_tests.rs | Browser keyboard placement. Arrows move a per-document/page crosshair, Enter places supported shapes or frames, pointer placement clears it, repeat tool selection retains it, view pans to follow it, and board shapes use it. Include the translated label. |
| `95d71a68`, `44f9eccb`, `4cd01f0a`; text/layout.rs and breaks.rs | CJK justification, grapheme-safe gaps, RTL run edges and nested bidirectional embeddings. |
| `deee3d8a`; format/sketch/text.rs | Bound total output characters from overlapping Sketch text runs. |
| `000d39b0`, `f56e30e7`, `099cc037` | Closed vector corner smoothing, rendered and hit-test outlines, per-region fills, simplify/offset and SVG/PDF/.fig/Penpot output. Audit the earlier vector rendering slice against the new smoothing behaviour. The existing zero-smoothing radius case remains the reconnect fixture. |
