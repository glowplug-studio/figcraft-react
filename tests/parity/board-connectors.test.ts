import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import type { Document } from "../../src/engine/document";
import { endGap, routePoints, routeAlong, reshaped, type Box } from "../../src/engine/board-route";
import native from "../fixtures/native-board-connectors.json" with { type: "json" };

// Connectors against native at bad07e44 (tests/fixtures/native-board-connectors.provenance.md), and native's route tests
// (doc/src/board_route_tests.rs) restated. Labels are compared by their middles: native's headless engine measures no text, so a label's
// size differs; where it sits on its connector does not.
type Step = { command: string; params: Record<string, unknown>; result: { receipt?: unknown; error?: string } } | { save: number };
const steps = native.steps as unknown as Step[];
const decoded = (raw: unknown) => decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(raw)) })).then(d => d.document);
function near(a: unknown, b: unknown, path = "", tol = 1e-6): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length ${a.length} ≠ ${b.length}` : a.map((x, i) => near(x, b[i], `${path}/${i}`, tol)).find(Boolean);
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`, tol)).find(Boolean);
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}
type Node = Record<string, unknown> & { board?: { type: string }; x: number; y: number; width: number; height: number };
function compare(got: Document, want: Document) {
  const problems: string[] = [];
  for (const [id, w] of Object.entries(want.nodes) as unknown as [string, Node][]) {
    const g = got.nodes[id] as unknown as Node | undefined;
    if (!g) { problems.push(`node ${id} missing`); continue; }
    if (w.board?.type === "connector") for (const k of ["board", "network", "x", "y", "width", "height", "stroke", "strokes", "name"]) { const why = near(g[k], w[k], `node ${id}/${k}`); if (why) problems.push(why); }
    if (w.board?.type === "label") {
      const why = near([g.x + g.width / 2, g.y + g.height / 2], [w.x + w.width / 2, w.y + w.height / 2], `label ${id} middle`, 2e-3);
      if (why) problems.push(why);
      for (const k of ["board", "layout", "corners", "fill", "sizing"]) { const w2 = near(g[k], w[k], `label ${id}/${k}`); if (w2) problems.push(w2); }
    }
  }
  for (const id of Object.keys(got.nodes)) if (!want.nodes[id]) problems.push(`node ${id} is extra`);
  return problems;
}

describe("connectors, as native routes them", () => {
  it("makes, labels, reattaches and re-routes connectors as native does, and frees the ends of a deleted layer", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    for (const s of steps.slice(1)) {
      if ("save" in s) { expect(compare(e.getSnapshot().document, await decoded(native.documents[s.save])), `save ${s.save}`).toEqual([]); continue; }
      if (s.result.error) { await expect(e.executeAsync(s.command, s.params), s.command).rejects.toThrow(s.result.error); continue; }
      const got = await e.executeAsync(s.command, s.params);
      if (s.command !== "edit.delete" && s.command !== "node.set") expect(got, s.command).toEqual(s.result.receipt);
    }
  });

  it("refuses what a connector can't join", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const shape = async (x: number) => (await e.executeAsync("board.shape", { x, y: 0, width: 100, height: 100 }) as { id: number }).id;
    const a = await shape(0), b = await shape(300);
    const k = (await e.executeAsync("board.connector", { from: a, to: b, style: "elbow" }) as { id: number }).id;
    for (const p of [{ id: k, end: "to", target: a }, { id: k, end: "middle", target: b }, { id: k, end: "to" }, { id: a, end: "to", target: b },
      { id: k, end: "to", target: k }, { id: k, end: "to", target: { x: "a", y: 1 } }, { id: k, end: "to", target: b, side: "inside" }])
      await expect(e.executeAsync("board.reattach", p), JSON.stringify(p)).rejects.toThrow();
    await expect(e.executeAsync("board.connector", { from: a, to: a })).rejects.toThrow("connect two different layers");
    await expect(e.executeAsync("board.connector", { from: { x: 5, y: 5 }, to: { x: 5, y: 5 } })).rejects.toThrow("the ends are in the same place");
    await expect(new EditorEngine().executeAsync("board.reattach", { end: "to", target: { x: 0, y: 0 } })).rejects.toThrow("this is for boards");
  });
});

describe("routes, as native's route tests pin them", () => {
  const shape = (x: number, y: number): Box => ({ x0: x, y0: y, x1: x + 100, y1: y + 60 });
  it("starts an attached end outside the border", () => {
    const a = shape(0, 0), b = shape(300, 0);
    for (const routing of ["straight", "elbow", "curved"] as const) {
      const pts = routePoints({ box: a, side: "auto" }, { box: b, side: "auto" }, routing)!;
      expect(pts[0], routing).toEqual({ x: 100 + endGap, y: 30 });
      expect(pts.at(-1), routing).toEqual({ x: 300 - endGap, y: 30 });
    }
    expect(routePoints({ box: a, side: "bottom" }, { point: { x: 50, y: 200 } }, "straight")![0]).toEqual({ x: 50, y: 60 + endGap });
  });
  it("lets connectors from one side leave together", () => {
    const a = shape(0, 0), up = { box: shape(300, -200), side: "auto" as const }, down = { box: shape(300, 200), side: "auto" as const };
    for (const routing of ["elbow", "curved"] as const) {
      const p = routePoints({ box: a, side: "right" }, up, routing)!, q = routePoints({ box: a, side: "right" }, down, routing)!;
      expect(p[0]).toEqual(q[0]);
      expect(p[1].y).toBe(p[0].y);
      expect(q[1].y).toBe(q[0].y);
    }
  });
  it("keeps a hand-placed end's point", () => {
    const on = { x: 80, y: 60 };
    expect(routePoints({ box: shape(0, 0), side: "bottom", on }, { point: { x: 80, y: 200 } }, "straight")![0]).toEqual(on);
  });
  it("goes round the objects an elbow joins, and keeps a reshaped path", () => {
    // Bottom to bottom of two boxes side by side: under them, not through them.
    const a = shape(0, 0), b = shape(300, 0);
    const pts = routePoints({ box: a, side: "bottom" }, { box: b, side: "bottom" }, "elbow")!;
    expect(pts.every(p => !(p.y > 0.5 && p.y < 59.5 && ((p.x > 0.5 && p.x < 99.5) || (p.x > 300.5 && p.x < 399.5))))).toBe(true);
    // Face to face the route is one run: dragged down, it keeps its ends through stubs and a run where it was dropped.
    const path = reshaped({ box: a, side: "auto" }, { box: b, side: "auto" }, "elbow", undefined, 0, { x: 200, y: 100 });
    expect(path && "runs" in path && path.runs.across).toBe(true);
    const along = routeAlong({ box: a, side: "auto" }, { box: b, side: "auto" }, "elbow", path)!;
    expect([along[0], along.at(-1)]).toEqual([{ x: 104, y: 30 }, { x: 296, y: 30 }]);
    expect(along.some(p => p.y === 100)).toBe(true);
    expect(reshaped({ box: a, side: "auto" }, { box: b, side: "auto" }, "straight", undefined, 0, { x: 0, y: 0 })).toBeUndefined();
  });
});
