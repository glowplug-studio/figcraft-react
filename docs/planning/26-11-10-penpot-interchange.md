# Penpot design interchange

## Native evidence and dependency order

Roadmap row 12 covers editable, offline import and export of Penpot 2.x files. The pinned upstream is a2e87433d8bda2b0c909587da08cb27c51e3b17e. The native format tests passed 136 cases. Instrumented test inputs produced 119 independent host sessions, 114 successful saves and five refusals. Expected records and warnings come from native file.open and file.saveAs. Keep all source metadata needed for native reopen and subsequent Penpot export.

1. Validate archive paths, UUIDs, entries, header versions, inflation and cumulative JSON structure counts, page limits and ordering. Expose the format in the ordinary open, import and drop routes. Compare failure receipts and blank drawings.
2. Import complete trees, shape geometry and transforms, clipping, masks, layout, text, paints, effects and media. Preserve file, page and layer metadata, display grids, guides, raw SVG and offline font warnings.
3. Import library swatches, typography, tokens, modes, aliases, components, instances, overrides and flows. Verify references across pages and multiple files. Compare saved document fields, actual image bytes and warning order for every corpus member.
4. Export through file.export and the signed-in UI. Reopen browser-written files in upstream and compare editable geometry, source metadata, assets, warnings and repeat exports. Check browser cancellation, memory, transferred worker lifetime and large inputs.
5. Record the property-level parity matrix, local Graphify coverage and full release results. Keep remaining online workspace, prototype presentation, board, Dev Mode and final release work open.

Owning sources are crates/format/src/penpot.rs, penpot/embedded_fonts.rs, penpot/prototype.rs, penpot/export.rs and crates/engine/src/cmd/file/load.rs. The existing React work covers native archive reading, text shaping, page appending, REST document projection, shared styles, variables, component links, prototype records and editable SVG import. Check each proposed reuse against the native model because the Penpot importer constructs document nodes directly and preserves format-specific source records.

## Execution checkpoint

The fork and upstream both report a2e87433. The synchronisation script completed using the existing studio SSH identity after the default identity was denied a no-op push. The scoped Figcraft Supabase read passed with zero public tables. Offline interchange uses the existing session, file picker, native persistence and worker lifecycle. Local Graphify resolves native shape_json and record_fingerprints alongside React readMember and readNode. The Rust reference fixture was captured from the pinned source. The combined graph contains 33,984 nodes and 116,471 edges with the Sketch implementation included.

Start by preserving Penpot source strings and ruler guides through native open/save, duplicate, file import and export. Of 327 reference nodes, 323 contain interchange metadata, and two archives contain guides. Confirm these fields against the independent host output before using the native reader as a comparator. Next validate UUID paths, cumulative inflate and JSON value budgets, shape bytes, page and layer limits. Handle raw SVG, offline fonts, imported libraries and prototype remapping before verifying writer round trips. Source metadata carries a file or page identity in addition to a layer UUID; retain the native records during edits and recompute fingerprints when exporting. The browser implementation must keep JSON parsing and large imports cancellable. Unit fixtures, production signed-in open/append/save and capped large-document checks precede closing the slice.
