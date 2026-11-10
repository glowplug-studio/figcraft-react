import { inverse, multiply, transformBounds, type Affine } from "./affine";
import { blurRadius } from "./blur-renderer";
import { type Colour, toCssHex } from "./colour";
import { convertColour } from "./colour-spaces";
import { rectanglePaints, type Document, type LayerNode } from "./document";
import type { Effect } from "./effects";
import type { Rectangle } from "./geometry";
import { glassBackdropRadius } from "./glass-renderer";
import { worldTransform } from "./hierarchy";
import { base64Bytes } from "./recovery";
import { expand, union, worldRenderBounds } from "./render-bounds";
import { shadowOutlines, type ShadowOutline } from "./shadow-renderer";
import { svgBlend, svgMatrix, svgNumber as num, svgPath } from "./svg-format";
import { pathBounds } from "./vector-path";

type Shadow = Extract<Effect,{type:"dropShadow"|"innerShadow"}>;
const reference = (key: string, id?: string) => id ? ' '+key+'="url(#'+id+')"' : "";
const regionAttrs = (r: Rectangle) => ' x="'+num(r.x)+'" y="'+num(r.y)+'" width="'+num(r.width)+'" height="'+num(r.height)+'"';
const pathAttrs = (o: ShadowOutline, xf: Affine) => ' transform="'+svgMatrix(xf)+'" d="'+svgPath(o.path)+'"';
const ruleAttr = (o: ShadowOutline, key="fill-rule") => o.rule === "evenodd" ? ' '+key+'="evenodd"' : "";
const offset = (xf: Affine, s: Shadow) => multiply([1,0,0,1,...s.offset],xf);

function transformBox(box: Rectangle, xf: Affine) {
  return transformBounds(multiply(xf,[1,0,0,1,box.x,box.y]),box.width,box.height);
}

function outlineBox(outlines: readonly ShadowOutline[], xf: Affine) {
  let result: Rectangle | undefined;
  for (const outline of outlines) {
    const box = pathBounds(outline.path);
    if (box) result = union(result,transformBox(box,xf));
  }
  return result;
}

// The native filter region includes the entire visible stack in page units.
export function filterMargin(node: LayerNode) {
  let layer=0, outer=0;
  const finite=(v:number) => Number.isFinite(v) ? Math.min(1e12,Math.max(0,v)) : 0;
  for (const e of node.effects ?? []) {
    if (!e.visible) continue;
    if (e.type==="layerBlur") layer+=finite(2*blurRadius(e));
    if (e.type==="texture") layer+=finite(Math.abs(e.radius));
    let reach=0;
    if (e.type==="dropShadow") reach=2*e.radius+4*Math.abs(e.spread)+Math.abs(e.offset[0])+Math.abs(e.offset[1]);
    if (e.type==="innerShadow" && (node.kind==="group" || rectanglePaints(node).some(p=>p.type==="image" || p.type==="pattern")))
      reach=2*e.radius+Math.abs(e.spread)+Math.abs(e.offset[0])+Math.abs(e.offset[1]);
    if (e.type==="glass") reach=2*glassBackdropRadius(e);
    if (e.type==="backgroundBlur") reach=2*blurRadius(e);
    outer=Math.max(outer,finite(reach));
  }
  return layer+outer;
}

export class SvgShadows {
  constructor(private doc: Document, private defs: string[], private id:(prefix:string)=>string) {}

  private colour(c: Colour) { return convertColour(c,this.doc.colourProfile ?? "srgb","srgb"); }

  private cover(node: LayerNode, xf: Affine) {
    if (!node.effects?.some(e=>e.visible && e.type==="dropShadow" && !e.showBehind) ||
      node.effects.some(e=>e.visible && (e.type==="layerBlur" && blurRadius(e)>0 || e.type==="texture" && !e.clipToShape && e.radius!==0))) return "";
    const outlines=shadowOutlines(this.doc,node,true);
    const box=outlines && outlineBox(outlines,xf);
    if (!box || !outlines) return "";
    const b=expand(box,1);
    const paths=outlines.map(o=>'<path'+pathAttrs(o,xf)+ruleAttr(o)+'/>').join("");
    const image='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+[b.x,b.y,b.width,b.height].map(num).join(" ")+'" width="'+num(b.width)+'" height="'+num(b.height)+'">'+paths+'</svg>';
    return '<feImage href="data:image/svg+xml;base64,'+base64Bytes(new TextEncoder().encode(image))+'"'+regionAttrs(b)+' preserveAspectRatio="none" result="cover"/>';
  }

  private filter(id:string,box:Rectangle|undefined,body:string) {
    const region=box ? ' filterUnits="userSpaceOnUse"'+regionAttrs(box) : ' x="-50%" y="-50%" width="200%" height="200%"';
    this.defs.push('<filter id="'+id+'"'+region+' color-interpolation-filters="sRGB">'+body+'</filter>');
    return id;
  }

  private blur(radius:number, box:Rectangle, cover:string) {
    if (radius<=0 && !cover) return "";
    let body=radius>0 ? '<feGaussianBlur stdDeviation="'+num(radius/2)+'" result="b"/>' : "";
    if (cover) body+=cover+'<feComposite in="'+(radius>0 ? "b" : "SourceGraphic")+'" in2="cover" operator="out"/>';
    return reference("filter",this.filter(this.id("filter"),box,body));
  }

  private spread(shapes:readonly ShadowOutline[], spread:number, xf:Affine, colour:string) {
    const path=(fill:string)=>shapes.map(o=>'<path'+pathAttrs(o,xf)+' fill="'+fill+'"'+ruleAttr(o)+'/>').join("");
    const body=path(colour);
    if (Math.abs(spread)<=1e-6) return body;
    const stroke=shapes.map(o=>'<path'+pathAttrs(o,xf)+' fill="none" stroke="'+(spread>0 ? colour : "black")+'" stroke-width="'+num(2*Math.abs(spread))+'" stroke-linejoin="miter" stroke-miterlimit="4"/>').join("");
    if (spread>0) return body+stroke;
    const box=outlineBox(shapes,xf);
    if (!box) return "";
    const id=this.id("mask");
    this.defs.push('<mask id="'+id+'" maskUnits="userSpaceOnUse"'+regionAttrs(expand(box,1))+'>'+path("white")+stroke+'</mask>');
    return '<g'+reference("mask",id)+'>'+body+'</g>';
  }

  outer(node:LayerNode, xf:Affine, clip?:string) {
    const visible=node.effects?.filter(e=>e.visible) ?? [];
    const geometry=visible.some(e=>e.type==="dropShadow" && e.spread!==0) ? shadowOutlines(this.doc,node,false) : undefined;
    let behind="";
    for (const s of visible) {
      if (s.type!=="dropShadow" || !s.spread || !geometry) continue;
      const at=offset(xf,s), b=outlineBox(geometry,at);
      if (!b) continue;
      const m=4*Math.abs(s.spread), halo=1.5*Math.abs(s.radius)+2;
      const region=expand(b,m*Math.hypot(xf[0],xf[2])+halo,m*Math.hypot(xf[1],xf[3])+halo);
      const filter=this.blur(s.radius,region,s.showBehind ? "" : this.cover(node,xf));
      const col=this.colour(s.color);
      const body=this.spread(geometry,s.spread,at,toCssHex(col).slice(0,7));
      behind+='<g opacity="'+num(col.a*(node.opacity ?? 1))+'"'+svgBlend(s.blend)+reference("clip-path",clip)+'><g'+filter+'>'+body+'</g></g>';
    }
    const effects=visible.filter(e=>e.type==="layerBlur" || e.type==="dropShadow" && !(geometry && e.spread));
    if (!effects.length) return {behind,filter:""};
    const id=this.id("filter");
    let body="", layer="SourceGraphic";
    effects.forEach((e,i)=>{
      if (e.type!=="layerBlur" || blurRadius(e)<=0) return;
      body+='<feGaussianBlur in="'+layer+'" stdDeviation="'+num(blurRadius(e)/2)+'" result="l'+i+'"/>';
      layer="l"+i;
    });
    const cast=layer==="SourceGraphic" ? "SourceAlpha" : "la";
    if (cast==="la" && effects.some(e=>e.type==="dropShadow"))
      body+='<feColorMatrix in="'+layer+'" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="la"/>';
    const cover=this.cover(node,xf), merge:string[]=[];
    const knock=cover ? "cover" : cast==="la" ? layer : "SourceAlpha";
    body+=cover;
    effects.forEach((s,i)=>{
      if (s.type!=="dropShadow") return;
      let source=cast;
      const out="s"+i;
      if (s.spread) {
        source=out+"m";
        body+='<feMorphology in="'+cast+'" operator="'+(s.spread>0 ? "dilate" : "erode")+'" radius="'+num(Math.abs(s.spread))+'" result="'+source+'"/>';
      }
      const c=this.colour(s.color);
      const tint=[0,0,0,0,c.r,0,0,0,0,c.g,0,0,0,0,c.b,0,0,0,c.a,0].map(num).join(" ");
      body+='<feOffset in="'+source+'" dx="'+num(s.offset[0])+'" dy="'+num(s.offset[1])+'"/><feGaussianBlur stdDeviation="'+num(s.radius/2)+'"/><feColorMatrix type="matrix" values="'+tint+'" result="'+out+'"/>';
      if (!s.showBehind) body+='<feComposite in="'+out+'" in2="'+knock+'" operator="out" result="'+out+'"/>';
      merge.push(out);
    });
    body+='<feMerge>'+[...merge,layer].map(name=>'<feMergeNode in="'+name+'"/>').join("")+'</feMerge>';
    const b=worldRenderBounds(this.doc,node.id), world=worldTransform(this.doc,node.id);
    let region:Rectangle|undefined;
    if (b && world[0]*world[3]!==world[1]*world[2]) {
      const scale=Math.sqrt(Math.abs(xf[0]*xf[3]-xf[1]*xf[2]));
      region=expand(transformBox(b,multiply(xf,inverse(world))),filterMargin(node)*scale);
    }
    return {behind,filter:reference("filter",this.filter(id,region,body))};
  }

  inner(s:Shadow, outline:ShadowOutline, xf:Affine) {
    const box=outlineBox([outline],xf);
    if (!box) return "";
    const r=expand(box,4*Math.abs(s.spread)+1.5*Math.abs(s.radius)+Math.max(...s.offset.map(Math.abs))+2);
    const clip=this.id("clip");
    this.defs.push('<clipPath id="'+clip+'"><path'+pathAttrs(outline,xf)+ruleAttr(outline,"clip-rule")+'/></clipPath>');
    const hole=this.spread([outline],-s.spread,offset(xf,s),"black"), mask=this.id("mask");
    const rect=(fill:string)=>'<rect'+regionAttrs(r)+' fill="'+fill+'"/>';
    this.defs.push('<mask id="'+mask+'" maskUnits="userSpaceOnUse"'+regionAttrs(r)+'>'+rect("white")+hole+'</mask>');
    const c=this.colour(s.color);
    return '<g'+reference("clip-path",clip)+'><g opacity="'+num(c.a)+'"'+this.blur(s.radius,r,"")+'><g'+reference("mask",mask)+'>'+rect(toCssHex(c).slice(0,7))+'</g></g></g>';
  }
}
