import { renderDocument } from "../../src/engine/canvas";
import { EditorEngine } from "../../src/engine/editor";
import { reserveLayerPixels } from "../../src/engine/mask-renderer";

const width = 180, height = 140;
function scene(canvas: HTMLCanvasElement, kind: "rectangle" | "ellipse") {
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
  const engine = new EditorEngine();
  engine.execute("page.setBackground", {color:"#000"});
  engine.execute("shape.rectangle", {x:40, y:0, width:70, height, props:{fill:"white"}});
  const id = String(engine.execute("shape." + kind, {x:30, y:25, width:90, height:70, props:{fills:[]}}).id);
  const set = (effects: Record<string, unknown>[]) => engine.execute("node.set", {id, props:{effects}});
  const draw = () => {
    renderDocument(ctx, engine.getSnapshot().document, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  };
  return {ctx, set, draw};
}
const glass = {type:"glass", depth:20, refraction:.8, lightIntensity:0, frost:0, dispersion:0};
const sample = (pixels: Uint8ClampedArray, x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

export function rectangularPane(canvas: HTMLCanvasElement) {
  const {set, draw} = scene(canvas, "rectangle");
  const measure = () => {
    const p = draw();
    return [[29,60],[30,60],[31,60],[39,60],[42,60],[75,60]].map(([x,y]) => sample(p,x,y));
  };
  set([]); const baseline = measure();
  set([glass]); const clear = measure();
  set([{...glass, visible:false}]); const hidden = measure();
  set([{...glass, frost:12}]); const frost = measure();
  const blur = {type:"backgroundBlur", radius:8};
  set([glass, blur]); const blurLast = measure();
  set([blur, glass]); const glassLast = measure();
  set([{...glass, refraction:0, lightIntensity:1, lightAngle:-90}]); const lit = measure();
  return {baseline, clear, hidden, frost, blurLast, glassLast, lit};
}

export function ellipsePane(canvas: HTMLCanvasElement) {
  const {ctx, set, draw} = scene(canvas, "ellipse");
  set([]); const baseline = draw();
  set([{...glass, dispersion:1, lightIntensity:.8, frost:3}]);
  const cold = draw(), warm = draw();
  let changes = 0, cacheDrift = 0, panDrift = 0;
  for (let i = 0; i < warm.length; i++) {
    if (baseline[i] !== cold[i]) changes++;
    if (cold[i] !== warm[i]) cacheDrift++;
  }
  ctx.setTransform(1, 0, 0, 1, -6, -3);
  const pan = draw();
  for (let y = 4; y < height - 12; y++) for (let x = 4; x < width - 12; x++) {
    for (let c = 0; c < 4; c++) if (pan[(y * width + x)*4 + c] !== warm[((y + 3) * width + x + 6)*4 + c]) panDrift++;
  }
  ctx.resetTransform();
  const budget = reserveLayerPixels(16384, 16384, 2);
  const refused = draw(); budget?.();
  const recovered = draw();
  return {changes, cacheDrift, panDrift, reserved: !!budget, refused: sample(refused,31,60), recovered: sample(recovered,31,60),
    expected: sample(warm,31,60), corner:sample(warm,30,25)};
}

export async function glassFrames(canvas: HTMLCanvasElement) {
  const {ctx, set, draw} = scene(canvas, "ellipse");
  set([{...glass, dispersion:.8, lightIntensity:.8, frost:2}]);
  const times: number[] = [];
  for (let i = 0; i < 45; i++) {
    await new Promise<void>(done => requestAnimationFrame(() => done()));
    ctx.setTransform(1, 0, 0, 1, -i % 10, 0);
    const start = performance.now();
    draw();
    if (i >= 5) times.push(performance.now() - start);
  }
  return {frames: times.length, p95: times.sort((a,b) => a-b)[37]};
}
