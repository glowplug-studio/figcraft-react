# Native public collaboration diff wire fixtures

Data: [native-public-diff-wire.json](native-public-diff-wire.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Generated independently on 15 November 2026 by a disposable Rust executable against the pinned native source mounted read-only. This port implementation copied the observed data; it did not generate expected bytes with its TypeScript writer.
- Output SHA-256: `d5a275d5f6589eed4804d4ccd263287b53d373408b97b6979c86f5810db22b00`.
- Generator source SHA-256: `5a5f3f94854b8e0a83c8e85046fbbdde41b8dbc070feeefffd830f43a493b0f5` (source below, including its final newline).
- 52 cases: empty and mixed vectors, six change variants, seven entry kinds for put/remove, u64 and safe-integer boundaries, count/key/position varint boundaries 127/128, multibyte strings, nested JSON, float `1.0` versus integer `1`.
- Exact format: native `message::encode(&Vec<Change>)`, wire version byte 1 followed by the Postcard change vector. No initial-session fields, transport wrapper or disk header.
- `encoded` is the complete independently observed byte vector; `bytes` is its native length; `count` is the number of changes. `readableJson` retains canonical serde number tokens; use it rather than ordinary JS parsing of the redundant structured `changes` field when extracting IDs and JSON strings.
- Empty encoding is `[1,0]`; mixed-six is 299 bytes. Count 127 starts `[1,127]`; count 128 starts `[1,128,1]`. Float-one is 9 bytes; integer-one is 7.

The browser receipt uses existing inspected-ID conventions: safe integers are numbers and unsafe integer tokens are exact decimal strings, recursively through values. Floating tokens become JavaScript numbers. Binary sizing uses the original canonical JSON strings, so public presentation of `1.0` as `1` does not alter native byte counts.

## Reproduction outside the port runtime

Create a disposable Cargo project from the manifest and source below. Set `FIGCRAFT_REFERENCE` to the pinned upstream checkout, `ORACLE_DIR` to that disposable project, and registry/target cache variables to available Cargo caches. The original observed run used the following command structure, one CPU/build job and offline dependency resolution. Dependency cache preparation is separate. The command writes only oracle output and caches and mounts upstream read-only:

```sh
docker run --rm --cpus=1 \
  -v "$FIGCRAFT_REFERENCE:/source:ro" \
  -v "$ORACLE_DIR:/oracle" \
  -v "$ORACLE_TARGET_CACHE:/target" \
  -v "$ORACLE_REGISTRY_CACHE:/usr/local/cargo/registry" \
  -e CARGO_TARGET_DIR=/target -e CARGO_BUILD_JOBS=1 -w /oracle \
  rust:latest cargo run --offline --quiet --bin wire \
  > "$ORACLE_DIR/wire-observed.json" 2> "$ORACLE_DIR/wire-build.log"
```

The successful observed wire build had empty stderr. `rust:latest` was the generator image; its digest was not captured, so this provenance does not claim a fully pinned toolchain. Preserve the native pin and compare output bytes/digest when regenerating. The original run supplied an existing standalone Cargo lock as an offline resolution seed; that disposable lock is not a product dependency.

```toml
[package]
name="public-diff-wire-oracle"
version="0.1.0"
edition="2024"
autobins=false
[dependencies]
figcraft-collab={path="/source/crates/collab"}
figcraft-doc={path="/source/crates/doc"}
serde_json="1"
[[bin]]
name="wire"
path="src/bin/wire.rs"
```

Place the following at `src/bin/wire.rs` in the disposable project:

```rust
use figcraft_collab::change::{Change,DocProp,Entry,Json,Prop};
use figcraft_collab::message;
use figcraft_doc::NodeId;
use serde_json::{Value,json};

fn emit(name:&str,changes:Vec<Change>)->Value {
    let bytes=message::encode(&changes).expect("encode change vector");
    json!({"name":name,"count":changes.len(),"bytes":bytes.len(),"encoded":bytes,
        "readableJson":serde_json::to_string(&changes).unwrap(),"changes":changes})
}
fn main(){
    let nested=Json(json!({"z":"é🙂\n","a":{"u64":u64::MAX,"float":1.0,"array":[null,true,-1]}}));
    let create=Change::Create{id:NodeId(u64::MAX),kind:Json(json!({"type":"rectangle"})),parent:Some(NodeId(128)),
        position:"aé🙂".into(),props:vec![(Prop::Name,Json(json!("Größe 🙂"))),(Prop::Opacity,Json(json!(1.0)))]};
    let variants=vec![
        ("create",create.clone()),
        ("set",Change::Set{id:NodeId(128),prop:Prop::PluginData,value:nested.clone()}),
        ("delete",Change::Delete{id:NodeId(u64::MAX)}),
        ("setDoc",Change::SetDoc{prop:DocProp::CurrentPage,value:Json(json!(u64::MAX))}),
        ("put",Change::Put{entry:Entry::Comment(u64::MAX),value:nested.clone()}),
        ("remove",Change::Remove{entry:Entry::DevSnapshot(NodeId(u64::MAX))}),
    ];
    let mut cases=vec![emit("empty",vec![])];
    for(name,change) in &variants{cases.push(emit(name,vec![change.clone()]));}
    cases.push(emit("mixed-six-variants",variants.iter().map(|(_,c)|c.clone()).collect()));
    let entries=vec![
        ("style",Entry::Style("S:é🙂".into())),("comment",Entry::Comment(u64::MAX)),
        ("collection",Entry::Collection("C:127".into())),("variable",Entry::Variable("V:128".into())),
        ("devSnapshot",Entry::DevSnapshot(NodeId(u64::MAX))),
        ("image",Entry::Image("abc-é🙂.png".into())),("ballot",Entry::Ballot("voter-é🙂".into())),
    ];
    for(name,entry) in entries{
        cases.push(emit(&format!("put-{name}"),vec![Change::Put{entry:entry.clone(),value:nested.clone()}]));
        cases.push(emit(&format!("remove-{name}"),vec![Change::Remove{entry}]));
    }
    for n in [0,1,127,128,9007199254740991,9007199254740992,u64::MAX]{
        cases.push(emit(&format!("node-id-{n}"),vec![Change::Delete{id:NodeId(n)}]));
        cases.push(emit(&format!("comment-key-{n}"),vec![Change::Remove{entry:Entry::Comment(n)}]));
        cases.push(emit(&format!("devSnapshot-key-{n}"),vec![Change::Remove{entry:Entry::DevSnapshot(NodeId(n))}]));
    }
    for n in [127,128]{
        cases.push(emit(&format!("vector-count-{n}"),vec![Change::Delete{id:NodeId(1)};n]));
        cases.push(emit(&format!("string-key-ascii-{n}"),vec![Change::Remove{entry:Entry::Style("x".repeat(n))}]));
        cases.push(emit(&format!("create-position-ascii-{n}"),vec![Change::Create{id:NodeId(1),kind:Json(json!({"type":"rectangle"})),parent:None,position:"x".repeat(n),props:vec![]}]));
    }
    cases.push(emit("string-key-utf8-128-bytes",vec![Change::Remove{entry:Entry::Ballot("é".repeat(64))}]));
    cases.push(emit("float-one",vec![Change::Set{id:NodeId(1),prop:Prop::Opacity,value:Json(json!(1.0))}]));
    cases.push(emit("integer-one",vec![Change::Set{id:NodeId(1),prop:Prop::Opacity,value:Json(json!(1))}]));
    println!("{}",serde_json::to_string_pretty(&json!({"nativeRevision":"bad07e4433240cad046589129c084bd2fc36f097","encoding":"message::encode(Vec<Change>), wire version 1; canonical readableJson preserves u64 and 1.0","cases":cases})).unwrap());
}
```

No React product, build or test imports or executes native Rust or this generator. Repository tests consume immutable JSON data only. Expected-byte assertions are in [collaboration-diff-wire.test.ts](../parity/collaboration-diff-wire.test.ts); existing snapshot regressions remain in [session-postcard.test.ts](../parity/session-postcard.test.ts).
