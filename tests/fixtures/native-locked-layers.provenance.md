# Native observations for locked layers (upstream #1560: 24cf7032, 6cb015d4)

Data: [native-locked-layers.json](native-locked-layers.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by a disposable Rust executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Twelve recorded sessions. Each is a list of steps with what every step gave. A step is a command through `Session::execute`, or one of the pointer, key and query steps of the `session` executable below: `@click` and `@drag` send pointer events through `Session::pointer`, `@selection` reads the selected ids, `@handle` says whether a transform handle is under a point, and `@undoDepth` reads the undo and redo depths.

| Name | Steps, in order of first use |
|---|---|
| the canvas never selects a locked layer or a locked frame's child | frame.create → shape.rectangle → object.toggleLock → @click → @selection → @drag |
| a panel-selected locked layer has no handles, ignores arrows and takes property edits | frame.create → shape.rectangle → object.toggleLock → select.set → @handle → @undoDepth → transform.nudge → node.get → transform.nudgeSize → node.set → fill.set → @selection |
| a child of a locked frame cannot be locked or unlocked on its own | frame.create → shape.rectangle → object.toggleLock → node.get → select.set → @click → @selection |
| lock and unlock on a mixed selection leaves a locked frame's child alone | frame.create → shape.rectangle → object.toggleLock → select.set → node.get → @click → @selection |
| lock and unlock on a panel-selected locked layer unlocks it | frame.create → shape.rectangle → object.toggleLock → select.set → node.get → @handle |
| an explicit locked value still sets a locked frame's child | frame.create → shape.rectangle → object.toggleLock → node.get |
| nudge moves the unlocked layers of a mixed selection only | frame.create → shape.rectangle → object.toggleLock → select.set → @undoDepth → transform.nudge → node.get → transform.nudgeSize |
| nudge leaves a locked frame's child alone | frame.create → shape.rectangle → object.toggleLock → select.set → transform.nudge → node.get → transform.nudgeSize → transform.move |
| toggling several unlocked layers locks them all, and again unlocks them | shape.rectangle → object.toggleLock → node.get |
| layers at a point list locked layers with a flag | frame.create → shape.rectangle → object.toggleLock → select.layersAt → select.set → @selection |
| a locked mask is listed under the pointer too | shape.rectangle → object.mask → select.layersAt → node.set → @click → @selection |
| show and hide toggle the targets together | shape.rectangle → node.set → select.set → object.toggleVisible → node.get → @selection → object.toggleLock |

The first five restate `crates/engine/src/lock_behaviour_tests.rs`, and "layers at a point…" restates `crates/engine/src/selection_depth_tests.rs::layers_at_a_point_list_locked_layers_with_a_flag_and_select_set_takes_them`. An explicit value on a locked frame's child, a mixed nudge, a nudge inside a locked frame, toggling several layers, a locked mask and Show/Hide with refused parameters were added. The locked mask is the scenario of an earlier port test whose expectation the upstream change moved.

## What the observations showed about the port

- The port had no `object.toggleLock` command, so every one of the first ten sessions failed at its first lock. With the command ported, six matched at once: the port already kept clicks, deep clicks and the marquee away from locked layers and already withheld the transform handles.
- The nudge sessions matched after `transform.nudge` and `transform.nudgeSize` skipped locked layers, and the Select layer session after `select.layersAt` listed locked layers with the flag.
- `transform.move`, a command and not a key, moves a layer inside a locked frame in native; the port agrees.
- Show/Hide without a value shows every target unless all are visible, and then hides them. A value of `"yes"` is read as true. An unknown parameter and a missing layer are refused.
- Three arrows and a resize arrow on a locked layer leave the undo depth where it was; a nudge that moves one of two selected layers adds one step.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and source below, with the upstream `Cargo.lock` copied beside the manifest, and run it as the [ellipse provenance](native-ellipse-four-anchor.provenance.md) shows, with `--bin session`. It reads `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.

Manifest (SHA-256 `ab7ac1084453910e6ed380fa3770e0db471fcee46ed36c915709b60fefd65115`): the [vector loop provenance](native-vector-loop-ops.provenance.md) manifest with one more executable:

```toml
[[bin]]
name = "session"
path = "src/session.rs"
```

`src/session.rs` (SHA-256 `5132a01344693e83267eab19643ee50f6f1944e43e10c5fb186c61ba8b899fc8`):

```rust
//! Replays commands, pointer events and keys through the pinned native engine and prints what each gave.
//! Input (stdin): [{"name": ..., "steps": [[step, params], ...]}]. A fresh session per case. A step is a command
//! name, or one of:
//!   "@pointer" {kind: "down" | "move" | "up" | "hover" | "doubleClick", x, y, zoom?, shift?, alt?, cmd?, ctrl?}
//!   "@click"   {x, y, zoom?, shift?, alt?, cmd?, ctrl?}            a press and a release at one point
//!   "@drag"    {from: [x, y], to: [x, y], zoom?, shift?, alt?, cmd?, ctrl?}   press, move, release
//!   "@key"     {name, shift?, alt?, cmd?}                          `Session::tool_key`; gives whether it was used
//!   "@escape"  {}                                                  `Session::escape`
//!   "@selection" {}                                                the selected layer ids
//!   "@handle"  {x, y, zoom?}                                       whether a transform handle is at the point
//!   "@undoDepth" {}                                                [undo steps, redo steps]
//! Every step gives {"receipt": ...} or {"error": message}.
use figcraft_doc::Document;
use figcraft_engine::tools::handle_at;
use figcraft_engine::{PointerEvent, PointerKind, Session};
use figcraft_geom::Point;
use serde_json::{Value, json};

fn event(kind: PointerKind, x: f64, y: f64, p: &Value) -> PointerEvent {
    let mut e = PointerEvent::at(kind, x, y, p["zoom"].as_f64().unwrap_or(1.0));
    let flag = |k: &str| p[k].as_bool().unwrap_or(false);
    (e.shift, e.alt, e.cmd, e.ctrl) = (flag("shift"), flag("alt"), flag("cmd"), flag("ctrl"));
    e
}

fn step(session: &mut Session, name: &str, p: &Value) -> Result<Value, String> {
    let num = |v: &Value| v.as_f64().ok_or("a number is missing");
    let err = |e: figcraft_engine::EngineError| e.to_string();
    Ok(match name {
        "@pointer" => {
            let kind = match p["kind"].as_str() {
                Some("down") => PointerKind::Down,
                Some("move") => PointerKind::Move,
                Some("up") => PointerKind::Up,
                Some("hover") => PointerKind::Hover,
                Some("doubleClick") => PointerKind::DoubleClick,
                other => return Err(format!("unknown pointer kind {other:?}")),
            };
            session.pointer(&event(kind, num(&p["x"])?, num(&p["y"])?, p)).map_err(err)?;
            Value::Null
        }
        "@click" => {
            let (x, y) = (num(&p["x"])?, num(&p["y"])?);
            session.pointer(&event(PointerKind::Down, x, y, p)).map_err(err)?;
            session.pointer(&event(PointerKind::Up, x, y, p)).map_err(err)?;
            Value::Null
        }
        "@drag" => {
            let (x0, y0, x1, y1) = (num(&p["from"][0])?, num(&p["from"][1])?, num(&p["to"][0])?, num(&p["to"][1])?);
            session.pointer(&event(PointerKind::Down, x0, y0, p)).map_err(err)?;
            session.pointer(&event(PointerKind::Move, x1, y1, p)).map_err(err)?;
            session.pointer(&event(PointerKind::Up, x1, y1, p)).map_err(err)?;
            Value::Null
        }
        "@key" => {
            let flag = |k: &str| p[k].as_bool().unwrap_or(false);
            json!(session.tool_key(p["name"].as_str().ok_or("a key name is missing")?, flag("shift"), flag("alt"), flag("cmd")).map_err(err)?)
        }
        "@escape" => {
            session.escape().map_err(err)?;
            Value::Null
        }
        "@selection" => json!(session.selection()),
        "@handle" => {
            let doc = session.doc().map_err(err)?;
            json!(handle_at(doc, &session.selection(), Point::new(num(&p["x"])?, num(&p["y"])?), p["zoom"].as_f64().unwrap_or(1.0)).is_some())
        }
        "@undoDepth" => json!(session.undo_depth()),
        command => session.execute(command, p).map_err(err)?,
    })
}

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let mut doc = Document::new("Untitled");
        doc.repair();
        let mut session = Session::with_document(doc);
        let mut results = vec![];
        for s in case["steps"].as_array().expect("steps") {
            results.push(match step(&mut session, s[0].as_str().expect("a step name"), &s[1]) {
                Ok(receipt) => json!({"receipt": receipt}),
                Err(error) => json!({"error": error}),
            });
        }
        out.push(json!({"name": case["name"], "results": results}));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```
