# Native observations for the dash allowance of a variable-width stroke (upstream #2249)

Data: [native-variable-outline-dashes.json](native-variable-outline-dashes.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by a disposable Rust executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`, Kurbo 0.13.1 as locked by the native workspace.

## What the file holds

Twelve strokes outlined by `figcraft_pathops::width::variable_outline` with a centred stroke, the default join and caps and, unless a profile is given, a uniform width profile. Each case records the number of elements, the number of subpaths (one per dash or solid piece), the bounds and the signed area. The five small cases also record every element at full `f64` precision.

| Name | Path | Width | Dashes | Elements | Subpaths | Full outline |
|---|---|---|---|---|---|---|
| one long line of unit dashes | 1 line of 15,000, 4 apart | 1 | 1, 1 | 37,741 | 7,501 |  |
| two long lines: the second draws solid | 2 lines of 15,000, 4 apart | 1 | 1, 1 | 38,254 | 7,502 |  |
| ten long lines share one allowance | 10 lines of 15,000, 4 apart | 1 | 1, 1 | 42,358 | 7,510 |  |
| a hundred unit lines under a 4,000-entry pattern | 100 lines of 1, 4 apart | 1 | 4,000 × 1 | 90,020 | 8,100 |  |
| six unit lines under a 4,000-entry pattern | 6 lines of 1, 4 apart | 1 | 4,000 × 1 | 41,798 | 8,006 |  |
| three lines of 9,000: the third draws solid | 3 lines of 9,000, 4 apart | 1 | 1, 1 | 45,995 | 9,003 |  |
| two lines of 10,000: the second meets the allowance exactly | 2 lines of 10,000, 4 apart | 1 | 1, 1 | 25,738 | 5,002 |  |
| three short lines all dashed | 3 lines of 30, 10 apart | 2 | 4, 2 | 1,098 | 18 | yes |
| a closed square then an open line | `M0 0L40 0L40 40L0 40Z M0 60L50 60` | 2 | 5, 3 | 747 | 27 | yes |
| two tapered dashed lines | `M0 0L60 0 M0 20L60 20` | 4 | 6, 4; profile [[0, 1], [1, 0.25]] | 686 | 14 | yes |
| an odd pattern doubles | 2 lines of 24, 8 apart | 2 | 3 | 522 | 10 | yes |
| no dashes | 2 lines of 24, 8 apart | 2 | none | 1,026 | 2 | yes |

The first four restate `crates/pathops/src/width_tests.rs::dashes_of_all_subpaths_share_one_allowance` and `a_short_subpath_is_budgeted_by_the_whole_pattern_it_takes`. The next three sit on the allowance's edges: a line that uses up exactly what is left draws solid, because the test is strictly less than. The last five are controls that the change must not move.

## What the observations showed about the port

- Before the change the port matched the six cases the allowance does not affect, element for element and to nine decimals in the five full outlines, and disagreed with the six it does affect: it drew 15,002 pieces where native draws 7,502, and 200,100 where native draws 8,100.
- With one allowance of 20,000 shared by all subpaths, and each line charged the larger of its dash count and its fitted pattern's length, all twelve match.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and source below, with the upstream `Cargo.lock` copied beside the manifest, and run it as the [ellipse provenance](native-ellipse-four-anchor.provenance.md) shows, with `--bin width`. It reads `[{"name", "d" | "lines": [count, length, spacing], "width", "dashes", "profile"?, "full"?}]`: the columns of the table above.

Manifest (SHA-256 `6c504a94764609068d8273a606e510b5f58aed21369df91d77b32c632d5ba68d`): the [corner radius provenance](native-round-corners.provenance.md) manifest with one more executable:

```toml
[[bin]]
name = "width"
path = "src/width.rs"
```

`src/width.rs` (SHA-256 `3d0826f8cf73e57d07e6c7ca52c0042d4af3e067a24b68060ebba0de97db9764`):

```rust
//! Outlines strokes with the native variable-width outliner and reports what it drew.
//! Input (stdin): [{"name", "d": svg path data | "lines": [count, length, spacing] (horizontal lines, one subpath each),
//! "width", "dashes": [..], "profile"?: [[t, scale], ...] (uniform when absent), "full"?: bool}].
//! Output per case: the number of elements, of subpaths (one per dash or solid piece), the bounds, the area, and with
//! "full" the elements at full precision.
use figcraft_doc::{StrokeAlign, StrokeProps, WidthProfile};
use figcraft_geom::kurbo::{BezPath, PathEl, Shape};
use figcraft_pathops::width::variable_outline;
use serde_json::{Value, json};

fn elements(path: &BezPath) -> Value {
    Value::Array(
        path.elements()
            .iter()
            .map(|el| match *el {
                PathEl::MoveTo(p) => json!(["M", p.x, p.y]),
                PathEl::LineTo(p) => json!(["L", p.x, p.y]),
                PathEl::QuadTo(a, p) => json!(["Q", a.x, a.y, p.x, p.y]),
                PathEl::CurveTo(a, b, p) => json!(["C", a.x, a.y, b.x, b.y, p.x, p.y]),
                PathEl::ClosePath => json!(["Z"]),
            })
            .collect(),
    )
}

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let path = match case.get("lines") {
            Some(l) => {
                let (count, length, spacing) = (l[0].as_u64().expect("count"), l[1].as_f64().expect("length"), l[2].as_f64().expect("spacing"));
                let mut p = BezPath::new();
                for i in 0..count {
                    p.move_to((0.0, i as f64 * spacing));
                    p.line_to((length, i as f64 * spacing));
                }
                p
            }
            None => BezPath::from_svg(case["d"].as_str().expect("path data")).expect("valid path data"),
        };
        let width = case["width"].as_f64().expect("width");
        let dashes: Vec<f64> = case["dashes"].as_array().expect("dashes").iter().map(|d| d.as_f64().expect("a dash")).collect();
        let profile = match case.get("profile") {
            Some(points) => WidthProfile::new(points.as_array().expect("profile points").iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))),
            None => WidthProfile::uniform(),
        };
        let props = StrokeProps { weight: width, align: StrokeAlign::Center, width_profile: Some(profile.clone()), dashes, ..Default::default() };
        let mut row = json!({"name": case["name"], "width": width, "dashes": case["dashes"]});
        for key in ["d", "lines", "profile"] {
            if let Some(v) = case.get(key) {
                row[key] = v.clone();
            }
        }
        match variable_outline(&path, width, &props, &profile) {
            Some(outline) => {
                let b = outline.bounding_box();
                row["elements"] = json!(outline.elements().len());
                row["subpaths"] = json!(outline.elements().iter().filter(|e| matches!(e, PathEl::MoveTo(_))).count());
                row["bounds"] = json!([b.x0, b.y0, b.x1, b.y1]);
                row["area"] = json!(outline.area());
                if case.get("full").and_then(Value::as_bool) == Some(true) {
                    row["outline"] = elements(&outline);
                }
            }
            None => row["outline"] = Value::Null,
        }
        out.push(row);
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```
