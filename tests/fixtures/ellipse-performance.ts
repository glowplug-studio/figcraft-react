import { newDocument, type Document, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { ArcInteraction } from "../../src/engine/arc-handles";

export async function measureEllipses(canvas: HTMLCanvasElement) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2); children.push(id);
    nodes[id] = { id, parent: "1", kind: "ellipse", name: `Layer ${i}`, x: i < 100 ? i % 10 * 70 : 10_000 + i, y: i < 100 ? Math.floor(i / 10) * 60 : 10_000, width: 50, height: 60, start: 0, sweep: Math.PI * 1.5, inner: .5, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const document: Document = { ...initial, nodes }, engine = new EditorEngine(), ids = children.slice(0, 1);
  await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft(document, "10002")) });
  engine.execute("select.set", { ids }); engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d")!, move = new ArcInteraction(engine, message => { throw new Error(message); });
  if (!move.down({ x: 25, y: 10 })) throw new Error("Handle not found");
  let rootNotifications = 0; engine.subscribe(() => rootNotifications++);
  const measurements: number[] = [], inputs: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    move.move({ x: 25 + 25 * Math.cos(-1.5 + i / 120), y: 30 + 30 * Math.sin(-1.5 + i / 120) }, false);
    const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView()); move.draw(context);
    if (i >= 10) { inputs.push(input); measurements.push(performance.now() - start); }
  }
  const previewCount = Object.keys(engine.getRenderDocument().nodes).length, notifications = rootNotifications;
  move.cancel();
  const restored = engine.getRenderDocument() === engine.getSnapshot().document;
  engine.execute("tool.ellipse");
  const drawing = new DrawInteraction(engine, message => { throw new Error(message); }), drawTimes: number[] = [];
  drawing.down({ x: 750, y: 100 }); const drawNotifications = rootNotifications;
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now();
    drawing.move({ x: 850 + i, y: 220 }, { shiftKey: false, altKey: false, ctrlKey: true, metaKey: false });
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView());
    if (i >= 10) drawTimes.push(performance.now() - start);
  }
  const drawRootNotifications = rootNotifications - drawNotifications; drawing.cancel();
  measurements.sort((a, b) => a - b); inputs.sort((a, b) => a - b); drawTimes.sort((a, b) => a - b);
  return { ellipses: 9_999, selected: ids.length, previewCount, measuredFrames: measurements.length, p95: measurements[Math.floor(measurements.length * .95)], max: measurements.at(-1), inputP95: inputs[Math.floor(inputs.length * .95)], rootNotifications: notifications, restored: restored && engine.getRenderDocument() === engine.getSnapshot().document, drawP95: drawTimes[Math.floor(drawTimes.length * .95)], drawRootNotifications };
}
