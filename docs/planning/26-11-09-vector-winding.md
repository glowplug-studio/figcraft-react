# Vector fill rules and loop direction

## Dependency and scope

Region painting, selection, path traversal and the native codec now work in the editable host. Winding and loop direction are inputs to Simplify, Offset, booleans and Shape Builder. Complete the native command pair and its readback before implementing those operations.

| Upstream | React target | Verification |
|---|---|---|
| engine/src/cmd/structure.rs fill_rule, area_index, network_mut | vector.fillRule registered with the existing vector command dispatcher | Validate native spellings, region indices, targeted and whole-network changes, multi-selection and the disabled result for zero eligible regions. Preserve unrelated paints and segments. |
| structure.rs reverse_loop, short_loop_segments | vector.reverseLoop operating on immutable networks and the normal history boundary | Reverse a long loop by list order. In short loops choose the lowest non-shared stored segment and swap both ends and tangents. Refuse fully shared short loops atomically across all targets. |
| doc/src/vector.rs loop_path and append_loop, engine/src/vector_fill_rule_tests.rs | vectorLoopWalk, appendVectorLoops, vectorRegionPath, regional and combined render/hit functions | Compare cubic one-segment and two-segment lenses, adjacent areas and a ring. Verify fill pixels and hit results at bounded coordinates for both winding rules. |
| Engine command specifications, doc codec and editor host | Existing public command surface, native save/open, history and local recovery | Exercise the command API and open the resulting native files in the signed-in browser. Do not invent a toolbar or inspector surface absent from upstream. Check the source for a corresponding UI before implementation. |

## Checkpoint

Phases 1–3. React b737b56, pinned upstream and fork main 8a7ebc2484a6d64d80a13c19c18ffb814325e347, global supported baseline 8eb0b876. Local merged graph 29,487 nodes and 96,614 edges, with native fill_rule and reverse_loop plus TypeScript vectorLoopWalk and appendVectorLoops verified. Local code-only extraction omits prose semantics and optional SQL parsing. Scoped Supabase MCP verified zero public tables. Local authenticated edit access and document recovery own this behaviour. No new schema or transport is needed. Rollback b737b56. Implement the paired reducers and native fixtures, then run build, local Auth, Playwright, hit/render, performance and reporting gates.

Phases 4–7 complete at c93010f. The [offline property matrix](../reports/26-11-09-vector-winding-parity.html) links the native-matched fixtures, browser coverage and performance observations.
