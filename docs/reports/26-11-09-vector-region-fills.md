# Selected vector region fills

React 0.35.0, revision a9f8ec60617da92a176e83c71505b63e96e85fab. Native reference 8a7ebc2484a6d64d80a13c19c18ffb814325e347, global baseline 8eb0b876. Strict TypeScript, library and Next.js production builds, 913 pure tests, both local Auth integration tests and all 115 Chromium workflows passed. Full Chromium run 242.6 seconds with one worker, zero retries and zero skips.

The inspector reads the selected region stacks and supports colour, opacity, visibility, add, remove, order, copy and paste. Explicit region arguments and implicit selection use the same transaction. Inheriting regions retain inheritance after a no-op. A failed edit across differing stacks preserves the document and history.

At 10,000 nodes and 100 edited layers, changing two selected region stacks took 0.3 ms p95. Command, render and hatch together took 3.0 ms p95 over 110 measured frames. The benchmark verified 120 edits, the unchanged sibling and undo of both regions. [Raw measurements](26-11-09-vector-region-fills-measurements.json). [Property evidence and manual checks](26-11-09-vector-region-fills-parity.html).

The scoped Supabase MCP confirmed zero public tables. Both local Auth tests passed. These commands edit the native document and require the existing authenticated editable capability. The paint clipboard belongs to the engine session and is cleared on revocation. This slice has no cloud data, schema or transport change.

Ten property rows passed. Non-solid regional paint editing awaits the gradient, image and pattern milestones. The current region fill scope uses independent TypeScript, HTML context actions and Canvas 2D. Local implementation a9f8ec6 on prompt/full-figcraft-port. Publication awaits full-product parity. No user action is required.
