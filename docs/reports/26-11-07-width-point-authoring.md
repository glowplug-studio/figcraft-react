# Variable-width point authoring

React 0.31.0 at 6b3529a751c1d5e09aff14f8884cca8e1bdf98f7 on prompt/full-figcraft-port. Native reference ed90dc103bac791ee917184418df10f4ef133c96. All 879 pure tests, two local Supabase Auth checks, strict TypeScript, the library build and the Next.js production build passed. All 108 Chromium checks passed in 237.9s without failures, skips or flakes.

The canvas, keyboard and inspector share the same profile operations. Authenticated Chromium created an asymmetric point, preserved the opposite side, edited the position, deleted and restored the point, downloaded the native file and recovered it after reload. The mobile toolbar remained operable at 390 pixels. [Property matrix](26-11-07-width-point-authoring-parity.html) · [Fixed capture](../../tests/e2e/preview.spec.ts-snapshots/asymmetric-width-handles.png) · [Measurements](26-11-07-width-point-authoring-measurements.json)

At 10,000 nodes and 100 visible edited layers, width drag including drawing measured 2.50 ms p95 with zero React root and inspector notifications. The library entry built to 669.91 kB, 187.18 kB gzip. This measurement covers the current entry and the bounded fixture. Full-host memory and sustained mixed-document work remain on the roadmap.

The first regression run exposed two existing captures that included the new toolbar control. A pixel comparison confined all changes to the bottom toolbar in each capture. Four focused checks passed after updating both references.

The scoped hosted Supabase call returned zero public tables. This feature uses native files, local recovery and existing host Auth. The source mapping and raw validation cases are in the [plan](../planning/26-11-07-width-point-authoring.md). The hosted React graph remains README-only. Following local refresh the code graph contained 1,790 nodes and 8,510 edges. Two SQL files lack a parser. The supported global baseline remains 8eb0b876. Full parity, cloud storage, collaboration and publication remain pending.
