# Rounded corners and radius handles — 7 November 2026

React0.17.0, implementation `37ad314`, branch `prompt/full-figcraft-port`; upstream `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Global parity baseline remains `8eb0b876`; full parity is incomplete.

Implemented independently derived rounded/smoothed Rectangle and Frame cubic paths, clockwise independent radii, native half-short-side clamping and smoothing reduction. Stored radii remain unclamped by dimensions; ordinary resize retains them and Scale multiplies them. Native scalar/1/2/4-array and per-corner command semantics, sorted property order, smoothing reset, serde defaults and native archive/recovery are supported. Group metadata is retained without painting a Group shape.

Canvas fills, affine selection outlines and Frame child clips use the rounded path. Native Frame hit/clipping traversal intentionally retains rectangular targets. Radius handles follow the source48px visibility threshold,10px inset,6px nearest hit,3.5/4.5px circles and one-decimal readout. Move-tool drags update all corners or Alt one corner, preserve transform-square precedence, preview from immutable base, cancel safely and commit once. Controls support mixed selection, individual corners and60% smoothing preset.

Browser equivalents: Canvas2D cubic commands implement the native path; circular segments follow the independently implemented [Kurbo0.13.1 arc algorithm](https://docs.rs/kurbo/0.13.1/src/kurbo/arc.rs.html) at0.01 tolerance. Pure hit testing uses adaptive cubic flattening at0.001 local-unit error, below native nearest's0.01 numerical tolerance. Browser antialiasing differs from native rasterisation. Native numeric-field scrubbing, expressions, variables, full theme and remaining shape kinds remain explicit required UI/model roadmap work; this report does not claim those families complete.

Verification:460 pure tests (20 corner cases),2 real local Auth tests, strict TypeScript, package/Next production builds and56/56 Chromium checks in104.2s. The2 environment-gated Auth cases are skipped in the pure suite and pass separately. Three new authenticated flows cover live all/Alt edits, no-root preview, smoothing, native save/reload, mobile controls, rounded Frame clipping/rectangular hits, mixed selection, resize/Scale and cancellation. Reviewed fixed rounded-corners.png baseline and live Radius29 screenshot. No browser errors or failed network requests.

Performance:10000-node document,9999 rounded rectangles,100 visible, one radius gesture,110 frames after10 warm-ups: p954.6ms, maximum9.5ms, input p954ms; zero root notifications and cancellation restores the committed document. Existing movement, affine, Frame, smart and transform performance suites also pass.

Corrections during verification: default corner metadata now normalises away like other omitted native defaults; omitted serde fields default but explicit null rejects; scaled-radius overflow refuses atomically. An older fill-pixel assertion was covered by a newly correct radius handle and now samples farther inside. The new Frame fixture initially created its child on the page; it now explicitly selects the Frame parent. No test failures remain.

Supabase scoped MCP public-table read succeeded; no application tables exist yet. No schema, Storage, Realtime, identity or hosted Auth change is required for this local geometry slice. Existing provider-neutral contracts and real local Auth checks pass. No credentials, hosted mutation, branch push, main merge or Vercel publication. Local Next process stopped. No user action required; continue immediately with source-evidenced ellipse/arc/ring geometry and handles.

[Property matrix](26-11-07-rounded-corners-parity.html) · [Master checkpoint](../planning/26-11-06-complete-figcraft-port.md).
