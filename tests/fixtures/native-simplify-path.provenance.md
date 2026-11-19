# Native observations for simplification that keeps to its input (upstream #1741)

Data: [native-simplify-path.json](native-simplify-path.json), [native-vector-simplify.json](native-vector-simplify.json) and [native-pencil-strokes.json](native-pencil-strokes.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by disposable Rust executables built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`, Kurbo 0.13.1 as locked by the native workspace.

## What each file holds

| File | Executable | Content |
|---|---|---|
| `native-simplify-path.json` | `simplify` | 36 inputs and 90 results. For each input and accuracy: `native` is `figcraft_geom::simplify_path`, `kurbo` is Kurbo's own `simplify_bezpath` on the same input, both as elements at full `f64` precision. `kurbo` is `null` where Kurbo panics (6 results: a close with nothing drawn). The two differ in 41 results; those are the inputs the upstream change exists for |
| `native-vector-simplify.json` | `replay` | Three command sequences through `Session::execute`: `vector.create`, `vector.simplify`, `node.get` and `file.exportSvg`, with every receipt. Exports are stored decoded as `svg` |
| `native-pencil-strokes.json` | `pencil` | Four strokes drawn with the Pencil tool through `Session::pointer` at zoom 1: the samples, the vector layer `node.get` reports and the exported SVG |

The first 27 inputs restate the native tests added by `0aba3f76` and `61389cdd` in `crates/geom/src/tests.rs`, `crates/engine/src/brush_tests.rs` and `crates/engine/src/vector_behaviour_tests.rs`, with quadratic segments left out because the port's paths hold lines and cubics only. The last nine are the scenarios of the port's earlier Pencil and Simplify tests, observed so that their expectations rest on native output.

## What the observations showed about the port

- Kurbo raises a line to a cubic whose control points sit on its ends. A fit over lines therefore sees no direction at a join and moves along each line as a smooth step. The port modelled lines with a constant direction, which fitted nearly straight runs well where Kurbo fits them badly.
- On straight or nearly straight runs the fit's coefficients are rounding noise, so the order of arithmetic decides the result. The port now follows Kurbo's order in the quadratic and cubic solvers, the moment integrals, the sampling steps and the candidate transform.
- A fourth executable, `fitdebug`, printed the intermediates of Kurbo's single-cubic fit (samples, moments, coefficients, roots, arms) for chosen parameter ranges. It was used to find the two points above and produces no fixture.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and sources below, with the upstream `Cargo.lock` copied beside the manifest, and run each executable as the [ellipse provenance](native-ellipse-four-anchor.provenance.md) shows, with `--bin simplify`, `--bin replay` or `--bin pencil`. `simplify` reads `[{"name", "d", "accuracies"}]`; `pencil` reads `[{"name", "samples"}]`; `replay` reads `[{"name", "commands"}]`.

Manifest (SHA-256 `ee3012f5c40453de405723e85672e5923dd84d4f0639c24c234b11a5ed48bc28`):

```toml
[package]
name = "oracle"
version = "0.0.0"
edition = "2024"
publish = false

[[bin]]
name = "replay"
path = "src/replay.rs"

[[bin]]
name = "hits"
path = "src/hits.rs"

[[bin]]
name = "simplify"
path = "src/simplify.rs"

[[bin]]
name = "fitdebug"
path = "src/fitdebug.rs"

[[bin]]
name = "pencil"
path = "src/pencil.rs"

[dependencies]
figcraft-geom = { path = "/source/crates/geom" }
figcraft-engine = { path = "/source/crates/engine" }
figcraft-doc = { path = "/source/crates/doc" }
serde_json = "1"

[workspace]
```

`src/simplify.rs` (SHA-256 `ab56edf67f9ad4f2949a2baf741e7a447eca836c636ab00bcddbf61ba012c740`):

```rust
//! Prints the native guarded simplification and kurbo's own, element by element, at full precision.
//! Input (stdin): [{"name": ..., "d": svg path data, "accuracies": [..]}].
use figcraft_geom::kurbo::{self, BezPath, PathEl};
use figcraft_geom::simplify_path;
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
        let d = case["d"].as_str().expect("path data");
        let path = if d.is_empty() { BezPath::new() } else { BezPath::from_svg(d).expect("valid path data") };
        let mut results = vec![];
        for accuracy in case["accuracies"].as_array().expect("accuracies") {
            let accuracy = accuracy.as_f64().unwrap();
            let ours = simplify_path(&path, accuracy);
            // kurbo's own simplification panics on some inputs the guarded one accepts (segments after a close).
            let theirs = std::panic::catch_unwind(|| kurbo::simplify::simplify_bezpath(path.iter(), accuracy, &Default::default()));
            results.push(json!({"accuracy": accuracy, "native": elements(&ours), "kurbo": theirs.ok().map(|p| elements(&p))}));
        }
        out.push(json!({"name": case["name"], "d": d, "input": elements(&path), "results": results}));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```

`src/pencil.rs` (SHA-256 `e7ec2c8d9aa8cd6d3d97999530c34a8b5e96637dcdd19a689b92cad795c382e9`):

```rust
//! Draws recorded samples with the native Pencil tool and prints the layer it leaves.
//! Input (stdin): [{"name": ..., "samples": [[x, y], ...]}]. A fresh session per stroke, zoom 1.
use figcraft_doc::Document;
use figcraft_engine::{PointerEvent, PointerKind, Session};
use serde_json::{Value, json};

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let samples: Vec<(f64, f64)> = case["samples"].as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect();
        let mut doc = Document::new("Untitled");
        doc.repair();
        let mut session = Session::with_document(doc);
        let tool = session.execute("tool.set", &json!({"tool": "pencil"})).map_err(|e| e.to_string());
        let (first, last) = (samples[0], samples[samples.len() - 1]);
        let _ = session.pointer(&PointerEvent::at(PointerKind::Down, first.0, first.1, 1.0));
        for (x, y) in &samples[1..] {
            let _ = session.pointer(&PointerEvent::at(PointerKind::Move, *x, *y, 1.0));
        }
        let _ = session.pointer(&PointerEvent::at(PointerKind::Up, last.0, last.1, 1.0));
        let mut layer = Value::Null;
        for id in 1..16u64 {
            if let Ok(node) = session.execute("node.get", &json!({"id": id, "fields": ["type", "vertices", "segments", "x", "y", "width", "height", "absoluteBounds"]})) {
                if node["type"] == "VECTOR" {
                    layer = node;
                }
            }
        }
        let svg = session.execute("file.exportSvg", &json!({})).ok();
        out.push(json!({"name": case["name"], "samples": case["samples"], "tool": tool.is_ok(), "layer": layer, "export": svg}));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```

`src/replay.rs` is unchanged from the ellipse provenance (SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`).

`src/fitdebug.rs` (SHA-256 `c148177e9eb0d86cb00c99cb168c457945dbae0d63d006c4bae059aec8ccfe9e`):

```rust
//! Prints the intermediates of kurbo's single-cubic fit over ranges of a path, to compare with a port.
//! Input (stdin): [{"name", "d", "accuracy", "ranges": [[t0, t1], ...]}].
use figcraft_geom::kurbo::common::{factor_quartic_inner, solve_cubic, solve_quadratic};
use figcraft_geom::kurbo::simplify::SimplifyBezPath;
use figcraft_geom::kurbo::{BezPath, ParamCurveFit, fit_to_cubic};
use serde_json::{Value, json};

fn mod_2pi(th: f64) -> f64 {
    let th_scaled = th * core::f64::consts::FRAC_1_PI * 0.5;
    core::f64::consts::PI * 2.0 * (th_scaled - th_scaled.round())
}

// kurbo 0.13.1 fit.rs::cubic_fit, copied to expose its intermediates.
fn cubic_fit(th0: f64, th1: f64, area: f64, mx: f64) -> Value {
    let (s0, c0) = th0.sin_cos();
    let (s1, c1) = th1.sin_cos();
    let a4 = -9. * c0 * (((2. * s1 * c1 * c0 + s0 * (2. * c1 * c1 - 1.)) * c0 - 2. * s1 * c1) * c0 - c1 * c1 * s0);
    let a3 = 12. * ((((c1 * (30. * area * c1 - s1) - 15. * area) * c0 + 2. * s0 - c1 * s0 * (c1 + 30. * area * s1)) * c0 + c1 * (s1 - 15. * area * c1)) * c0 - s0 * c1 * c1);
    let a2 = 12. * ((((70. * mx + 15. * area) * s1 * s1 + c1 * (9. * s1 - 70. * c1 * mx - 5. * c1 * area)) * c0 - 5. * s0 * s1 * (3. * s1 - 4. * c1 * (7. * mx + area))) * c0 - c1 * (9. * s1 - 70. * c1 * mx - 5. * c1 * area));
    let a1 = 16. * (((12. * s0 - 5. * c0 * (42. * mx - 17. * area)) * s1 - 70. * c1 * (3. * mx - area) * s0 - 75. * c0 * c1 * area * area) * s1 - 75. * c1 * c1 * area * area * s0);
    let a0 = 80. * s1 * (42. * s1 * mx - 25. * area * (s1 - c1 * area));
    let mut roots: Vec<f64> = vec![];
    let mut branch = "flat";
    const EPS: f64 = 1e-12;
    if a4.abs() > EPS {
        branch = "quartic";
        if let Some(quads) = factor_quartic_inner(a3 / a4, a2 / a4, a1 / a4, a0 / a4, false) {
            for (qc1, qc0) in quads {
                let qroots = solve_quadratic(qc0, qc1, 1.0);
                if qroots.is_empty() { roots.push(-0.5 * qc1); } else { roots.extend(qroots); }
            }
        } else {
            branch = "quartic-unfactored";
        }
    } else if a3.abs() > EPS {
        branch = "cubic";
        roots.extend(solve_cubic(a0, a1, a2, a3));
    } else if a2.abs() > EPS || a1.abs() > EPS || a0.abs() > EPS {
        branch = "quadratic";
        roots.extend(solve_quadratic(a0, a1, a2));
    }
    let s01 = s0 * c1 + s1 * c0;
    let arms: Vec<Value> = roots
        .iter()
        .map(|&d0| {
            let (e0, e1) = if d0 > 0.0 {
                let d1 = (d0 * s0 - area * (10. / 3.)) / (0.5 * d0 * s01 - s1);
                if d1 > 0.0 { (d0, d1) } else { (s1 / s01, 0.0) }
            } else {
                (0.0, s0 / s01)
            };
            json!([e0, e1])
        })
        .collect();
    json!({"coefficients": [a0, a1, a2, a3, a4], "branch": branch, "roots": roots, "arms": arms})
}

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let path = BezPath::from_svg(case["d"].as_str().unwrap()).expect("valid path data");
        let accuracy = case["accuracy"].as_f64().unwrap();
        let source = SimplifyBezPath::new(path.iter());
        let mut ranges = vec![];
        for r in case["ranges"].as_array().unwrap() {
            let (t0, t1) = (r[0].as_f64().unwrap(), r[1].as_f64().unwrap());
            let start = source.sample_pt_tangent(t0, 1.0);
            let end = source.sample_pt_tangent(t1, -1.0);
            let d = end.p - start.p;
            let chord2 = d.hypot2();
            let th = d.atan2();
            let th0 = mod_2pi(start.tangent.atan2() - th);
            let th1 = mod_2pi(th - end.tangent.atan2());
            let raw = source.moment_integrals(t0..t1);
            let (mut area, mut x, mut y) = raw;
            let (x0, y0) = (start.p.x, start.p.y);
            area -= d.x * (y0 + 0.5 * d.y);
            let dy_3 = d.y * (1. / 3.);
            x -= d.x * (x0 * y0 + 0.5 * (x0 * d.y + y0 * d.x) + dy_3 * d.x);
            y -= d.x * (y0 * y0 + y0 * d.y + dy_3 * d.y);
            x -= x0 * area;
            y = 0.5 * y - y0 * area;
            let moment = d.x * x + d.y * y;
            let chord2_inv = chord2.recip();
            let unit_area = area * chord2_inv;
            let mx = moment * chord2_inv.powi(2);
            let fitted = fit_to_cubic(&source, t0..t1, accuracy).map(|(c, e)| json!({"curve": [c.p0.x, c.p0.y, c.p1.x, c.p1.y, c.p2.x, c.p2.y, c.p3.x, c.p3.y], "error2": e}));
            ranges.push(json!({
                "range": [t0, t1],
                "start": [start.p.x, start.p.y, start.tangent.x, start.tangent.y],
                "end": [end.p.x, end.p.y, end.tangent.x, end.tangent.y],
                "rawMoments": [raw.0, raw.1, raw.2],
                "th0": th0, "th1": th1, "unitArea": unit_area, "mx": mx,
                "fit": cubic_fit(th0, th1, unit_area, mx),
                "fitted": fitted,
            }));
        }
        out.push(json!({"name": case["name"], "accuracy": accuracy, "ranges": ranges}));
    }
    println!("{}", serde_json::to_string(&json!({"cases": out})).unwrap());
}
```
