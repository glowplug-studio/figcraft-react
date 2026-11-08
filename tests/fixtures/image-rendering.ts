import { EditorEngine } from "../../src/engine/editor";
import { renderDocument } from "../../src/engine/canvas";
import { base64Bytes } from "../../src/engine/recovery";

export async function imagePixels(canvas: HTMLCanvasElement) {
  canvas.width = 256; canvas.height = 160;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const engine = new EditorEngine();
  engine.execute("page.setBackground", { color: "white" });
  const source = document.createElement("canvas"); source.width = 60; source.height = 40;
  const input = source.getContext("2d")!;
  const colours = ["red", "#00ff00", "blue", "blue", "#00ff00", "red"];
  colours.forEach((c, i) => { input.fillStyle = c; input.fillRect(i%3*20,Math.floor(i/3)*20,20,20); });
  const png = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), "image/png"));
  const { id, image } = await engine.executeAsync("image.place", { data: base64Bytes(new Uint8Array(await png.arrayBuffer())), x: 20, y: 20 });
  const paint = { type: "image", image };
  function change(props: Record<string, unknown>) { engine.execute("node.set", { id, props }); }
  function render() { renderDocument(ctx, engine.getSnapshot().document, canvas.width, canvas.height); }
  const pixel = (x: number, y: number) => [...ctx.getImageData(x,y,1,1).data];
  render();
  const start = performance.now();
  while (pixel(28,28)[1] > 5) {
    if (performance.now()-start > 5000) throw new Error("Image decode did not repaint the standalone canvas");
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  change({ width: 80, height: 80, fills: [{ ...paint, scale_mode: "fit" }] }); render();
  const fit = [pixel(28,24), pixel(28,43), pixel(90,79)];
  change({ fills: [{ ...paint, scale_mode: "fill", opacity: .5 }] }); render();
  const fill = [pixel(24,30),pixel(96,30),pixel(60,90)];
  change({ fills: [{ ...paint, scale_mode: "crop", crop: [1,0,0,1,-.5,0] }] }); render();
  const crop = [pixel(35,35),pixel(73,35)];
  change({ width: 60, height: 40, fills: [{ ...paint, scale_mode: "tile", scale: .5, rotation: -1 }] }); render();
  const tile = [pixel(24,24),pixel(34,24),pixel(44,24),pixel(24,34)];
  change({ fills: [], strokes: [{ ...paint, scale_mode: "fill" }], strokeWeight: 8, strokeAlign: "outside" }); render();
  const stroke = [pixel(16,29), pixel(84,49), pixel(37,36)];
  change({ dashes: [100,1] }); render();
  const maskedStroke = [pixel(16,29), pixel(37,36)];
  change({ fills: [paint], strokes: [], rotation: 13 });
  const second = engine.execute("shape.rectangle", { x:130, y:35, width:60, height:40, props:{ fills:[{ ...paint, rotation:2 }] } }).id;
  const samples = () => [pixel(33,30),pixel(66,47),pixel(139,42),pixel(180,62)];
  render(); const beforeFlatten = samples();
  engine.execute("vector.flatten", { ids:[id,second] }); render();
  return { fit, fill, crop, tile, stroke, maskedStroke, beforeFlatten, afterFlatten:samples() };
}
