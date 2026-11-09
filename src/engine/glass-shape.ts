import { transformPoint, type Affine } from "./affine";
import type { PathCommand } from "./corners";
import { glassBendDirections, glassInsideDistance, glassNormals } from "./glass-fields";
import type { GlassGeometry } from "./glass-lens";
import { glassOwnFrame } from "./glass-rectangle";
import { reserveLayerPixels } from "./mask-renderer";
import { pathBounds } from "./vector-path";
import { mapVectorPath } from "./vector-region-selection";

interface EdgeFields {
  alpha: Uint8Array;
  distance: Float32Array;
  normals: ReturnType<typeof glassNormals>;
  bends: Map<number, ReturnType<typeof glassBendDirections>>;
  width: number;
  height: number;
}
const maximumShape = 1 << 20, maximumBytes = 32 << 20;
const kept = new Map<string, EdgeFields>(), seen = new Map<string, number>();
let retained = 0, frame = 0;

export function beginGlassFrame() { frame++; }

const hashes = new WeakMap<readonly PathCommand[], string>();
function pathHash(path: readonly PathCommand[]) {
  const existing = hashes.get(path);
  if (existing) return existing;
  const bits = new DataView(new ArrayBuffer(8));
  let a = 2166136261, b = 5381;
  const mix = (v: number) => { a = Math.imul(a ^ v, 16777619); b = Math.imul(b ^ v, 1597334677); };
  for (const cmd of path) {
    mix(cmd[0].charCodeAt(0));
    for (let i = 1; i < cmd.length; i++) {
      bits.setFloat64(0, cmd[i] as number);
      mix(bits.getUint32(0)); mix(bits.getUint32(4));
    }
  }
  const key = [path.length, a, b].join("/");
  hashes.set(path, key);
  return key;
}

function rasterFields(doc: Document, path: Path2D, rule: CanvasFillRule, xf: Affine,
  originX: number, originY: number, width: number, height: number, radius: number) {
  const release = reserveLayerPixels(width, height, 10);
  if (!release) return;
  const canvas = doc.createElement("canvas");
  try {
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
    ctx.setTransform(xf[0], xf[1], xf[2], xf[3], xf[4] - originX, xf[5] - originY);
    ctx.fill(path, rule);
    const pixels = ctx.getImageData(0, 0, width, height).data, alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[4 * i + 3];
    const distance = glassInsideDistance(alpha, width, height), normals = glassNormals(distance, width, height, radius);
    return { alpha, distance, normals, bends: new Map(), width, height } as EdgeFields;
  } finally { canvas.width = canvas.height = 0; release(); }
}

export function glassShape(doc: Document, commands: readonly PathCommand[], path: Path2D, rule: CanvasFillRule,
  xf: Affine, width: number, height: number, depth: number, bevel: number): GlassGeometry | undefined {
  const r = Math.trunc(Math.min(8, Math.max(1, depth * .1))), reach = Math.fround(depth + bevel);
  const plain = Math.ceil(depth + bevel) + 4 * r + 4, cored = plain + Math.ceil(1.5 * reach) + 2;
  const own = glassOwnFrame(xf), matrix = own?.matrix ?? xf;
  const bounds = pathBounds(mapVectorPath(commands, p => transformPoint(matrix, p)));
  if (!bounds) return;
  const left = Math.floor(bounds.x), top = Math.floor(bounds.y);
  const boxWidth = Math.ceil(bounds.x + bounds.width) - left + 2, boxHeight = Math.ceil(bounds.y + bounds.height) - top + 2;
  const roundedMargin = (margin: number) => Math.ceil(margin / 32) * 32;
  const coreMargin = roundedMargin(cored);
  const core = (boxWidth + 2 * coreMargin) * (boxHeight + 2 * coreMargin) <= maximumShape;
  const margin = core ? cored : plain, rounded = roundedMargin(margin);
  const ww = boxWidth + 2 * rounded, wh = boxHeight + 2 * rounded;
  let edge: EdgeFields | undefined, x0 = -margin, y0 = -margin;
  if (own && ww * wh <= maximumShape && Math.max(Math.abs(left), Math.abs(top)) < 1e9) {
    const key = [pathHash(commands), rule, ...matrix, rounded, r].join(",");
    edge = kept.get(key);
    if (edge) {
      kept.delete(key); kept.set(key, edge);
    } else if (seen.has(key) && seen.get(key)! < frame) {
      const bytes = ww * wh * 29;
      while (kept.size && retained + bytes > maximumBytes) {
        const oldest = kept.keys().next().value!, old = kept.get(oldest)!;
        retained -= old.width * old.height * 29; kept.delete(oldest);
      }
      edge = rasterFields(doc, path, rule, matrix, left - 1 - rounded, top - 1 - rounded, ww, wh, r);
      if (edge) { kept.set(key, edge); seen.delete(key); retained += bytes; }
    } else if (!seen.has(key)) {
      if (seen.size >= 256) seen.clear();
      seen.set(key, frame);
    }
    if (edge) { x0 = left - 1 - rounded + own.shiftX; y0 = top - 1 - rounded + own.shiftY; }
  }
  edge ??= rasterFields(doc, path, rule, xf, x0, y0, width + 2 * margin, height + 2 * margin, r);
  if (!edge) return;
  const { alpha, distance, normals, bends, width: ew, height: eh } = edge;
  let bend = normals;
  if (core) {
    const cached = bends.get(reach);
    if (cached) { bend = cached; bends.delete(reach); }
    else {
      const release = reserveLayerPixels(ew, eh, 10);
      if (!release) return;
      try { bend = glassBendDirections(distance, ew, eh, reach, r); } finally { release(); }
      if (bends.size >= 2) bends.delete(bends.keys().next().value!);
    }
    bends.set(reach, bend);
  }
  return (x, y, field) => {
    const px = x - x0, py = y - y0;
    if (px < 0 || py < 0 || px >= ew || py >= eh) { field.coverage = 0; return; }
    const i = py * ew + px;
    field.coverage = alpha[i] / 255; field.distance = distance[i];
    field.normalX = normals.x[i]; field.normalY = normals.y[i];
    field.bendX = bend.x[i]; field.bendY = bend.y[i];
  };
}
