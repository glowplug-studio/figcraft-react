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
