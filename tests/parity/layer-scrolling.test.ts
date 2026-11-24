import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import native from "../fixtures/native-layer-scrolling.json" with { type: "json" };

type Step = { command: string; params: Record<string, unknown>; receipt?: unknown; error?: string; saved?: Record<string, Record<string, string>> };

// Native doc/src/node.rs (overflow, scroll_position) and node.set, observed at bad07e44: a frame's overflow and a layer's
// scroll position are set by name in any case, refused otherwise, and written only when not the default.
it("sets, saves and reopens a layer's overflow and scroll position as native does", async () => {
  const e = new EditorEngine();
  const { unzipSync, strFromU8 } = await import("fflate");
  for (const [n, step] of (native.steps as Step[]).entries()) {
    const where = `step ${n}: ${step.command} ${JSON.stringify(step.params)}`;
    if (step.saved) {
      const bytes = await encodeFigcraft(e.getSnapshot().document);
      const saved = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]));
      for (const [id, fields] of Object.entries(step.saved)) {
        const node = saved.nodes[id];
        expect({ ...(node.overflow !== undefined && { overflow: node.overflow }), ...(node.scroll_position !== undefined && { scroll_position: node.scroll_position }) }, `${where} node ${id}`).toEqual(fields);
      }
      const again = (await decodeFigcraft(bytes)).document;
      for (const id of Object.keys(step.saved)) {
        const a = again.nodes[id] as { overflow?: string; scrollPosition?: string }, b = e.getSnapshot().document.nodes[id] as typeof a;
        expect([a.overflow, a.scrollPosition], where).toEqual([b.overflow, b.scrollPosition]);
      }
      continue;
    }
    let error: string | undefined;
    try { e.execute(step.command, step.params); } catch (x) { error = (x as Error).message; }
    if (step.error !== undefined) expect(error, where).toBe(step.error);
    else expect(error, where).toBeUndefined();
  }
});
