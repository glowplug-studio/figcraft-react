import { newDocument, type Document, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { SmartHandles } from "../../src/engine/smart-handles";

export async function measureSmartSelection(canvas: HTMLCanvasElement) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2); children.push(id);
    nodes[id] = { id, parent: "1", kind: "rectangle", name: `Layer ${i}`, x: i < 100 ? i % 10 * 70 : 10_000 + i, y: i < 100 ? Math.floor(i / 10) * 60 : 10_000, width: 50, height: 40, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const document: Document = { ...initial, nodes }, engine = new EditorEngine(), ids = children.slice(0, 100);
  await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft(document, "10002")) });
  engine.execute("select.set", { ids }); engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d")!, handles = new SmartHandles(engine, message => { throw new Error(message); });
  handles.hover({ x: 300, y: 300 }, { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
  let rootNotifications = 0; engine.subscribe(() => rootNotifications++);
  const measurements: number[] = [], inputs: number[] = [];
  engine.beginInteraction();
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    engine.execute("arrange.spacing", { ids, horizontal: 20 + i % 20, fromGesture: true });
    const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, ids, undefined, engine.getView()); handles.draw(context);
    if (i >= 10) { inputs.push(input); measurements.push(performance.now() - start); }
  }
  const notificationsDuringDrag = rootNotifications;
  engine.cancelInteraction();
  measurements.sort((a, b) => a - b); inputs.sort((a, b) => a - b);
  return { rectangles: 9_999, selected: 100, measuredFrames: measurements.length, p95: measurements[Math.floor(measurements.length * .95)], max: measurements.at(-1), inputP95: inputs[Math.floor(inputs.length * .95)], rootNotifications: notificationsDuringDrag, restored: engine.getRenderDocument() === engine.getSnapshot().document };
}
