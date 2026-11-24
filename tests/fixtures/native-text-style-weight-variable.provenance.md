# Native observations for a text style's weight bound to a variable (upstream ccb33e0b, 281918e2, #2174)

Data: [native-text-style-weight-variable.json](native-text-style-weight-variable.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

The commands restate native `style_vars_tests.rs` and `variables_io_tests.rs`: a Theme collection (Light, Dark), two frames (the second in Dark), a text in each using the text style "Body" made from the first.

| Case (native test) | What native gives |
|---|---|
| A number weight picks the face and the wght axis (`a_number_weight_picks_the_face_and_the_wght_axis`, and the face-name half of 281918e2) | weight 700 / 400: Bold with `wght` 700 in Light, Regular with 400 in Dark; Dark set to 650: Bold, 650; a colour variable on the weight is refused; a face name bound afterwards ("Light") replaces the weight binding and clears the axis |
| Junk weight values clamp (`junk_weight_values_clamp_to_the_lightest_and_heaviest_face`) | −50: Thin, `wght` 1; 5000: Black, 1000 |
| The CSS export keeps a style weight bare (`css_export_keeps_a_style_weight_bare`) | `--weight: 700;` with no unit |

`font_weight_wins_over_font_style_when_a_file_carries_both` edits the document directly, which `replay` cannot; the port resolves bound keys in the same sorted order, so `fontWeight` applies after `fontStyle`. `a_text_style_binding_round_trips_through_fig` concerns the `.fig` writer, which has no weight field natively either.
