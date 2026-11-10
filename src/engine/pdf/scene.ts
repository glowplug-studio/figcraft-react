import { identity, inverse, multiply, type Affine } from "../affine";
import { maskOutline, paintedStrokePath } from "../boolean-result";
import { isFrameLike, isLeaf, layerBlend, layerTransform, rectanglePaints, type Document, type DocumentNode, type LayerNode } from "../document";
import { gradientFrame } from "../gradient";
import { worldTransform } from "../hierarchy";
import { lineStrokePath } from "../line-stroke";
import { reversedRuns } from "../paint-runs";
import { shapePath, isClosedShape } from "../shape-path";
import { clippedSideStrokePath, sideStrokeGeometry } from "../side-stroke";
import type { Paint } from "../solid-paint";
import { defaultStroke, hasVisibleStroke } from "../stroke";
import { closedStrokeRing } from "../stroke-geometry";
import { bake } from "../vector-drawable/geometry";
import type { CurveElement } from "../curve-flatten";
import { vectorPaintRegions } from "../vector-presentation";
import { pdfPath, PdfGraphics } from "./graphics";
import { nums, PdfObjects, PdfSurface } from "./objects";
import type { PdfPage } from "./pages";
import { imagePaint } from "./paint-images";
import { drawEffect, pdfEffects } from "./effects";
import { PdfImages } from "./images";
import { ink } from "./sheet";
import { drawPdfText, type PdfLink } from "./text";
import type { PdfFonts } from "./fonts";
import type { GradientPaint } from "../solid-paint";

type Path=readonly CurveElement[];
export class PdfScene {
  readonly graphics:PdfGraphics;
  readonly origin:Affine;
  readonly surface=new PdfSurface();
  readonly links:PdfLink[]=[];
  tiling=0;
  depth=0;
  constructor(readonly doc:Document,readonly page:PdfPage,file:PdfObjects,readonly cmyk:boolean,readonly fonts:PdfFonts | undefined,readonly images:PdfImages,private checkpoint:()=>Promise<void>) {
    const {sheet,area}=page;
    this.graphics=new PdfGraphics(file,sheet.width,sheet.height);
    this.origin=[1,0,0,1,sheet.margin-area.x,sheet.margin-area.y];
  }
  async paint(s:PdfSurface,p:Paint,path:Path,rule:CanvasFillRule,world:Affine,w:number,h:number,mask:boolean) {
    if (!path.length || !p.visible || p.opacity<=0 || !world.every(v=>Number.isFinite(v) && Math.abs(v)<1e21)) return;
    const cmyk=this.cmyk && !mask, even=rule==="evenodd";
    if (p.type==="solid") {
      const geometry=pdfPath(bake(path,world));
      s.ops.push("q"); this.graphics.state(s,p.opacity*p.color.a,p.blend);
      s.ops.push(nums(ink(p.color,cmyk))+(cmyk ? " k" : " rg"),geometry,even ? "f*" : "f","Q");
    } else if (p.type==="gradient" && (p.kind==="linear" || p.kind==="radial")) {
      await this.shade(s,p,path,rule,world,w,h,mask);
    } else await imagePaint(this,s,p,path,rule,world,w,h,mask);
  }
  async shade(s:PdfSurface,p:GradientPaint,path:Path,rule:CanvasFillRule,world:Affine,w:number,h:number,mask:boolean,pagePath=false) {
    const cmyk=this.cmyk && !mask, even=rule==="evenodd";
    const geometry=pdfPath(pagePath ? path : bake(path,world));
    const frame=multiply(world,gradientFrame(p,w,h));
    if (!Number.isFinite(frame[0]*frame[3]-frame[1]*frame[2]) || frame[0]*frame[3]===frame[1]*frame[2]) return;
    s.ops.push("q",geometry,even ? "W* n" : "W n");
    const alpha=p.stops[0]?.color.a ?? 1;
    if (p.stops.some(stop=>stop.color.a!==alpha)) {
      const grey=new PdfSurface();
      this.graphics.shade(grey,p,frame,false,true);
      this.graphics.state(s,p.opacity,p.blend,{form:this.graphics.form(grey,"DeviceGray"),kind:"Luminosity"});
    } else this.graphics.state(s,p.opacity*alpha,p.blend);
    this.graphics.shade(s,p,frame,cmyk,false);
    s.ops.push("Q");
  }
  private async children(s:PdfSurface,n:DocumentNode,world:Affine,depth:number,mask:boolean) {
    if (isLeaf(n)) return;
    const ids=n.children,order=isFrameLike(n) && n.layout?.reverseZ ? reversedRuns(this.doc,ids) : undefined;
    for (let cursor=0;cursor<(order?.length ?? ids.length);cursor++) {
      const i=order ? order[cursor] : cursor, child=this.doc.nodes[ids[i]];
      if (!child?.isMask || child.kind==="page" || child.visible===false) {
        await this.node(s,ids[i],world,depth+1,mask); continue;
      }
      let end=i+1; while (end<ids.length && !this.doc.nodes[ids[end]]?.isMask) end++;
      if (!order) cursor=end-1;
      if (end===i+1) continue;
      s.ops.push("q");
      let painted=s;
      if (child.maskType==="vector") {
        const outline=maskOutline(this.doc,child,depth+1);
        if (!outline?.path.length) {s.ops.push("Q"); continue;}
        s.ops.push(pdfPath(bake(outline.path,multiply(world,layerTransform(child)))),outline.rule==="evenodd" ? "W* n" : "W n");
      } else {
        const surface=new PdfSurface();
        await this.node(surface,child.id,world,depth+1,true,true);
        this.graphics.state(s,1,"normal",{form:this.graphics.form(surface),kind:child.maskType==="luminance" ? "Luminosity" : "Alpha"});
        painted=new PdfSurface();
      }
      for (let j=i+1;j<end;j++) await this.node(painted,ids[j],world,depth+1,mask);
      if (painted!==s && painted.ops.length) s.ops.push(s.use("XObject",this.graphics.form(painted,this.cmyk && !mask ? "DeviceCMYK" : "DeviceRGB"))+" Do");
      s.ops.push("Q");
    }
  }
  private async stroke(s:PdfSurface,n:LayerNode,world:Affine,mask:boolean) {
    if (!hasVisibleStroke(n)) return;
    const props=n.stroke ?? defaultStroke,sides=sideStrokeGeometry(n);
    const area=sides ? clippedSideStrokePath(sides) : n.kind==="line" && !props.widthProfile?.points.length && !props.brush ?
      lineStrokePath(n.width,props) : closedStrokeRing(n) ?? paintedStrokePath(this.doc,n);
    if (!area) return;
    const rule=props.sides || !props.dashes.length && props.align!=="center" && isClosedShape(n) ? "evenodd" : "nonzero";
    for (const p of n.strokes ?? []) await this.paint(s,p,area,rule,world,n.width,n.height,mask);
  }
  async node(s:PdfSurface,id:string,parent:Affine,depth:number,mask:boolean,maskRoot=false) {
    await this.checkpoint();
    const previous=this.depth;this.depth=depth;
    try {await this.layer(s,id,parent,depth,mask,maskRoot);} finally {this.depth=previous;}
  }
  private async layer(s:PdfSurface,id:string,parent:Affine,depth:number,mask:boolean,maskRoot:boolean) {
    const n=this.doc.nodes[id];
    if (!n || depth>256 || n.isMask && !maskRoot || n.kind!=="page" && n.visible===false || (n.opacity ?? 1)<=0) return;
    const world=n.kind==="page" ? parent : multiply(parent,layerTransform(n));
    const blend=n.kind==="page" ? n.blend ?? "passThrough" : layerBlend(n);
    const effects=n.kind!=="page" && n.effects?.some(e=>e.visible) ? await pdfEffects(this,n,mask) : undefined;
    if (effects?.whole) {
      if (effects.back) drawEffect(this,s,{...effects.back,blend},n.opacity);
      if (effects.layer) drawEffect(this,s,effects.layer);
      return;
    }
    for (const shadow of effects?.drop ?? []) drawEffect(this,s,shadow,n.opacity);
    const group=(n.opacity ?? 1)<1 || blend!=="passThrough" && (blend!=="normal" || !isLeaf(n) && n.kind!=="booleanOp" && n.children.length>0);
    const content=group ? new PdfSurface() : s;
    if (effects?.back) drawEffect(this,content,effects.back);
    const inner=()=>{for (const shadow of effects?.inner ?? []) drawEffect(this,content,shadow);};
    if (n.kind==="page" || n.kind==="group") {
      await this.children(content,n,world,depth,mask);
      inner();
    }
    else if (n.kind==="text") {
      await drawPdfText(this,content,n,world,mask,this.fonts);
      inner();
      await this.stroke(content,n,world,mask);
    } else {
      let path:Path=n.kind==="booleanOp" ? maskOutline(this.doc,n,0)?.path ?? [] : shapePath(n);
      const bleed=this.page.sheet.bleed;
      if (bleed>0 && this.page.ids.length===1 && id===this.page.ids[0] && isFrameLike(n))
        path=[["M",-bleed,-bleed],["L",n.width+bleed,-bleed],["L",n.width+bleed,n.height+bleed],["L",-bleed,n.height+bleed],["Z"]];
      if (n.kind==="vector") {
        for (const region of vectorPaintRegions(n)) {
          const frame=region.space;
          const geometry=frame ? bake(region.path,inverse(frame.transform)) : region.path;
          for (const p of region.paints) await this.paint(content,p,geometry,region.rule,frame ? multiply(world,frame.transform) : world,
            frame?.width ?? n.width,frame?.height ?? n.height,mask);
        }
      } else if (isClosedShape(n)) for (const p of rectanglePaints(n)) {
        await this.paint(content,p,path,n.kind==="booleanOp" ? "evenodd" : "nonzero",world,n.width,n.height,mask);
      }
      inner();
      if (!isLeaf(n) && n.kind!=="booleanOp" && n.children.length) {
        if (isFrameLike(n) && n.clip) {
          if (path.length) {
            content.ops.push("q",pdfPath(bake(path,world)),"W n");
            await this.children(content,n,world,depth,mask);
            content.ops.push("Q");
          }
        } else await this.children(content,n,world,depth,mask);
      }
      await this.stroke(content,n,world,mask);
    }
    if (group && content.ops.length) {
      s.ops.push("q"); this.graphics.state(s,n.opacity ?? 1,blend);
      s.ops.push(s.use("XObject",this.graphics.form(content,this.cmyk && !mask ? "DeviceCMYK" : "DeviceRGB"))+" Do","Q");
    }
  }
  async draw() {
    const s=this.surface, {ids,sheet}=this.page;
    s.ops.push("q",sheet.flip,"q");
    if (sheet.clip) s.ops.push(sheet.clip);
    for (const id of ids) {
      const parent=this.doc.nodes[id]?.parent;
      await this.node(s,id,multiply(this.origin,parent ? worldTransform(this.doc,parent) : identity),0,false);
    }
    s.ops.push("Q",sheet.marks,"Q");
    return s;
  }
}
