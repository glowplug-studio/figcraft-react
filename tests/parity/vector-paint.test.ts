import { describe, expect, it } from "vitest";
import { identity, transformPoint } from "../../src/engine/affine";
import { rectanglePaints, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { worldTransform } from "../../src/engine/hierarchy";
import { paintVector } from "../../src/engine/vector-paint";
import { freezeNetwork } from "../../src/engine/vector-network";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { vectorFillContains } from "../../src/engine/vector-path";

const upper = { x: 75, y: 25 }, lower = { x: 25, y: 75 };
const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
function setup() {
  const e = new EditorEngine();
  const id = String(e.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100 }).id);
  e.execute("vector.edit.begin", { id });
  e.execute("vector.edit.connect", { a: 0, b: 2 });
  const node = () => e.getRenderDocument().nodes[id] as VectorNode;
  return { e, id, node };
}
describe("paint bucket commands and gestures", () => {
  it("splits a converted square and reuses the first valid action across a drag", () => {
    const { e, node } = setup(), before = e.getSnapshot().document;
    expect(e.execute("vector.edit.paint", { points: [[999, 999], ["75px", "25"], ["bad"], [75, 25]] })).toEqual({ filled: false });
    expect(vectorFillContains(node().network, upper)).toBe(false);
    expect(vectorFillContains(node().network, lower)).toBe(true);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
    expect(e.execute("vector.edit.paint", { points: [[75, 25], [25, 75]] })).toEqual({ filled: false });
    expect(node().network.regions).toHaveLength(0);
  });
  it("installs a visible default without making untouched faces visible", () => {
    const { e, node, id } = setup();
    e.execute("node.set", { id, props: { fills: [] } });
    expect(e.execute("vector.edit.paint", upper)).toEqual({ filled: true });
    expect(rectanglePaints(node())).toHaveLength(1);
    expect(node().fill).toBe("#d9d9d9");
    expect(node().network.regions.map(r => r.fills?.length)).toEqual([0, undefined]);
  });
  it("rejects missed and empty commands atomically and applies the page transform", () => {
    const { e, node, id } = setup();
    e.execute("node.set", { id, props: { x: 120, y: 85, rotation: 35 } });
    const before = e.getSnapshot().document, depth = e.getUndoDepth();
    for (const params of [{ points: [] }, { x: 999, y: -999 }]) expect(() => e.execute("vector.edit.paint", params)).toThrow(/closed area/);
    expect(e.getSnapshot().document).toBe(before); expect(e.getUndoDepth()).toBe(depth);
    const point = transformPoint(worldTransform(before, id), upper);
    expect(e.execute("vector.edit.paint", point)).toEqual({ filled: false });
    expect(vectorFillContains(node().network, upper)).toBe(false);
  });
  it("removes all copies of a face while preserving the neighbouring region's stack and paint frame", () => {
    const { node } = setup(), n = node(), source = n.network.regions[0];
    const paints = rectanglePaints(n), frame = { width: 160, height: 80, transform: identity };
    const network = freezeNetwork({ ...n.network, regions: [source, { ...source, fills: paints, paintSpace: frame }] });
    const result = paintVector({ ...n, network }, [upper])!;
    expect(result.filled).toBe(false);
    expect(result.node.network.regions).toHaveLength(2);
    expect(result.node.network.regions[0].fills).toBeUndefined();
    expect(result.node.network.regions[1]).toMatchObject({ fills: paints, paintSpace: frame });
    expect(vectorFillContains(result.node.network, upper)).toBe(false);
    const last = paintVector(result.node, [lower])!;
    expect(last.filled).toBe(false); expect(last.node.network.regions).toEqual([]);
  });
  it("selects the other edited layer by its enclosed area even without an edge hit", () => {
    const { e, id, node } = setup();
    const other = String(e.execute("shape.rectangle", { x: 200, y: 0, width: 100, height: 100 }).id);
    e.execute("vector.edit.begin", { ids: [id, other] }); e.execute("vector.edit.tool", { tool: "paint" });
    const interaction = new VectorInteraction(e, error => { throw Error(error); }), p = { x: 250, y: 50 };
    interaction.down(p, plain); interaction.up(p);
    expect(e.getVectorEdit()?.id).toBe(other);
    expect((e.getRenderDocument().nodes[other] as VectorNode).network.regions).toHaveLength(0);
    expect(vectorFillContains(node().network, upper)).toBe(true);
  });
  it("caps accepted command stamps at 10,000 and does not count malformed pairs", () => {
    const { e, node } = setup();
    const misses = Array.from({ length: 9999 }, () => [200, 300]);
    expect(e.execute("vector.edit.paint", { points: [null, ...misses, [75, 25], [25, 75]] })).toEqual({ filled: false });
    expect(vectorFillContains(node().network, lower)).toBe(true);
  });
  it("suppresses hover beyond the upstream segment limit", () => {
    const owner = new EditorEngine();
    const path = "M0 0H100V100H0Z " + "M110 0L110 1 ".repeat(2997);
    const other = String(owner.execute("vector.create", { x: 0, y: 0, path }).id);
    expect((owner.getRenderDocument().nodes[other] as VectorNode).network.segments).toHaveLength(3001);
    owner.execute("vector.edit.begin", { id: other }); owner.execute("vector.edit.tool", { tool: "paint" });
    const interaction = new VectorInteraction(owner, error => { throw Error(error); });
    interaction.hover(upper); expect(interaction.overlay.paintHover).toBeUndefined();
  });
  it("previews and cancels a pointer drag, then commits both faces in one undo", () => {
    const { e, node } = setup(), interaction = new VectorInteraction(e, error => { throw Error(error); });
    e.execute("vector.edit.tool", { tool: "paint" });
    const original = e.getSnapshot().document, depth = e.getUndoDepth();
    interaction.hover(upper); expect(interaction.overlay.paintHover?.face.area).toBeCloseTo(5000);
    let notifications = 0; e.subscribe(() => notifications++);
    for (const cancel of [true, false]) {
      interaction.down(upper, plain); expect(interaction.overlay.paintHover).toBeUndefined();
      expect(vectorFillContains(node().network, lower)).toBe(true);
      interaction.move(lower, plain); expect(node().network.regions).toHaveLength(0);
      expect(e.getSnapshot().document).toBe(original); expect(notifications).toBe(0);
      if (cancel) { interaction.cancel(); expect(e.getRenderDocument()).toBe(original); }
      else interaction.up(lower);
    }
    expect(e.getUndoDepth()).toBe(depth + 1);
    e.execute("edit.undo"); expect(e.getRenderDocument()).toBe(original);
  });
});
