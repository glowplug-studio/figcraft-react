import { transformPoint, type Affine } from "./affine";
import type { Point } from "./geometry";
import { measurePath, polylineAt, polylineLength, type MeasuredPolyline } from "./path-measure";
import { parseSvgPath } from "./svg-path";
import type { TextData } from "./text-data";
import type { FlowLine } from "./text-flow";

export class TextOnPath {
  private constructor(private line:MeasuredPolyline, private origin:number,
    private flip:boolean, private baseline:number, private closed:boolean) {}

  static from(path:NonNullable<TextData["path"]>, shift:number, baseline:number) {
    let elements;
    try { elements=parseSvgPath(path.d,true); } catch { return undefined; }
    if (elements.length>20_000) return undefined;
    const line=measurePath(elements)?.[0];
    if (!line) return undefined;
    const first=line.points[0], last=line.points[line.points.length-1];
    const closed=line.closed || Math.hypot(last.x-first.x,last.y-first.y)<1e-6;
    const start=Number.isFinite(path.start) ? Math.max(0,Math.min(1,path.start)) : 0;
    return new TextOnPath(line,start*polylineLength(line)-shift,path.flip,baseline,closed);
  }

  frame(x:number,y:number):Affine | undefined {
    const length=polylineLength(this.line);
    let along=this.origin+x;
    if (length<=1e-9 || !Number.isFinite(along)) return undefined;
    if (this.closed) {
      along%=length;
      if (along<0) along+=length;
    }
    if (along<0 || along>length) return undefined;
    const t=along/length, sample=polylineAt(this.line,this.flip ? 1-t : t);
    if (!sample) return undefined;
    const {point,normal}=sample;
    const dx=this.flip ? -normal.y : normal.y, dy=this.flip ? normal.x : -normal.x;
    const angle=Math.atan2(dy,dx), a=Math.cos(angle), b=Math.sin(angle), below=y-this.baseline;
    return [a,b,-b,a,point.x-dy*below-a*x+b*y,point.y+dx*below-b*x-a*y];
  }
}

export function textWarpPoint(layout:{lines:readonly FlowLine[]; onPath?:TextOnPath},x:number,y:number):Point {
  const point={x,y};
  if (!layout.onPath) return point;
  const line=layout.lines.find(line=>y<=line.top+line.height) ?? layout.lines.at(-1);
  const frame=layout.onPath.frame(x,line?.baseline ?? y);
  return frame ? transformPoint(frame,point) : point;
}
