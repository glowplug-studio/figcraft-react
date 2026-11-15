# Public collaboration diff engine fixture

`native-public-diff-engine.json` is immutable output from an independently compiled native engine oracle on 2026-11-15, at native revision `bad07e4433240cad046589129c084bd2fc36f097`.

The oracle ran 22 sequential stages through the real `Session::execute` dispatcher. Nine failures are intentional command-error fixtures. The generator creates a repaired pathless document named `Oracle 🙂`, adds one rectangle, compares undo/saved targets, exercises parameter errors, undoes and renames. It does not establish recovery/save/live lifecycle expectations; those contract tests separately translate the owning native source.

The output was copied without recomputing receipts in TypeScript. Native source was mounted read-only at `/source`; temporary oracle files and native caches lived outside the repository. There is no Rust dependency or native execution in product builds or runtime tests. The registry/Git cache resolved the dependencies pinned by the native checkout. The separate manifest declares `figcraft-doc` and `figcraft-engine` using `/source/crates/doc` and `/source/crates/engine`, and `serde_json = "1"`; its engine binary path is `../src/bin/engine.rs`.

Reproduction from a prepared disposable workspace, with paths supplied by the caller:

```sh
# Mount the pinned native checkout at /source read-only and the disposable project at /oracle.
# Reuse the prepared Cargo dependency caches; the command runs inside that container.
CARGO_BUILD_JOBS=1 cargo run --offline --manifest-path /oracle/engine/Cargo.toml --bin engine > engine-observed.json
```

Reviewed generator source:

```rust
use figcraft_doc::Document;
use figcraft_engine::Session;
use serde_json::{Value,json};
fn record(session:&mut Session,stages:&mut Vec<Value>,stage:&str,command:&str,params:Value){
    let result=match session.execute(command,&params){Ok(receipt)=>json!({"receipt":receipt}),Err(error)=>json!({"error":error.to_string()})};
    stages.push(json!({"stage":stage,"command":command,"params":params,"result":result}));
}
fn main(){
    let mut doc=Document::new("Oracle 🙂");doc.repair();
    let mut session=Session::with_document(doc);
    let mut stages=vec![];
    record(&mut session,&mut stages,"initial-saved","collab.diff",json!({"against":"saved"}));
    record(&mut session,&mut stages,"initial-undo","collab.diff",json!({}));
    record(&mut session,&mut stages,"rectangle","shape.rectangle",json!({"x":0,"y":0,"width":10,"height":10}));
    record(&mut session,&mut stages,"default-undo","collab.diff",json!({}));
    record(&mut session,&mut stages,"repeat-undo","collab.diff",json!({}));
    record(&mut session,&mut stages,"explicit-undo","collab.diff",json!({"against":"undo"}));
    record(&mut session,&mut stages,"unknown-key","collab.diff",json!({"against":"undo","ignored":true}));
    record(&mut session,&mut stages,"edited-saved","collab.diff",json!({"against":"saved"}));
    for(target,label) in [(json!("bad\n\"🙂"),"escaped-string"),(json!(1),"number"),(json!(true),"boolean"),(Value::Null,"null"),(json!([]),"array"),(json!({}),"object")]{
        record(&mut session,&mut stages,label,"collab.diff",json!({"against":target}));
    }
    for(target,label) in [(json!("\0"),"nul-string"),(json!("\u{1b}"),"esc-string"),(json!("\u{2028}"),"line-separator-string"),(json!("quote\"slash\\end"),"quotes-backslash-string")]{
        record(&mut session,&mut stages,label,"collab.diff",json!({"against":target}));
    }
    record(&mut session,&mut stages,"undo-edit","edit.undo",json!({}));
    record(&mut session,&mut stages,"undo-to-saved","collab.diff",json!({"against":"saved"}));
    record(&mut session,&mut stages,"rename","file.rename",json!({"name":"Renamed é🙂"}));
    record(&mut session,&mut stages,"rename-saved-diff","collab.diff",json!({"against":"saved"}));
    println!("{}",serde_json::to_string_pretty(&json!({"nativeRevision":"bad07e4433240cad046589129c084bd2fc36f097","stages":stages})).unwrap());
}
```

The binary `bytes` field counts `message::encode(&changes)`: version byte `1`, postcard vector count and changes. It excludes session-disk headers and session envelopes. Receipt expectations include initial/undo-to-saved empty size 2, rectangle size 56 and renamed-document size 21. Rust Debug escaping is captured for NUL, ESC, U+2028, double quotes and backslashes. The unknown-key fixture reflects public parameter validation before the leaf diff function.

Additional Unicode error-contract expectations were reviewed against a separate tiny Rust 1.99.1 standard-library Debug oracle. This supplements the 22-stage engine fixture without changing it. Combining acute, NBSP, ZWJ and private-use scalars escape; Hangul fillers U+115F/U+1160/U+3164/U+FFA0 escape; halfwidth U+FF9E/U+FF9F remain literal despite their Grapheme_Extend property. The writer review compared the corrected rule across every valid scalar with zero mismatches. This full-range check was independent tooling outside runtime tests.

Representative standalone generator (compile in a disposable workspace with `rustc probe.rs -o probe`, then run `./probe`):

```rust
fn main() {
    for n in [0x301, 0xa0, 0x200d, 0xe000, 0xf0000,
              0x115f, 0x1160, 0x3164, 0xffa0, 0xff9e, 0xff9f] {
        let c = char::from_u32(n).unwrap();
        println!("U+{:04X} {:?}", n, c.to_string());
    }
}
```

The exhaustive probe iterated `0..=0x10ffff`, skipped `char::from_u32` failures and recorded scalar values whose `format!("{:?}", c.to_string())` contained `\u{`. Native public unknown-key ordering follows scalar order from the serde map: U+E000 precedes U+10000. These source-derived ordering assertions need no native runtime dependency.

The separate two-page preview contract translates `crates/engine/src/doc_state.rs::start_preview`: `ds.doc` becomes the raw historical document, while `ds.page` retains the currently selected page if it still exists. `sharing/collab.rs::diff_cmd` reads `ds.doc`, so its currentPage change comes from the historical document, even when the UI keeps another page visible. This is source-derived lifecycle coverage, not an additional stage in the immutable engine oracle.
