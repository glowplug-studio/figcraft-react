import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { shapeOrder, shapePadding, shapePath } from "../../src/engine/board-shapes";
import { lineShade, boardColour } from "../../src/engine/board-commands";
import { networkFromPath } from "../../src/engine/vector-network";
import { rectanglePaints } from "../../src/engine/document";
import native from "../fixtures/native-board-shapes.json" with { type: "json" };

// Stickies and shapes with text against native at bad07e44 (tests/fixtures/native-board-shapes.provenance.md): the 23 outlines at two sizes,
// two stickies, and native's refusals. Native's headless engine measures no text, so text heights (and the sticky and centring that follow
// from them) are left out; everything else about each layer is compared as native wrote it.
type Raw = Record<string, unknown> & { nodes: Record<string, Record<string, unknown>> };
const doc = native.document as unknown as Raw;
const commands = native.commands as unknown as [string, Record<string, unknown>][];
/** Two values equal, numbers to 32-bit float precision (native writes f32 fields with their shortest digits). */
function near(a: unknown, b: unknown, path = ""): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? undefined : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length ${a.length} ≠ ${b.length}` : a.map((x, i) => near(x, b[i], `${path}/${i}`)).find(Boolean);
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].map(k => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`)).find(Boolean);
  }
  return Object.is(a, b) ? undefined : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}
async function played() {
  const e = EditorEngine.newTab(undefined, {}, "board");
  const receipts: unknown[] = [];
  for (const [c, p] of commands.slice(1)) receipts.push(await e.executeAsync(c, p));
  const saved = JSON.parse(strFromU8(unzipSync(await encodeFigcraft(e.getSnapshot().document))["document.json"])) as Raw;
  return { e, receipts, saved };
}
const textual = (n: Record<string, unknown>) => n.type === "text";

describe("stickies and shapes with text, as native makes them", () => {
  it("returns native's receipts", async () => {
    const { receipts } = await played();
    expect(receipts).toEqual((native.receipts as unknown[]).slice(1).map(r => (r as { receipt: unknown }).receipt));
  });

  it("makes each layer as native does", async () => {
    const { e } = await played();
    // Both in the port's own form: native's file through the port's reader, and what the port's commands made.
    const want = (await decodeFigcraft(zipSync({ "document.json": strToU8(JSON.stringify(native.document)) }))).document;
    const got = e.getSnapshot().document;
    const problems: string[] = [];
    for (const [id, w] of Object.entries(want.nodes) as unknown as [string, Record<string, unknown>][]) {
      const g = got.nodes[id] as unknown as Record<string, unknown> | undefined;
      if (!g) { problems.push(`node ${id} missing`); continue; }
      const parent = w.parent != null ? want.nodes[String(w.parent)] as unknown as Record<string, unknown> : undefined;
      const inSticky = (parent?.board as { type?: string } | undefined)?.type === "sticky", sticky = (w.board as { type?: string } | undefined)?.type === "sticky";
      // Native's headless engine measures no text: a text's height, and where its frame centres it, are left out.
      const skip = new Set(w.kind === "text" ? ["height", "y"] : sticky ? ["height"] : []);
      void inSticky;
      // The reader spells two defaults out that a layer made in the port leaves unset: a container's pass-through blend and no fills.
      // Paints compared as the layer paints them (a single solid may be kept as `fill` alone).
      const unset = (k: string, v: unknown, n: Record<string, unknown>) => k === "fills" ? rectanglePaints(n as never) : v === undefined && k === "blend" && "children" in w ? "passThrough" : v;
      for (const key of new Set([...Object.keys(w), ...Object.keys(g)])) {
        if (skip.has(key)) continue;
        const why = near(unset(key, g[key], g), unset(key, w[key], w), `node ${id} (${String(w.name)})/${key}`);
        if (why) problems.push(why);
      }
    }
    expect(problems).toEqual([]);
  });

  it("draws the 23 outlines and pads their text as native does", () => {
    expect(shapeOrder).toHaveLength(23);
    for (const n of Object.values(doc.nodes)) {
      const b = n.board as { type?: string; shape?: string } | undefined;
      if (b?.type !== "shape") continue;
      const outline = doc.nodes[String((n.children as number[])[0])];
      const net = networkFromPath(shapePath(b.shape as never, n.width as number, n.height as number));
      expect(near(net, outline.network), `${b.shape} ${n.width}`).toBeUndefined();
      expect(near(shapePadding(b.shape as never, n.width as number, n.height as number), (n.layout as { padding: number[] }).padding)).toBeUndefined();
    }
    const yellow = boardColour("YELLOW")!, shade = lineShade(yellow);
    expect([shade.r, shade.g, shade.b]).toEqual([Math.fround(0.55), Math.fround(Math.fround(231 / 255) * 0.55), Math.fround(Math.fround(138 / 255) * 0.55)]);
    expect(lineShade({ r: 0.1, g: 0.2, b: 0.3, a: 1 })).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  });

  it("refuses as native refuses", async () => {
    const { commands: cs, results } = native.refusals as unknown as { commands: [string, Record<string, unknown>][]; results: ({ error: string } | { receipt: unknown })[] };
    const e = new EditorEngine();
    let board: EditorEngine = e;
    for (const [i, [c, p]] of cs.entries()) {
      const want = results[i];
      if (c === "file.newBoard") { board = EditorEngine.newTab(undefined, {}, "board"); continue; }
      if ("error" in want) await expect(board.executeAsync(c, p), c).rejects.toThrow(want.error);
      else expect(await board.executeAsync(c, p), c).toEqual(want.receipt);
    }
  });

  it("remembers a sticky's text size for new ones, and restyles a shape's outline and text", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const s = await e.executeAsync("board.sticky", { x: 0, y: 0, text: "One" }) as { id: number };
    await e.executeAsync("board.setStyle", { ids: [s.id], fontSize: 40 });
    const next = await e.executeAsync("board.nextSticky", { id: s.id, side: "below" }) as { id: number; text: number };
    const d = e.getSnapshot().document;
    expect((d.nodes[String(next.text)] as { text: { style: { fontSize: number } } }).text.style.fontSize).toBe(40);
    expect((d.nodes[String(next.id)] as { y: number }).y).toBe((d.nodes[String(s.id)] as { height: number }).height + 24);
    const sh = await e.executeAsync("board.shape", { shape: "rectangle", x: 0, y: 400, width: 200, height: 100 }) as { id: number };
    await e.executeAsync("board.setStyle", { ids: [sh.id], shape: "diamond" });
    e.execute("board.setColor", { ids: [sh.id], color: "green" });
    const d2 = e.getSnapshot().document, frame = d2.nodes[String(sh.id)] as unknown as { name: string; board: unknown; layout: { padding: number[] }; children: string[] };
    expect([frame.name, frame.board, frame.layout.padding]).toEqual(["Diamond", { type: "shape", shape: "diamond" }, [25, 50, 25, 50]]);
    const outline = d2.nodes[frame.children[0]] as unknown as { network: unknown; fill: string };
    expect(near(outline.network, networkFromPath(shapePath("diamond", 200, 100)))).toBeUndefined();
    expect(outline.fill).toBe("#c2e8a6");
  });

  it("keeps a resized shape's text inside its outline", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const sh = await e.executeAsync("board.shape", { shape: "ellipse", x: 0, y: 0 }) as { id: number };
    e.execute("node.set", { id: sh.id, props: { width: 300, height: 100 } });
    const frame = e.getSnapshot().document.nodes[String(sh.id)] as unknown as { layout: { padding: number[] } };
    expect(frame.layout.padding).toEqual(shapePadding("ellipse", 300, 100));
  });
});
