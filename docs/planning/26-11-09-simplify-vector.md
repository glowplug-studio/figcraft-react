# Simplify vector

## Execution checkpoint

Phases 1–3 complete. React implementation checkpoint dfdffca. Original, fork and pinned submodule at 8a7ebc2484a6d64d80a13c19c18ffb814325e347 after synchronisation. Global supported baseline 8eb0b876. The combined local code graph at dfdffca has 29,601 nodes and 97,240 edges. It resolves native structure::simplify and pathops::simplify alongside fitPencilRun, drawnVectorNetwork and appendNetwork. Code-only indexing omits prose and test declarations without extracted symbols. The scoped Figcraft Supabase MCP returned zero public tables. Device editing and the existing host Auth contract cover this operation. Rollback dfdffca.

| Native evidence | React target | Verification |
|---|---|---|
| engine/src/cmd/structure.rs simplify, vector_behaviour_tests.rs | vector command transaction, vector-path, vector-rounded and appendNetwork | Default tolerance 0.5 with a minimum of 0.01. Skip nonvectors, preserve IDs and the unmodified layer box. Legacy regions share winding where any even-odd loop selects the rule. Painted regions retain independent fills and paint frames. Rebuild loose strokes separately without regions. Preserve source-smoothed corners within the native area tolerance. |
| Pinned Kurbo 0.13.1 simplify.rs SimplifyBezPath and SimplifyState, fit.rs; existing Pencil fitter | Extend the existing fitter with an equal-span piecewise cubic source and analytically accurate moments. Preserve special handling of single-segment runs, discontinuities, closing edges and the default tangent threshold 0.001. | Compare moments for lines versus their equivalent cubics and analytic examples; exercise split cubics, open/closed paths, variable tolerance, sharp corners and numerical degeneracy. Verify the existing Pencil suite. |
| engine/src/catalog.rs Vector → Simplify vector | Existing layer action dispatch, native save and recovery in the authenticated editor | Expose the default action. Keep optional tolerance available through the command API. Test desktop and narrow action, geometry, undo, native re-open and a retained large-document scene. |

1. Generalise the fit source while preserving Pencil’s existing behaviour. Reconstruct legacy fills, independent painted regions and leftover open trails in native order. A path-operations refusal during simplification falls back to the fitted curve per native.
2. Connect the action. Exercise shrinking segment counts, maintained shape, preserved native paint frames and both open and closed results with real browser coverage.
3. Verify both production builds, strict types, pure and local Auth cases and the full browser suite. Record a property matrix, refresh the local graph and proceed to Shape Builder. Complex paints and later layer kinds retain their own coverage obligations.
