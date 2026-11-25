import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { route } from "../../src/engine/board-commands";
import type { Connector } from "../../src/engine/board-data";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import native from "../fixtures/native-board-reshape.json" with { type: "json" };

// Reshaping connectors and joined shapes against native at bad07e44 (tests/fixtures/native-board-reshape.provenance.md), and native's
// board_reshape_tests.rs and board_connected_tests.rs restated.
function near(a: unknown, b: unknown, path = ""): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length ${a.length} ≠ ${b.length}` : a.map((x, i) => near(x, b[i], `${path}/${i}`)).find(Boolean);
  if (a && b && typeof a === "object" && typeof b === "object") return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`)).find(Boolean);
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}
type Node = Record<string, unknown> & { board?: { type: string }; kind: string };
const board = () => EditorEngine.newTab(undefined, {}, "board");
const idOf = (r: unknown) => (r as { id: number }).id;
/** The points connector `k` is drawn through, on the page. */
function drawn(e: EditorEngine, k: number) {
  const d = e.getSnapshot().document, n = d.nodes[String(k)] as unknown as { network: { vertices: { x: number; y: number }[]; segments: unknown[] } };
  const w = worldTransform(d, String(k));
  return n.network.vertices.map(v => { const p = transformPoint(w, v); return { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }; });
}
const connectorOf = (e: EditorEngine, k: number) => { const { type: _t, ...c } = (e.getSnapshot().document.nodes[String(k)] as unknown as { board: Connector & { type: string } }).board; void _t; return c as Connector; };
/** Native `joined`: shapes at (0, 0) and (300, 200), 100 square, joined by a connector of `style`. */
async function joined(style: string) {
  const e = board();
  const a = idOf(await e.executeAsync("board.shape", { x: 0, y: 0, width: 100, height: 100 }));
  const b = idOf(await e.executeAsync("board.shape", { x: 300, y: 200, width: 100, height: 100 }));
  const k = idOf(await e.executeAsync("board.connector", { from: a, to: b, style }));
  return { e, a, b, k };
}
const A = { x: 104, y: 50 }, B = { x: 296, y: 250 }, pt = (x: number, y: number) => ({ x, y });

describe("reshaping and joined shapes, as native does them", () => {
  it("replays native's run", async () => {
    const e = board();
    const cs = native.commands as unknown as [string, Record<string, unknown>][], rs = native.results as unknown as ({ receipt: unknown } | { error: string })[];
    for (const [i, [c, p]] of cs.slice(1).entries()) {
      const want = rs[i + 1];
      if ("error" in want) await expect(e.executeAsync(c, p), c).rejects.toThrow(want.error);
      else { const got = await e.executeAsync(c, p); if (c !== "node.set") expect(got, `${c} ${JSON.stringify(p)}`).toEqual(want.receipt); }
    }
    const want = (await decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(native.document)) }))).document, got = e.getSnapshot().document;
    const problems: string[] = [];
    for (const [id, w] of Object.entries(want.nodes) as unknown as [string, Node][]) {
      const g = got.nodes[id] as unknown as Node | undefined;
      if (!g) { problems.push(`node ${id} missing`); continue; }
      const keys = w.board?.type === "connector" ? ["board", "network", "x", "y", "width", "height", "stroke"] : w.board ? ["board", "x", "y", "width", "fill", "name"] : [];
      for (const k of keys) { const why = near(g[k], w[k], `node ${id}/${k}`); if (why) problems.push(why); }
    }
    expect(problems).toEqual([]);
  });

  it("moves a run, and the shape travels with what it joins", async () => {
    const { e, a, b, k } = await joined("elbow");
    expect(drawn(e, k)).toEqual([A, pt(200, 50), pt(200, 250), B]);
    await e.executeAsync("board.reshape", { id: k, portion: 1, x: 250, y: 170 });
    expect(drawn(e, k)).toEqual([A, pt(250, 50), pt(250, 250), B]);
    await e.executeAsync("select.set", { ids: [a, b] });
    await e.executeAsync("transform.nudge", { dx: 40, dy: 10 });
    expect(drawn(e, k)).toEqual([A, pt(250, 50), pt(250, 250), B].map(p => pt(p.x + 40, p.y + 10)));
    await e.executeAsync("edit.undo", {});
    await e.executeAsync("edit.undo", {});
    expect(drawn(e, k)).toEqual([A, pt(200, 50), pt(200, 250), B]);
    expect(connectorOf(e, k).path).toBeUndefined();
  });

  it("keeps the sides a reshaped connector left by, and gives first and last runs an extra run", async () => {
    const { e, a, b, k } = await joined("elbow");
    await e.executeAsync("board.reshape", { id: k, portion: 0, x: 150, y: 120 });
    expect(drawn(e, k)).toEqual([A, pt(128, 50), pt(128, 120), pt(200, 120), pt(200, 250), B]);
    const last = drawn(e, k).length - 2;
    await e.executeAsync("board.reshape", { id: k, portion: last, x: 250, y: 200 });
    expect(drawn(e, k)).toEqual([A, pt(128, 50), pt(128, 120), pt(200, 120), pt(200, 200), pt(272, 200), pt(272, 250), B]);
    const c = connectorOf(e, k);
    expect([c.from, c.to]).toEqual([{ node: String(a), side: "right" }, { node: String(b), side: "left" }]);
  });

  it("gives a lone run a run at each end", async () => {
    const e = board();
    const a = idOf(await e.executeAsync("board.shape", { x: 0, y: 0, width: 100, height: 100 }));
    const b = idOf(await e.executeAsync("board.shape", { x: 300, y: 0, width: 100, height: 100 }));
    const k = idOf(await e.executeAsync("board.connector", { from: a, to: b, style: "elbow" }));
    expect(drawn(e, k)).toHaveLength(2);
    await e.executeAsync("board.reshape", { id: k, portion: 0, x: 200, y: -40 });
    expect(drawn(e, k)).toEqual([pt(104, 50), pt(128, 50), pt(128, -40), pt(272, -40), pt(272, 50), pt(296, 50)]);
  });

  it("puts a curve's middle where it is dragged, keeping its bow as its ends move", async () => {
    const { e, a, b, k } = await joined("curved");
    await e.executeAsync("board.reshape", { id: k, portion: 0, x: 300, y: 40 });
    const middle = () => { const p = route(e.getSnapshot().document, connectorOf(e, k))!; return pt((p[0].x + 3 * (p[1].x + p[2].x) + p[3].x) / 8, (p[0].y + 3 * (p[1].y + p[2].y) + p[3].y) / 8); };
    expect(near(middle(), pt(300, 40))).toBeUndefined();
    await e.executeAsync("select.set", { ids: [a, b] });
    await e.executeAsync("transform.nudge", { dx: 20, dy: 0 });
    expect(near(middle(), pt(320, 40))).toBeUndefined();
    await e.executeAsync("board.reshape", { id: k, portion: 0, x: 200, y: 300 });
    expect(near(middle(), pt(200, 300))).toBeUndefined();
  });

  it("moves only a connector's portions, up to a limit of runs, and goes back to routing itself on a new style or end", async () => {
    const { e, a, b, k } = await joined("elbow");
    const before = connectorOf(e, k);
    for (const [id, portion] of [[k, 3], [k, -1], [k, 0.5], [k, 1e300], [a, 0]]) await expect(e.executeAsync("board.reshape", { id, portion, x: 10, y: 10 })).rejects.toThrow();
    for (const junk of [{ id: k }, { id: k, portion: "one", x: 0, y: 0 }]) await expect(e.executeAsync("board.reshape", junk)).rejects.toThrow();
    expect(connectorOf(e, k)).toEqual(before);
    let tries = 0;
    for (let i = 0; i < 80; i++) { try { await e.executeAsync("board.reshape", { id: k, portion: 0, x: 150, y: 60 + 3 * i }); tries++; } catch { /* the limit */ } }
    expect(tries >= 20 && tries < 40).toBe(true);
    expect(drawn(e, k).length).toBeLessThanOrEqual(66);
    const s = await joined("elbow");
    await s.e.executeAsync("board.reshape", { id: s.k, portion: 1, x: 250, y: 170 });
    await s.e.executeAsync("board.setStyle", { ids: [s.k], style: "curved" });
    expect(connectorOf(s.e, s.k).path).toBeUndefined();
    await s.e.executeAsync("board.reshape", { id: s.k, portion: 0, x: 300, y: 40 });
    expect(connectorOf(s.e, s.k).path).toBeDefined();
    await s.e.executeAsync("board.reattach", { id: s.k, end: "to", target: s.b, side: "top" });
    expect(connectorOf(s.e, s.k).path).toBeUndefined();
    void b;
    const straight = await joined("straight");
    await expect(straight.e.executeAsync("board.reshape", { id: straight.k, portion: 0, x: 10, y: 10 })).rejects.toThrow("no such portion");
  });
});
