# Text gestures, path placement and flattening

Upstream a4251ca89e253ab69a5ee4135bc30bc5f82725ab. React 12c1b6e and a80bacf on prompt/full-figcraft-port. The local production host passed all 230 Chromium workflows in 507.8 seconds with one worker, zero skips and zero retries. Strict types, both builds, 1,675 pure tests and two local Auth integration checks passed.

The initial complete run with a separate toolbar button produced 90 passes, one rectangle screenshot failure and 138 workflows skipped by the serial group. The new button moved the existing toolbar and changed 2,223 pixels. Grouping the choices under Text restored the original screenshot. During focused work, saving an edit also exposed idle smart handles cancelling another interaction. Both regressions have browser coverage.

432 upstream pointer probes matched, including 162 hits. The 108 native flatten cases matched every vertex, tangent, region loop and bound within 10⁻⁷ document units. Native snapshots cover Inter, Noto Sans Georgian, blank outlines, decorations, rotation and text attached to a curve. Local Auth passed. The scoped Figcraft Supabase inspection for the rich-text slice found zero public tables. These changes use native files and browser clipboard permissions. The combined graph for a80bacf had 31,612 nodes and 104,110 edges.

Plugins and widgets remain deferred. Further rich-text IME, rendering, large-document verification and release gates remain open. [Property matrix](26-11-09-text-gestures-parity.html).
