import type { PathCommand } from "../../src/engine/corners";
import { ellipsePath } from "../../src/engine/ellipse";
import { booleanStep, normaliseBooleanPath } from "../../src/engine/path-boolean";
import { tracePath } from "../../src/engine/corners";
import { pathWinding } from "../../src/engine/vector-path";

export function exerciseBooleanPaths(canvas: HTMLCanvasElement) {
  const square = (x: number, y: number, size: number): PathCommand[] => [["M",x,y],["L",x+size,y],["L",x+size,y+size],["L",x,y+size],["Z"]];
  const box = square(10,0,20), circle = ellipsePath(20,20,{start:0,sweep:2*Math.PI,inner:0});
  canvas.width = 32; canvas.height = 24;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const hits = [], samples: number[] = [];
  for (const operation of ["union","subtract","intersect","exclude"] as const) {
    const begin = performance.now();
    let result: PathCommand[] = [];
    for (let i=0;i<50;i++) result = booleanStep(circle,box,operation);
    samples.push((performance.now()-begin)/50);
    ctx.clearRect(0,0,32,24); ctx.beginPath(); tracePath(ctx,result); ctx.fill("evenodd");
    hits.push([4,12,24].map(x => ctx.getImageData(x,10,1,1).data[3]));
  }
  const many = Array.from({length:4097},(_,i)=>square(i*2,0,1)).flat();
  const start = performance.now(), result = normaliseBooleanPath(many), normaliseMs = performance.now()-start;
  return { hits, samples, normaliseMs, contours:result.filter(cmd => cmd[0]==="M").length, last:pathWinding(result,{x:8192.5,y:.5}) };
}

import { booleanResult } from "../../src/engine/boolean-result";
import { EditorEngine } from "../../src/engine/editor";
import type { BooleanNode } from "../../src/engine/document";

export function exerciseBooleanEdits() {
  const engine = new EditorEngine();
  const ids = Array.from({ length: 48 }, (_, i) => String(engine.execute("shape.rectangle", {
    x: i * 12, y: i % 3, width: 20, height: 20,
  }).id));
  const group = String(engine.execute("bool.union", { ids }).id);
  const render = () => {
    const doc = engine.getSnapshot().document;
    return booleanResult(doc, doc.nodes[group] as BooleanNode, 0, true)!;
  };
  const vertices = render().network.vertices.length;
  function sample(id: string) {
    const durations: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      engine.execute("node.set", { id, props: { height: 21 + (i % 6) } });
      render();
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    return { medianMs: durations[15], p95Ms: durations[28], maxMs: durations[29] };
  }
  const top = sample(ids[47]), bottom = sample(ids[0]);
  return { operands: ids.length, editCount: 60, vertices, top, bottom };
}

import { renderDocument } from "../../src/engine/canvas";

/** Native `a_boolean_groups_radius_rounds_what_the_canvas_draws`: the L group drawn by the real canvas renderer,
 * sharp and then with a radius of 20, sampled where the native test samples it; then a click on the cut-off corner. */
export async function exerciseBooleanRadius(canvas: HTMLCanvasElement) {
  const engine = new EditorEngine();
  const a = String(engine.execute("shape.rectangle", { x: 0, y: 0, width: 200, height: 100 }).id);
  const b = String(engine.execute("shape.rectangle", { x: 150, y: 0, width: 100, height: 200 }).id);
  const group = String(engine.execute("bool.union", { ids: [a, b] }).id);
  engine.execute("node.set", { ids: [group], props: { fills: [{ type: "solid", color: "#000000" }] } });
  canvas.width = 260; canvas.height = 210;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!, view = { cx: 130, cy: 105, zoom: 1, vw: 260, vh: 210 };
  const dark = (x: number, y: number) => { const [r, g, bl, alpha] = ctx.getImageData(x, y, 1, 1).data; return alpha > 200 && r + g + bl < 96; };
  const draw = async () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 260, 210);
    await renderDocument(ctx, engine.getSnapshot().document, 260, 210, [], undefined, view);
    return [dark(1, 1), dark(148, 102), dark(100, 50)];
  };
  const sharp = await draw();
  engine.execute("node.set", { ids: [group], props: { cornerRadius: 20 } });
  const rounded = await draw();
  engine.execute("edit.undo");
  const undone = await draw();
  return { sharp, rounded, undone };
}
