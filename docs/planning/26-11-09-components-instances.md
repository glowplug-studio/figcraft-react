# Components, instances and variants

## Execution checkpoint

| Field | Evidence |
|---|---|
| Phase | Source investigation and implementation plan. |
| Reference | Upstream and the authorised fork both point to 79c363466a46b96f989b73c7cf20240bc168b7a2. The incoming commit changes the upstream Cloudflare packaging size limit only. The layout reference remains 3839fe4a. |
| React | Geometry and layout implementation dbc35f4 on prompt/full-figcraft-port. The global supported baseline remains 8eb0b876. |
| Graph | The combined local graph has 31,884 nodes and 105,277 edges. create_instance_at links to default_props and would_contain_itself. rebase_instance links to diff_groups and variable_groups. Native macro registrations and serde defaults were inspected in source. |
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

Use these records as the first comparator for the public open, inspect, edit and save paths. The current React decoder rejects all three component kinds, and its per-layer override support is limited to the text characters marker. Forty-four source files currently contain an exact frame-kind comparison. Check every one against the corresponding native predicate when extending frame-like behaviour.
