import { newDocument, type DocumentNode, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { drawPen } from "../../src/engine/pen-overlay";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { drawVectorEdit } from "../../src/engine/vector-edit-overlay";

export async function measurePen(canvas: HTMLCanvasElement, operation: "hover" | "draw" | "edit") {
  const seed = new EditorEngine(), id = String(seed.execute("vector.create", { path: "M0 0C10 -5 30 -5 40 0L40 30L0 30Z" }).id);
  const template = seed.getSnapshot().document.nodes[id] as VectorNode, initial = newDocument();
  const nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2), x = i < 100 ? 40 + i % 10 * 90 : 10_000 + i, y = i < 100 ? 40 + Math.floor(i / 10) * 65 : 10_000;
    children.push(id); nodes[id] = i < 100 ? { ...template, id, x, y, transform: [1, 0, 0, 1, x, y] }
      : { id, parent: "1", kind: "rectangle", name: `Layer ${i}`, x, y, width: 40, height: 30, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const engine = new EditorEngine(); await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft({ ...initial, nodes }, "10002")) });
  engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 }); canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d")!, modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
  const edit = new VectorInteraction(engine, message => { throw new Error(message); });
  if (operation === "edit") { engine.execute("vector.edit.begin", { id: "2" }); engine.execute("vector.edit.tool", { tool: "pen" }); engine.execute("vector.edit.pen", { x: 40, y: 40 }); }
  else engine.execute("tool.pen");
  const before = engine.getSnapshot().document, state = engine.getVectorEdit();
  if (operation === "edit") edit.down({ x: 140, y: 730 }, modifiers);
  else { engine.pen.down({ x: 140, y: 730 }, modifiers); engine.pen.up(); engine.pen.down({ x: 220, y: 730 }, modifiers); if (operation === "hover") engine.pen.up(); }
  let rootNotifications = 0, chromeNotifications = 0; engine.subscribe(() => rootNotifications++); engine.subscribeVectorEdit(() => chromeNotifications++);
  const frames: number[] = [], inputs: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now(), point = { x: 240 + i % 20, y: 700 + i % 11 };
    if (operation === "edit") edit.move(point, modifiers); else if (operation === "draw") engine.pen.move(point); else engine.pen.hover(point, modifiers);
    const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView());
    if (operation === "edit") drawVectorEdit(context, engine.getRenderDocument(), engine.getRenderVectorEdit()!, engine.getView(), edit.overlay);
    else drawPen(context, engine.getRenderDocument(), engine.getView(), engine.pen.overlay);
    if (i >= 10) { inputs.push(input); frames.push(performance.now() - start); }
  }
  if (operation === "edit") edit.cancel(); else engine.pen.cancel(); frames.sort((a, b) => a - b); inputs.sort((a, b) => a - b);
  return { operation, nodes: Object.keys(before.nodes).length, visibleLayers: 100, measuredFrames: frames.length, rootNotifications, chromeNotifications,
    p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), inputP95: inputs[Math.floor(inputs.length * .95)], restored: engine.getRenderDocument() === before && engine.getVectorEdit() === state };
}
