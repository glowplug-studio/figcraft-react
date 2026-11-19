# Native observations for the four-anchor ellipse (upstream #2080)

Affected data: four cases in [native-svg-export.json](native-svg-export.json) and [native-svg-shadow-export.json](native-svg-shadow-export.json), twelve in [native-vector-drawable.json](native-vector-drawable.json), case 22 in [native-text-path-commands.json](native-text-path-commands.json) and the ellipse row of [native-text-path-hits.json](native-text-path-hits.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 19 November 2026 by two disposable Rust executables built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Every other entry in these files keeps the value recorded at its original pin. Each was replayed too, as the control below.

## What was replayed and what changed

| Fixture | Replayed | Identical to the record | Changed and updated | Not reproducible headless, left as recorded |
|---|---|---|---|---|
| SVG export (three files) | 53 cases | 47 | 4: `ellipse`, `radial handles`, `spread group`, `eroded group`. The ellipse path gains a closing `Z`; nothing else differs | 2: `live text`, `outlined text` (the container has no fonts, so text measures 1×14) |
| Android XML | 103 cases | 89 | 12: `ellipse`, `radial handles`, `spread group`, `eroded group` and the eight gradient skew/mirror cases. One `pathData` per case gains ` Z`; warnings are identical | 2: the same two text cases |
| Text-path commands | 25 cases | 13 | 1: case 22. Only `textPath.d` differs: four cubics and a close instead of five cubics; `start`, `flip` and every other field are identical | 11: font-dependent width, height or position only |
| Text-on-a-path tool clicks | 432 points | 360 of 360 on the five other shapes; 46 of 72 on the ellipse | 26 ellipse start fractions, largest change 0.00053; no point changed between hit and miss | 0 |

The control matters: the harness reproduces every recorded case that does not involve an ellipse or fonts, byte for byte, so the changed cases reflect native behaviour at this revision and not a different generator.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and sources below, with the upstream `Cargo.lock` copied beside the manifest. Set `FIGCRAFT_REFERENCE` to the pinned upstream checkout, `ORACLE_DIR` to the project and the cache variables to writable directories. The first build fetches crates; later runs can add `--offline`.

```sh
run() { docker run --rm -i \
  -v "$FIGCRAFT_REFERENCE:/source:ro" -v "$ORACLE_DIR:/oracle" \
  -v "$ORACLE_TARGET_CACHE:/target" -v "$ORACLE_REGISTRY_CACHE:/usr/local/cargo/registry" -v "$ORACLE_GIT_CACHE:/usr/local/cargo/git" \
  -e CARGO_TARGET_DIR=/target -e NATIVE_REVISION=bad07e4433240cad046589129c084bd2fc36f097 -w /oracle \
  rust:latest cargo run --quiet --bin "$1"; }
run replay < cases.json > observed.json   # cases.json: [{"name", "commands": [[command, params], ...]}]
run hits < tests/fixtures/native-text-path-hits.json > hits-observed.json
```

`replay` input for the export fixtures is each case's recorded `commands`. For the text-path commands it is `text.create` with the test's text at the origin, the case's commands, then `node.get` for node 2. Receipts carry `data` as base64 for exports. Observed with `rustc 1.99.1` in the `rust:latest` image.

Manifest (SHA-256 `8eee2562869114ba98d382b54c8374593388e6e0d1c2b5b192e7732f24de5817`):

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

[dependencies]
figcraft-engine = { path = "/source/crates/engine" }
figcraft-doc = { path = "/source/crates/doc" }
serde_json = "1"

[workspace]
```

`src/replay.rs` (SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`):

```rust
//! Replays command sequences through the pinned native engine and prints every receipt.
//! Input (stdin): [{"name": ..., "commands": [[command, params], ...]}]. A fresh session per case.
use figcraft_doc::Document;
use figcraft_engine::Session;
use serde_json::{Value, json};

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let mut doc = Document::new("Untitled");
        doc.repair();
        let mut session = Session::with_document(doc);
        let mut results = vec![];
        for step in case["commands"].as_array().expect("commands") {
            let command = step[0].as_str().expect("command name");
            results.push(match session.execute(command, &step[1]) {
                Ok(receipt) => json!({"receipt": receipt}),
                Err(error) => json!({"error": error.to_string()}),
            });
        }
        out.push(json!({"name": case["name"], "results": results}));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```

`src/hits.rs` (SHA-256 `d6c9fec400ae45d0f13b4822242692b8adc5dd25652d84084f0122dc62176283`):

```rust
//! Clicks the native text-on-a-path tool at recorded points and prints where the text would start.
//! Input (stdin): [{"command": [name, params], "points": [[x, y, zoom, ...], ...]}]. A fresh session per point.
use figcraft_doc::Document;
use figcraft_engine::{PointerEvent, PointerKind, Session, ToolId};
use serde_json::{Value, json};

fn main() {
    let input: Value = serde_json::from_reader(std::io::stdin()).expect("cases as JSON on stdin");
    let mut out = vec![];
    for case in input.as_array().expect("an array of cases") {
        let command = &case["command"];
        let mut points = vec![];
        for p in case["points"].as_array().expect("points") {
            let (x, y, zoom) = (p[0].as_f64().unwrap(), p[1].as_f64().unwrap(), p[2].as_f64().unwrap());
            let mut doc = Document::new("Untitled");
            doc.repair();
            let mut session = Session::with_document(doc);
            let made = session.execute(command[0].as_str().unwrap(), &command[1]).expect("the shape is created");
            session.set_tool(ToolId::TextOnPath);
            let _ = session.pointer(&PointerEvent::at(PointerKind::Down, x, y, zoom));
            let _ = session.pointer(&PointerEvent::at(PointerKind::Up, x, y, zoom));
            let mut start = Value::Null;
            for id in 1..16u64 {
                if let Ok(node) = session.execute("node.get", &json!({"id": id, "fields": ["type", "textPath"]})) {
                    if node["type"] == "TEXT" && !node["textPath"].is_null() {
                        start = node["textPath"]["start"].clone();
                    }
                }
            }
            points.push(json!([p[0], p[1], p[2], start, made["id"]]));
        }
        out.push(json!({"command": command, "points": points}));
    }
    println!("{}", serde_json::to_string(&json!({"nativeRevision": env!("NATIVE_REVISION"), "cases": out})).unwrap());
}
```
