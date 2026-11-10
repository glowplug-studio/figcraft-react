import {identity} from "../../affine";
import {canvasBlend} from "../../blend";
import {rectanglePaints,defaultConstraints,type LayerNode} from "../../document";
import {sortedStops,type Gradient} from "../../gradient";
import {decodeImageBitmap} from "../../image-decode";
import {strokeGeometry} from "../../shape-path";
import type {Paint} from "../../solid-paint";
import {defaultStroke,wireStroke,type StrokeCap} from "../../stroke";
import {fingerprint} from "./values";
import {derivedId,PenpotExportIds} from "./write-pages";
import {sourceValue,rgb,rounded,type Fields,type Warn} from "./write-geometry";

function gradientFields(g:Gradient) {
  const [x,y]=g.from,[tx,ty]=g.to;
  const length=(tx-x)**2+(ty-y)**2;
  const width=g.kind==="linear" || length<=1e-12 ? 1 : Math.sqrt(((g.width[0]-x)**2+(g.width[1]-y)**2)/length);
  return {type:g.kind==="linear" ? "linear" : "radial",startX:rounded(x),startY:rounded(y),endX:rounded(tx),endY:rounded(ty),width:rounded(width),
    stops:sortedStops(g.stops).map(s=>({color:rgb(s.color),opacity:rounded(s.color.a),offset:rounded(s.position)}))};
}

interface Media {
  id:string;object:string;mtype:string;ext:string;bytes:Blob;width:number;height:number;
}
const extensions:Readonly<Record<string,string>>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"};
const opacity=(value:number)=>rounded(Math.max(0,Math.min(1,value)));
const caps:Readonly<Record<StrokeCap,string | undefined>>={round:"round",square:"square",lineArrow:"line-arrow",triangleArrow:"triangle-arrow",
  reversedTriangle:"triangle-arrow",circleFilled:"circle-marker",diamondFilled:"diamond-marker",none:undefined};

export class PenpotPaintWriter {
  readonly media=new Map<string,Media>();
  constructor(private ids:PenpotExportIds,private warn:Warn) {}

  private async image(hash:string) {
    const saved=this.media.get(hash);
    if (saved) return saved;
    const resource=this.ids.doc.images?.[hash];
    if (!resource) return;
    let bytes=resource.bytes;
    if (!Object.hasOwn(extensions,bytes.type)) {
      try {
        const bitmap=await decodeImageBitmap(resource);
        try {
          const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(bitmap,0,0);
          bytes=await canvas.convertToBlob({type:"image/png"});
        } finally { bitmap.close(); }
      } catch { return; }
    }
    const media={id:derivedId(this.ids.file+":media:"+hash),object:derivedId(this.ids.file+":object:"+hash),mtype:bytes.type,ext:extensions[bytes.type],bytes,
      width:Math.max(1,resource.width),height:Math.max(1,resource.height)};
    this.media.set(hash,media);
    return media;
  }

  async paints(paints:readonly Paint[],stroke=false) {
    const out:Fields[]=[],key=stroke ? "stroke" : "fill";
    for (let i=paints.length-1;i>=0;i--) {
      const p=paints[i];
      if (!p.visible && !stroke) { this.warn("Hidden fills have no Penpot equivalent and were left out"); continue; }
      const fields:Fields={[key+"Opacity"]:opacity(p.opacity)};
      switch (p.type) {
        case "solid":
          fields[key+"Color"]=rgb(p.color);
          fields[key+"Opacity"]=opacity(Math.fround(p.opacity*p.color.a));
          break;
        case "gradient":
          if (p.kind!=="linear" && p.kind!=="radial") this.warn("Angular and diamond gradients have no Penpot equivalent; exported as radial gradients");
          fields[key+"ColorGradient"]=gradientFields(p);
          break;
        case "image": {
          if (p.scale_mode==="fit" || p.scale_mode==="tile") this.warn("Fit and tiled image fills have no Penpot equivalent; exported as fill images");
          const media=await this.image(p.image);
          if (!media) {this.warn("An image fill whose image is missing from the document was left out"); continue;}
          const {id,width,height,mtype}=media;
          const keepAspectRatio=p.scale_mode!=="crop" || Boolean(p.crop && !p.crop.every((v,i)=>v===identity[i]));
          fields[key+"Image"]={id,width,height,mtype,name:"image",keepAspectRatio};
          break;
        }
        case "pattern":
          this.warn("Pattern fills have no Penpot equivalent and were left out");
          continue;
      }
      if (!p.visible) fields.hidden=true;
      out.push(fields);
    }
    return out;
  }

  private async strokes(n:LayerNode,typ:string) {
    const props=n.stroke ?? defaultStroke,paints=n.strokes ?? [];
    const saved=n.sourceMetadata?.["penpot.fp.strokes"];
    if (saved) {
      const source=sourceValue(n,"strokes");
      if (Array.isArray(source) && !source.some(s=>s && Object.hasOwn(s,"strokeImage"))) {
        const native=paints.map(p=>{const {colorAlpha,...rest}=p;return colorAlpha===1 ? rest : p;});
        if (saved===fingerprint({stroke:wireStroke(props),strokes:native})) return source;
      }
    }
    const strokes=await this.paints(paints,true),w=props.weight;
    const near=(...dashes:number[])=>dashes.length===props.dashes.length && props.dashes.every((v,i)=>Math.abs(v-dashes[i])<1e-6);
    const style=!props.dashes.length ? "solid" : near(0,w+5) ? "dotted" : near(w+5,w+5,w+1,w+5) ? "mixed" : "dashed";
    if (style==="dashed" && !near(w+10,w+10)) this.warn("Custom dash patterns have no Penpot equivalent; exported as Penpot's dashed style");
    const open=strokes.length && typ==="path" && !strokeGeometry(n).some(c=>c[0]==="Z");
    for (const stroke of strokes) {
      stroke.strokeWidth=rounded(w);
      stroke.strokeAlignment=props.align==="inside" ? "inner" : props.align==="outside" ? "outer" : "center";
      stroke.strokeStyle=style;
      if (open) for (const [key,cap] of [["strokeCapStart",props.capStart],["strokeCapEnd",props.capEnd]] as const)
        if (caps[cap] && !(style==="dotted" && cap==="round")) stroke[key]=caps[cap];
    }
    if (props.sides && strokes.length) this.warn("Per-side stroke widths have no Penpot equivalent; exported with one width");
    return strokes;
  }

  async fields(n:LayerNode,typ:string,fields:Fields) {
    const fills=await this.paints(rectanglePaints(n));
    fields.fills=typ==="text" ? [] : fills;
    fields.strokes=await this.strokes(n,typ);
    if (n.visible===false) fields.hidden=true;
    if (n.locked) fields.blocked=true;
    if (n.opacity!==undefined && Math.abs(n.opacity-1)>1e-6) fields.opacity=rounded(n.opacity);
    const blend=n.blend;
    if (blend && blend!=="normal" && blend!=="passThrough" && blend!=="plusDarker" && blend!=="plusLighter") fields.blendMode=canvasBlend[blend];
    fields.proportionLock=n.constrainProportions ?? false;
    const {horizontal,vertical}=n.constraints ?? defaultConstraints;
    fields.constraintsH=horizontal.toLowerCase();
    fields.constraintsV=vertical.toLowerCase();
    const shadows:Fields[]=[];
    for (const [index,e] of (n.effects ?? []).entries()) {
      const id=derivedId(this.ids.file+":"+n.id+":effect:"+index),hidden=!e.visible;
      switch(e.type) {
        case "dropShadow": case "innerShadow":
          shadows.push({id,hidden,style:e.type==="dropShadow" ? "drop-shadow" : "inner-shadow",offsetX:rounded(e.offset[0]),offsetY:rounded(e.offset[1]),
            blur:rounded(e.radius),spread:rounded(e.spread),color:{color:rgb(e.color),opacity:rounded(e.color.a)}});
          break;
        case "layerBlur": case "backgroundBlur":
          fields[e.type==="layerBlur" ? "blur" : "backgroundBlur"]={id,type:e.type==="layerBlur" ? "layer-blur" : "background-blur",value:rounded(e.radius),hidden};
          break;
        default: this.warn("Noise, texture and glass effects have no Penpot equivalent and were left out");
      }
    }
    if (shadows.length) fields.shadow=shadows;
    if (typ==="frame" || typ==="rect") for (let i=0;i<4;i++) fields["r"+(i+1)]=rounded(n.corners?.radii[i] ?? 0);
    if (typ==="frame" && n.grids?.length) fields.grids=n.grids.map(g=>{
      const color={color:rgb(g.color),opacity:rounded(g.color.a)};
      if (g.kind==="grid") return {type:"square",display:g.visible,params:{size:rounded(g.size),color}};
      const align=g.align==="min" ? "left" : g.align==="max" ? "right" : g.align;
      return {type:g.kind==="columns" ? "column" : "row",display:g.visible,params:{size:g.count,itemLength:rounded(g.size),gutter:rounded(g.gutter),margin:rounded(g.offset),type:align,color}};
    });
  }
}
