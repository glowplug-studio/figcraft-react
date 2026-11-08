import { inverse, transformPoint } from "./affine";
import { canvasAccent } from "./canvas-colours";
import { renderColour, withAlpha } from "./colour";
import type { EditorEngine, PaintPicker } from "./editor";
import type { Point } from "./geometry";
import { sampleSorted, sortedStops, squareLinearWidth, type GradientHandle } from "./gradient";
import { worldTransform } from "./hierarchy";
import type { GradientPaint } from "./solid-paint";
import { pageToScreen, screenToPage } from "./viewport";

type Handle = "from" | "to" | "width";
type Hit = Handle | { stop:number } | { insert:number };
const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y);
const along = (a:Point,b:Point,t:number):Point => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function project(a:Point,b:Point,p:Point) {
  const x=b.x-a.x,y=b.y-a.y,length=x*x+y*y;
  return length<1e-6 ? undefined : Math.fround(Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/length)));
}

export class GradientInteraction {
  #drag?: { hit:Handle | {stop:number}; paint:GradientPaint; picker:PaintPicker; id:string };
  constructor(private engine:EditorEngine) {}
  get active() { return !!this.#drag; }

  private target() {
    const target=this.engine.pickedGradient();
    if (!target) return;
    const {node,paint}=target;
    const matrix=worldTransform(this.engine.getRenderDocument(),node.id), view=this.engine.getView();
    const screen=([x,y]:GradientHandle) => pageToScreen(view,transformPoint(matrix,{x:x*node.width,y:y*node.height}));
    return {...target,matrix,from:screen(paint.from),to:screen(paint.to),width:screen(paint.width)};
  }
  private hit(target:NonNullable<ReturnType<GradientInteraction["target"]>>, point:Point):Hit|undefined {
    for (const key of ["from","to","width"] as const) {
      if ((key!=="width" || target.paint.kind!=="linear") && distance(target[key],point)<=8) return key;
    }
    const stop=target.paint.stops.findIndex(s=>distance(along(target.from,target.to,s.position),point)<=8);
    if (stop>=0) return {stop};
    const t=project(target.from,target.to,point);
    if (t!==undefined && distance(along(target.from,target.to,t),point)<=5) return {insert:t};
  }
  cursor(point:Point) {
    const target=this.target(), hit=target && this.hit(target,point);
    return hit === undefined ? undefined : typeof hit==="object" && "insert" in hit ? "copy" : "grab";
  }
  down(point:Point) {
    const target=this.target(), hit=target && this.hit(target,point);
    if (!target || hit===undefined || this.engine.interacting) return false;
    let {paint,picker}=target;
    let part:Handle | {stop:number};
    if (typeof hit==="object") {
      const index="insert" in hit ? paint.stops.length : hit.stop;
      picker={...picker,stop:index}; this.engine.setPaintPicker(picker);
      if ("insert" in hit) {
        const color=sampleSorted(sortedStops(paint.stops),hit.insert);
        paint={...paint,stops:[...paint.stops,{position:hit.insert,color}]};
      }
      part={stop:index};
    } else part=hit;
    this.engine.beginInteraction();
    this.#drag={hit:part,paint,picker,id:target.node.id};
    if (paint!==target.paint) this.engine.previewPaint(picker,paint);
    return true;
  }
  move(point:Point) {
    const target=this.target(), drag=this.#drag;
    if (!drag || !target || !this.engine.interacting || drag.id!==target.node.id) return;
    const {paint,hit}=drag;
    let next:GradientPaint;
    if (typeof hit==="object") {
      const position=project(target.from,target.to,point);
      if (position===undefined) return;
      next={...paint,stops:paint.stops.map((s,i)=>i===hit.stop ? {...s,position} : s)};
    } else {
      const local=transformPoint(inverse(target.matrix),screenToPage(this.engine.getView(),point));
      const {width,height}=target.node;
      const unit:GradientHandle=[local.x/Math.max(1e-9,width), local.y/Math.max(1e-9,height)];
      next={...paint,[hit]:unit};
      if (next.kind==="linear" && hit!=="width") next={...next,width:squareLinearWidth(next.from,next.to,width,height)};
    }
    this.engine.previewPaint(drag.picker,next);
  }
  up() { if (this.#drag) { this.#drag=undefined; this.engine.commitInteraction(); } }
  cancel() { if (this.#drag) { this.#drag=undefined; this.engine.cancelInteraction(); } }
  draw(context:CanvasRenderingContext2D) {
    const target=this.target(); if (!target) return;
    const {from,to,width,paint,picker}=target,accent=canvasAccent(this.engine.getRenderDocument());
    context.save();
    context.globalAlpha=1;
    const line=(end:Point,colour:string,weight:number) => {
      context.beginPath(); context.moveTo(from.x,from.y); context.lineTo(end.x,end.y);
      context.strokeStyle=colour; context.lineWidth=weight; context.stroke();
    };
    line(to,"white",2); line(to,"rgba(0,0,0,.47)",1);
    if (paint.kind!=="linear") {context.setLineDash([4,3]); line(width,"white",1); context.setLineDash([]);}
    paint.stops.forEach((stop,i)=>{
      const p=along(from,to,stop.position);
      context.fillStyle=renderColour(withAlpha(stop.color,1)); context.fillRect(p.x-6,p.y-6,12,12);
      context.strokeStyle="white"; context.lineWidth=2; context.strokeRect(p.x-7,p.y-7,14,14);
      if (i===picker.stop) {context.strokeStyle=accent; context.lineWidth=1.5; context.strokeRect(p.x-9,p.y-9,18,18);}
    });
    for (const p of paint.kind==="linear" ? [from,to] : [from,to,width]) {
      context.beginPath(); context.arc(p.x,p.y,5,0,2*Math.PI); context.fillStyle="white"; context.fill();
      context.strokeStyle=accent; context.lineWidth=1.5; context.stroke();
    }
    context.restore();
  }
}
