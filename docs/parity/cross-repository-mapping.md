# Cross-repository mapping

Graphify indexes `glowplug-studio/figcraft` and `glowplug-studio/figcraft-react` independently. It does not automatically determine which Rust and TypeScript symbols are equivalent.

Add mappings only after inspecting behaviour, callers, data contracts and tests. Preserve upstream command identifiers, file-format keys and user-facing terminology where they are compatibility contracts; otherwise use idiomatic TypeScript names and record the relationship here.

| Port scope | Upstream Rust module or symbol | Upstream evidence | TypeScript target | Parity tests | Status |
|---|---|---|---|---|---|
| Local document | `doc::Document::new`, `Node::new`, `NodeKind::{Page,Rectangle}` | `doc/src/lib.rs`, `doc/src/node.rs`, `color/src/lib.rs`; default page/name/fill | `src/engine/document.ts`, rectangle constructor in `editor.ts` | `tests/parity/rectangle.test.ts` defaults and paired create test | Verified subset; no file codec |
| Rectangle command/history | `cmd::create::create`, `shape.rectangle`; `create_select_undo_redo` | Registry label/undo flag; Rust x=10,y=20,w=30,h=40 test | `EditorEngine.execute` | `rectangle.test.ts`; `preview.spec.ts` authenticated command/keyboard test | Verified supported parameters; props/other kinds explicitly rejected |
| Drawing gesture | `Session::draw_drag`, `Session::up`, `ToolId::click_size` | Reverse extents, Shift/Alt, pixel rounding, tiny-click 100x100, return to Move | `drawnRectangle`, `CanvasController` | `rectangle.test.ts` geometry; `preview.spec.ts` pointer test | Verified page-only subset; object snapping deferred |
| Solid rectangle rendering | `render_one`, ordered page children, `Node::new` colours | `render/src/lib.rs`, `doc/src/node.rs`, `color/src/lib.rs` | `renderDocument` | Browser pixel test, canvas screenshot and 10,000-node fixture | Verified flat solid rectangle subset |
| Host identity boundary | Upstream has no accounts; local file editing independent of online owner tokens | `access-mapping.md`, `Document::new`; host requirement in execution prompt | Next.js host and `SupabaseIdentityAdapter`; existing read/edit capabilities | Shared contracts, real Auth integration, browser login/refresh/logout | Host infrastructure verified locally; no new product role |
