import { multiply, transformBounds, type Affine } from "./affine";
import { hasBackdrop, renderBackdrop, backdropPadding } from "./backdrop-renderer";
import { maskOutline } from "./boolean-result";
import { renderAreaPixels } from "./canvas";
import { beneathDocument } from "./backdrop-document";
import { isFrameLike,type Document,type LayerNode } from "./document";
import type { Rectangle } from "./geometry";
import { worldTransform } from "./hierarchy";
import { intersect } from "./render-bounds";
import { shapePath } from "./shape-path";
import { pathBounds } from "./vector-path";

export function effectView(box: Rectangle | undefined, rate=2) {
  if (!box || !(box.width>0 && box.height>0) || !Object.values(box).every(Number.isFinite)) return;
  const scale=Math.min(rate,4096/Math.max(box.width,box.height));
  const xf:Affine=[scale,0,0,scale,-box.x*scale,-box.y*scale];
  return {box,scale,xf,width:Math.max(1,Math.ceil(box.width*scale)),height:Math.max(1,Math.ceil(box.height*scale))};
}
export type EffectView = NonNullable<ReturnType<typeof effectView>>;

export function isolatedEffectDocument(doc:Document,node:LayerNode,plain:boolean):Document {
  const effects=plain ? [] : node.effects?.filter(e=>e.type!=="backgroundBlur" && e.type!=="glass");
  const replacement:LayerNode={...node,isMask:false,effects,...(plain && {opacity:1,blend:"normal"})};
  const nodes={...doc.nodes,[node.id]:replacement};
  return {...doc,nodes};
}

export async function backdropPixels<T>(doc:Document,node:LayerNode,roots:readonly string[],consume:(canvas:HTMLCanvasElement,v:EffectView)=>Promise<T>,keep?:Rectangle) {
  if (!hasBackdrop(node)) return;
  const outline=isFrameLike(node) ? shapePath(node) : maskOutline(doc,node,0)?.path;
  const bounds=outline && pathBounds(outline);
  if (!bounds) return;
  const world=worldTransform(doc,node.id), box=transformBounds(multiply(world,[1,0,0,1,bounds.x,bounds.y]),bounds.width,bounds.height);
  const v=effectView(keep ? intersect(box,keep) : box);
  if (!v) return;
  const pad=backdropPadding(node,v.scale);
  const area={x:v.box.x-pad/v.scale,y:v.box.y-pad/v.scale,width:(v.width+2*pad)/v.scale,height:(v.height+2*pad)/v.scale};
  const canvas=document.createElement("canvas");
  let rendered:CanvasRenderingContext2D|undefined;
  try {
    await renderAreaPixels(canvas,beneathDocument(doc,roots,node.id),area,v.scale,roots,undefined,1e-6);
    const ctx=canvas.getContext("2d")!;
    if (keep) {
      const pixel=(a:number,b:number)=>Math.ceil((a-b)*v.scale-.5);
      const left=pixel(keep.x,area.x),top=pixel(keep.y,area.y);
      const right=pixel(keep.x+keep.width,area.x),bottom=pixel(keep.y+keep.height,area.y);
      ctx.save();ctx.resetTransform();
      ctx.clearRect(0,0,left,canvas.height);ctx.clearRect(right,0,canvas.width,canvas.height);
      ctx.clearRect(0,0,canvas.width,top);ctx.clearRect(0,bottom,canvas.width,canvas.height);
      ctx.restore();
    }
    rendered=renderBackdrop(ctx,doc,node,pad,pad,v.width,v.height,multiply(v.xf,world),v.scale);
    if (rendered) return await consume(rendered.canvas,v);
  } finally {
    if (rendered) rendered.canvas.width=rendered.canvas.height=0;
    canvas.width=canvas.height=0;
  }
}
