# Upstream reference for width-point authoring

The reference advanced from e9fc975a to ed90dc10 by fast-forward. The 28 commits changed 65 files with 927 insertions and 196 deletions. Fork and original main agreed after synchronisation. Width-point code is unchanged. The global supported baseline remains 8eb0b876.

| Commit anchors | Required follow-up |
|---|---|
| 01214c6e, 453e0b9a, 8b6c9279, 46760776, d72f0961 | CSS import and export. Missing colour components, angle units and wrapping, non-finite and calc rejection, eight-bit alpha round-trip, propagation of missing channels and alpha in nested colour mixes. |
| 695ca075, 0d1801db, fb33f782 | Rich text styles. Paragraph spacing and indent, lists and OpenType, trailing paragraphs in whole-layer operations and retaining style links for omitted paragraph attributes. 9e356096 normalises line endings. |
| 98710acb | File workspace. Dirty tab close, discard, cancel and save handling. |
| 5bbab0fa | PDF export. Bound hyperlink length before per-line copying. |

Verify these changes in their owning slices and include them in the final baseline comparison.
