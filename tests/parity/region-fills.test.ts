import { expectSolid } from "../fixtures/expect-solid";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { toCssHex } from "../../src/engine/colour";
import { rectanglePaints, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { selectedRegionFills } from "../../src/engine/fill-commands";
import { base64Bytes } from "../../src/engine/recovery";
import type { Paint } from "../../src/engine/solid-paint";

async function setup() {
  const engine = new EditorEngine(), id = String(engine.execute("vector.create", { path: "M0 0H80V80H0Z M100 0H180V80H100Z", props: { fill: "#123456" } }).id);
  const doc = engine.getSnapshot().document, vector = doc.nodes[id] as VectorNode;
  const regions = vector.network.regions[0].loops.map(loop => ({ loops: [loop], winding: "nonZero" as const }));
  await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft({ ...doc, nodes: { ...doc.nodes, [id]: { ...vector, network: { ...vector.network, regions } } } })) });
  engine.execute("vector.edit.begin", { id });
  const node = () => engine.getSnapshot().document.nodes[id] as VectorNode;
  const select = (regions: number[]) => engine.execute("vector.edit.select", { regions });
  const stack = (i: number) => node().network.regions[i].fills;
  const inspect = () => selectedRegionFills(node(), engine.getVectorEdit());
  return { engine, id, node, select, stack, inspect };
}
const colours = (list?: readonly Paint[] | null) => list?.map(p => toCssHex(expectSolid(p).color).toLowerCase());

describe("native effective region fill commands", () => {
  it("uploads to only the selected region and cancels a pending read when the picker closes", async () => {
    const {engine, select, stack, node} = await setup();
    select([0]);
    const picker = {list:"fill" as const,index:0,stop:0};
    engine.setPaintPicker(picker);
    const before = engine.getSnapshot().document, source = readFileSync(new URL("../fixtures/images/six-pixels.png",import.meta.url));
    const file = new File([Uint8Array.from(source)],"region.png",{type:"image/png"});
    vi.stubGlobal("createImageBitmap", async () => ({width:3,height:2,close(){}}));
    try {
      await engine.uploadPaintImage(picker,file);
      expect(stack(0)?.[0]).toMatchObject({type:"image",scale_mode:"fill"});
      expect(stack(1)).toBeUndefined();
      expect(rectanglePaints(node())[0].type).toBe("solid");
      engine.execute("edit.undo");
      expect(engine.getSnapshot().document).toBe(before);
      engine.setPaintPicker(picker);
      let release!: (bytes:ArrayBuffer)=>void;
      const read = new Promise<ArrayBuffer>(resolve=>{release=resolve;});
      vi.spyOn(file,"arrayBuffer").mockReturnValue(read);
      const pending = engine.uploadPaintImage(picker,file);
      engine.setPaintPicker();
      release(Uint8Array.from(source).buffer);
      await expect(pending).rejects.toThrow(/picker target changed/);
      expect(engine.getSnapshot().document).toBe(before);
    } finally { vi.unstubAllGlobals(); }
  });
  it("edits inherited stacks independently and reports a mixed region selection", async () => {
    const f = await setup(), inherited = rectanglePaints(f.node());
    f.select([1]); expect(f.inspect()).toEqual(inherited);
    f.engine.execute("fill.set", { color: "#ff0000" });
    f.engine.execute("fill.add", { color: "#00ff00" });
    f.engine.execute("fill.move", { from: "0", to: 1 });
    expect(colours(f.stack(1))).toEqual(["#00ff00", "#ff0000"]);
    f.engine.execute("fill.remove", { index: 0 });
    expect(colours(f.inspect())).toEqual(["#ff0000"]);
    expect(f.stack(0)).toBeUndefined(); expect(rectanglePaints(f.node())).toEqual(inherited);
    f.select([0, 1]); expect(f.inspect()).toBeNull();
    f.engine.execute("fill.set", { color: "#220011" }); expect(colours(f.inspect())).toEqual(["#220011"]);
    f.select([]); expect(f.inspect()).toBeUndefined();
    f.engine.execute("fill.set", { color: "#010203" });
    expect(colours(rectanglePaints(f.node()))).toEqual(["#010203"]); expect(colours(f.stack(1))).toEqual(["#220011"]);
  });
  it("retains inheritance for no-ops, deduplicates indices and persists explicit empty lists", async () => {
    const f = await setup(), depth = f.engine.getUndoDepth();
    f.select([1]); f.engine.execute("fill.move", { from: 0, to: 0 }); f.engine.execute("fill.remove", { index: 9 });
    f.engine.execute("fill.set", { color: "#123456" });
    expect(f.stack(1)).toBeUndefined(); expect(f.engine.getUndoDepth()).toBe(depth);
    f.engine.execute("fill.add", { regions: [0, 0], color: "#abcdef" });
    expect(f.stack(0)).toHaveLength(2); expect(f.stack(1)).toBeUndefined();
    f.engine.execute("fill.remove"); expect(f.stack(1)).toEqual([]);
    const restored = await decodeFigcraft(await f.engine.nativeSnapshot());
    expect((restored.document.nodes[f.id] as VectorNode).network.regions[1].fills).toEqual([]);
    f.engine.execute("edit.undo"); expect(f.stack(1)).toBeUndefined();
  });
  it("rejects malformed targets atomically, including a missing slot in the second region", async () => {
    const f = await setup(); f.engine.execute("fill.add", { regions: [0] }); const before = f.engine.getSnapshot(), depth = f.engine.getUndoDepth();
    for (const regions of ["all", [], [2], ["0"], [false], [0.5], [-1], [0, 42]]) {
      expect(() => f.engine.execute("fill.set", { ids: [f.id], regions, color: "#fff" })).toThrow();
    }
    expect(() => f.engine.execute("fill.set", { regions: [0, 1], color: "#fff", index: 1 })).toThrow(/index/);
    expect(f.engine.getSnapshot()).toBe(before); expect(f.engine.getUndoDepth()).toBe(depth);
  });
  it("copies one regional slot, refuses mixed stacks and pastes by append or replacement", async () => {
    const f = await setup(); f.select([1]);
    f.engine.execute("fill.set", { color: "rgba(255,0,0,.25)", opacity: "50%", visible: false, blend: "passThrough" });
    const paint = f.stack(1)![0], depth = f.engine.getUndoDepth();
    expect(paint).toMatchObject({ opacity: .5, colorAlpha: 1, visible: false, blend: "passThrough" });
    expect(f.engine.execute("fill.copy")).toEqual(paint); expect(f.engine.getUndoDepth()).toBe(depth);
    f.select([0, 1]); expect(() => f.engine.execute("fill.copy")).toThrow(/differ/);
    f.engine.execute("fill.paste", { regions: [0] }); expect(f.stack(0)![1]).toEqual(paint);
    f.engine.execute("fill.paste", { regions: [0], index: 0 }); expect(f.stack(0)).toEqual([paint, paint]);
    const bytes = await f.engine.nativeSnapshot(); await f.engine.executeAsync("file.open", { data: base64Bytes(bytes) });
    f.engine.execute("fill.paste", { id: f.id, regions: [1] }); expect(f.stack(1)).toEqual([paint, paint]);
    f.engine.setEditable(false); f.engine.setEditable(true);
    expect(() => f.engine.execute("fill.paste", { id: f.id })).toThrow(/copied/);
  });
  it("applies frame and shape defaults and keeps copied layer fills outside file history", () => {
    const e = new EditorEngine(), a = String(e.execute("frame.create", { x: 0, y: 0, width: 80, height: 80 }).id), b = String(e.execute("shape.rectangle", { x: 100, y: 0, width: 80, height: 80 }).id);
    e.execute("fill.add", { ids: [a, b] });
    const doc = e.getSnapshot().document;
    expect(colours(rectanglePaints(doc.nodes[a] as VectorNode))?.at(-1)).toBe("#ffffff");
    expect(colours(rectanglePaints(doc.nodes[b] as VectorNode))?.at(-1)).toBe("#d9d9d9");
    expect(() => e.execute("fill.add", { ids: [a, b], regions: [0] })).toThrow();
    expect(() => e.execute("fill.set", { id: b, regions: [0] })).toThrow();
    expect(e.getSnapshot().document).toBe(doc);
  });
});
