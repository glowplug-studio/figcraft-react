import { blendModes, type BlendMode } from "../../blend";
import { colour, withAlpha } from "../../colour";
import { defaultGradient, type GradientHandle, type GradientKind } from "../../gradient";
import { validImageKey, type ImageResource } from "../../image-resource";
import type { Paint } from "../../solid-paint";
import { restTransform } from "./placement";
import { missingImagePng } from "./stripes";
import { clamp, clipped, entries, finite, list, numeric, object, restColour, string, type ImportWarnings, type JsonObject } from "./values";

const blendNames=new Map(blendModes.map(mode=>[mode.replace(/[A-Z]/g,c=>"_"+c).toUpperCase(),mode]));
blendNames.delete("PLUS_DARKER");
blendNames.delete("PLUS_LIGHTER");
blendNames.set("LINEAR_BURN","plusDarker");
blendNames.set("LINEAR_DODGE","plusLighter");
export const restBlend=(value:unknown)=>blendNames.get(string(value) ?? "");
export function paintBlend(value:unknown):BlendMode {
  const mode=restBlend(value);
  return mode==="passThrough" ? "normal" : mode ?? "normal";
}
export class ImportImages {
  readonly resources:Record<string,ImageResource>=Object.create(null);
  readonly #keys=new Map<string,string>();
  #placeholder?:ImageResource;
  #missing=0;
  constructor(readonly companions?:ReadonlyMap<string,{key:string;resource:ImageResource}>,readonly figWarnings?:ImportWarnings) {}
  key(ref:string) {
    const existing=this.#keys.get(ref);
    if (existing) return existing;
    const supplied=ref && this.companions?.get(ref);
    let key:string;
    if (supplied) {
      key=supplied.key;
      this.resources[key]=supplied.resource;
    } else {
      const candidate=clipped(ref);
      key=validImageKey(candidate) && !/^[a-f0-9]{64}$/i.test(candidate) ? candidate : "rest-image-missing";
      this.#placeholder??={bytes:missingImagePng(),width:256,height:256};
      this.resources[key]??=this.#placeholder;
      this.#missing++;
      this.figWarnings?.add("image fills whose image isn't in the file show a missing-image placeholder and keep its name");
    }
    this.#keys.set(ref,key);
    return key;
  }
  finish(warnings:ImportWarnings) {
    if (this.#missing && !this.figWarnings) warnings.add(this.#missing+(this.#missing===1 ? " image without image data shows" : " images without image data show")+
      " a missing-image placeholder, named by its imageRef when that can legitimately name a file and by the shared name otherwise (put the downloaded images, named by imageRef, in an `images` folder next to the JSON)");
  }
}
const gradients=new Map<string,GradientKind>([["GRADIENT_LINEAR","linear"],["GRADIENT_RADIAL","radial"],["GRADIENT_ANGULAR","angular"],["GRADIENT_DIAMOND","diamond"]]);
const black=colour(0,0,0);
function gradient(kind:GradientKind,p:JsonObject) {
  const base=defaultGradient(kind,black);
  const handles=list(p.gradientHandlePositions).flatMap(h=>{
    const {x,y}=object(h);
    return finite(x) && finite(y) ? [[clamp(x,-1000,1000),clamp(y,-1000,1000)] as GradientHandle] : [];
  });
  const [from,to,width]=handles;
  const stops=list(p.gradientStops).flatMap(s=>{
    const {position,color}=object(s), c=restColour(color);
    return finite(position) && c ? [{position:Math.fround(clamp(position,0,1)),color:c}] : [];
  });
  return {...base,...(from && to && {from,to,width:width ?? [from[0]-(to[1]-from[1]),from[1]+(to[0]-from[0])] as const}),...(stops.length && {stops})};
}
const filterNames=["exposure","contrast","saturation","temperature","tint","highlights","shadows"] as const;
function imagePaint(p:JsonObject,images:ImportImages,warnings:ImportWarnings) {
  const raw=object(p.filters);
  if (p.filters!=null && (typeof p.filters!=="object" || Array.isArray(p.filters))) warnings.add("malformed image filters container was skipped");
  for (const [key,value] of entries(raw)) {
    if (!finite(value)) warnings.add("malformed image filter `"+clipped(key)+"` was skipped");
    else if (value!==0 && !filterNames.some(name=>name===key)) warnings.add("nonzero unsupported image filter `"+clipped(key)+"` was skipped");
  }
  const filter=(key:typeof filterNames[number])=>Math.fround(clamp(numeric(raw[key]) ?? 0,-1,1));
  const scaleMode=p.scaleMode==="FIT" ? "fit" : p.scaleMode==="TILE" ? "tile" : p.scaleMode==="STRETCH" ? "crop" : "fill";
  const crop=scaleMode==="crop" ? restTransform(p.imageTransform) : undefined;
  const turns=clamp(numeric(p.rotation) ?? 0,-1e6,1e6)/90;
  const scale=numeric(p.scalingFactor);
  return {type:"image",image:images.key(string(p.imageRef) ?? ""),scale_mode:scaleMode,scale:scale && scale>0 ? Math.min(scale,1000) : 1,
    rotation:((Math.sign(turns)*Math.round(Math.abs(turns)))%4+4)%4,
    crop:crop && Math.abs(crop[0])>1e-9 && Math.abs(crop[3])>1e-9 ? crop : null,
    filters:{exposure:filter("exposure"),contrast:filter("contrast"),saturation:filter("saturation"),temperature:filter("temperature"),
      tint:0-filter("tint"),highlights:filter("highlights"),shadows:filter("shadows")}} as const;
}
export function restPaints(input:unknown,images:ImportImages,warnings:ImportWarnings):Paint[] {
  const result:Paint[]=[];
  for (const value of list(input)) {
    const p=object(value), type=string(p.type);
    if (!type) continue;
    const props={opacity:Math.fround(clamp(numeric(p.opacity) ?? 1,0,1)),visible:p.visible!==false,blend:paintBlend(p.blendMode),colorAlpha:1};
    if (type==="SOLID") {
      const c=restColour(p.color) ?? black;
      result.push({...props,type:"solid",color:withAlpha(c,1),colorAlpha:c.a,opacity:Math.fround(props.opacity*c.a)});
    } else if (type==="IMAGE") result.push({...props,...imagePaint(p,images,warnings)});
    else {
      const kind=gradients.get(type);
      if (kind) result.push({...props,type:"gradient",...gradient(kind,p)});
      else warnings.add(clipped(type)+" paints are not supported and were skipped");
    }
  }
  return result;
}
