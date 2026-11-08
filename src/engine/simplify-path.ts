import type { PathCommand } from "./corners";
import { cubicStartDirection, reverseCubic, type Cubic } from "./cubic";
import { CubicFitSource } from "./fit-cubic-source";
import type { Point } from "./geometry";
import { fitSource } from "./pencil-fit";

const samePoint = (a: Point, b: Point) => a.x===b.x && a.y===b.y;

/** Simplify each tangent-continuous run; keep isolated segments and hard corners verbatim. */
export function simplifyPath(input: readonly PathCommand[], accuracy: number): PathCommand[] {
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
        const end={x:cmd[1],y:cmd[2]}, dx=(end.x-point.x)/3, dy=(end.y-point.y)/3;
        curve=[point,{x:point.x+dx,y:point.y+dy},{x:end.x-dx,y:end.y-dy},end];
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
