# Shape Builder

React 0.42.0 (a132b69d5f4521a71ae9922264875e997afe7960), upstream 8a7ebc2484a6d64d80a13c19c18ffb814325e347, global supported baseline 8eb0b876. Strict types, both production builds, 980 pure tests, two real local Auth tests and all 133 Chromium workflows passed. Single worker, zero retries, skips, failures or flaky outcomes. Browser duration 277.8 seconds.

The browser tool constructs connected page-space regions from supported shapes, independent vector paints, boolean groups and visible stroke outlines. Click, drag and Alt support one undoable merge or removal. The initial server-rendered authenticated host now loads the Node entry of the cubic geometry dependency. Fourteen reference screenshots were reviewed pixel by pixel. Their only changes were inside the floating toolbar. [Twelve verified properties](26-11-09-shape-builder-parity.html).

With 32 overlapping sources in 10,000 nodes, the arrangement had 60 regions and cold construction took 27.8 ms. Across 110 measured hovers input p95 was below browser timer resolution and combined document/overlay paint p95 was 0.6 ms. Editor notifications during hover: 0. Removal took 3.6 ms. [Raw measurements](26-11-09-shape-builder-measurements.json).

Scoped Supabase MCP read returned zero public tables. The tool uses host Auth and device recovery. Text outlines, gradient sampling, effects, shared style references and absolute placement under auto layout require their corresponding later milestones. Implementation a132b69 on prompt/full-figcraft-port. Gradients follow. Full audit and final publication remain pending.
