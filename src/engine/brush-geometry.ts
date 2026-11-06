import { brushPreset, sanitiseBrush, type Brush } from "./brush";
import type { PathCommand } from "./corners";
import { ellipticalArcPath, TAU } from "./ellipse";
import type { Point } from "./geometry";
import { MAX_PATH_SAMPLES, measurePath, polylineAt, polylineLength, type MeasuredPolyline } from "./path-measure";
import { starPoints } from "./polygon";
import type { StrokeProps } from "./stroke";
import { sanitiseWidthProfile, widthProfileSidesAt } from "./width-profile";

export const MAX_BRUSH_COPIES = 5000;
const shapes = new Map<string, readonly PathCommand[]>();
function band(path: PathCommand[], edges: (x: number) => readonly [number, number]): void {
  for (let i = 0; i <= 64; i++) { const x = i / 64; path.push([i ? "L" : "M", x, edges(x)[0]]); }
  for (let i = 64; i >= 0; i--) { const x = i / 64; path.push(["L", x, edges(x)[1]]); }
  path.push(["Z"]);
}
export function brushShape(id: string): readonly PathCommand[] | undefined {
  const prior = shapes.get(id); if (prior) return prior;
  const path: PathCommand[] = [];
  switch (id) {
    case "taper": path.push(["M", 0, 0], ["C", .3, -.5, .7, -.5, 1, 0], ["C", .7, .5, .3, .5, 0, 0], ["Z"]); break;
    case "ink": band(path, x => {
      const w = Math.min(x / .04, 1) * Math.min((1 - x) / .3, 1);
      return [-.5 * w + .04 * Math.sin(9 * Math.PI * x) * w, .45 * w + .04 * Math.sin(13 * Math.PI * x + 1) * w];
    }); break;
    case "ribbon": band(path, x => { const c = .5 * Math.cos(3 * Math.PI * x); return [-c, c]; }); break;
    case "bristle":
      for (let k = 0; k < 4; k++) {
        const y = -.375 + .25 * k, x0 = .03 * k, x1 = 1 - .04 * (3 - k);
        band(path, x => { const u = Math.max(0, Math.min(1, (x - x0) / (x1 - x0))), h = .09 * Math.sqrt(Math.max(0, Math.sin(Math.PI * u))); return [y - h, y + h]; });
      } break;
    case "dots": path.push(...ellipticalArcPath(0, 0, .5, .5, 0, TAU), ["Z"]); break;
    case "stars": starPoints(1, 1, 5, .4).forEach((p, i) => path.push([i ? "L" : "M", p.x - .5, p.y - .5])); path.push(["Z"]); break;
    case "confetti": path.push(["M", -.3, -.3], ["L", .3, -.3], ["L", .3, .3], ["L", -.3, .3], ["Z"]); break;
    case "leaves": path.push(["M", -.5, 0], ["C", -.2, -.3, .2, -.3, .5, 0], ["C", .2, .3, -.2, .3, -.5, 0], ["Z"]); break;
    default: return undefined;
  }
  const frozen = Object.freeze(path.map(command => Object.freeze(command))); shapes.set(id, frozen); return frozen;
}
/** Exact native splitmix64: mask after each multiplication, then retain the top53 bits. */
export function brushRandom(seed: number, index: number, channel: number): number {
  const u64 = (n: bigint) => BigInt.asUintN(64, n);
  let z = BigInt(seed) ^ u64(BigInt(index) * 0x9e3779b97f4a7c15n) ^ u64(BigInt(channel) * 0xd1b54a32d192ed03n);
  z = u64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = u64((z ^ (z >> 27n)) * 0x94d049bb133111ebn); z ^= z >> 31n;
  return Number(z >> 11n) / 2 ** 53;
}
const unitLines = new Map<string, readonly MeasuredPolyline[]>();
function stretch(out: PathCommand[], unit: readonly MeasuredPolyline[], line: MeasuredPolyline, steps: number, scale: (t: number) => number): void {
  const map = (q: Point): Point | undefined => {
    const at = polylineAt(line, q.x); if (!at) return undefined;
    const w = q.y * scale(q.x); return { x: at.point.x + at.normal.x * w, y: at.point.y + at.normal.y * w };
  };
  for (const contour of unit) {
    let last = contour.points[0]; if (!last) continue;
    const start = map(last); if (start) out.push(["M", start.x, start.y]);
    for (let i = 1; i < contour.points.length; i++) {
      const q = contour.points[i], count = Math.max(1, Math.min(steps, Math.ceil(Math.abs(q.x - last.x) * steps)));
      for (let k = 1; k <= count; k++) {
        const p = map({ x: last.x + (q.x - last.x) * k / count, y: last.y + (q.y - last.y) * k / count });
        if (p) out.push(["L", p.x, p.y]);
      }
      last = q;
    }
    if (contour.closed) out.push(["Z"]);
  }
}
/** Source brush::outline; undefined requests uniform fallback, never profile fallback. */
export function brushOutline(path: readonly PathCommand[], width: number, props: StrokeProps, brush: Brush): readonly PathCommand[] | undefined {
  const preset = brushPreset(brush.preset), unit = brushShape(brush.preset); if (!preset || !unit) return undefined;
  const lines = measurePath(path); if (!lines) return undefined;
  if (!(width > 0 && Number.isFinite(width))) return [];
  const profile = props.widthProfile?.points.length ? sanitiseWidthProfile(props.widthProfile) : undefined;
  const scale = (t: number): number => { const [left, right] = profile ? widthProfileSidesAt(profile, t) : [1, 1]; return width * (left + right) / 2; };
  const out: PathCommand[] = [];
  if (preset.kind === "stretch") {
    let flattened = unitLines.get(preset.id);
    if (!flattened) { flattened = measurePath(unit, MAX_PATH_SAMPLES, .002); if (!flattened) return undefined; unitLines.set(preset.id, flattened); }
    const steps = Math.max(8, Math.min(512, Math.floor(65536 / Math.max(1, lines.length))));
    for (const line of lines) stretch(out, flattened, line, steps, scale);
  } else {
    const b = sanitiseBrush(brush), total = lines.reduce((sum, line) => sum + polylineLength(line), 0);
    const step = Math.max(b.spacing * width, total / MAX_BRUSH_COPIES, 1e-3); let index = 0;
    for (const line of lines) for (let distance = step / 2, length = polylineLength(line); distance < length; distance += step, index++) {
      const t = distance / length, at = polylineAt(line, t); if (!at) continue;
      const random = (channel: number) => brushRandom(b.seed, index, channel) * 2 - 1;
      const size = scale(t) * Math.max(.05, 1 + b.sizeJitter * random(0));
      const angle = Math.atan2(-at.normal.x, at.normal.y) + b.rotationJitter * Math.PI * random(1);
      const scatter = b.scatter * width * random(2), x = at.point.x + at.normal.x * scatter, y = at.point.y + at.normal.y * scatter;
      const cos = Math.cos(angle) * size, sin = Math.sin(angle) * size;
      const map = (a: number, c: number): [number, number] => [x + cos * a - sin * c, y + sin * a + cos * c];
      for (const command of unit) out.push(command[0] === "Z" ? command : command[0] === "C"
        ? ["C", ...map(command[1], command[2]), ...map(command[3], command[4]), ...map(command[5], command[6])]
        : [command[0], ...map(command[1], command[2])]);
    }
  }
  return out;
}
