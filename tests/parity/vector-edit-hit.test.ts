import { describe, expect, it } from "vitest";
import type { Affine } from "../../src/engine/affine";
import { cubicPoint, type Cubic } from "../../src/engine/cubic";
import { nearestCubic } from "../../src/engine/cubic-nearest";
import type { Document, VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { newVectorEdit, selectVectorParts } from "../../src/engine/vector-edit";
import { hitEditedVectors, hitVector } from "../../src/engine/vector-edit-hit";
import { freezeNetwork, type VectorNetwork } from "../../src/engine/vector-network";

function fixture(network: VectorNetwork, transform: Affine = [1, 0, 0, 1, 0, 0]) {
  const e = new EditorEngine(), id = String(e.execute("vector.create", { points: [[0, 0], [100, 0]], closed: false }).id);
  const before = e.getSnapshot().document, node = before.nodes[id] as VectorNode;
  const document: Document = { ...before, nodes: { ...before.nodes, [id]: { ...node, transform, network: freezeNetwork(network) } } };
  return { document, id, state: newVectorEdit(id) };
}
const line: VectorNetwork = { vertices: [{ x: 0, y: 0, radius: 0 }, { x: 100, y: 0, radius: 0 }], segments: [{ a: 0, b: 1, ta: [0, 0], tb: [0, 0] }], regions: [] };

describe("cubic nearest point", () => {
  it("retains cubic line parameterisation, endpoint minima and constant curves", () => {
    const c: Cubic = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }];
    const near = nearestCubic(c, { x: 15.625, y: 7 })!;
    expect(near.t).toBeCloseTo(.25, 12); expect(near.distance).toBeCloseTo(7, 12);
    expect(nearestCubic(c, { x: -5, y: 0 })).toEqual({ t: 0, distance: 5 });
    expect(nearestCubic(c, { x: 105, y: 0 })).toEqual({ t: 1, distance: 5 });
    expect(nearestCubic([c[0], c[0], c[0], c[0]], { x: 3, y: 4 })).toEqual({ t: 0, distance: 5 });
  });
  it("finds interior minima on curved and looping paths against independent dense distances", () => {
    const curves: Cubic[] = [
      [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }],
      [{ x: 0, y: 0 }, { x: 220, y: 200 }, { x: -180, y: 200 }, { x: 30, y: 0 }],
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -100, y: 0 }, { x: 0, y: 0 }],
    ];
    for (const c of curves) for (const p of [{ x: 15, y: 30 }, { x: 50, y: 70 }, { x: 0, y: 120 }, { x: -30, y: 0 }]) {
      const near = nearestCubic(c, p)!; let sampled = Infinity;
      for (let i = 0; i <= 10_000; i++) { const q = cubicPoint(c, i / 10_000); sampled = Math.min(sampled, Math.hypot(q.x - p.x, q.y - p.y)); }
      expect(near.distance).toBeLessThanOrEqual(sampled + 1e-8);
      const q = cubicPoint(c, near.t); expect(near.distance).toBeCloseTo(Math.hypot(q.x - p.x, q.y - p.y), 9);
    }
    expect(nearestCubic(curves[0], { x: 50, y: 80 })?.t).toBeCloseTo(.5, 12);
  });
  it("handles cusps, tiny curves, extreme finite coordinates and rejects non-finite inputs", () => {
    const cusp: Cubic = [{ x: 1, y: 0 }, { x: -1 / 3, y: 0 }, { x: -1 / 3, y: 0 }, { x: 1, y: 0 }];
    expect(nearestCubic(cusp, { x: 0, y: 1 })?.t).toBeCloseTo(.5, 7);
    for (const scale of [1e-150, 1e150]) {
      const c: Cubic = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: scale, y: 0 }, { x: scale, y: 0 }];
      const near = nearestCubic(c, { x: scale / 2, y: scale / 4 })!;
      expect(near.t).toBeCloseTo(.5, 12); expect(near.distance / scale).toBeCloseTo(.25, 12);
    }
    const extreme: Cubic = [{ x: -1e308, y: 0 }, { x: -1e308, y: 0 }, { x: 1e308, y: 0 }, { x: 1e308, y: 0 }];
    expect(nearestCubic(extreme, { x: 1e308, y: 1 })?.t).toBe(1);
    expect(nearestCubic(cusp, { x: Infinity, y: 0 })).toBeUndefined();
  });
});

describe("native vector hit priority", () => {
  it("compares visible handles and vertices on the page under non-uniform scale", () => {
    // vectoredit/tests.rs::a_handle_and_a_point_are_compared_on_the_page.
    const f = fixture({ ...line, vertices: [{ x: 0, y: 0, radius: 0 }, { x: 5, y: 0, radius: 0 }], segments: [{ ...line.segments[0], ta: [.5, -.9] }] }, [10, 0, 0, 1, 0, 0]);
    const state = selectVectorParts(f.document, f.state, { vertices: [0] });
    expect(hitVector(f.document, state, { x: 4, y: 0 }, 6)).toEqual({ kind: "handle", seg: 0, start: true });
    expect(hitVector(f.document, state, { x: 0, y: 0 }, 6)).toEqual({ kind: "vertex", index: 0 });
  });
  it("lets a short handle retain its anchor and gives the handle a coincident-point tie", () => {
    // Native #1875 short_handles_leave_their_point_clickable and handle-on-point fixtures.
    const f = fixture({ ...line, segments: [{ ...line.segments[0], ta: [4, 0] }] });
    const state = selectVectorParts(f.document, f.state, { vertices: [0] });
    expect(hitVector(f.document, state, { x: 0, y: 0 }, 6)).toEqual({ kind: "vertex", index: 0 });
    expect(hitVector(f.document, state, { x: 4, y: 0 }, 6)).toEqual({ kind: "handle", seg: 0, start: true });
    const g = fixture({ ...line, segments: [{ ...line.segments[0], ta: [100, 0] }] });
    expect(hitVector(g.document, { ...g.state, vertices: [0] }, { x: 100, y: 0 }, 6)).toEqual({ kind: "handle", seg: 0, start: true });
  });
  it("hides unselected and region-only handles; selected segments reveal both ends", () => {
    const f = fixture({ ...line, segments: [{ ...line.segments[0], ta: [20, 30], tb: [-20, 30] }] });
    expect(hitVector(f.document, f.state, { x: 20, y: 30 }, 1)?.kind).not.toBe("handle");
    expect(hitVector(f.document, { ...f.state, vertices: [0], regionVertices: [0] }, { x: 20, y: 30 }, 1)?.kind).not.toBe("handle");
    for (const [x, start] of [[20, true], [80, false]] as const) expect(hitVector(f.document, { ...f.state, segments: [0] }, { x, y: 30 }, 1)).toEqual({ kind: "handle", seg: 0, start });
  });
  it("returns precise segment parameters after point tests and preserves same-kind order", () => {
    const f = fixture({ ...line, segments: [line.segments[0], line.segments[0]] });
    const hit = hitVector(f.document, f.state, { x: 15.625, y: 2 }, 3);
    expect(hit).toMatchObject({ kind: "segment", seg: 0 }); if (hit?.kind === "segment") expect(hit.t).toBeCloseTo(.25, 12);
    expect(hitVector(f.document, f.state, { x: 50, y: 4 }, 3)).toBeUndefined();
    expect(hitVector(f.document, f.state, { x: 0, y: 0 }, 3)).toEqual({ kind: "vertex", index: 0 });
  });
  it("prioritises the active layer, then other layers with their own selected handles", () => {
    const e = new EditorEngine(); const ids = [0, 1].map(() => String(e.execute("vector.create", { path: "M0 0C20 30 80 30 100 0" }).id));
    const d = e.getSnapshot().document, state = { ...newVectorEdit(ids[0], [ids[1]]), others: [{ id: ids[1], vertices: [0], segments: [] }] };
    expect(hitEditedVectors(d, state, { x: 0, y: 0 }, 1)?.id).toBe(ids[0]);
    expect(hitEditedVectors(d, state, { x: 20, y: 30 }, 1)).toEqual({ id: ids[1], hit: { kind: "handle", seg: 0, start: true } });
  });
  it("returns no hit for singular transforms or invalid input without throwing", () => {
    const f = fixture(line, [0, 0, 0, 1, 0, 0]);
    expect(hitVector(f.document, f.state, { x: 0, y: 0 }, 6)).toBeUndefined();
    const g = fixture(line);
    expect(hitVector(g.document, g.state, { x: NaN, y: 0 }, 6)).toBeUndefined();
    expect(hitVector(g.document, g.state, { x: 0, y: 0 }, -1)).toBeUndefined();
  });
});
