# Sketch design import

## Evidence and execution order

Roadmap row 12 uses the pinned upstream revision `a2e87433d8bda2b0c909587da08cb27c51e3b17e`. The local combined graph resolves `sketch/tree.rs::to_rest`, `importRestDocument` and `readMember`. The native format reader first maps a checked archive into a REST document, then runs the ordinary document importer. The host uses its own installed-font lookup. The browser implementation can reuse the verified archive, REST, vector, text, style and component paths.

1. Reproduce file detection, version rejection, page order and deduplication, member limits, recoverable archive errors, embedded-font warnings and image lookup. Verify genuine Sketch 48+ ZIP members, legacy SQLite, damaged and unsupported records. Use independent native expected documents and receipts.
2. Map pages, affine transforms, pins, clipping, masks and siblings, frame/graphic/stack sizing, backgrounds and corner treatments. Compare actual editable nodes, including combined mask groups.
3. Map editable paths, curve points, boolean groups, painted strokes and compound paths. Preserve numeric precision and compare native saved networks.
4. Map paints, gradients, blurs, noise, artboard backgrounds, tints and image resources. Check archive image bytes, placeholders, linked styles, swatches and stable variable references.
5. Map attributed text, scalar ranges and PostScript face lookup, local and foreign symbol masters, overridden nested instances and hidden library resources. Verify missing fonts, missing/cyclic symbols and expansion limits. Track prototype and slice properties until their document models and UI pass.
6. Verify signed-in open, import, drop, save, reload, invalid input and large archives. Run full local release checks and document each property before starting the next format.

## Resumable checkpoint

The reference harness captured 179 archive and receipt pairs from the pinned upstream format tests. The native host saved 176 documents and refused three inputs. Each original is paired with its file.open receipt and, when accepted, its file.saveAs archive in [native-sketch-files.zip](../../tests/fixtures/native-sketch-files.zip). Captures run outside the product checkout and add no Rust runtime dependency.

Archive validation, geometry, layout, paints, path networks and mask grouping are in progress. Next map the document tree, compare each successful native archive and each refusal, and integrate the signed-in host. The native override fan-out stress test exhausted the reference container’s memory. Reproduce the browser expansion limit with a bounded budget and verify recoverable warnings before claiming that property.
