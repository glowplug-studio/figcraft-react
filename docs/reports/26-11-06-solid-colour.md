# Solid colour and basic appearance checkpoint — 6 November 2026

## Scope and source

This bounded React slice adds native non-premultiplied f32 sRGB colour, CSS/hex and RGB/HSL/LCH/OKLCH parsing, solid paint stacks and their separate `opacity`, `visible`, `blend` and `colorAlpha` fields. It adds rectangle name, fill, visibility, lock and node opacity; editable page background; Canvas 2D compositing; native ZIP/JSON round trips, undo and local recovery. The source reference is upstream `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`, especially `crates/color/src/lib.rs`, `hsx.rs`, `lch.rs`, `named.rs`, `crates/engine/src/cmd/edit/props.rs` and `crates/doc/src/node.rs`. The global parity baseline remains `8eb0`; this slice does not claim the whole source commit.

The implementation is on `prompt/full-figcraft-port` in the canonical checkout. The public rectangle `fill` and page `background` strings remain compatibility aliases; precise typed colour and paint fields carry native values. Unsupported gradients, image/pattern paints, non-normal blending, strokes, effects and wider node/document structures remain explicitly refused by the bounded file reader.

## Verification state

At the final core/browser checkpoint, 242 pure tests, two real local Auth integration tests, strict TypeScript, the package/Next.js production build and 16/16 local production Chromium browser tests passed (17.8 s), including the native paint metadata regression after scratch-canvas cropping. The 10,000-node plain fixture ran 110 frames at p95/max 1.0/1.3 ms; the affine fixture ran 110 frames at p95/max 4.9/8.1 ms. These are local fixture measurements, not universal frame budgets. The `test-results/solid-paint-stack.png` screenshot was visually inspected. A CSS correction for hidden file inputs and inline checkboxes passed a rebuilt focused production-browser check (1/1, 3.7 s); its screenshot was inspected. Verified product commit: `bfa5dd89e4907d312e5c573444325392b82c3353`. The [property-level report](26-11-06-solid-colour-parity.html) gives exact test identifiers, expected and observed results, source and test links, manual steps, confidence and limitations for each property.

Automated browser observations cover translucent CSS fill, invalid colour rejection, fill order/add/remove/visibility, 50% node opacity applied once to a red plus half-blue stack, transparent page redraw, hidden/locked pointer bypass and select-all, undo and reload. The composed pixel target is approximately `[191,127,191,255]` over white, with a two-channel tolerance. Tests use inspected Rust sources and inspection-derived native fixtures; Rust was not executed, and there is no independently generated Rust output comparison. Local Chromium verification is not a cross-browser or broad performance claim.

No Supabase schema, adapter, RLS, Storage, Realtime or hosted setting changed. The earlier scoped MCP verification remains the source for that boundary; two real local Auth tests passed at the verified checkpoint. Graphify access was restored: its Rust index is at `0b97f3f1`, while its React index remains at `b3b8a1b` and covers only the README. Current local React files therefore provide implementation evidence. There was no deployment, push or hosted verification.

## Remaining work

The full colour picker interface, colour profiles and gamut-wide product workflows, gradients, image/pattern paints, blend modes, strokes, effects, complete node hierarchy and complete native archive remain outside this checkpoint. Complete Figcraft parity remains in progress. The next slice completes nested group hierarchy.
