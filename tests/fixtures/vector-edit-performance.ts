import { newDocument, type Document, type DocumentNode, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { drawVectorEdit } from "../../src/engine/vector-edit-overlay";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { widthHandles } from "../../src/engine/vector-width";
import { pointBoxCentre, pointBoxCorners, shownVectorPointBox } from "../../src/engine/vector-point-transform";

export async function measureVectorEdit(canvas: HTMLCanvasElement, operation: "move" | "scale" | "rotate" | "width" | "paint" | "region" = "move") {
  const seed = new EditorEngine(), id = String(seed.execute("vector.create", { path: "M0 0C10 -5 30 -5 40 0L40 30L0 30Z" }).id);
  const template = seed.getSnapshot().document.nodes[id] as VectorNode;
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2), x = i < 100 ? 40 + i % 10 * 90 : 10_000 + i, y = i < 100 ? 40 + Math.floor(i / 10) * 65 : 10_000;
    children.push(id);
    nodes[id] = i < 100 ? { ...template, id, parent: "1", x, y, transform: [1, 0, 0, 1, x, y] } : { id, parent: "1", kind: "rectangle", name: `Layer ${i}`, x, y, width: 40, height: 30, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const document: Document = { ...initial, nodes }, engine = new EditorEngine();
  await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft(document, "10002")) });
  engine.execute("vector.edit.begin", { ids: children.slice(0, 100) });
  engine.updateVectorSelection(s => ({ ...s, vertices: [0], others: s.others.map(p => ({ ...p, vertices: [0] })) }));
  engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d")!, interaction = new VectorInteraction(engine, message => { throw new Error(message); });
  const modifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  const box = shownVectorPointBox(engine.getSnapshot().document, engine.getVectorEdit()!)!, corners = pointBoxCorners(box), centre = pointBoxCentre(box);
  let widthStart;
  if (operation === "width") {
    const active = engine.getVectorEdit()!.id;
    engine.execute("node.set", { id: active, props: { strokes: ["#333"], strokeWeight: 8 } });
    engine.execute("vector.edit.tool", { tool: "width" }); engine.execute("vector.edit.widthPoint", { t: .5, width: 40 });
    const [x, y] = widthHandles(engine.getRenderDocument(), active, 1)[1].sides[0];
    widthStart = { x, y };
  }
  if (operation === "paint") engine.execute("vector.edit.tool", { tool: "paint" });
  if (operation === "region") {
    engine.execute("vector.edit.select", { regions: [0], add: true });
  }
  const paintStart = operation === "paint" || operation === "region" ? { x: 55, y: 55 } : undefined;
  const startPoint = paintStart ?? widthStart ?? (operation === "move" ? { x: 40, y: 40 } : operation === "scale" ? { x: corners[1].x, y: centre.y } : { x: corners[1].x + 10, y: corners[1].y - 10 });
  if (operation === "paint") {
    interaction.hover(startPoint);
    if (!interaction.overlay.paintHover) throw Error("Paint hover missed the active face");
    drawVectorEdit(context, engine.getRenderDocument(), engine.getRenderVectorEdit()!, engine.getView(), interaction.overlay);
  }
  if (operation === "region") {
    interaction.hover(startPoint);
    if (engine.getVectorEdit()?.regionHover !== 0) throw Error("Region hover missed the active region");
  }
  interaction.down(startPoint, modifiers);
  const before = engine.getSnapshot().document, state = engine.getVectorEdit(); let rootNotifications = 0, chromeNotifications = 0;
  engine.subscribe(() => rootNotifications++); engine.subscribeVectorEdit(() => chromeNotifications++);
  const measurements: number[] = [], inputs: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    interaction.move(operation === "paint" ? { x: 54 + i % 11, y: 52 + i % 7 } : operation === "move" ? { x: 20 + i % 10, y: 20 + i % 8 } : { x: startPoint.x + 20 + i % 10, y: startPoint.y + 20 + i % 8 }, modifiers); const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView());
    drawVectorEdit(context, engine.getRenderDocument(), engine.getRenderVectorEdit()!, engine.getView(), interaction.overlay);
    if (i >= 10) { inputs.push(input); measurements.push(performance.now() - start); }
  }
  if (operation === "width" && (engine.getRenderDocument().nodes[engine.getVectorEdit()!.id] as VectorNode).stroke?.widthProfile?.points[1]?.scale === 5) throw new Error("Width gesture did not resize the stroke");
  if (operation === "paint" && (engine.getRenderDocument().nodes[engine.getVectorEdit()!.id] as VectorNode).network.regions.length) throw Error("Paint gesture did not unfill the face");
  if (operation === "region" && (engine.getRenderVectorEdit()?.regions[0] !== 0 || engine.getRenderDocument() === before)) throw Error("Region drag did not move selected points");
  interaction.cancel();
  const restored = engine.getRenderDocument() === before && engine.getRenderVectorEdit() === state;
  measurements.sort((a, b) => a - b); inputs.sort((a, b) => a - b);
  const hoverPan: number[] = [];
  if (operation === "paint" || operation === "region") {
    for (let i = 0; i < 120; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const start = performance.now();
      interaction.hover({ x: 54 + i % 11, y: 52 + i % 7 });
      const view = { ...engine.getView(), cx: 600 + i / 3, cy: 400 + i / 5 };
      renderDocument(context, engine.getRenderDocument(), 1200, 800, [], undefined, view);
      drawVectorEdit(context, engine.getRenderDocument(), engine.getRenderVectorEdit()!, view, interaction.overlay);
      if (i >= 10) hoverPan.push(performance.now() - start);
    }
    hoverPan.sort((a, b) => a - b);
  }
  return { operation, nodes: Object.keys(before.nodes).length, visibleEditedLayers: 100, selectedPoints: (state?.vertices.length ?? 0) + (state?.others.reduce((n, p) => n + p.vertices.length, 0) ?? 0), measuredFrames: measurements.length,
    p95: measurements[Math.floor(measurements.length * .95)], max: measurements.at(-1), inputP95: inputs[Math.floor(inputs.length * .95)], rootNotifications, chromeNotifications,
    hoverPanP95: hoverPan[Math.floor(hoverPan.length * .95)],
    restored };
}
