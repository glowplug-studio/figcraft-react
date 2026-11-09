import { fontGeometryCache } from "./font-generation";
import { tracePath } from "./corners";
import { rectanglePaints, type TextNode } from "./document";
import type { ColourBitmap } from "./font-bitmap";
import type { LayerPaintSteps } from "./image-renderer";
import { paintPath } from "./paint-path";
import { decorationPath } from "./text-decorations";
import { glyphColour } from "./text-glyph-colour";
import { glyphPath } from "./text-glyph-path";
import { textNodeLayout } from "./text-node-layout";
import { textSpans, textStyleKey } from "./text-ranges";
import type { TextStyle } from "./text-style";

type Ink = NonNullable<ReturnType<typeof glyphColour>>;
type ColourItem = { bitmap: ColourBitmap; place: Extract<Ink,{kind:"bitmap"}>["place"] } | {path: Path2D; colour: string};
interface Group { style: TextStyle; path: Path2D; ink: ColourItem[] }

function groupsFor(node: TextNode, scale: number) {
  const {layout} = textNodeLayout(node);
  const groups = new Map<string, Group>();
  function groupFor(style: TextStyle) {
    const key = textStyleKey(style);
    let group = groups.get(key);
    if (!group) { group = {style, path: new Path2D(), ink: []}; groups.set(key, group); }
    return group;
  }
  for (const {style} of textSpans(node.text)) groupFor(style);
  for (const glyph of layout.glyphs) {
    const group = groupFor(glyph.style), colour = glyphColour(glyph, scale);
    if (colour?.kind === "bitmap") group.ink.push(colour);
    else if (colour?.kind === "layers") {
      for (const layer of colour.layers) {
        const path = new Path2D(), [r,g,b,a] = layer.rgba;
        tracePath(path, glyphPath(glyph, layer.id));
        group.ink.push({path, colour: `rgba(${r},${g},${b},${a/255})`});
      }
    } else tracePath(group.path, glyphPath(glyph));
  }
  for (const decor of layout.decorations) tracePath(groupFor(decor.style).path, decorationPath(decor));
  return groups;
}

const groupsCache = fontGeometryCache<TextNode,{scale:number; groups: ReturnType<typeof groupsFor>}>();
const bitmapCache = new WeakMap<ColourBitmap, HTMLCanvasElement>();
function bitmapSurface(context: CanvasRenderingContext2D, bitmap: ColourBitmap) {
  let canvas = bitmapCache.get(bitmap);
  if (canvas) return canvas;
  canvas = context.canvas.ownerDocument.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const target = canvas.getContext("2d")!;
  const image = target.createImageData(bitmap.width, bitmap.height);
  for (let i = 0; i < bitmap.rgba.length; i += 4) {
    const a = bitmap.rgba[i+3];
    if (!a) continue;
    for (let c = 0; c < 3; c++) image.data[i+c] = bitmap.rgba[i+c] * 255 / a;
    image.data[i+3] = a;
  }
  target.putImageData(image,0,0); bitmapCache.set(bitmap,canvas);
  return canvas;
}

export function* paintText(context: CanvasRenderingContext2D, node: TextNode, alpha: number): LayerPaintSteps {
  const m = context.getTransform(), scale = Math.sqrt(Math.abs(m.a*m.d-m.b*m.c));
  let cached = groupsCache.get(node);
  if (!cached || cached.scale !== scale) {
    cached = {scale, groups: groupsFor(node, scale)};
    groupsCache.set(node, cached);
  }
  context.save();
  try {
    context.translate(0, textNodeLayout(node).dy);
    for (const {style, path, ink} of cached.groups.values()) {
      for (const paint of style.fills ?? rectanglePaints(node)) {
        if (paint.visible && paint.opacity > 0) yield* paintPath(context, path, "nonzero", node.width, node.height, paint, alpha);
      }
      for (const item of ink) {
        context.save();
        context.globalAlpha = alpha;
        if ("bitmap" in item) {
          context.transform(...item.place);
          context.drawImage(bitmapSurface(context, item.bitmap),0,0);
        } else { context.fillStyle = item.colour; context.fill(item.path); }
        context.restore();
      }
    }
  } finally { context.restore(); }
}
