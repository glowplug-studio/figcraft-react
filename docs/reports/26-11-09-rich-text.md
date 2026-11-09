# Rich text and fonts

Local package 0.49.0 at a81127c on prompt/full-figcraft-port. Implementation 96f54c5 targets upstream a4251ca89e253ab69a5ee4135bc30bc5f82725ab. The global supported baseline remains 8eb0b876. [Property matrix](26-11-09-rich-text-parity.html).

Native document interchange, shaped and curved text, styled scalar ranges, paragraph layout, fonts, lists, links, clipboard, composition and flattening are implemented. All 60 text commands registered by the native command module are present, together with text.missingFonts and text.refit from the native font module. Presence alone does not verify every parameter combination.

The local production Next.js host passed 234/234 Chromium workflows at a81127c in 497.1 seconds with one worker, zero skips and zero retries. The 390 × 844 touch workflow created and saved Japanese text and an emoji. The versioned package passed strict types, both production builds, 1,675 pure tests and two local Auth tests. Seven native raster scenes matched every stable interior pixel. On a 10,000-node drawing with 100 visible text layers the release run measured 0.6 ms p95 input, 4.0 ms p95 edit plus render and 400,604 retained bytes across 110 frames. No root notifications fired.

The browser uses composition events, a textarea and browser-mediated font import. The upstream browser target omits native font downloading. Physical phone keyboards and other browser engines remain untested. Verification of style and variable resolution, instance overrides, auto-layout text reflow and cross-format exports belongs to the remaining roadmap rows. The scoped Figcraft Supabase inspection returned zero public tables. Text work uses the existing host authentication and local native document storage.

Earlier implementation checkpoints include font catalogue 52177ad, keyboard navigation 5568cb2, editing sessions 31a85cb, path gestures 12c1b6e and flattening a80bacf. The final text implementation corrected provisional selection and normalised insertion boundaries. [Native comparisons and implementation history](../planning/26-11-09-rich-text.md).
