# Upstream reference advance

The authorised `npm run upstream:sync` fast-forwarded the reference fork and canonical submodule from `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3` to `09e04e71765517975950403eec4cb6fbe8955359`. Fork/original/submodule heads agree. The18-commit range changes42 files (907 insertions,148 deletions). No React branch was pushed or merged. The supported global baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; a source update is not a parity claim.

Pen/Pencil tools, vector-edit engine modules and existing Pen/pressure tests are unchanged. The completed Pen workflow remains verified at `d3c00a4` by803 pure tests,2 real Auth tests, strict TypeScript/package/Next builds and97 Chromium checks. Reference changes do not enter runtime or tests.

| Incoming behaviour | Source evidence | Required owning slice / status |
|---|---|---|
| A held canvas press retains its page point when panel visibility changes the canvas size or position | `ui-egui/src/canvas.rs`; `panel_width_tests.rs`; commits5d21ca87/36b72830 | Canvas/chrome interaction follow-up; add browser resize/reposition-during-press cases. Not yet ported |
| Go to main opens/focuses a linked local library file, selects its source component and preserves viewport; clear handling of missing/unlinked/remote library copies | `engine/src/cmd/component.rs::go_to_library_main`, `assets/library.rs::library_source`, library tests;76af4e3f/6a31ea73 | Components/libraries/file tabs; not yet implemented. Browser file access must use its provider/file contract |
| Clipboard PNG data must decode successfully before insertion; retain100M-pixel limit and density-based placement | `ui-egui/src/menus/clipboard.rs::with_pixel_size`; `paste_image_tests.rs`;bea214eb | Clipboard/image import; not yet implemented |
| A local share supports distinct edit/view secrets, links and codes, with matching read-only access; local comment access remains refused | `collab-net/{link,host,join,guest}.rs`, `engine/src/sharing/live/{host,types}.rs`, protocol docs and code/loopback/share tests;a2be6632/a05201e2/b779e46d | Sharing/collaboration adapter and access mapping; not implemented. Preserve access semantics without browser TCP hosting or exposing transport secrets in core identity |
| All-interface share links use a reachable address rather than an unspecified bind address | `collab-net/src/link.rs::{reachable,route_ip}` and tests;10df192b | Native listener/address discovery has no direct browser API; explicit transport-host substitution required in collaboration scope |
| Glass dispersion uses one sample below1/256-pixel colour separation; wider splits retain triangular sampling | `render/src/glass.rs::{dispersed,dispersion_window}` and `a_split_too_narrow_to_show_takes_one_sample`;43403b3f | Effects/rendering; not yet implemented |
| Glass splay uses the layer bounds centre; shape-core limits differ between desktop/web and large shapes fall back to edge normals | `doc/src/props.rs`, `render/src/glass.rs`, target-app parity docs;3d41394b | Effects/rendering browser-equivalence evaluation; not yet implemented |
| Contributor credit and accompanying roadmap/docs | `contributors/people.toml`, `ROADMAP.md` | Final About/credits and source audit |

Paths are relative to `original/figcraft/crates` unless otherwise stated. Merge commits are included in the18-commit total. This is an incoming-change routing review, not completed verification of those features. The source command/feature inventory must be refreshed against the final pin before the complete-product gate, including changed command parameter/result contracts.

Graphify Rust remains queryable at0b97f3f and React atb3b8a1b (README-only); local source controls the updated evidence. Supabase MCP authenticated public-table read succeeds with no tables; no schema/Auth/hosted configuration change is needed for these reference and Pencil foundation steps.
