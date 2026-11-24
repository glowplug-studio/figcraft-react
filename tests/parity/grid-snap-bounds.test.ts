import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { base64Bytes } from "../../src/engine/recovery";
import { maxGridSnapLines, SnapTargets } from "../../src/engine/snapping";

// Restates native crates/layout/src/depth_tests.rs `snap_lines_are_bounded_across_a_frames_grids` at bad07e44
// (upstream 1935c3ea, 9d486259): a 4000 x 4000 frame with 1000 visible 1 px grids.
async function frameWith(grids: number) {
  const engine = new EditorEngine();
  const doc = { name: "Grids", next_id: 4, pages: [1], current_page: 1, nodes: {
    1: { id: 1, type: "page", name: "Page", width: 0, height: 0, children: [2] },
    2: { id: 2, type: "frame", parent: 1, name: "F", width: 4000, height: 4000, children: [3],
      ...(grids && { grids: Array.from({ length: grids }, () => ({ kind: "grid", size: 1, visible: true })) }) },
    3: { id: 3, type: "rectangle", parent: 2, name: "R", width: 10, height: 10 },
  } };
  await engine.executeAsync("file.open", { data: base64Bytes(new TextEncoder().encode(JSON.stringify(doc))) });
  const targets = new SnapTargets(engine.getSnapshot().document, ["3"]);
  return { xs: targets.xs.length, ys: targets.ys.length };
}

it("bounds the snap lines a frame's grids give together and leaves out a grid that would pass the budget", async () => {
  const base = await frameWith(0), one = await frameWith(1), many = await frameWith(1000);
  const lines = (t: { xs: number; ys: number }) => ({ xs: t.xs - base.xs, ys: t.ys - base.ys });
  expect(lines(one), "one grid gives 4000 lines each way (native grid_lines stops at 4000)").toEqual({ xs: 4000, ys: 4000 });
  const all = lines(many);
  expect(all.xs + all.ys).toBeLessThanOrEqual(maxGridSnapLines);
  expect(all.xs > 4000 && all.ys > 4000, "the first grids still give their lines").toBe(true);
  expect(all.xs + all.ys, "a grid adds one line per rectangle and the check counts two, as native: 24 whole grids fit and the 25th is left out").toBe(24 * 8000);
});
