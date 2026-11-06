import { newDocument, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { CornerInteraction } from "../../src/engine/corner-handles";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { starPoints } from "../../src/engine/polygon";

export async function measurePointShapes(canvas: HTMLCanvasElement) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2); children.push(id);
    const common = { id, parent: "1", name: `Layer ${i}`, x: i < 100 ? i % 10 * 70 : 10_000 + i, y: i < 100 ? Math.floor(i / 10) * 60 : 10_000, width: 60, height: 50, fill: "#d9d9d9", corners: { radii: [2, 2, 2, 2] as const, smoothing: .6 } };
    nodes[id] = i % 2 ? { ...common, kind: "polygon", count: 6 } : { ...common, kind: "star", count: 5, innerRatio: .38 };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const engine = new EditorEngine(); await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft({ ...initial, nodes }, "10002")) });
  engine.execute("select.set", { ids: ["2"] }); engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800; const context = canvas.getContext("2d")!;
  const fail = (message: string) => { throw new Error(message); }, handle = new CornerInteraction(engine, fail);
  if (!handle.down(starPoints(60, 50, 5, .38)[1])) throw new Error("Star ratio handle not found");
  let notifications = 0; engine.subscribe(() => notifications++);
  const inputs: number[] = [], frames: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now();
    handle.move(starPoints(60, 50, 5, .3 + i / 300)[1], false); const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView()); handle.draw(context);
    if (i >= 10) { inputs.push(input); frames.push(performance.now() - start); }
  }
  const rootNotifications = notifications; handle.cancel(); const restored = engine.getRenderDocument() === engine.getSnapshot().document;
  engine.execute("tool.polygon"); const drawing = new DrawInteraction(engine, fail), drawTimes: number[] = []; drawing.down({ x: 750, y: 100 }); const before = notifications;
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now();
    drawing.move({ x: 850 + i, y: 220 }, { shiftKey: false, altKey: false, ctrlKey: true, metaKey: false });
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView());
    if (i >= 10) drawTimes.push(performance.now() - start);
  }
  const drawRootNotifications = notifications - before; drawing.cancel();
  const p95 = (times: number[]) => times.sort((a, b) => a - b)[Math.floor(times.length * .95)];
  return { nodes: Object.keys(engine.getRenderDocument().nodes).length, measuredFrames: frames.length, p95: p95(frames), max: frames.at(-1), inputP95: p95(inputs), rootNotifications, drawP95: p95(drawTimes), drawRootNotifications, restored: restored && engine.getRenderDocument() === engine.getSnapshot().document };
}
