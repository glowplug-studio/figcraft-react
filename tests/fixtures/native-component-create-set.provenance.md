# Native observations for Create component set (upstream f5a52ea5, 524ad8b1, 253e0c3d, dda27030)

Data: [native-component-create-set.json](native-component-create-set.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- The scenes restate native `components_behaviour_tests.rs` `create_set_*`, with the layers named by `node.set`: native's tests name them with `object.rename`, which the port does not have yet (a separate command-inventory gap).

## What the file holds

Frames 100 × 60, 150 apart along x at y 20.

| Case (native test) | Native result |
|---|---|
| Primary, Secondary, Ghost (`create_set_names_variants_by_layer_name_and_wraps_in_place`) | Set 5 "Component 1" at (−20, 0), 440 × 100; variants "Property 1=Primary/Secondary/Ghost" at x 20, 170, 320; undo restores the frames |
| A, B, C laid out right to left (`create_set_orders_left_to_right_whatever_the_selection_order`) | Variants named by left-to-right position: C first |
| Size=Small, Size=Large, Size=Medium (`create_set_keeps_names_already_in_prop_value_form`) | The names are kept; the set "Component 1" |
| Card, Card, Card (`create_set_with_one_shared_name_names_the_set_and_makes_default_variants`) | The set "Card" with three "Property 1=Default" |
| Solo (`create_set_with_one_layer_makes_a_one_variant_set`) | A set "Solo" with one "Property 1=Default" |
| An instance and a frame; a frame inside another; nothing; a component; a set (`create_set_refuses_*`) | Each refused, the document unchanged |

The port's case also checks one undo step and the set's selection after each success, and that a refusal changes neither document, selection nor history, as native's tests assert.
