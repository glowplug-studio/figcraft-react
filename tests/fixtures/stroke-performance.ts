import { newDocument, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { TransformInteraction } from "../../src/engine/transform-interaction";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { defaultStroke } from "../../src/engine/stroke";
import { solidPaint } from "../../src/engine/solid-paint";
import { fromRgba8 } from "../../src/engine/colour";
import { parseWidthProfile, widthPresetProfile } from "../../src/engine/width-profile";
import { brushPresets, defaultBrush } from "../../src/engine/brush";
import { pathNetwork } from "../../src/engine/svg-path";
import { freezeNetwork } from "../../src/engine/vector-network";

export async function measureStrokes(canvas: HTMLCanvasElement, individual = false, profiles = false, brushes = false, vectors = false) {
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  const paints = [solidPaint(fromRgba8(0, 0, 0))], stroke = { ...defaultStroke, weight: 3, align: "outside" as const, dashes: [8, 4], capStart: "round" as const, capEnd: "square" as const };
  const curved = pathNetwork("M0 0C20 0 40 50 60 50").network, ring = pathNetwork("M0 0H60V50H0Z M15 15H45V35H15Z").network;
  const networks = [curved, freezeNetwork({ ...ring, regions: ring.regions.map(r => ({ ...r, winding: "evenOdd" })) }), freezeNetwork({ ...curved, vertices: curved.vertices.map(v => ({ ...v, cap: "triangleArrow" })) })];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2); children.push(id);
    const currentStroke = { ...stroke, ...(profiles ? { widthProfile: i % 2 ? widthPresetProfile("eye") : parseWidthProfile([[0, 0, 2], [.5, 2, 1], [1, 0, 1]]) } : {}), ...(brushes ? { brush: { ...defaultBrush, preset: brushPresets[i % brushPresets.length].id, spacing: 2, sizeJitter: .25, rotationJitter: .25, scatter: .25, seed: 7 } } : {}) };
    const common = { id, parent: "1", name: `Layer ${i}`, x: i < 100 ? i % 10 * 80 : 10_000 + i, y: i < 100 ? 20 + Math.floor(i / 10) * 70 : 10_000, width: 60, fill: "transparent", strokes: paints, stroke: currentStroke };
    nodes[id] = vectors ? { ...common, kind: "vector", height: 50, network: networks[i % networks.length], stroke: { ...stroke, dashes: i % 3 === 0 ? [8, 4] : [], ...(i % 5 === 0 ? { widthProfile: widthPresetProfile("eye") } : {}), ...(i % 7 === 0 ? { brush: { ...defaultBrush, preset: "dots" } } : {}) } }
      : individual ? { ...common, kind: "rectangle", height: 50, corners: { radii: [12, 12, 12, 12], smoothing: .6 }, stroke: { ...stroke, sides: [0, 0, 3, 2] } }
      : i % 2 ? { ...common, kind: "star", height: 50, count: 5, innerRatio: .38 } : { ...common, kind: "line", height: 0, stroke: { ...currentStroke, capEnd: "triangleArrow" } };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#ffffff", children };
  const engine = new EditorEngine(); await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft({ ...initial, nodes }, "10002")) });
  engine.execute("select.set", { ids: ["2"] }); engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800; const context = canvas.getContext("2d")!;
  const fail = (message: string) => { throw new Error(message); }, handle = new TransformInteraction(engine, fail);
  if (!handle.down({ x: 60, y: individual || vectors ? 70 : 20 })) throw new Error("Resize handle not found");
  let notifications = 0; engine.subscribe(() => notifications++);
  const frames: number[] = [], inputs: number[] = [], mods = { shiftKey: false, altKey: false, ctrlKey: true, metaKey: false };
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now();
    handle.move({ x: 70 + i / 5, y: (individual || vectors ? 80 : 30) + i / 10 }, mods); const input = performance.now() - start;
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView()); handle.draw(context);
    if (i >= 10) { inputs.push(input); frames.push(performance.now() - start); }
  }
  const rootNotifications = notifications; handle.cancel(); const restored = engine.getRenderDocument() === engine.getSnapshot().document;
  engine.execute("tool.arrow"); const draw = new DrawInteraction(engine, fail), drawTimes: number[] = []; draw.down({ x: 850, y: 100 }); const before = notifications;
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now();
    draw.move({ x: 950 + i, y: 220 }, mods); renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, engine.getView());
    if (i >= 10) drawTimes.push(performance.now() - start);
  }
  const drawRootNotifications = notifications - before; draw.cancel();
  const panTimes: number[] = [];
  if (profiles || vectors) for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now();
    renderDocument(context, engine.getRenderDocument(), 1200, 800, engine.getRenderSelection(), undefined, { ...engine.getView(), cx: 600 + i / 3, cy: 400 + i / 5 });
    if (i >= 10) panTimes.push(performance.now() - start);
  }
  const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length * .95)];
  return { nodes: Object.keys(engine.getRenderDocument().nodes).length, visible: 100, measuredFrames: frames.length, p95: p95(frames), max: frames.at(-1), inputP95: p95(inputs), rootNotifications, drawP95: p95(drawTimes), drawRootNotifications, ...(profiles || vectors ? { panP95: p95(panTimes) } : {}), restored: restored && engine.getRenderDocument() === engine.getSnapshot().document };
}
