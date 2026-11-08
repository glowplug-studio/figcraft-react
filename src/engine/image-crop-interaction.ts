import { inverse, transformPoint } from "./affine";
import { canvasAccent } from "./canvas-colours";
import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import { cropFromRect, cropRect, placementCrop } from "./image-placement";
import type { CanvasImages } from "./image-renderer";
import { handleAt } from "./transform-handles";
import { pageToScreen, screenToPage, viewOrigin } from "./viewport";

type Rect = ReturnType<typeof cropRect>;
const box:Rect = [0,0,1,1];
const corners = ([left,top,right,bottom]:Rect): Point[] => [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y);
type Target = NonNullable<ReturnType<ImageCropInteraction["target"]>>;

/** Crop image corners stretch the picture. In explicit crop mode the layer's own handles resize the box. */
export class ImageCropInteraction {
  #drag?: {target:Target; hit:number; start:Point};
  constructor(private engine:EditorEngine) {}
  get active() {return !!this.#drag;}
  target() {
    const target=this.engine.pickedCrop();
    if (!target) return;
    const {node,resource,paint}=target, view=this.engine.getView();
    if (!node.width || !node.height) return;
    try {
      const matrix=worldTransform(this.engine.getRenderDocument(),node.id), inv=inverse(matrix);
      const rect=cropRect(placementCrop(paint,resource.width,resource.height,node.width,node.height));
      const screen=(u:Point)=>pageToScreen(view,transformPoint(matrix,{x:u.x*node.width,y:u.y*node.height}));
      const unit=(p:Point)=>{
        const local=transformPoint(inv,screenToPage(view,p));
        return {x:local.x/node.width,y:local.y/node.height};
      };
      return {...target,rect,unit,matrix,outer:corners(rect).map(screen),inner:corners(box).map(screen)};
    } catch { return; }
  }
  #hit(t:Target,p:Point) {
    if (this.engine.getSnapshot().crop) {
      const handle=handleAt(t.inner,p,1);
      if (handle && handle.kind!=="rotate") return "layer";
    }
    const corner=t.outer.findIndex(c=>distance(c,p)<=8);
    if (corner>=0) return corner;
    const [x0,y0,x1,y1]=t.rect, u=t.unit(p);
    if (u.x>=Math.min(x0,x1) && u.x<=Math.max(x0,x1) && u.y>=Math.min(y0,y1) && u.y<=Math.max(y0,y1)) return 4;
  }
  cursor(p:Point) {
    const t=this.target(); if (!t) return;
    const hit=this.#hit(t,p);
    if (typeof hit==="number") return hit===4 ? "move" : hit%2 ? "nesw-resize" : "nwse-resize";
  }
  down(p:Point) {
    const target=this.target(); if (!target || this.engine.interacting) return false;
    const hit=this.#hit(target,p);
    if (hit==="layer") return "layer";
    if (hit===undefined) {this.engine.finishCrop();return false;}
    this.engine.beginInteraction(); this.#drag={target,hit,start:target.unit(p)}; return true;
  }
  move(p:Point,shift:boolean) {
    const drag=this.#drag; if (!drag || !this.engine.interacting) return;
    const {target,hit,start}=drag, [x0,y0,x1,y1]=target.rect, u=target.unit(p);
    let rect:Rect;
    if (hit===4) {
      const dx=u.x-start.x, dy=u.y-start.y;
      rect=[x0+dx,y0+dy,x1+dx,y1+dy];
    } else {
      const c=corners(target.rect), a=c[(hit+2)%4], ow=c[hit].x-a.x, oh=c[hit].y-a.y;
      let w=u.x-a.x,h=u.y-a.y;
      if (!shift) {
        const {width,height}=target.node;
        const factor=Math.max(Math.abs(w*width)/Math.max(1e-9,Math.abs(ow*width)),Math.abs(h*height)/Math.max(1e-9,Math.abs(oh*height)));
        w=ow*factor; h=oh*factor;
      }
      if (Math.abs(w)<.001 || Math.abs(h)<.001 || Math.sign(w)!==Math.sign(ow) || Math.sign(h)!==Math.sign(oh)) return;
      rect=[a.x,a.y,a.x+w,a.y+h];
    }
    this.engine.previewPaint(target.picker,{...target.paint,crop:cropFromRect(...rect)});
  }
  up() {if(this.#drag){this.#drag=undefined;this.engine.commitInteraction();}}
  cancel() {if(this.#drag){this.#drag=undefined;this.engine.cancelInteraction();}}
  draw(ctx:CanvasRenderingContext2D,images?:CanvasImages) {
    const t=this.target(); if (!t) return;
    const {node,paint,matrix,outer,inner}=t, view=this.engine.getView();
    if (images && (!paint.crop || !paint.crop[1] && !paint.crop[2])) {
      const [l,u,r,b]=t.rect, x0=Math.min(l,r),x1=Math.max(l,r),y0=Math.min(u,b),y1=Math.max(u,b);
      const bands=[[x0,y0,x1,Math.min(0,y1)],[x0,Math.max(1,y0),x1,y1],
        [x0,Math.max(0,y0),Math.min(0,x1),Math.min(y1,1)],[Math.max(1,x0),Math.max(0,y0),x1,Math.min(y1,1)]];
      ctx.save();
      try {
        const origin=viewOrigin(view);
        ctx.scale(view.zoom,view.zoom);ctx.translate(-origin.x,-origin.y);ctx.transform(...matrix);
        ctx.beginPath();
        let visible=false;
        for (const [x,y,right,bottom] of bands) {
          if (right-x<=1e-9 || bottom-y<=1e-9) continue;
          ctx.rect(x*node.width,y*node.height,(right-x)*node.width,(bottom-y)*node.height); visible=true;
        }
        if (visible) {ctx.clip();ctx.globalAlpha=115/255;images.drawGhost(ctx,paint,node.width,node.height);}
      } finally {ctx.restore();}
    }
    const accent=canvasAccent(this.engine.getRenderDocument());
    ctx.save();
    const line=(points:Point[],colour:string,width:number)=>{
      ctx.beginPath();points.forEach((p,i)=>i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
      ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.stroke();
    };
    line([...outer,outer[0]],"white",2);line([...outer,outer[0]],accent,1);
    for (const p of outer) {ctx.fillStyle="white";ctx.fillRect(p.x-4,p.y-4,8,8);ctx.strokeStyle=accent;ctx.strokeRect(p.x-3.5,p.y-3.5,7,7);}
    if (this.engine.getSnapshot().crop) {
      for (let i=0;i<4;i++) {
        const p=inner[i], prev=inner[(i+3)%4], next=inner[(i+1)%4];
        const lp=distance(prev,p), ln=distance(next,p);
        if (!lp || !ln) continue;
        const dx=(prev.x-p.x)/lp,dy=(prev.y-p.y)/lp,ex=(next.x-p.x)/ln,ey=(next.y-p.y)/ln;
        const at={x:p.x+(dx+ex)*2.5,y:p.y+(dy+ey)*2.5};
        const mid={x:(p.x+next.x)/2+dx*2.5,y:(p.y+next.y)/2+dy*2.5}, half=Math.min(12,ln/6);
        const bracket=[{x:at.x+dx*Math.min(22,lp/3),y:at.y+dy*Math.min(22,lp/3)},at,{x:at.x+ex*Math.min(22,ln/3),y:at.y+ey*Math.min(22,ln/3)}];
        const bar=[{x:mid.x-ex*half,y:mid.y-ey*half},{x:mid.x+ex*half,y:mid.y+ey*half}];
        for(const points of [bracket,bar]){line(points,"rgba(0,0,0,.196)",7);line(points,accent,5);}
      }
    }
    ctx.restore();
  }
}
