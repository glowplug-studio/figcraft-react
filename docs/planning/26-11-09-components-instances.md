# Components, instances and variants

## Execution checkpoint

| Field | Evidence |
|---|---|
| Phase | Phase 5. Instance lifecycle, variant selection, property values, exposed nested instances and slot edits have native comparison coverage. Property definitions, bindings, editable slots and the authoring inspector passed local verification. Local asset discovery and placement are next. |
| Reference | Upstream and the authorised fork both point to 79c363466a46b96f989b73c7cf20240bc168b7a2. The incoming commit changes the upstream Cloudflare packaging size limit only. The layout reference remains 3839fe4a. |
| React | Commit 3bf7932 on prompt/full-figcraft-port passed all 258 production Chromium workflows in 563.1 seconds with zero skips, failures or flaky tests. The global supported baseline remains 8eb0b876. |
| Graph | The combined local graph has 32,047 nodes and 106,466 edges. create_instance_at links to default_props and would_contain_itself. rebase_instance links to diff_groups and variable_groups. Native macro registrations and serde defaults were inspected in source. |
| Backend | The scoped MCP read resolved the intended Figcraft project and returned zero public tables. This slice works on in-document component definitions and local instances. |
| Native verification | All 15 upstream headless UI tests selected by the component filter passed. They cover panel and layer interactions. This filter does not cover the full engine family. |
| First implementation | Preserve main component, component set, instance and descendant linkage records. Verify a real native component drawing survives open, render, recovery and download before adding authoring commands. |
| Publication | Local work on the existing port branch. The full-product publication gate remains pending. |

## Dependency order

1. **Native records and frame behaviour.** Map component descriptions, property definitions and order, instance main IDs and values, and per-layer source IDs, overrides, exposure and property references. Preserve exact 64-bit IDs, arbitrary property names, native ordering and omitted defaults. Make frame-like predicates explicit wherever drawing, clipping, layout, transforms, hit testing, layers and file interchange share behaviour. Check each exact-frame condition against its Rust caller.
2. **Create and instantiate.** Convert a single frame or group in place. Wrap other selections using the existing frame-selection operation and preserve names and hierarchy. Place an instance of a main or a set’s default variant using native placement rules. Verify single/multiple creation, selection, return IDs, expected errors and undo. An ordinary copy of a main becomes its instance. A copied variant inside its own set remains a main.
3. **Synchronisation and edit guards.** Reconcile the mirrored subtree by source identity, remove stale children, update untouched fields and preserve allowed overrides. Apply constraints before child overrides, including scaled and nested instances. Enforce the native structural and override restrictions through commands, clipboard and canvas interactions. Compare multi-step sessions for cycles, missing sources, ID reuse, rollback, deleting mains, restore, detach, reset and undo.
4. **Variants, properties and slots.** Implement discovery, combine/add, naming, defaults and conflicts, swapping with the applicable override policy, property add/edit/delete/reorder/bind, exposure and editable slot content. Check each transition against the command result and final document. Cover missing defaults, renames, preferred swaps, orphaned references and nested slots.
5. **Browser workflows.** Integrate the native component/layer actions, Design inspector, local Assets discovery, placement, navigation and keyboard/pointer equivalents. Verify focus, errors, narrow layout, mixed selections, component settings, save, recovery and one-step undo. Preserve shared library links for the assets slice, and integrate the cross-file behaviour when its storage and workspace dependencies land.
6. **Verification and release.** Run native comparison sessions, pure and local Auth tests, production Next.js Chromium, component tree performance and a dedicated property matrix. Check the previous layout, text, overrides and duplicate/clipboard behaviours before advancing.

## Source mapping

| Native source | React ownership and verification |
|---|---|
| [NodeKind, PropDef, ordered_props and common node fields](../../original/figcraft/crates/doc/src/node.rs) | [Document and node types](../../src/engine/document.ts), [native file reader/writer](../../src/engine/file-format.ts) and [lossless identifiers](../../src/engine/native-values.ts). Compare source IDs and all per-kind and per-layer fields after a native round trip. |
| [Component command registry and creation](../../original/figcraft/crates/engine/src/cmd/component.rs) and [instances](../../original/figcraft/crates/engine/src/assets/components/instances.rs) | [Editor dispatch](../../src/engine/editor.ts), [structure](../../src/engine/structure.ts), [hierarchy](../../src/engine/hierarchy.ts) and [duplication](../../src/engine/duplicate.ts). Compare group and frame conversion, wrapped leaves, parents, selection and allocated IDs. |
| [Guards](../../original/figcraft/crates/engine/src/assets/components/guard.rs), [cycles](../../original/figcraft/crates/engine/src/assets/components/cycles.rs), [sync](../../original/figcraft/crates/engine/src/assets/components/sync.rs) and [rebase](../../original/figcraft/crates/engine/src/assets/components/rebase.rs) | Put validation and propagation at the shared edit boundary so the command palette, inspector, canvas and clipboard cannot bypass them. Verify rejected edits leave the correct state and history. |
| [Property commands](../../original/figcraft/crates/engine/src/cmd/component/props.rs), [variant commands](../../original/figcraft/crates/engine/src/cmd/component/variants.rs) and [instance commands](../../original/figcraft/crates/engine/src/cmd/component/instance.rs) | Separate typed property and variant operations from browser controls. The pinned module registers 28 commands. Cover every registration and its error paths. |
| [Component panel](../../original/figcraft/crates/ui-egui/src/panels/component_panel.rs) and [engine behaviour tests](../../original/figcraft/crates/engine/src/components_behaviour_tests.rs) | Browser inspector, layers, assets and independent checks of mirror structure, saved values and visible output. |

The rollback point for component product code is dbc35f4. The reference fast-forward supplies no new editor functionality. This phase adds no hosted schema, storage or realtime resources.


## Native reference sessions

Three independent engine sessions were run against the source. Converting frame 2 in place preserved child 3. Creating its instance at (160, 20) allocated root 4 and mirrored child 5, with source IDs 2 and 3 respectively. Converting a single rectangle wrapped it under a new component and kept its prior origin on the wrapper. Editing the main rectangle’s name and fill afterwards propagated to the instance copy. Adding a variant to a standalone main created set 3 and variant 4. The original main became Property 1=Default and the new main Property 1=Variant2. The native component list returned all three assets with their folders, page and instance counts.

Use these records as the first comparator for the public open, inspect, edit and save paths. At the start of the slice the React decoder rejected all three component kinds, and its per-layer override support was limited to the text characters marker. Forty-four source files currently contain an exact frame-kind comparison. Check every one against the corresponding native predicate when extending frame-like behaviour.

## Property records and descendant links

All five native property declaration kinds are implemented in component-properties.ts. Of 500 generated native inputs, both implementations accepted 317 and rejected 183. Every accepted definition, default, preferred ID list and displayed name order matched the Rust output. Cases include maximum unsigned 64-bit IDs, repeated and unknown names, integer-like keys, prototype names and Unicode outside the BMP.

The native file adapter now preserves descendant source IDs, property references, exposure and override groups on supported node types. Node inspection reports the ordered groups. Text's existing characters override remains compatible with older in-memory documents. The archive test saves and reopens a layer with a maximum-width ID and an own __proto__ property reference. Strict TypeScript and 1,837 pure tests passed. The new fixture file was tested directly because the code graph extractor yielded no test symbols for it. The merged local graph has 31,900 nodes and 105,342 edges including the React and Rust ordering functions.

Next, extend the document union with component, componentSet and instance. Use the native frame-like predicate for shared geometry and rendering. Compare open/render/recovery/save with the three captured native sessions, then implement creation and instance propagation. The full component release gate is open.

## Native containers and component creation

The document model represents components, component sets and instances as distinct frame-like kinds. Layout, clipping, constraints, stacking, selection, numeric geometry and paint use the same native predicates as frames where applicable. Boolean subtrees and individual side strokes retain their native component-set exceptions. Property definitions and values are available through node.get. Named component data and lossless numbers round-trip through the archive writer. Three captured Rust trees cover a main and mirror, a propagated edit and a component set with its variants.

The layer actions and native keyboard shortcut create components. A frame or group converts in place. A single shape lends its name to a transparent wrapper. Multiple creation uses one history entry and rolls back a failed batch. The generic node.create command also accepts the native component type. Across 180 generated Rust sessions, 754 final nodes matched on kind, name, parent, order, size, transform, clipping and paint count. Selection and per-command success also matched.

The exact production build passed six signed-in Chromium workflows in 17.3 seconds. They cover opening an existing instance, canvas picking, original and copied pixels, editing its position, recovery after reload, intact source IDs on download, creation through the layer action and keyboard, undo and existing frame and grid behaviour. The complete pure suite passed 1,845 tests with a 30-second per-test timeout. Under concurrent machine load the 1,001-image clipboard fixture had exceeded Vitest’s five-second default twice. Its isolated rerun passed. Both local Auth integrations passed separately. Strict TypeScript, the library and the production host built successfully. The merged local graph has 31,921 nodes and 105,520 edges and links readNode to readFrameKind.

Next implement instance.create, choose the default variant by position and reject direct and transitive containment. Compare the results and generated child source IDs with native sessions. Main-to-instance change propagation, override tracking and slot ownership remain open.

## Create and duplicate instances

At 97cb324 all 252 production Chromium checks passed in 9.5 minutes. The subsequent implementation adds instance.create, the Layers action and main-component duplication. Native set geometry determines the default variant. Creation preserves the source IDs and child order, applies boolean and text bindings, and allocates one undoable tree. The containment checks reject direct cycles, indirect cycles and cycles introduced by default swap properties. Native duplication returns the descendant ID map and keeps a variant duplicated inside its set as a main.

Across 180 generated sessions, 540 instance commands and 2,575 final nodes matched the native command outcomes, IDs, selection, tree order, geometry, link targets, clipping and paint counts. Separate Rust sessions confirmed duplicate maps and rollback of an instance whose default swap would close a cycle. The rejected allocation remained available for the next command.

Strict TypeScript, library and production-host builds, 1,852 pure tests and both local Auth tests passed. Five signed-in production Chromium workflows passed in 14.6 seconds, including default variant selection through Layers, undo, redo, reload and native download. An initial browser invocation selected the hosted login fixture through its base URL argument and stopped before executing a workflow. The successful run used the configured local Auth fixture. The combined local graph includes insertInstance and assertNoNewComponentCycle on the React side and would_contain_itself and sync_instance_depth on the Rust side.

Next implement transaction-wide edit guards, override capture, adopting slot content and propagation to existing mirrors. Compare edits to a main and its nested instances after each command and after undo. Nested swap rebuilding, copy/paste, variants, property authoring, Assets and the full component release gate remain open.

## Instance edits, propagation and rollback

The shared edit boundary checks a proposed document before storing history, consuming IDs or exposing a selection. Property writes, structural commands, pointer commits and asynchronous image placement reach that boundary. Undo and redo restore the recorded documents. Active text saves and asynchronous image archive checks can reuse the prepared edit.

Main value edits propagate to copies through nested instances. Explicitly setting an instance property to its current value can mark its group overridden. A changed non-geometric value set back to its main clears the override. The native command-specific marking and the post-edit comparison both matter. A child's Delete hides it in an instance and preserves its ID. The same command removes owned slot content. Direct placement and constraint changes on a mirror are refused. Editing a main and its mirror together can be valid. Structural changes preserve matched IDs, allocate new mirrors in native order and keep the instance's own slot subtree on rebuild.

Generated comparisons replayed every prefix of 180 value-edit sessions and 100 nested structural sessions in Rust and React. All 3,140 snapshots matched across 27,509 inspected nodes. Compared fields include selection, per-command success and return values, IDs, hierarchy, mirror sources, component links, dimensions, matrices, names, visibility, lock state, fills, stroke weight, opacity, blend, corners and override markers. The 540 instance-creation commands also passed again. The generated sessions use basic shapes and simple component trees. They do not cover every property declaration, nested variant swap, library or lost-source repair.

The native comparisons caught three distinct behaviours before verification passed. Setting the current stroke weight still records an override. Rebuilding an instance can reset a child's lock to its source layer. Adding the same new source to nested and standalone instances uses a different allocation order from rebuilding the outer trees one at a time.

The prior implementation at 9f918ae passed all 253 production Chromium tests in 9.1 minutes. This checkpoint passed strict TypeScript, the library and production host builds, 1,857 pure tests, both local Auth integrations and six signed-in production Chromium workflows in 16.2 seconds. The new browser workflow renames a main child, verifies that its mirror follows, overrides the mirror, changes the main again, undoes and redoes, reloads and downloads the native archive. The archive retained source 3 and the name override. The combined graph links rebuildAffectedInstances to rebuildInstance in React and sync_after_edit to record_overrides in Rust.

Next compare nested swap rebasing, source matching across variants, property binding changes and default propagation. Implement instance reset, detach and restore using the verified edit boundary and extend the Assets and component controls. Deep slot rebasing, scaled text/vector geometry and the full component release gate remain open.

## Instance lifecycle and property controls

The instance inspector opens the local main (including on another page), swaps components, resets field groups or the whole instance, pushes eligible overrides, detaches, and restores a deleted local main. Nested copies retain their own sources when the outer instance detaches. Reset preserves the outer size override. A restored main reuses free source identifiers and relinks surviving instances. Entering or resetting slot content updates selection, hierarchy, history and recovery. Shared-library navigation still depends on the library and workspace slices.

Variant selection reads comma-separated property/value pairs from sibling names. The first exact match wins. Partial matches use the last highest-scoring sibling. Boolean, text and swap properties use the selected variant’s definitions. Slots expose their editable contents separately. Main and instance property queries include defaults, value order, editable slots and conflicting variant combinations. Exposed visible nested instances show their own property controls. The engine commits multi-target edits atomically.

Native comparisons used the pinned engine and the same five repository fonts in both renderers. The first text-bound comparison had used a fontless native harness. Repeating with matched fonts removed that geometry difference. Native comparisons also identified two implementation errors. Slot reset left a removed selection behind, and creating an instance with a bound nested swap skipped the placing main’s override and ID matching. Instance creation now invokes the same rebuild as subsequent synchronisation. Permanent fixtures exercise both repairs.

| Generated command prefixes | Cases | Inspected node states |
|---|---:|---:|
| Nested detach, restore, reset, navigation and push | 1,400 | 21,954 |
| Slot insertion/reset and variant-specific override carry | 600 | 6,192 |
| Typed properties, query results, conflicts, exposure and refusal rollback | 820 | 7,440 |
| Bound nested swaps with shared and renamed children and text bindings | 675 | 10,125 |
| Previous main-edit and structural regressions | 3,140 | 27,509 |

Every row matched the native command outcomes, selection and inspected node fields. The 180 earlier three-command creation sessions also matched. The local merged graph links React instance creation to the rebuild and native synchronisation to cycle-aware expansion. These cases cover local components. Remaining work includes set and property definition authoring, spatial placement and swaps, local Assets discovery, component performance and the full release matrix.

Local verification passed strict TypeScript, the package and production Next.js builds, 1,866 pure tests, both real local Auth checks and eight signed-in Chromium workflows. The browser replay exposed a slot selector whose accessible label included its option text. An explicit property label fixed it. The replay now switches a variant, navigates to its actual main, resets an override, detaches and undoes, edits a bound caption and visibility, resets/refills a slot, reloads and verifies the downloaded native document. All 256 production browser workflows subsequently passed at 6960033.

## Creating and extending variant sets

Native `wrap_in_set`, `combine`, `add_variant` and `fit_set` map to [variant authoring](../../src/engine/variant-authoring.ts). The Layers panel offers the actions for eligible local mains and sets. Combining deduplicates command targets, orders them by stacking, wraps padded world bounds in the top layer’s parent space and preserves the placement of each main. A slash-separated main gives the set its folder name. Adding to a standalone main creates the set first. Adding to an existing set duplicates the chosen variant’s subtree, including internally referenced patterns, names the combination and grows the set.

A pinned Rust oracle exercised 840 command prefixes and 7,892 node states with single and multiple mains, reversed or repeated IDs, different parents, choice ordering, explicit names and rejected duplicates. Comparison initially found that a newly created text layer carried a character override outside an instance. Upstream clears orphaned links and overrides for newly inserted layers, including copies. The corrected transaction boundary clears them and rebases new independent instance copies where needed. Later explicit character edits retain their upstream override behaviour. All 840 prefixes now agree on command outcomes, selection, hierarchy, placement, paint and inspected node properties. The 1,400 lifecycle, 820 typed-property and 675 bound-swap prefixes also passed again.

The next property-authoring comparison has 990 native command prefixes covering boolean and text bindings, swap preferences, slot declaration and removal, variant property renames, defaults and deletion. These are reference captures awaiting React implementation and verification.

For property authoring, compare mutations against every variant in the owner set and all of their placed instances. The captures include 30 rejected text bindings, 30 invalid preferred slot components and 30 duplicate variant-property names. Renaming a property must migrate existing values and layer references, including an own key named `__proto__`. Editing a boolean default updates bound main layers. Moving a variant default exchanges its coordinates with the top-left variant. Recheck deletion of an edited slot, expose/hide controls and user-visible undo before advancing to Assets.

Variant authoring passed strict TypeScript, both builds, 1,868 pure tests, both local Auth checks and six signed-in production Chromium workflows. The new workflows combine a multi-selection and undo it, add variants to a standalone main, change an existing instance to the new variant, reload and inspect the downloaded native hierarchy. The local combined graph links `addVariant` to `duplicateInto` and `fitVariantSet`, and links native `add_variant` to `fit_set`. The complete regression is the next browser gate.

## Authoring properties, bindings and slots

Native `add_prop_for`, `bind`, `edit_prop`, `delete_prop`, `make_slot` and `remove_slot` map to [property authoring](../../src/engine/property-authoring.ts). Definitions follow their owner across variants. Ordered names, layer bindings and instance values survive renames and deletion. Boolean defaults follow direct main-layer visibility changes, even in a drawing without placed instances. Swap and slot preferences retain order and deduplicate component or set IDs. An edited slot loses its contents when the declaration is removed and undo restores the former subtree. Existing variable bindings on imported instances still depend on the variables and library work.

The [Design inspector](../../src/ComponentPanel.tsx) supports typed defaults, creating properties from a selected layer, rename, remove, variant value editing and reordering, preferred components and component descriptions. Selected instance slots support local insert, select and reset. The default variant follows the native top-left position rule. Swapping the positions of two coincident variants leaves them coincident. The browser test now places the alternatives apart to verify that choosing the new default actually moves it.

| Native comparison | Prefixes | Inspected node states |
|---|---:|---:|
| Set-wide declarations, binding, renaming, deletion, preferred components, editable slots and variant axes | 990 | 15,390 |
| Owner resolution, direct visibility changes, unusual keys, sanitised slot names, type and duplicate refusals and atomic variant edits | 1,260 | 14,510 |

All command outcomes, queried property descriptions, selections and inspected native fields matched. Comparisons include numeric-looking strings, Unicode names, `__proto__` and `constructor`. Three permanent model workflows cover ownership, slot undo and rollback. Strict TypeScript, package and production host builds, 1,871 pure tests, two local Auth tests and eight signed-in Chromium workflows passed. The full browser regression follows the local commit. Graphify connects `editDefinition` to boolean default propagation and the native declaration code to its default-value and binding functions.

Next implement `component.list`, `component.hideWhenPublishing`, `instance.place` and `instance.swapAt` with local Assets UI, thumbnails, click/drag placement, slot targeting, auto-layout insertion and Alt-drop swap. Then complete the component property matrix, cross-feature/performance and release checks. Shared-library resolution and publication remain assigned to roadmap row 10.
