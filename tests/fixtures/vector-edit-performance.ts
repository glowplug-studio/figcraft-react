import { expectSolid } from "./expect-solid";
import { newDocument, type Document, type DocumentNode, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { renderDocument } from "../../src/engine/canvas";
import { drawVectorEdit } from "../../src/engine/vector-edit-overlay";
import { ShapeBuilderInteraction } from "../../src/engine/shape-builder-interaction";
import { builderArrangement } from "../../src/engine/shape-builder";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { widthHandles } from "../../src/engine/vector-width";
import { pointBoxCentre, pointBoxCorners, shownVectorPointBox } from "../../src/engine/vector-point-transform";

async function openVectorScene(path: string, splitRegions = true) {
  const seed = new EditorEngine(), id = String(seed.execute("vector.create", { path }).id);
  const vector = seed.getSnapshot().document.nodes[id] as VectorNode;
  const regions = splitRegions ? vector.network.regions.flatMap(r => r.loops.map(loop => ({ ...r, loops: [loop] }))) : vector.network.regions;
  const template = { ...vector, network: { ...vector.network, regions } };
  const initial = newDocument(), nodes: Record<string, DocumentNode> = { ...initial.nodes }, children: string[] = [];
  for (let i = 0; i < 9_999; i++) {
    const id = String(i + 2), x = i < 100 ? 40 + i % 10 * 90 : 10_000 + i, y = i < 100 ? 40 + Math.floor(i / 10) * 80 : 10_000;
    children.push(id);
    nodes[id] = i < 100 ? { ...template, id, parent: "1", x, y, transform: [1, 0, 0, 1, x, y] } : { id, parent: "1", kind: "rectangle", name: `Layer ${i}`, x, y, width: 40, height: 30, fill: "#d9d9d9" };
  }
  nodes["1"] = { ...initial.nodes["1"], kind: "page", parent: null, background: "#f5f5f5", children };
  const document: Document = { ...initial, nodes }, engine = new EditorEngine();
  await engine.executeAsync("file.open", { data: base64Bytes(await encodeFigcraft(document, "10002")) });
  engine.execute("vector.edit.begin", { ids: children.slice(0, 100) });
  return { engine, children };
}

export async function measureVectorEdit(canvas: HTMLCanvasElement, operation: "move" | "scale" | "rotate" | "width" | "paint" | "region" = "move") {
  const { engine, children } = await openVectorScene("M0 0C10 -5 30 -5 40 0L40 30L0 30Z");
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
  if (operation === "scale") {
    const farId = children[99];
    const original = before.nodes[farId] as VectorNode, scaled = engine.getRenderDocument().nodes[farId] as VectorNode;
    if (original === scaled || original.network === scaled.network) throw Error("Scale drag did not transform the far selected layer");
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


export async function measureRegionFills(canvas: HTMLCanvasElement) {
  const { engine, children } = await openVectorScene("M0 0H18V30H0Z M22 0H40V30H22Z");
  const id = children[0];
  engine.execute("vector.edit.select", { regions: [0, 1] });
  engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d")!, interaction = new VectorInteraction(engine, message => { throw Error(message); });
  const initial = engine.getSnapshot().document, depth = engine.getUndoDepth();
  const input: number[] = [], frames: number[] = [];
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    engine.execute("fill.set", { id, color: i % 2 ? "#0000ff" : "#ff0000" });
    const changed = performance.now();
    renderDocument(context, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView());
    drawVectorEdit(context, engine.getRenderDocument(), engine.getRenderVectorEdit()!, engine.getView(), interaction.overlay);
    if (i >= 10) { input.push(changed - start); frames.push(performance.now() - start); }
  }
  const getNode = () => engine.getSnapshot().document.nodes[id] as VectorNode;
  const colours = () => getNode().network.regions.map(r => expectSolid(r.fills?.[0]).color);
  if (colours().length !== 2 || !colours().every(c => c?.b === 1 && c.r === 0)) throw Error("Both selected regions must be blue");
  if (engine.getSnapshot().document.nodes[children[1]] !== initial.nodes[children[1]]) throw Error("Sibling changed");
  const edits = engine.getUndoDepth() - depth;
  engine.execute("edit.undo");
  if (!colours().every(c => c?.r === 1 && c.b === 0)) throw Error("Undo must restore both red regions");
  const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(.95 * values.length)];
  return { nodes: Object.keys(initial.nodes).length, editedLayers: 100, regions: 2, edits, measuredFrames: frames.length, inputP95: p95(input), p95: p95(frames) };
}

export async function measureVectorPathTool(canvas: HTMLCanvasElement, tool: "cut" | "eraser" | "lasso") {
  const { engine, children } = await openVectorScene("M0 0H40V30H0Z");
  engine.execute("vector.edit.tool", { tool });
  engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext("2d")!, edit = new VectorInteraction(engine, message => { throw Error(message); });
  const mods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  const start = tool === "lasso" ? { x: 30, y: 30 } : { x: 60, y: 30 };
  const before = engine.getSnapshot().document, frames: number[] = [], inputs: number[] = [];
  edit.down(start, mods);
  let root = 0, chrome = 0;
  const offRoot = engine.subscribe(() => root++), offChrome = engine.subscribeVectorEdit(() => chrome++);
  let end = start;
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (tool === "lasso") {
      const side = Math.floor(i / 30), t = (i % 30 + 1) / 30;
      const corners = [start, { x: 905, y: 30 }, { x: 905, y: 798 }, { x: 30, y: 798 }, start];
      end = { x: corners[side].x + (corners[side+1].x-corners[side].x)*t, y: corners[side].y+(corners[side+1].y-corners[side].y)*t };
    } else end = { x: 60, y: 30 + i / 2 };
    const begin = performance.now(); edit.move(end, mods); const input = performance.now();
    renderDocument(ctx, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView());
    drawVectorEdit(ctx, engine.getRenderDocument(), engine.getRenderVectorEdit()!, engine.getView(), edit.overlay);
    if (i >= 10) { inputs.push(input - begin); frames.push(performance.now() - begin); }
  }
  offRoot(); offChrome();
  const release = performance.now(); edit.up(end); const releaseMs = performance.now() - release;
  const after = engine.getSnapshot().document, active = after.nodes[children[0]] as VectorNode, state = engine.getVectorEdit()!;
  if (tool === "lasso") {
    const selected = state.vertices.length + state.others.reduce((n,p) => n+p.vertices.length,0);
    if (selected !== 400 || before !== after) throw Error("Lasso did not select all 400 points without changing geometry");
  } else {
    if (tool === "cut" && Object.keys(after.nodes).length !== 10_001) throw Error("Cut did not create a sibling");
    if (tool === "eraser" && active.network.segments.length !== 6) throw Error("Brush did not erase both crossed edges");
    engine.execute("edit.undo"); if (engine.getSnapshot().document !== before) throw Error("Undo did not restore the network");
  }
  const p95 = (n: number[]) => n.sort((a,b) => a-b)[Math.floor(.95*n.length)];
  return { tool, nodes: Object.keys(before.nodes).length, editedLayers:100, measuredFrames: frames.length, inputP95:p95(inputs), p95:p95(frames), releaseMs, root, chrome };
}

export async function measureWinding(canvas: HTMLCanvasElement, command: "vector.fillRule" | "vector.reverseLoop") {
  const { engine, children } = await openVectorScene("M0 0H40V30H0Z M10 8H30V22H10Z", false);
  const ids = children.slice(0, 100), params = { ids, region: 0, loop: 1 };
  engine.execute("vector.edit.end");
  engine.execute("view.set", { cx: 600, cy: 400, vw: 1200, vh: 800, zoom: 1 });
  canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext("2d")!, frames: number[] = [], inputs: number[] = [];
  const depth = engine.getUndoDepth();
  for (let i = 0; i < 120; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    if (command === "vector.reverseLoop") engine.execute(command, params);
    else engine.execute(command, { ids, rule: i % 2 ? "nonZero" : "evenOdd" });
    const changed = performance.now();
    renderDocument(ctx, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView());
    const rendered = performance.now();
    if (i >= 10) { frames.push(rendered - start); inputs.push(changed - start); }
    // Read one centre in the final visible row, after drawing. Even iterations open the holes.
    const pixel = ctx.getImageData(870, 775, 1, 1).data;
    if (pixel[0] !== (i % 2 ? 217 : 245)) throw Error(`Last ring did not change fill: ${Array.from(pixel)}`);
  }
  const edits = engine.getUndoDepth() - depth, p95 = (a: number[]) => a.sort((x,y) => x-y)[Math.floor(a.length * .95)];
  engine.execute("edit.undo");
  renderDocument(ctx, engine.getRenderDocument(), 1200, 800, [], undefined, engine.getView());
  return { nodes: Object.keys(engine.getSnapshot().document.nodes).length, rings: ids.length, edits, frames: frames.length, inputP95: p95(inputs), p95: p95(frames), undoPixel: ctx.getImageData(870,775,1,1).data[0] };
}

export async function measureOffset(canvas: HTMLCanvasElement) {
  const { engine, children } = await openVectorScene("M0 0H40V30H0Z M10 8V22H30V8Z", false);
  const ids = children.slice(0,32), original = engine.getSnapshot().document;
  canvas.width=960; canvas.height=850;
  const context = canvas.getContext("2d", { willReadFrequently:true })!;
  const commands: number[] = [], frames: number[] = [];
  let grownPixel = 0, holePixel = 0;
  for (let i=0; i<12; i++) {
    const start=performance.now();
    engine.execute("vector.offset", { ids, offset:2 });
    const changed=performance.now();
    renderDocument(context, engine.getSnapshot().document, canvas.width, canvas.height);
    const painted=performance.now();
    if (i>=2) { commands.push(changed-start); frames.push(painted-changed); }
    grownPixel=context.getImageData(39,55,1,1).data[0];
    holePixel=context.getImageData(60,55,1,1).data[0];
    engine.execute("edit.undo");
    if (engine.getSnapshot().document!==original) throw Error("Undo did not restore the original document");
  }
  const p95=(values:number[]) => values.sort((a,b)=>a-b)[Math.floor(values.length*.95)];
  return { nodes:Object.keys(original.nodes).length, rings:ids.length, runs:commands.length, commandP95Ms:p95(commands), paintP95Ms:p95(frames), grownPixel, holePixel };
}

export async function measureSimplify(canvas: HTMLCanvasElement) {
  const {engine,children}=await openVectorScene("M0 0H10H20H40V30H0Z M50 0H60H70H80",false);
  const ids=children.slice(0,32), before=engine.getSnapshot().document;
  canvas.width=960;canvas.height=850;
  const context=canvas.getContext("2d",{willReadFrequently:true})!;
  const commands:number[]=[], frames:number[]=[];
  let afterSegments=0, sample=0;
  for(let i=0;i<12;i++){
    const start=performance.now();engine.execute("vector.simplify",{ids});
    const committed=performance.now(), doc=engine.getSnapshot().document;
    renderDocument(context,doc,canvas.width,canvas.height);
    const finish=performance.now();
    if(i>=2){commands.push(committed-start);frames.push(finish-committed);}
    afterSegments=(doc.nodes[ids[0]] as VectorNode).network.segments.length;
    sample=context.getImageData(60,55,1,1).data[0];
    engine.execute("edit.undo");if(engine.getSnapshot().document!==before)throw Error("Simplify undo lost geometry");
  }
  const p95=(a:number[])=>a.sort((x,y)=>x-y)[Math.floor(a.length*.95)];
  return {nodes:Object.keys(before.nodes).length,targets:ids.length,runs:commands.length,beforeSegments:(before.nodes[ids[0]] as VectorNode).network.segments.length,
    afterSegments,sample,commandP95Ms:p95(commands),paintP95Ms:p95(frames)};
}

export async function measureShapeBuilder(canvas: HTMLCanvasElement) {
  const { engine, children } = await openVectorScene("M0 0H120V60H0Z", false);
  engine.execute("tool.shapeBuilder");
  const ids = children.slice(0, 32);
  engine.execute("select.set", { ids });
  engine.execute("view.set", {cx:480,cy:200,vw:960,vh:400,zoom:1});
  canvas.width = 960; canvas.height = 400;
  const context = canvas.getContext("2d", {willReadFrequently:true})!;
  const document = engine.getSnapshot().document, start = performance.now();
  const arrangement = builderArrangement(document, ids), coldMs = performance.now() - start;
  const interaction = new ShapeBuilderInteraction(engine);
  const input: number[] = [], frames: number[] = [];
  let notifications = 0;
  const unsubscribe = engine.subscribe(() => { notifications++; });
  for (let i = 0; i < 120; i++) {
    const before = performance.now();
    interaction.move({x:45+(i*7)%850,y:60},i%2===0);
    const moved = performance.now();
    renderDocument(context,document,960,400,[],undefined,engine.getView());
    interaction.draw(context);
    const finished = performance.now();
    if (i >= 10) { input.push(moved-before); frames.push(finished-moved); }
  }
  unsubscribe();
  const before = performance.now();
  engine.execute("shapeBuilder.remove",{points:[[135,60]]});
  const commitMs = performance.now()-before;
  engine.execute("edit.undo");
  if (engine.getSnapshot().document !== document) throw Error("Shape Builder undo lost the source document");
  const p95 = (samples:number[]) => samples.sort((a,b) => a-b)[Math.floor(samples.length*0.95)];
  return { nodes:Object.keys(document.nodes).length, targets:ids.length, regions:arrangement.regions.length,
    frames:frames.length, notifications, coldMs, commitMs, paintP95Ms:p95(frames), inputP95Ms:p95(input) };
}
