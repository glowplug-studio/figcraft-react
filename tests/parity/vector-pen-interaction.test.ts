import { describe, expect, it } from "vitest";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import type { MoveModifiers } from "../../src/engine/move-interaction";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { PenSnapCache } from "../../src/engine/vector-point-snap";

const plain: MoveModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
function setup() {
  const engine = new EditorEngine(), errors: string[] = [];
  const id = String(engine.execute("vector.create", { points: [[0, 0], [100, 0]], closed: false }).id);
  engine.execute("vector.edit.begin"); engine.execute("vector.edit.tool", { tool: "pen" });
  const interaction = new VectorInteraction(engine, message => errors.push(message));
  const net = () => (engine.getRenderDocument().nodes[id] as VectorNode).network;
  const click = (x: number, y: number, modifiers = plain) => { interaction.down({ x, y }, modifiers); interaction.up({ x, y }); interaction.cancel(); };
  return { engine, interaction, id, net, click, errors };
}

describe("native edit-mode Pen pointer fixtures", () => {
  it("extends, closes and branches with one history entry per geometry click", () => {
    const { engine, click, net, errors } = setup(), depth = engine.getUndoDepth();
    click(100, 0); expect(engine.getUndoDepth()).toBe(depth); expect(engine.getVectorEdit()?.anchor).toBe(1);
    click(100, 100); expect(net().segments).toHaveLength(2); expect(engine.getUndoDepth()).toBe(depth + 1);
    click(0, 0); expect(net().regions).toHaveLength(1); expect(engine.getVectorEdit()?.anchor).toBeUndefined();
    click(100, 100); click(200, 150); expect(net().segments).toHaveLength(4); expect(net().regions).toHaveLength(1);
    expect(errors).toEqual([]);
  });
  it("replays smooth drags in captured coordinates without root or panel frame notifications", () => {
    const { engine, interaction, click, net, errors } = setup(); click(100, 0);
    const before = engine.getSnapshot().document, state = engine.getVectorEdit(), depth = engine.getUndoDepth();
    let root = 0, panels = 0; engine.subscribe(() => root++); engine.subscribeVectorEdit(() => panels++);
    interaction.down({ x: 150, y: 50 }, plain);
    for (let y = 51; y <= 80; y++) interaction.move({ x: 150, y }, plain);
    expect(net().vertices).toHaveLength(3); expect(net().segments[1].tb[1]).toBe(-30);
    expect(engine.getRenderVectorEdit()?.penOut).toEqual([0, 30]); expect(root).toBe(0); expect(panels).toBe(0);
    interaction.cancel(); expect(engine.getSnapshot().document).toBe(before); expect(engine.getVectorEdit()).toBe(state); expect(engine.getUndoDepth()).toBe(depth);
    interaction.down({ x: 150, y: 50 }, plain); interaction.move({ x: 150, y: 80 }, plain); interaction.up({ x: 150, y: 80 });
    expect(engine.getUndoDepth()).toBe(depth + 1); click(250, 50); expect(net().segments.at(-1)?.ta).toEqual([0, 30]);
    expect(errors).toEqual([]);
  });
  it("wobble below two screen pixels adds no handle and split ignores a large drag", () => {
    const { engine, interaction, click, net, errors } = setup(); click(100, 0);
    interaction.down({ x: 150, y: 50 }, plain); interaction.move({ x: 151, y: 50 }, plain); interaction.up({ x: 151, y: 50 });
    expect(net().vertices[2].mirror).toBeUndefined(); expect(engine.getVectorEdit()?.penOut).toBeUndefined();
    interaction.down({ x: 50, y: 0 }, plain); interaction.move({ x: 60, y: 100 }, plain); interaction.up({ x: 60, y: 100 });
    expect(engine.getVectorEdit()?.anchor).toBeUndefined(); expect(net().vertices).toHaveLength(4);
    expect(net().segments.at(-1)?.tb).toEqual([0, 0]); expect(errors).toEqual([]);
  });
  it("snaps new points unless Cmd suppresses objects, and Shift bypasses snap for 45-degree steps", () => {
    const { engine, click, net, errors } = setup(); click(100, 0); click(103, 100);
    expect(net().vertices[2].x).toBe(100);
    click(203.4, 200, { ...plain, metaKey: true }); expect(net().vertices[3].x).toBe(203);
    click(403, 220, { ...plain, shiftKey: true });
    expect(net().vertices[4].y).toBeCloseTo(200, 8); expect(net().vertices[4].x).toBeCloseTo(203 + Math.hypot(200, 20), 8);
    expect(engine.getVectorEdit()?.anchor).toBe(4); expect(errors).toEqual([]);
  });
  it("double-click removes an accidental isolated point or split and switches to Move", () => {
    for (const point of [{ x: 50, y: 0 }, { x: 150, y: 300 }]) {
      const { engine, interaction, click, net, errors } = setup(), before = engine.getSnapshot().document, depth = engine.getUndoDepth();
      click(point.x, point.y); click(point.x, point.y); interaction.doubleClick(point);
      expect(engine.getSnapshot().document).toBe(before); expect(net().vertices).toHaveLength(2);
      expect(engine.getUndoDepth()).toBe(depth); expect(engine.getVectorEdit()?.tool).toBe("move"); expect(errors).toEqual([]);
    }
  });
  it("double-click while continuing keeps its final point once", () => {
    const { engine, interaction, click, net, errors } = setup(); click(100, 0);
    click(200, 100); click(200, 100); interaction.doubleClick({ x: 200, y: 100 });
    expect(net().vertices).toHaveLength(3); expect(net().segments).toHaveLength(2);
    expect(engine.getVectorEdit()).toMatchObject({ tool: "move", anchor: undefined }); expect(errors).toEqual([]);
  });
  it("keeps the active layer while extending across another edited layer", () => {
    const { engine, interaction, id, errors } = setup(); engine.execute("vector.edit.end");
    const other = String(engine.execute("vector.create", { points: [[200, 100], [300, 100]], closed: false }).id);
    engine.execute("vector.edit.begin", { ids: [id, other] }); engine.execute("vector.edit.tool", { tool: "pen" });
    interaction.down({ x: 100, y: 0 }, plain); interaction.up({ x: 100, y: 0 });
    const untouched = engine.getSnapshot().document.nodes[other];
    interaction.down({ x: 200, y: 100 }, plain); interaction.up({ x: 200, y: 100 });
    expect(engine.getVectorEdit()?.id).toBe(id); expect(engine.getSnapshot().document.nodes[other]).toBe(untouched);
    expect((engine.getSnapshot().document.nodes[id] as VectorNode).network.vertices).toHaveLength(3); expect(errors).toEqual([]);
  });
  it("shows the native edit-mode band and segment ghost and clears them on cancellation", () => {
    const { interaction, click, errors } = setup(); click(100, 0);
    interaction.hover({ x: 150, y: 100 }, plain); expect(interaction.overlay.rubber).toEqual([{ x: 100, y: 0 }, { x: 150, y: 100 }]);
    interaction.hover({ x: 50, y: 0 }, plain); expect(interaction.overlay.add).toEqual({ point: { x: 50, y: 0 }, on: true });
    interaction.cancel(); expect(interaction.overlay.rubber).toBeUndefined(); expect(interaction.overlay.add).toBeUndefined(); expect(errors).toEqual([]);
  });
  it("reuses hover targets only for the same immutable document, edited layer and extra points", () => {
    const { engine, id } = setup(), cache = new PenSnapCache(), doc = engine.getSnapshot().document, points = [{ x: 10, y: 20 }];
    const first = cache.targets(doc, id, points);
    expect(cache.targets(doc, id, [{ x: 10, y: 20 }])).toBe(first);
    points[0].x = 11; const changed = cache.targets(doc, id, points); expect(changed).not.toBe(first);
    expect(cache.targets(doc, undefined, points)).not.toBe(changed);
    const latest = cache.targets(doc, id, points); engine.execute("node.set", { id, props: { name: "Changed" } });
    expect(cache.targets(engine.getSnapshot().document, id, points)).not.toBe(latest);
    cache.clear(); expect(cache.targets(doc, id, points)).not.toBe(latest);
  });
});
