# Vector faces and Paint bucket

Local React 0.33.0 at 50370fe01b5d63050e9a28e2361285e736d8481b. Native reference 8a7ebc2484a6d64d80a13c19c18ffb814325e347. All 900 pure tests and both real local Auth integration tests passed. All 111 Chromium tests passed in 236.0 seconds with one worker, zero retries and zero skips. Strict TypeScript, package and Next.js production builds passed.

B or Shift+B activates the Paint bucket in vector edit mode. Hover outlines and hatches the active face. A drag toggles the first enclosed face and applies the same action across its remaining stamps. Escaped and cancelled edits restore the captured document. Save and reload preserve the authored segments, region winding and supported paint stacks. The mobile toolbar exposes the same tool. Implementation 94273da adds the bucket. Commit 50370fe updates two existing toolbar snapshots after the initial full regression. The snapshot review found all differences above two colour levels within the toolbar.

On 10,000 nodes with 100 visible edited vectors, p95 input took 2.70 ms, drag and draw 4.40 ms, hover and pan 2.20 ms. There were zero root or chrome notifications and cancellation restored the original snapshot. [Raw measurements](26-11-09-vector-paint-bucket-measurements.json) and [property matrix](26-11-09-vector-paint-bucket-parity.html).

The scoped Supabase MCP read returned zero public tables. Both local Auth checks passed. The bucket changes document edits and local file data. It introduces no schema or Realtime change. Authenticated browser verification exercised both desktop and mobile viewports against the local production build on branch `prompt/full-figcraft-port`.

Twelve properties passed. The native non-solid stack case remains untested until gradient, image and pattern paints are available. The row and the [slice plan](../planning/26-11-08-vector-paint-bucket.md) retain this dependency for the full-product audit. Upstream reference 8a7ebc2484a6d64d80a13c19c18ffb814325e347; global supported baseline 8eb0b876. Publication remains gated on the remaining roadmap.
