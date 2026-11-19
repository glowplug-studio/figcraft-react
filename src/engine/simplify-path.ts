import type { PathCommand } from "./corners";
import { cubicStartDirection, reverseCubic, type Cubic } from "./cubic";
import { CubicFitSource } from "./fit-cubic-source";
import type { Point } from "./geometry";
import { fitSource } from "./pencil-fit";
import { simplifyKeeping } from "./simplify-guard";

const samePoint = (a: Point, b: Point) => a.x===b.x && a.y===b.y;

/** Kurbo's `simplify_bezpath`: simplify each tangent-continuous run; keep isolated segments and hard corners verbatim. */
export function simplifyBezPath(input: readonly PathCommand[], accuracy: number): PathCommand[] {
  const output: PathCommand[] = [], curves: Cubic[] = [];
  let point: Point | undefined, first: Point | undefined, single: PathCommand | undefined, needsMove = true;
  const flush = () => {
    if (!curves.length) return;
    if (needsMove) { const p=curves[0][0]; output.push(["M",p.x,p.y]); needsMove=false; }
    if (curves.length===1) output.push(single!);
    else for (const [,a,b,c] of fitSource(new CubicFitSource(curves),accuracy)) output.push(["C",a.x,a.y,b.x,b.y,c.x,c.y]);
    curves.length=0;
  };
  for (const cmd of input) {
    if (cmd[0]==="M") {
      flush(); point=first={x:cmd[1],y:cmd[2]}; needsMove=true;
    } else if (cmd[0]==="Z") {
      flush(); output.push(["Z"]); point=first; needsMove=true;
    } else if (point) {
      let curve: Cubic;
      if (cmd[0]==="C") curve=[point,{x:cmd[1],y:cmd[2]},{x:cmd[3],y:cmd[4]},{x:cmd[5],y:cmd[6]}];
      else {
        // Kurbo raises a line to a cubic with its control points on its ends: the fit then sees no direction
        // at a join between lines, and moves along each line as a smooth step, not at a constant rate.
        const end={x:cmd[1],y:cmd[2]};
        curve=[point,point,end,end];
      }
      if (curve.every(p=>samePoint(p,curve[0]))) continue;
      const previous=curves.at(-1);
      if (previous) {
        const a=cubicStartDirection(reverseCubic(previous)), b=cubicStartDirection(curve);
        if (a && b && Math.abs(a.x*b.y-a.y*b.x)>1e-3*Math.abs(a.x*b.x+a.y*b.y)) flush();
      }
      curves.push(curve); single=cmd; point=curve[3];
    }
  }
  flush();
  return output;
}

/** Native `simplify_path`: Kurbo's simplification, kept from straying far from the path where its fit does. */
export function simplifyPath(input: readonly PathCommand[], accuracy: number): PathCommand[] {
  return simplifyKeeping(input, accuracy, simplifyBezPath);
}

/** Native Pencil: `simplify_path(line samples, 0.75)`. Corners stay, nearly straight runs are fitted, and the
 * fitted stroke stays where it was drawn (upstream #1741). */
export function simplifyPencil(points: readonly Point[]): readonly PathCommand[] {
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Pencil points must remain finite");
  for (let i = 1; i < points.length; i++) if (!Number.isFinite(points[i].x - points[i - 1].x) || !Number.isFinite(points[i].y - points[i - 1].y)) throw new Error("Pencil segment overflowed");
  const path = simplifyPath(points.map((p, i): PathCommand => [i ? "L" : "M", p.x, p.y]), .75);
  if (path.some(command => command.slice(1).some(value => typeof value === "number" && !Number.isFinite(value)))) throw new Error("Pencil fitting geometry overflowed");
  return path;
}
