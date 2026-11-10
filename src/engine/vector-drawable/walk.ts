import { multiply, type Affine } from "../affine";
import { maskOutline, paintedStrokePath } from "../boolean-result";
import { withAlpha } from "../colour";
import { isFrameLike, isLeaf, layerTransform, rectanglePaints, type Document, type DocumentNode, type LayerNode } from "../document";
import type { ExportSetting } from "../export-settings";
import { lineStrokePath } from "../line-stroke";
import { reversedRuns } from "../paint-runs";
import { normaliseBooleanPath } from "../path-boolean";
import { expand } from "../render-bounds";
import { isClosedShape, shapePath, strokeGeometry } from "../shape-path";
import { clippedSideStrokePath, sideStrokeGeometry } from "../side-stroke";
import type { Paint } from "../solid-paint";
import { defaultStroke, hasVisibleStroke } from "../stroke";
import { closedStrokeRing } from "../stroke-geometry";
import { networkFromPath } from "../vector-network";
import { pathBounds } from "../vector-path";
import { bake, cubics, itemBounds, overlaps, textRuns } from "./geometry";
import { drawableGradient } from "./gradient";
import { DrawableWarnings } from "./warnings";
import type { DrawableItem, DrawablePath, PathItem } from "./xml";

function scaleAlpha(items:DrawableItem[],opacity:number) {
  for (const it of items) {
    if ("children" in it) {scaleAlpha(it.children,opacity); continue;}
    const fill=it.fill;
    if (fill && "r" in fill) it.fill=withAlpha(fill,fill.a*opacity);
    else if (fill) it.fill={...fill,stops:fill.stops.map(s=>({...s,color:withAlpha(s.color,s.color.a*opacity)}))};
    if (it.stroke) it.stroke={...it.stroke,color:withAlpha(it.stroke.color,it.stroke.color.a*opacity)};
  }
}
function writable(path:DrawablePath) {
  return path.every(c=>c.every((v,i)=>i===0 || Number.isFinite(v) && Math.abs(Number(v))<=1e7));
}
function nativeStroke(n:LayerNode,[a,b,c,d]:Affine) {
  const s=n.stroke ?? defaultStroke, scale=(a*a+b*b+c*c+d*d)/2;
  if (n.kind==="text" || n.kind==="booleanOp" || n.kind==="group" || !(scale>0 && Number.isFinite(scale)) ||
    Math.abs(a*c+b*d)>1e-6*scale || Math.abs(a*a+b*b-c*c-d*d)>1e-6*scale ||
    s.align!=="center" || s.sides || s.widthProfile?.points.length || s.brush || s.dashes.length ||
    s.capStart!==s.capEnd || !["none","round","square"].includes(s.capStart) ||
    n.kind==="vector" && n.network.vertices.some(v=>v.join && v.join!==s.join || v.cap!==undefined)) return;
  const width=s.weight*Math.sqrt(Math.abs(a*d-b*c));
  if (!(width>0 && Number.isFinite(width))) return;
  return {width,cap:s.capStart==="none" ? "butt" : s.capStart,join:s.join,miter:Math.max(1,s.miterLimit)};
}

export class DrawableWalker {
  readonly warnings:DrawableWarnings;
  private used=new Set<string>();
  private suffix=new Map<string,number>();
  private mode:NonNullable<ExportSetting["vdCompat"]>;
  constructor(private doc:Document,private setting:ExportSetting) {
    this.mode=setting.vdCompat ?? "bestEffort";
    this.warnings=new DrawableWarnings(this.mode==="ignore");
  }
  private name(raw:string) {
    let base=Array.from(raw).slice(0,200).join("");
    if (!base.trim()) base="layer";
    let k=this.suffix.get(base) ?? 1, candidate:string;
    do {candidate=k===1 ? base : base+"_"+k; k++;} while (this.used.has(candidate));
    this.used.add(candidate); this.suffix.set(base,k); return candidate;
  }
  private fill(n:LayerNode,p:Paint,local:DrawablePath,even:boolean,world:Affine,items:DrawableItem[]) {
    if (!p.visible || p.opacity<=0 || !local.length) return;
    if (p.type==="image" || p.type==="pattern") {
      this.warnings.add(p.type==="image" ? "imageFill" : "patternFill",n.name); return;
    }
    if (p.type==="gradient" && p.kind==="diamond") {
      if (this.mode==="ignore") return;
      this.warnings.add(this.mode==="exact" ? "diamondOmitted" : "diamondApprox",n.name);
      if (this.mode==="exact") return;
    }
    if (p.type==="solid" && p.color.a<=0) return;
    const paint=p.type==="solid" ? {fill:withAlpha(p.color,p.color.a*p.opacity)} : drawableGradient(p,p.opacity,world,n.width,n.height);
    if (p.blend!=="normal" && p.blend!=="passThrough") this.warnings.add("blend",n.name);
    let data:DrawablePath=bake(local,world);
    if (!writable(data)) {this.warnings.add("tooLarge",n.name); return;}
    if (even && this.mode==="bestEffort") {
      try {data=normaliseBooleanPath(cubics(data),true); even=false; this.warnings.add("evenOddRewritten",n.name);}
      catch {this.warnings.add("evenOddKept",n.name);}
    }
    if (!paint || !data.length) return;
    const box=pathBounds(cubics(data)) ?? {x:0,y:0,width:0,height:0};
    const path:PathItem={box,data,fill:paint.fill,even};
    if (paint.group) {
      path.data=bake(data,paint.group.inverse);
      items.push({box,transform:paint.group.transform,children:[path]});
    } else items.push(path);
  }
  private strokes(n:LayerNode,world:Affine,items:DrawableItem[]) {
    if (!hasVisibleStroke(n)) return;
    const props=n.stroke ?? defaultStroke, native=nativeStroke(n,world);
    let area:DrawablePath | undefined;
    for (const p of n.strokes ?? []) {
      if (!p.visible || p.opacity<=0) continue;
      if (native && p.type==="solid") {
        if (p.blend!=="normal" && p.blend!=="passThrough") this.warnings.add("blend",n.name);
        const color=withAlpha(p.color,p.color.a*p.opacity);
        if (!color.a) continue;
        const data=bake(strokeGeometry(n),world);
        if (!writable(data)) {this.warnings.add("tooLarge",n.name); continue;}
        const bounds=pathBounds(cubics(data));
        if (bounds) items.push({data,box:expand(bounds,native.width/2*Math.max(native.miter,Math.SQRT2)),stroke:{...native,color}});
      } else {
        if (!area) {
          const sides=sideStrokeGeometry(n);
          area=sides ? clippedSideStrokePath(sides) : n.kind==="line" && !props.widthProfile?.points.length && !props.brush
            ? lineStrokePath(n.width,props) : closedStrokeRing(n) ?? paintedStrokePath(this.doc,n) ?? [];
        }
        const even=!!props.sides || !props.dashes.length && isClosedShape(n) && props.align!=="center";
        this.fill(n,p,area,even,world,items);
      }
    }
  }
  private clipped(n:LayerNode,path:DrawablePath,even:boolean,kids:DrawableItem[]) {
    if (!kids.length || !path.length) return;
    if (!writable(path)) {this.warnings.add("tooLarge",n.name); return;}
    if (even && this.mode!=="ignore") {
      try {
        path=normaliseBooleanPath(cubics(path),true);
        if (this.mode==="bestEffort") this.warnings.add("clipEvenOddRewritten",n.name);
      } catch {
        this.warnings.add(this.mode==="exact" ? "clipEvenOddOmitted" : "clipEvenOddApprox",n.name);
        if (this.mode==="exact") return;
      }
    }
    const a=pathBounds(cubics(path)); if (!a) return;
    const b=itemBounds(kids), x=Math.max(a.x,b.x), y=Math.max(a.y,b.y);
    const box={x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
    return {box,clip:path,children:kids};
  }
  private children(n:DocumentNode,world:Affine,depth:number) {
    const out:DrawableItem[]=[];
    if (isLeaf(n)) return out;
    const ids=n.children;
    const reverse=isFrameLike(n) && n.layout?.reverseZ ? reversedRuns(this.doc,ids) : undefined;
    for (let cursor=0;cursor<(reverse?.length ?? ids.length);cursor++) {
      const i=reverse ? reverse[cursor] : cursor, mask=this.doc.nodes[ids[i]];
      if (!mask?.isMask || mask.kind==="page" || mask.visible===false) {
        for (const it of this.node(ids[i],world,depth+1)) out.push(it);
        continue;
      }
      let end=i+1;
      while (end<ids.length && !this.doc.nodes[ids[end]]?.isMask) end++;
      if (!reverse) cursor=end-1;
      if (mask.maskType!=="vector") {
        this.warnings.add(this.mode==="exact" ? "maskOmitted" : "maskApprox",mask.name);
        if (this.mode==="exact") continue;
      }
      const kids:DrawableItem[]=[];
      for (let j=i+1;j<end;j++) for (const it of this.node(ids[j],world,depth+1)) kids.push(it);
      const outline=maskOutline(this.doc,mask,depth+1);
      if (outline) {
        const group=this.clipped(mask,bake(outline.path,multiply(world,layerTransform(mask))),outline.rule==="evenodd",kids);
        if (group) out.push(group);
      }
    }
    return out;
  }
  node(id:string,parent:Affine,depth:number):DrawableItem[] {
    const n=this.doc.nodes[id];
    if (!n || depth>256 || n.isMask || n.kind!=="page" && n.visible===false || (n.opacity ?? 1)<=0) return [];
    const world=n.kind==="page" ? parent : multiply(parent,layerTransform(n));
    for (const e of n.effects ?? []) if (e.visible) this.warnings.add(e.type,n.name);
    if (n.blend && n.blend!=="normal" && n.blend!=="passThrough") this.warnings.add("blend",n.name);
    const items:DrawableItem[]=[];
    if (n.kind==="text") {
      const runs=textRuns(n);
      for (const run of runs) for (const p of run.paints) this.fill(n,p,run.path,false,world,items);
      if (hasVisibleStroke(n)) for (const run of runs) {
        const vector={...n,kind:"vector" as const,network:networkFromPath(cubics(run.path))};
        const area=paintedStrokePath(this.doc,vector) ?? [], props=n.stroke ?? defaultStroke;
        for (const p of n.strokes ?? []) this.fill(n,p,area,!!props.sides || !props.dashes.length && props.align!=="center",world,items);
      }
    } else {
      const outline=n.kind==="booleanOp" || n.kind==="vector" ? maskOutline(this.doc,n,0) :
        n.kind!=="page" && n.kind!=="group" ? {path:shapePath(n),rule:"nonzero"} : undefined;
      if (outline && n.kind!=="page" && isClosedShape(n)) {
        for (const p of rectanglePaints(n)) this.fill(n,p,outline.path,outline.rule==="evenodd",world,items);
      }
      if (!isLeaf(n) && n.kind!=="booleanOp" && n.children.length) {
        const kids=this.children(n,world,depth);
        if (isFrameLike(n) && n.clip && outline) {
          const group=this.clipped(n,bake(outline.path,world),outline.rule==="evenodd",kids);
          if (group) items.push(group);
        } else for (const it of kids) items.push(it);
      }
      if (n.kind!=="page") this.strokes(n,world,items);
    }
    const opacity=n.opacity ?? 1;
    if (opacity<1) {
      if (overlaps(items)) {
        if (this.mode==="exact") {this.warnings.add("opacityOmitted",n.name); return [];}
        if (this.mode==="bestEffort") {this.warnings.add("opacityApprox",n.name); scaleAlpha(items,opacity);}
      } else scaleAlpha(items,opacity);
    }
    if (this.setting.svgIdAttribute && items.length) {
      if (!isLeaf(n) && n.kind!=="booleanOp" && n.children.length) return [{box:itemBounds(items),name:this.name(n.name),children:items}];
      for (const it of items) it.name=this.name(n.name);
    }
    return items;
  }
}
