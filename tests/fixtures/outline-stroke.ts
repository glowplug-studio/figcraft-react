import { renderDocument } from "../../src/engine/canvas";
import { EditorEngine } from "../../src/engine/editor";

export function compareOutlines(canvas: HTMLCanvasElement) {
  canvas.width = 200;
  canvas.height = 150;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const scenes = [
    { kind: "line", props: { widthProfile: [[0,0,2], [1,0,2]] } },
    { kind: "line", props: { brush: { preset: "dots", spacing: 3 } } },
    { kind: "line", props: { brush: { preset: "taper" } } },
    { kind: "line", props: { dashes: [10, 10], startCap: "round", endCap: "square" } },
    { kind: "arrow", props: { startCap: "round", endCap: "triangleArrow" } },
    { kind: "rectangle", props: { strokeSides: [2,6,10,14], cornerRadius: 12, strokeAlign: "outside" } },
    { kind: "ellipse", props: { strokeAlign: "inside" } },
    { kind: "polygon", props: { pointCount: 6, strokeJoin: "bevel", strokeAlign: "center" } },
  ];
  return scenes.map(({ kind, props }) => {
    const engine = new EditorEngine();
    const id = engine.execute("shape."+kind, { x: 35, y: 40, width: 120, height: kind === "line" || kind === "arrow" ? 0 : 70,
      props: { fill: null, stroke: "#000", strokeWeight: 8, ...props } }).id;
    const draw = () => {
      renderDocument(ctx, engine.getSnapshot().document, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const before = draw();
    engine.execute("vector.outlineStroke", { id });
    const after = draw();
    let dark = 0, mismatch = 0;
    // Antialiasing differs between a browser stroke and a filled contour. Compare both sides
    // of the boundary only where the expected pixel and its immediate neighbours agree.
    for (let y = 1; y < canvas.height - 1; y++) for (let x = 1; x < canvas.width - 1; x++) {
      const i = (y * canvas.width + x) * 4, v = before[i];
      if (v !== 0 && v !== 245) continue;
      const offsets = [-4,4,-4 * canvas.width,4 * canvas.width];
      if (!offsets.every(d => before[i+d] === v)) continue;
      if (v === 0) dark++;
      if (Math.abs(after[i] - v) > 5) mismatch++;
    }
    return { kind, props, dark, mismatch };
  });
}

export function measureOutlineEdits() {
  const engine = new EditorEngine();
  const ids = Array.from({ length: 32 }, (_, i) => String(engine.execute("shape.line", {
    x: 0, y: i * 10, width: 80, props: { stroke: "#a00000", strokeWeight: 3, dashes: [10,5] },
  }).id));
  const before = engine.getSnapshot().document, timings: number[] = [];
  let count = 0;
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    count = (engine.execute("vector.outlineStroke", { ids }).ids as string[]).length;
    timings.push(performance.now() - start);
    engine.execute("edit.undo");
  }
  timings.sort((a,b)=>a-b);
  return { outlines: count, runs: timings.length, medianMs: timings[7], p95Ms: timings[14], restored: before === engine.getSnapshot().document };
}
