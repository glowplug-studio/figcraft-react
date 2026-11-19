# Native observations for vector loops, Flatten and mirror modes (upstream #1951, #2195, #2110)

Data: [native-vector-loop-ops.json](native-vector-loop-ops.json) and [native-vector-loop-sequences.json](native-vector-loop-sequences.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by disposable Rust executables built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`, Kurbo 0.13.1 as locked by the native workspace.

## What each file holds

| File | Executable | Content |
|---|---|---|
| `native-vector-loop-ops.json` | `vecops` | 24 networks with the operations applied to each through `figcraft_engine::vectoredit::ops`: the network after every operation as the native file stores it, what `connect` returned, then the last network's fill path, stroke path and region paths as drawn, and the drawn network's loops |
| `native-vector-loop-sequences.json` | `replay` | Nine command sequences through `Session::execute` with every receipt. `vector.edit.state` receipts keep only `network` and `mirroring`; exports are stored decoded as `svg` |

### Networks and operations

Point and segment numbers are indices into the network. Each segment is a line unless an operation gives it handles.

| Name | Network | Operations |
|---|---|---|
| deleting a point behind a curved bridge keeps the bridge in the loop | 6 points, 6 segments, loops [[0, 1, 2, 3, 4, 5]] | connect 1–3; deleteVertices [2] |
| removing segments behind a curved bridge keeps the bridge in the loop | 6 points, 6 segments, loops [[0, 1, 2, 3, 4, 5]] | connect 1–3; removeSegments [1, 2] |
| regions over one open chain all close through the joining segment | 6 points, 5 segments, loops [[3, 1, 2, 0], [3, 1, 2, 0]] | deleteVertices [5] |
| the same chain walked both ways closes both | 6 points, 5 segments, loops [[3, 1, 2, 0], [0, 2, 1, 3]] | deleteVertices [5] |
| a segment joining two different chains closes both | 6 points, 6 segments, loops [[3, 1, 2, 0], [3, 5, 2, 0]] | deleteVertices [5] |
| two different chains as rounding draws them before any removal | 6 points, 6 segments, loops [[3, 1, 2, 0], [3, 5, 2, 0]] | none: drawn as stored |
| two fills that shared a deleted border both close through the bridge | 7 points, 8 segments, loops [[0, 6, 7, 4, 5], [1, 2, 3, 7, 6]] | connect 1–4; deleteVertices [6] |
| removing nothing leaves an open loop alone | 6 points, 5 segments, loops [[3, 1, 2, 0]] | removeSegments []; removeSegments [99]; deleteVertices []; deleteVertices [99] healed; deleteVertices [5] |
| a rounded loop left open where a segment joins its ends follows that segment | 5 points, 5 segments, loops [[3, 1, 2, 0]] | none: drawn as stored |
| the joining segment listed first | 5 points, 5 segments, loops [[4, 2, 3, 1]] | none: drawn as stored |
| the open loop walked backwards | 5 points, 5 segments, loops [[0, 2, 1, 3]] | none: drawn as stored |
| many open loops with no closing segment round as before | 160 points, 120 segments, loops 40 regions of three segments | none: drawn as stored |
| a healed delete behind a bridge | 6 points, 6 segments, loops [[0, 1, 2, 3, 4, 5]] | connect 1–3; deleteVertices [2] healed |
| mirror angle and length smooths a sharp point | 3 points, 2 segments, loops [] | setMirroring [1] angleAndLength |
| mirror angle smooths a sharp point | 3 points, 2 segments, loops [] | setMirroring [1] angle |
| mirror angle at a right angle with legs 100 and 50 | 3 points, 2 segments, loops [] | setMirroring [1] angle |
| two sharp points of a closed square | 4 points, 4 segments, loops [[0, 1, 2, 3]] | setMirroring [0, 2] angleAndLength |
| open-path ends stay sharp | 3 points, 2 segments, loops [] | setMirroring [0, 2] angle |
| a zero-length neighbour stays sharp | 3 points, 2 segments, loops [] | setMirroring [1] angleAndLength |
| a point with one handle keeps the old behaviour | 3 points, 2 segments, loops [] | setMirroring [1] angle |
| mirror none leaves a sharp point alone | 3 points, 2 segments, loops [] | setMirroring [1] none |
| a collinear sharp point | 3 points, 2 segments, loops [] | setMirroring [1] angle |
| handles zeroed again are smoothed by the next mirror mode | 3 points, 2 segments, loops [] | setHandle segment 0 end [-30, 0]; setHandle segment 1 start [0, 10]; setMirroring [1] angle; setHandle segment 1 start [0, 0]; setHandle segment 0 end [0, 0]; setMirroring [1] angle; setHandle segment 1 start [0, 12] |
| one zero handle takes the other's direction and length | 3 points, 2 segments, loops [] | setHandle segment 1 start [0, 10]; setMirroring [1] angle; setHandle segment 1 start [0, 12] |

The first eight restate the tests of `crates/engine/src/canvas/vectoredit/ops.rs` that `a75d8bf0`, `35d46208`, `153fa08d` and `06ffeca8` added; the next four restate `crates/doc/src/tests.rs` and the rounding guard; the mirror cases restate `mirror_modes_smooth_a_sharp_point_as_measured`, `mirror_modes_smooth_other_angles_and_several_points` and `mirror_modes_leave_unmeasured_points_alone`. A healed delete, mirror mode `none`, a collinear point and the last two were added. The last two are the scenario of an earlier port test whose expectation the upstream change moved.

### Command sequences

| Name | Commands, in order of first use |
|---|---|
| a rounded chamfer cut in the editor, top edge first | shape.rectangle → vector.edit.begin → vector.edit.addVertex → vector.edit.state → vector.edit.select → vector.deleteHeal → vector.edit.cornerRadius → vector.edit.end → node.get → file.exportSvg |
| a rounded chamfer cut in the editor, right edge first | shape.rectangle → vector.edit.begin → vector.edit.addVertex → vector.edit.state → vector.edit.select → vector.deleteHeal → vector.edit.cornerRadius → vector.edit.end → node.get → file.exportSvg |
| the corner deleted plainly and the two points connected again | shape.rectangle → vector.edit.begin → vector.edit.addVertex → vector.edit.select → vector.edit.delete → vector.edit.state → vector.edit.connect → vector.edit.cornerRadius → vector.edit.end → node.get → file.exportSvg |
| a bridge drawn first, then the corner deleted | shape.rectangle → vector.edit.begin → vector.edit.addVertex → vector.edit.connect → vector.edit.state → vector.edit.select → vector.edit.delete → vector.edit.cornerRadius → vector.edit.end → node.get → file.exportSvg |
| flatten bakes an open V's rounded apex | vector.create → vector.edit.begin → vector.edit.cornerRadius → vector.edit.state → vector.edit.end → node.get → file.exportSvg → vector.flatten → edit.undo |
| flatten bakes a triangle rounded at every point | vector.create → vector.edit.begin → vector.edit.cornerRadius → vector.edit.state → vector.edit.end → node.get → file.exportSvg → vector.flatten → edit.undo |
| flatten leaves a vector without a radius alone | vector.create → vector.edit.begin → vector.edit.state → vector.edit.end → node.get → file.exportSvg → vector.flatten → edit.undo |
| flatten bakes a smoothed rounded triangle | vector.create → vector.edit.begin → vector.edit.cornerRadius → vector.edit.state → vector.edit.end → node.set → node.get → file.exportSvg → vector.flatten → edit.undo |
| a mirror mode from the panel smooths a sharp point | vector.create → vector.edit.begin → vector.edit.mirroring → vector.edit.state → edit.undo → vector.edit.end → node.get → file.exportSvg |

The first four restate `crates/engine/src/canvas/vectoredit/tests.rs` (`a_rounded_chamfer_cut_in_the_editor_fills_along_its_arcs`, `a_rounded_chamfer_made_other_ways_fills_along_its_arcs`, `deleting_the_corner_behind_a_pen_bridge_closes_the_loop_through_the_bridge`); the Flatten cases restate `crates/engine/src/vector_behaviour_tests.rs::flatten_bakes_a_vectors_point_radius` and add a smoothed triangle.

## What the observations showed about the port

- Before the change the port disagreed with 17 of the first 22 network cases: every case where a loop closes through a bridge or is drawn through one, and every case where a mirror mode meets a sharp point. The five it matched are those the upstream change leaves alone.
- With the change all 24 match: loops, segment ends and point radii exactly, handles to nine decimals and drawn paths to seven.
- The nine sequences were first run after the network operations were ported. The four editor sequences, the mirror sequence and Flatten without a radius matched then, with byte-identical exported SVG. The three Flatten cases with a radius failed, and matched after Flatten took the network as the layer draws it, including the smoothed triangle whose box moves by 0.076.
- An earlier port test expected a point whose two handles were both set back to zero to stay sharp under a mirror mode. Native now smooths it, each handle 0.3905 of its own segment; the test states the observed values.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and sources below, with the upstream `Cargo.lock` copied beside the manifest, and run each executable as the [ellipse provenance](native-ellipse-four-anchor.provenance.md) shows, with `--bin vecops` or `--bin replay`. `vecops` reads `[{"name", "network", "ops"}]`, which is each case's `name`, `network` and the `op` of each step in the fixture; `replay` reads `[{"name", "commands": [[command, params], ...]}]`.

Manifest (SHA-256 `599ee9778f2fe6645ab79bdcda59a36a3b5965d5a109dc6a4c4af0109c7b1cda`): the [dash allowance provenance](native-variable-outline-dashes.provenance.md) manifest with one more executable:

```toml
[[bin]]
name = "vecops"
path = "src/vecops.rs"
```

`src/replay.rs` is unchanged from the ellipse provenance (SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`).

`src/vecops.rs` (SHA-256 `77da290b769ebc48343bc75e26d49bf4eb9046c0c2786bf7614e74f5889acf87`):

```rust
//! Applies native vector network operations and prints what the network becomes and draws.
//! Input (stdin): [{"name", "network": a VectorNetwork as the native file stores it, "ops": [
//!   {"op": "deleteVertices", "vertices": [..], "heal": bool} | {"op": "removeSegments", "segments": [..]} |
//!   {"op": "connect", "a", "b", "ta": [x, y], "tb": [x, y]} | {"op": "setMirroring", "vertices": [..], "mode": "none" | "angle" | "angleAndLength"} |
//!   {"op": "setHandle", "segment", "start": bool, "rel": [x, y], "independent": bool}]}].
//! Output per case: the network after each operation (with what `connect` returned), then for the last network its
//! fill path, stroke path and each region's path as drawn (rounded where points have a radius), and the drawn
//! network's loops.
use figcraft_doc::{HandleMirroring, VectorNetwork};
use figcraft_engine::vectoredit::ops;
use figcraft_geom::kurbo::{BezPath, PathEl};
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

fn indices(v: &Value) -> Vec<usize> {
    v.as_array().expect("indices").iter().map(|x| x.as_u64().expect("an index") as usize).collect()
}

fn pair(v: &Value) -> (f64, f64) {
    (v[0].as_f64().expect("x"), v[1].as_f64().expect("y"))
}

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let mut net: VectorNetwork = serde_json::from_value(case["network"].clone()).expect("a network");
        let mut steps = vec![];
        for op in case["ops"].as_array().expect("ops") {
            let mut returned = Value::Null;
            match op["op"].as_str().expect("an operation") {
                "deleteVertices" => ops::delete_vertices(&mut net, &indices(&op["vertices"]), op["heal"].as_bool().unwrap_or(false)),
                "removeSegments" => ops::remove_segments(&mut net, &indices(&op["segments"])),
                "connect" => {
                    let (a, b) = (op["a"].as_u64().unwrap() as usize, op["b"].as_u64().unwrap() as usize);
                    returned = json!(ops::connect(&mut net, a, b, pair(&op["ta"]), pair(&op["tb"])));
                }
                "setMirroring" => {
                    let mode: HandleMirroring = serde_json::from_value(op["mode"].clone()).expect("a mirror mode");
                    ops::set_mirroring(&mut net, &indices(&op["vertices"]), mode);
                }
                "setHandle" => {
                    let seg = op["segment"].as_u64().expect("a segment") as usize;
                    ops::set_handle(&mut net, seg, op["start"].as_bool().expect("start"), pair(&op["rel"]), op["independent"].as_bool().unwrap_or(false));
                }
                other => panic!("unknown operation {other}"),
            }
            steps.push(json!({"op": op, "returned": returned, "network": serde_json::to_value(&net).unwrap()}));
        }
        let drawn = net.rounded();
        let shown = drawn.as_ref().unwrap_or(&net);
        let regions: Vec<Value> = (0..shown.regions.len()).map(|i| shown.region_path(i).map_or(Value::Null, |p| elements(&p))).collect();
        out.push(json!({
            "name": case["name"],
            "network": case["network"],
            "steps": steps,
            "rounded": drawn.is_some(),
            "drawnLoops": shown.regions.iter().map(|r| json!(r.loops)).collect::<Vec<_>>(),
            "fill": elements(&net.fill_path()),
            "stroke": elements(&net.stroke_path()),
            "regions": regions,
        }));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```
