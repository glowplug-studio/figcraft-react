import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { inverse, multiply, type Affine } from "../../src/engine/affine";
import { colour } from "../../src/engine/colour";
import { withLayerTransform, withRectanglePaints, rectanglePaints, type Document, type DocumentNode, type NodeId } from "../../src/engine/document";
import { worldTransform } from "../../src/engine/hierarchy";
import { matchLayers, namePath, smartInterpolate, transitionFrames } from "../../src/engine/prototype-transitions";
import { reversedTransition } from "../../src/engine/prototype-model";
import { solidPaint } from "../../src/engine/solid-paint";
import { boundsOf } from "../../src/engine/viewport";

// Restated from native ui-egui/src/present/tests.rs at bad07e44 (matching_by_name_path, smart_interpolate_tweens_matched_and_fades_the_rest,
// transitions_move_the_right_way).
const id = (v: unknown) => String((v as { id: unknown }).id);
function twoFrames() {
  const e = new EditorEngine();
  const a = id(e.execute("frame.create", { x: 0, y: 0, width: 200, height: 400, name: "A" }));
  const b = id(e.execute("frame.create", { x: 300, y: 0, width: 200, height: 400, name: "B" }));
  return { e, a, b };
}
const rect = (e: EditorEngine, parent: NodeId, name: string, x: number, y: number, w: number, h: number) => id(e.execute("shape.rectangle", { x, y, width: w, height: h, parent: Number(parent), props: { name } }));

describe("prototype transitions, as native's tests pin them", () => {
  it("matches layers by their name path", () => {
    const { e, a, b } = twoFrames();
    const ga = id(e.execute("frame.create", { x: 0, y: 0, width: 10, height: 10, parent: Number(a), name: "Card" }));
    const ra = rect(e, ga, "Box", 0, 0, 10, 10), ra2 = rect(e, ga, "Box", 0, 0, 10, 10);
    const onlyA = rect(e, a, "Gone", 0, 0, 10, 10);
    const gb = id(e.execute("frame.create", { x: 0, y: 0, width: 10, height: 10, parent: Number(b), name: "Card" }));
    const rb = rect(e, gb, "Box", 0, 0, 10, 10), rb2 = rect(e, gb, "Box", 0, 0, 10, 10);
    rect(e, b, "Box", 0, 0, 10, 10);
    const d = e.getSnapshot().document, m = matchLayers(d, a, d, b);
    expect(m).toEqual([[ga, gb], [ra, rb], [ra2, rb2]]);
    expect(m.some(([f]) => f === onlyA)).toBe(false);
    expect(namePath(d, a, ra)).toBe("Card\u001fBox");
    expect(namePath(d, b, ra)).toBeUndefined();
  });

  it("tweens matched layers and fades the rest", () => {
    const { e, a, b } = twoFrames();
    const ra = rect(e, a, "Box", 0, 0, 20, 20), rb = rect(e, b, "Box", 100, 200, 60, 40);
    const onlyB = rect(e, b, "New", 0, 0, 5, 5), onlyA = rect(e, a, "Old", 0, 0, 5, 5);
    let d = e.getSnapshot().document;
    const set = (doc: Document, n: NodeId, f: (x: DocumentNode) => DocumentNode): Document => ({ ...doc, nodes: { ...doc.nodes, [n]: f(doc.nodes[n]) } });
    d = set(d, ra, n => ({ ...(withRectanglePaints(n as never, [solidPaint(colour(1, 0, 0, 1))]) as DocumentNode), corners: { radii: [0, 0, 0, 0], smoothing: 0 }, opacity: 1 }) as DocumentNode);
    // B's box rotated 90° about its centre (130, 220) in B.
    const c = Math.PI / 2, rot: Affine = multiply(multiply([1, 0, 0, 1, 130, 220], [Math.cos(c), Math.sin(c), -Math.sin(c), Math.cos(c), 0, 0]), [1, 0, 0, 1, -30, -20]);
    d = set(d, rb, n => ({ ...(withLayerTransform(withRectanglePaints(n as never, [solidPaint(colour(0, 0, 1, 1))]) as never, rot) as DocumentNode), corners: { radii: [20, 20, 20, 20], smoothing: 0 }, opacity: 0.5 }) as DocumentNode);
    const mid = smartInterpolate(d, a, d, b, 0.5), n = mid.nodes[rb] as DocumentNode & { width: number; height: number; opacity: number; corners: { radii: number[] } };
    expect(Math.abs(n.width - 40) < 1e-9 && Math.abs(n.height - 30) < 1e-9).toBe(true);
    expect(Math.abs(n.opacity - 0.75)).toBeLessThan(1e-6);
    expect(Math.abs(n.corners.radii[0] - 10)).toBeLessThan(1e-9);
    const fill = rectanglePaints(n as never)[0];
    expect(fill.type === "solid" && Math.abs(fill.color.r - 0.5) < 0.02 && Math.abs(fill.color.b - 0.5) < 0.02).toBe(true);
    const m = multiply(inverse(worldTransform(mid, b)), worldTransform(mid, rb));
    const ctr = { x: m[0] * n.width / 2 + m[2] * n.height / 2 + m[4], y: m[1] * n.width / 2 + m[3] * n.height / 2 + m[5] };
    expect(Math.abs(ctr.x - 70) < 1e-6 && Math.abs(ctr.y - 115) < 1e-6).toBe(true);
    const own = (n as unknown as { transform: Affine }).transform;
    expect(Math.abs(Math.atan2(own[1], own[0]) - Math.PI / 4)).toBeLessThan(1e-6);
    expect(Math.abs(((mid.nodes[onlyB] as { opacity: number }).opacity) - 0.5)).toBeLessThan(1e-6);
    const copies = (mid.nodes[b] as { children: readonly NodeId[] }).children.map(k => mid.nodes[k]).filter(x => x.name === "Old");
    expect(copies.length).toBe(1);
    expect(Math.abs((copies[0] as { opacity: number }).opacity - 0.5)).toBeLessThan(1e-6);
    expect(copies[0].id).not.toBe(onlyA);
    const end = smartInterpolate(d, a, d, b, 1);
    expect(end.nodes[rb]).toEqual(d.nodes[rb]);
    expect((end.nodes[b] as { children: unknown }).children).toEqual((d.nodes[b] as { children: unknown }).children);
    const start = smartInterpolate(d, a, d, b, 0), s = boundsOf(start, [rb])!, f = boundsOf(start, [b])!;
    expect(Math.abs(s.x - f.x) < 1e-6 && Math.abs(s.y - f.y) < 1e-6 && Math.abs(s.width - 20) < 1e-6).toBe(true);
  });

  it("moves frames the right way", () => {
    expect(transitionFrames({ type: "moveIn", direction: "left" }, 0).toOff.map(v => v + 0)).toEqual([1, 0]);
    expect(transitionFrames({ type: "moveIn", direction: "left" }, 1).toOff.map(Math.abs)).toEqual([0, 0]);
    const push = transitionFrames({ type: "push", direction: "top" }, 0.5);
    expect(push.fromOff.map(v => v + 0)).toEqual([0, -0.5]);
    expect(push.toOff.map(v => v + 0)).toEqual([0, 0.5]);
    const out = transitionFrames({ type: "moveOut", direction: "right" }, 0.25);
    expect(out.fromOnTop).toBe(true);
    expect(out.fromOff.map(v => v + 0)).toEqual([0.25, 0]);
    expect(transitionFrames({ type: "dissolve" }, 0.3).toAlpha).toBe(0.3);
    expect(transitionFrames({ type: "instant" }, 0).fromAlpha).toBe(0);
    expect(reversedTransition({ type: "slideIn", direction: "bottom" })).toEqual({ type: "slideOut", direction: "top" });
  });
});
