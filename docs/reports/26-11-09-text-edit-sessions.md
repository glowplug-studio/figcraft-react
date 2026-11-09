# Canvas text editing commands

Upstream a4251ca89e253ab69a5ee4135bc30bc5f82725ab. React 5568cb2 and 31a85cb on prompt/full-figcraft-port. Local production Next.js 16.4.5, Chromium, Playwright 1.65.0 and local Supabase Auth. The complete suite passed 227/227 workflows in 477.8 seconds, one worker with zero retries or skips. The library and preview built, strict types passed, and 1,670 pure tests and two Auth integration tests passed.

All nine native editing commands use the same edit as the browser textarea. Independent comparisons matched 443 command sequences. Physical keyboards and the DOM expose UTF-16 offsets, and the engine exposes Unicode scalar indices. The browser bridge was checked through the installed library entry. Its first test expected a string for a small inspected ID. Rust returns a number. Correcting the assertion made the focused workflow pass.

The scoped Figcraft Supabase inspection for the rich-text slice found zero public tables. Local Auth integration passed. This checkpoint adds no schema or Realtime resources. The combined local graph contained 31,600 nodes and 104,028 edges, including executeTextEdit, textKeyMotion, select_line and preedit_doc. The extractor did not model the top-level browser and parity tests as symbols. Those files were executed directly.

Clipboard gestures, path placement, surrounding-text composition, cross-feature rendering, performance and release verification remain open. This is an internal branch checkpoint. [Property matrix](26-11-09-text-edit-sessions-parity.html).
