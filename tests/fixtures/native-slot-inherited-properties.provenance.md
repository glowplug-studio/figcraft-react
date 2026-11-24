# Native observations for inherited slot properties (upstream a6d9b74d, a66946d1, 2067a0b5)

Data: [native-slot-inherited-properties.json](native-slot-inherited-properties.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- The commands restate native `slot_tests.rs`; the layer ids in them were resolved by running the same scenario through the port, and every create receipt natively matched them, so both allocators agree.

## What the file holds

A Content component whose Label binds its Text (and in one case Visible); a Base component whose Body is a slot holding Content (default content) or given it by `instance.slotInsert` (own content); a Composition wrapping Base, and in one case an Outer composition wrapping that.

| Case (native test) | What native gives |
|---|---|
| Text stays local in default content (`slot_text_properties_stay_local_in_default_content`) | Instances' slot Labels show their own Text: Custom only where set, the main value and a new default reaching the others |
| Text stays local in own content (`…_in_own_content`) | The same with own content |
| Text does not read an unbound base property (`slot_text_properties_do_not_read_an_unbound_base_property`) | The slot Label keeps Content's Default although Base has a Text of its own ("Wrong owner"), which stays stored on the Base copy |
| Boolean stays local in inherited own content (`slot_boolean_properties_stay_local_in_inherited_own_content`) | Labels stay visible though Base has a Visible of false; each instance's own Visible holds through main updates and a fill edit |

Each step keeps, for `node.get`, the id, characters, visibility and an instance's properties, and for `component.properties` each property's name and value.

Native's `slot_text_properties_survive_inherited_own_content_and_persistence` saves and reopens; its binding resolution is the same as the cases above, and the port's file round trip is covered by earlier component slices.
