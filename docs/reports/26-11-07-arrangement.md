# Movement and arrangement checkpoint — 7 November 2026

React `0.10.0`, implementation `783a694`, branch `prompt/full-figcraft-port`; upstream evidence `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Global baseline remains `8eb0b876`; full parity is incomplete.

Added eighteen commands: page-space move/moveTo, parent-space nudge, six alignments, two distribution axes, two packing axes, tidy-up and four stacking operations. Commands validate targets, edit immutable drafts, normalise changed groups and publish one history step. No-op alignment/nudge/stacking preserve the snapshot. Inspector controls and keyboard nudges use these same commands.

Source-derived cases cover outermost-edge distribution, all six alignments, transformed parents, selected ancestors/descendants, negative gaps, tidy rows, multi-parent stacking, invalid targets/overflow atomicity and native round trips. The distinction between world movement and local nudge is intentional upstream behaviour. Default nudge amounts1/10 are supported; editable preferences and auto-layout flow rules remain required later.

Verification: strict TypeScript,331 pure tests,2 real local Auth integration checks, package/Next production builds,30/30 Chromium checks in39.8s. New authenticated flows exercise alignment, distribution, both move modes, keyboard nudge/undo, stacking, native save/recovery, a rotated frame child and mobile controls. No browser errors or failed requests; inspected mobile screenshot has no horizontal overflow. Test-generated accounts are removed; no permanent test account was retained.

Performance,110 measured frames: groups p95/max8.9/12.9ms, frames10.1/11.6ms, moving frames13.3/16.6ms, plain rectangles1.2/1.4ms, affine6.8/11.5ms, moving affine4/6ms. Pointer/render p95 both0.1ms. These are local Chromium measurements. The screenshot `test-results/arrangement-mobile.png` and JSON logs regenerate locally and remain ignored.

No provider/schema/RLS/Storage/Realtime change. Previously verified scoped Supabase MCP and current local Auth checks cover the unchanged boundary; hosted tables and deployment remain unchanged. Graphify Rust evidence is current, React index stale/README-only. No Rust execution, push, deployment or main merge. No user action required.

Required gaps include pointer move/resize, snapping/drag duplication, resize/scale/rotation origin commands, smart spacing/reorder, nudge preferences, auto-layout behaviour and other document kinds. Next: anchored resize and uniform scale. [Property report](26-11-07-arrangement-parity.html).
