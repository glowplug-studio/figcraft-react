import { EditorEngine } from "../../src/engine/editor";
import { defaultViewport } from "../../src/engine/viewport";
import { sampleCanvasColour } from "../../src/engine/eyedropper";
import { toCssHex } from "../../src/engine/colour";
import { base64Bytes } from "../../src/engine/recovery";

/** Native eyedropper_image_tests.rs (#2189): a 9 x 9 image of `back` with a 1 px vertical line of `line` in column 4, placed at the
 * origin; the eyedropper's colour at page (x, y) for each zoom. */
export async function linePicks(back: string, line: string, picks: readonly [number, number, number][]) {
  const source = document.createElement("canvas"); source.width = source.height = 9;
  const ctx = source.getContext("2d")!;
  ctx.fillStyle = back; ctx.fillRect(0, 0, 9, 9);
  ctx.fillStyle = line; ctx.fillRect(4, 0, 1, 9);
  const png = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), "image/png"));
  const engine = new EditorEngine();
  await engine.executeAsync("image.place", { data: base64Bytes(new Uint8Array(await png.arrayBuffer())), x: 0, y: 0 });
  const doc = engine.getSnapshot().document;
  const out: string[] = [];
  for (const [x, y, zoom] of picks) out.push(toCssHex(await sampleCanvasColour(doc, { ...defaultViewport, zoom }, { x, y })).slice(1));
  return out;
}
