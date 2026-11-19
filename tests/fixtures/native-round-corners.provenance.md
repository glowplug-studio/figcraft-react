# Native observations for a boolean group's corner radius (upstream #2222)

Data: [native-round-corners.json](native-round-corners.json) and [native-boolean-radius.json](native-boolean-radius.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by disposable Rust executables built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`, Kurbo 0.13.1 and `linesweeper` as locked by the native workspace.

## What each file holds

| File | Executable | Content |
|---|---|---|
| `native-round-corners.json` | `round` | 16 inputs and 38 results. Each input is one shape, or several folded bottom to top with `figcraft_pathops::boolean_ops` as a boolean group folds its operands. `folded` is the fold; each result is `figcraft_pathops::round_corners(folded, radius, smoothing)` as elements at full `f64` precision, with its signed `area` and `unchanged` (the rounded path equals the fold). Nine results are unchanged |
| `native-boolean-radius.json` | `replay` | Ten command sequences through `Session::execute` with every receipt: `bool.*`, `node.set`, `node.get`, `edit.undo`, `vector.flatten`, `edit.copyProperties`, `edit.pasteProperties`, `variable.*` and `file.exportSvg`. Exports are stored decoded as `svg` |

The `round` inputs restate `crates/pathops/src/round_tests.rs` (the L of the Figma measurement, a notch in a rounded rectangle, shapes with nothing sharp, an open path, points the sweep leaves on an edge, curved corners of two circles, degenerate contours, a small contour beside a large one, non-finite and negative radii) and add a plain rectangle, a triangle and two subtractions. The command sequences restate `crates/engine/src/boolean_radius_tests.rs` and add paste properties and a bound radius variable, which the upstream commit message names without an engine test.

## Inputs to `round`

Radius and smoothing pairs are written `radius / smoothing`.

| Name | Shapes | Operations | Rounds |
|---|---|---|---|
| L of two rectangles | `[{"rect": [0, 0, 200, 100]}, {"rect": [150, 0, 100, 200]}]` | union | 20 / 0; 40 / 0; 500 / 0; 1e+300 / 0; 20 / 0.6; 20 / 1; 0 / 0; -5 / 0; NaN / 0; Infinity / 0 |
| notch in a rounded rectangle | `[{"rounded": [200, 100, 10, 0]}, {"rect": [50, -50, 100, 100]}]` | subtract | 20 / 0; 500 / 0; 20 / 0.6 |
| rounded rectangle, nothing sharp | `[{"rounded": [100, 60, 20, 0]}]` | none | 20 / 0 |
| ellipse, nothing sharp | `[{"ellipse": [100, 60]}]` | none | 20 / 0 |
| open path | `[{"d": "M0 0L50 0L50 50"}]` | none | 10 / 0 |
| points the sweep leaves on an edge | `[{"d": "M0 0L20 0L100 0L100 0L100 60L100.00000000001 60L100 100L0 100Z"}]` | none | 500 / 0; 10 / 0 |
| two circles united | `[{"ellipse": [100, 100]}, {"ellipse": [100, 100], "at": [70, 0]}]` | union | 10 / 0; 10 / 0.6; 40 / 0 |
| two circles intersected | `[{"ellipse": [100, 100]}, {"ellipse": [100, 100], "at": [70, 0]}]` | intersect | 10 / 0; 40 / 0 |
| two points closed | `[{"d": "M0 0L10 0Z"}]` | none | 5 / 0.5 |
| a small rectangle | `[{"rect": [0, 0, 1, 0.5]}]` | none | 0.1 / 0; 5 / 0 |
| empty | `[{"d": ""}]` | none | 5 / 0 |
| a large contour beside a small notched one | `[{"d": "M0 0L1000000 0L1000000 1000000L0 1000000Z M2000000 0L2000010 0L2000010 10L2000005.5 10L2000005.5 9.5L2000005 9.5L2000005 10L2000000 10Z"}]` | none | 0.001 / 0 |
| a plain rectangle | `[{"rect": [10, 20, 120, 80]}]` | none | 15 / 0; 15 / 0.6; 60 / 0; 100 / 0 |
| a triangle | `[{"d": "M0 0L100 0L50 80Z"}]` | none | 10 / 0; 10 / 0.6; 200 / 0 |
| rectangle minus circle | `[{"rect": [0, 0, 200, 100]}, {"ellipse": [80, 80], "at": [60, -40]}]` | subtract | 8 / 0; 30 / 0 |
| rectangle excluding rectangle | `[{"rect": [0, 0, 100, 100]}, {"rect": [50, 50, 100, 100]}]` | exclude | 10 / 0 |

## What the observations showed about the port

- With `round_corners` ported, every result on a fold of lines matches native to nine decimals, and every result on a fold with curves to four. A corner beside a curve is cut by arc length along the curve, and the two implementations measure a cubic's length by different quadratures.
- Native returns the fold itself, not a copy with equal elements, when nothing rounds: for a radius that is zero, negative or not finite, an open path, a contour with nothing sharp, and an empty path.
- Native's fold and the port's start a contour at different vertices and native writes straight pieces as lines (the recorded normaliser difference). The engine-level test therefore compares exported outlines segment by segment whatever vertex they start at, and only where a radius is drawn. Where no radius is set, the two normalisers also differ on points left along straight edges; that predates this change.
- A boolean group reports and stores per-corner radii like any layer, but draws only the first.
- `edit.copyProperties` from a boolean group carries its radius and smoothing; `edit.pasteProperties` gives them to a boolean group or rectangle and not to an ellipse. A number variable bound to `cornerRadius` on a boolean group sets all four stored radii and follows `variable.set`.

Two native tests are restated without a new observation because they state their expectation in the source at the pinned revision: `crates/format/src/rest/tests.rs::vectors_ellipses_stars_and_booleans` (REST JSON: radius 12 and smoothing 0.6 on a boolean group) and `crates/format/src/fig/export_tests.rs::a_boolean_groups_corner_radius_round_trips` (radius 20 and smoothing 0.6 to four decimals). The Design panel cases restate `crates/ui-egui/src/field_tests.rs` and `corner_individual_tests.rs` the same way; the native panel cannot be driven headless here.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and source below, with the upstream `Cargo.lock` copied beside the manifest, and run each executable as the [ellipse provenance](native-ellipse-four-anchor.provenance.md) shows, with `--bin round` or `--bin replay`. `round` reads the inputs above as `[{"name", "shapes", "ops", "rounds"}]`, where a round is `[radius, smoothing]`; `replay` reads `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.

Manifest (SHA-256 `9126df97839528fed8c507540fa8c05760f4e273e0b7cf6b6839d0e156e2ea0e`): the [simplification provenance](native-simplify-path.provenance.md) manifest with one more executable and one more dependency:

```toml
[[bin]]
name = "round"
path = "src/round.rs"

[dependencies]
figcraft-pathops = { path = "/source/crates/pathops" }
```

`src/replay.rs` is unchanged from the ellipse provenance (SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`).

`src/round.rs` (SHA-256 `911807fa661437182fc5c7b9b8aa6b1b095cebd0decce9d2ebe5af12c721db42`):

```rust
//! Folds shapes with the native boolean operations and rounds the result's corners.
//! Input (stdin): [{"name", "shapes": [{"rect": [x, y, w, h]} | {"rounded": [w, h, r, smoothing]} | {"ellipse": [w, h]} | {"d": "..."},
//! each with an optional "at": [dx, dy]], "ops": ["union" | "subtract" | "intersect" | "exclude"], "rounds": [[radius, smoothing], ...]}].
//! A radius or smoothing may be the string "NaN", "Infinity" or "-Infinity".
use figcraft_doc::BoolOp;
use figcraft_geom::kurbo::{Affine, BezPath, PathEl, Shape};
use figcraft_geom::{Rect, ellipse, rounded_rect};
use figcraft_pathops::{boolean_ops, round_corners};
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

fn number(v: &Value) -> f64 {
    match v.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => v.as_f64().expect("a number"),
    }
}

fn shape(spec: &Value) -> BezPath {
    let n = |v: &Value, i: usize| v[i].as_f64().expect("a number");
    let path = if let Some(r) = spec.get("rect") {
        Rect::new(n(r, 0), n(r, 1), n(r, 0) + n(r, 2), n(r, 1) + n(r, 3)).to_path(0.1)
    } else if let Some(r) = spec.get("rounded") {
        rounded_rect(n(r, 0), n(r, 1), [n(r, 2); 4], n(r, 3))
    } else if let Some(e) = spec.get("ellipse") {
        ellipse(n(e, 0), n(e, 1), 0.0, std::f64::consts::TAU, 0.0)
    } else {
        let d = spec["d"].as_str().expect("path data");
        if d.is_empty() { BezPath::new() } else { BezPath::from_svg(d).expect("valid path data") }
    };
    match spec.get("at") {
        Some(at) => Affine::translate((n(at, 0), n(at, 1))) * path,
        None => path,
    }
}

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let shapes: Vec<BezPath> = case["shapes"].as_array().expect("shapes").iter().map(shape).collect();
        let ops: Vec<BoolOp> = case["ops"]
            .as_array()
            .expect("ops")
            .iter()
            .map(|o| match o.as_str() {
                Some("union") => BoolOp::Union,
                Some("subtract") => BoolOp::Subtract,
                Some("intersect") => BoolOp::Intersect,
                Some("exclude") => BoolOp::Exclude,
                other => panic!("unknown operation {other:?}"),
            })
            .collect();
        // One shape is rounded as it is; several are folded bottom to top, as a boolean group folds its operands.
        let folded = if ops.is_empty() {
            shapes[0].clone()
        } else {
            let operands: Vec<(&BezPath, BoolOp)> = shapes.iter().enumerate().map(|(i, s)| (s, if i == 0 { ops[0] } else { ops[i - 1] })).collect();
            boolean_ops(operands).expect("the fold succeeds")
        };
        let mut results = vec![];
        for round in case["rounds"].as_array().expect("rounds") {
            let rounded = round_corners(&folded, number(&round[0]), number(&round[1]));
            results.push(json!({"radius": round[0], "smoothing": round[1], "rounded": elements(&rounded), "area": rounded.area(), "unchanged": rounded == folded}));
        }
        out.push(json!({"name": case["name"], "shapes": case["shapes"], "ops": case["ops"], "folded": elements(&folded), "area": folded.area(), "results": results}));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```
