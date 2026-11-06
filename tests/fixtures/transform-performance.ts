import { newDocument, type Document, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { TransformInteraction } from "../../src/engine/transform-interaction";

export async function measureTransform(canvas: HTMLCanvasElement, scale: boolean) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2); children.push(id);
    nodes[id] = { id, parent: "1", kind: "rectangle", name: `Layer ${i}`, x: i < 100 ? i % 10 * 70 : 10_000 + i, y: i < 100 ? Math.floor(i / 10) * 60 : 10_000, width: 50, height: 40, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const document: Document = { ...initial, nodes }, engine = new EditorEngine(), ids = children.slice(0, 100);
  await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft(document, "10002")) });
  engine.execute("select.set", { ids }); engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  if (scale) engine.execute("tool.scale");
  canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d")!, move = new TransformInteraction(engine, message => { throw new Error(message); });
  const modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  if (!move.down({ x: 680, y: 580 })) throw new Error("Handle not found");
  let rootNotifications = 0; engine.subscribe(() => rootNotifications++);
  const measurements: number[] = [], inputs: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    move.move({ x: 730 + i % 30, y: 630 + i % 10 }, modifiers);
    const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView()); move.draw(context);
    if (i >= 10) { inputs.push(input); measurements.push(performance.now() - start); }
  }
  const previewCount = Object.keys(engine.getRenderDocument().nodes).length, notifications = rootNotifications;
  move.cancel();
  measurements.sort((a, b) => a - b); inputs.sort((a, b) => a - b);
  return { rectangles: 9_999, selected: ids.length, scale, previewCount, measuredFrames: measurements.length, p95: measurements[Math.floor(measurements.length * .95)], max: measurements.at(-1), inputP95: inputs[Math.floor(inputs.length * .95)], rootNotifications: notifications, restored: engine.getRenderDocument() === engine.getSnapshot().document };
}
