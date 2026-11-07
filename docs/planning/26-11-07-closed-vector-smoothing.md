# Closed vector corner smoothing

React base 242b5d0. Original, fork and local reference at 3daa9d3293c5973bc8811e9b1108cea3224690aa. The operative upstream change is 000d39b0. Existing zero-smoothing arcs and the authored network remain the regression baseline. Supabase project-scoped listing succeeded with zero public tables. The Rust graph at 894d0246 identified the earlier rounded geometry. The React graph at b3b8a1b still contains four README nodes. The current reference supplies the newer contract.

| Native behaviour | React owners | Paired acceptance |
|---|---|---|
| geom::smoothed_corner and smooth_corner | polygon.ts and vector-rounded.ts | Share polygon corner calculations. Produce finite cubic segments, reduce smoothing before radius when space is limited. Preserve polygon output and plain vector arcs at zero smoothing. |
| doc::VectorNetwork::rounded_smoothed and corner | vector-rounded.ts | Only two straight edges on region loops qualify. Each point uses its authored radius. Curved neighbours and open branches keep their plain arcs, junctions and zero-radius points stay sharp. Preserve both walk directions, hole winding and explicit region paint metadata. |
| doc::geometry::drawn_network, stroke_geometry, hits_node_itself | shape-path.ts, vector-presentation.ts, vector-stroke.ts and geometry consumers | Same effective contour for fills, strokes, variable widths, brushes, masks and hit tests. Share cached geometry at the same smoothing without retaining every historical slider value. Preserve editable control points and save the authored network. |
| doc::NodeKind eligibility; ui-egui individual corner smoothing | CornerPanel and node property commands | Permit closed vectors in the existing inspector. Check mixed selections, hidden or disabled controls for open vectors and editing one point's radius independently. |
| doc/src/tests.rs smoothed vectors and ui-egui corner_individual_tests | paired pure and authenticated Chromium workflows | Compare geometry on heterogeneous corner radii, reverse traversals and malformed inputs. Inspect actual contour and selection at a smoothing-sensitive point, undo/redo, save/reload, mobile and retained performance budgets. |

Dependent upstream consumers include shape builder, Boolean/offset/simplify, SVG, PDF, FIG and Penpot. Carry the effective-geometry contract into those roadmap slices and verify their individual acceptance when the owning features exist. No new schema or services. Use the canonical checkout sequentially. Rollback base 242b5d0. The complete roadmap and publication gates remain active.

## Incoming reference changes

The 15 commits from ed90dc10 to 3daa9d32 change 13 files (+283/−31). Six non-merge commits account for the behaviour.

- 44bec70a caps arrowhead weight. ad9894a9 bounds repeated-child visits in document render bounds. Reconcile both with the implemented renderer and malformed document checks.
- bb7d568d aligns the bottom of a non-text layer to the baseline in auto layout.
- ddb8bfa6 caps bytes copied while filling missing variable modes in REST import.
- ee6ca15c joins and rounds layer hierarchy highlights. 901bc6d4 computes selection roots once per visible row. Assign both to the layer panel work and its large-document browser checks.

The global supported baseline remains 8eb0b876. Audit all incoming changes before advancing it.

## Integrated checkpoint

Phase 6. Native closed-vector corner smoothing uses the polygon corner profile and retains the source network. Every applicable shape, stroke, hit and width-geometry caller takes the drawn network. Nine paired fixtures include four native rectangle-area comparisons within 0.1 square unit, 32 direction and region-paint combinations, open and curved edges, holes, malformed loops, sharp junctions and rendered hit discrimination. All 888 pure tests and two local Auth checks pass. Strict TypeScript and both production builds pass. Authenticated Chromium checked open-vector eligibility, closed-vector position-sensitive pixels and selection, undo/redo, authored native file, reload, mobile smoothing and the iOS preset. The 10,000-node vector benchmark includes 33 visible smoothed rings. Full Chromium regression and the property report follow. The local graph refreshed to 1,800 nodes and 8,596 edges.
