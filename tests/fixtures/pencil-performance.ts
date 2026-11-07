import { newDocument, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";

export async function measurePencil(canvas: HTMLCanvasElement) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2), x = i < 100 ? 40 + i % 10 * 90 : 10_000 + i, y = i < 100 ? 40 + Math.floor(i / 10) * 65 : 10_000;
    children.push(id); nodes[id] = { id, parent: "1", kind: "rectangle", name: `Layer ${i}`, x, y, width: 40, height: 30, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const engine = new EditorEngine(); await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft({ ...initial, nodes }, "10002")) });
  engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 }); engine.execute("tool.pencil");
  canvas.width = 1200; canvas.height = 800; const context = canvas.getContext("2d")!, before = engine.getSnapshot().document;
  let rootNotifications = 0, chromeNotifications = 0; const offRoot = engine.subscribe(() => rootNotifications++), offChrome = engine.subscribeVectorEdit(() => chromeNotifications++);
  engine.pencil.down({ x: 100, y: 730 }, .25);
  const frames: number[] = [], inputs: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now(); engine.pencil.move({ x: 110 + i * 6, y: 730 + 20 * Math.sin(i / 12) }, .25 + i / 160);
    const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView()); engine.pencil.draw(context);
    if (i >= 10) { inputs.push(input); frames.push(performance.now() - start); }
  }
  engine.pencil.cancel(); const restored = engine.getRenderDocument() === before && !engine.interacting;
  offRoot(); offChrome(); frames.sort((a, b) => a - b); inputs.sort((a, b) => a - b);
  // Long, smooth runs exercise cubic candidates and software FMA, not only corner pass-through.
  const samples = 4001, point = (i: number) => ({ x: i, y: 730 + 10 * Math.sin(i / 500) });
  engine.pencil.down(point(0), .25);
  for (let i = 1; i < samples; i++) engine.pencil.move(point(i), .25 + .75 * i / (samples - 1));
  const start = performance.now(); engine.pencil.up(point(samples - 1), 1); const completionMs = performance.now() - start;
  const selected = engine.getSnapshot().document.nodes[engine.getSnapshot().selection[0]];
  return { nodes: Object.keys(before.nodes).length, visibleLayers: 100, measuredFrames: frames.length, rootNotifications, chromeNotifications, restored,
    p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), inputP95: inputs[Math.floor(inputs.length * .95)], samples, completionMs,
    completed: selected.kind === "vector" && selected.network.segments.some(s => s.ta[0] !== 0 || s.ta[1] !== 0), undoDepth: engine.getUndoDepth() };
}
