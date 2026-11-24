# Native observations for the properties an instance lists (upstream 14670b99, #2022)

Data: [native-instance-properties.json](native-instance-properties.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

| Case | Native result |
|---|---|
| A set of two variants (State Default and Selected), each Label bound to its own text property, plus an unbound "Gone label" (native `prop_order_tests::an_instance_lists_only_the_properties_its_variant_uses`) | The set and a variant list all five; an instance of Default lists Type, State and Default label; switched to Selected it lists Type, State and Selected label |
| A Card with a slot (Body), a bound text (Heading), a bound boolean (Show dot), a bound swap (Glyph) and an unbound boolean (Unused); then Heading deleted | The main lists all five, the instance all but Unused; after the deletion both lose Heading |

## Older expectation re-observed

`tests/parity/component-containers.test.ts` "applies typed values to bound layers and describes native slots without changing history" expected the instance of `native-component-typed.json` to list its Icon swap. Replayed natively at this revision (`file.open` of that fixture, then `component.properties` of the instance and the main), the instance lists Shown, Caption and Body, the main all four; the expectation was updated. The browser case "main property bindings, defaults and descriptions…" now checks that a text property bound to no layer is not listed on the instance, as upstream's own tests were changed to bind such a property.

The browser case "scoped layer fields bind, change and detach…" opens `native-variable-inspectors.json`, whose Button component defines Shown and Caption without binding them to any layer. Replayed natively at this revision, `component.properties` of its instance (node 6) lists nothing, so the case now checks that the instance offers neither property to bind and that its stored values stay as they were. Binding a variable to an instance property by command stays covered in `tests/parity/layer-variables.test.ts`.
