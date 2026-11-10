import { type Affine } from "../affine";
import type { BlendMode } from "../blend";
import type { Colour } from "../colour";
import type { CurveElement } from "../curve-flatten";
import { sortedStops, type Gradient } from "../gradient";
import { cubics } from "../vector-drawable/geometry";
import { number, nums, PdfObjects, PdfSurface, ref } from "./objects";
import { ink } from "./sheet";

export function pdfPath(path:readonly CurveElement[]) {
  return cubics(path).map(c=>c[0]==="Z" ? "h" : nums(c.slice(1) as number[])+" "+(c[0]==="C" ? "c" : c[0]==="M" ? "m" : "l")).join("\n");
}
export const pdfMatrix=(xf:Affine)=>nums(xf)+" cm";
export function pdfBlend(b:BlendMode) {
  if (b==="passThrough" || b==="normal") return "Normal";
  if (b==="plusDarker") return "Multiply";
  if (b==="plusLighter") return "Screen";
  return b[0].toUpperCase()+b.slice(1);
}
export class PdfGraphics {
  private states=new Map<string,number>();
  constructor(readonly file:PdfObjects,readonly width:number,readonly height:number) {}
  get box() {return "[0 0 "+nums([this.width,this.height])+"]";}
  state(s:PdfSurface,opacity:number,blend:BlendMode="normal",mask?:{form:number;kind:"Alpha"|"Luminosity"}) {
    if (opacity===1 && pdfBlend(blend)==="Normal" && !mask) return;
    const value="/ca "+number(opacity)+" /CA "+number(opacity)+" /BM /"+pdfBlend(blend)+
      (mask ? " /SMask << /S /"+mask.kind+" /G "+ref(mask.form)+" >>" : "");
    let id=this.states.get(value);
    if (!id) {id=this.file.add("<< /Type /ExtGState "+value+" >>");this.states.set(value,id);}
    s.ops.push(s.use("ExtGState",id)+" gs");
  }
  form(surface:PdfSurface,space="DeviceRGB") {
    return surface.stream(this.file,"/Type /XObject /Subtype /Form /BBox "+this.box+" /Resources "+surface.resources()+
      " /Group << /S /Transparency /I true /CS /"+space+" >>");
  }
  shade(surface:PdfSurface,gradient:Gradient,frame:Affine,cmyk:boolean,alpha:boolean) {
    const stops=sortedStops(gradient.stops);
    const channels=(c:Colour)=>alpha ? [c.a] : ink(c,cmyk);
    const functionOf=(a:Colour,b:Colour)=>"<< /FunctionType 2 /Domain [0 1] /C0 ["+nums(channels(a))+"] /C1 ["+nums(channels(b))+"] /N 1 >>";
    // A hard stop has distinct colours on the two sides of one stitching boundary.
    const extend=[...stops];
    if (extend[0].position>0) extend.unshift({...extend[0],position:0});
    if (extend.at(-1)!.position<1) extend.push({...extend.at(-1)!,position:1});
    const functions:string[]=[], limits:number[]=[];
    for (let i=1;i<extend.length;i++) {
      if (extend[i].position<=extend[i-1].position) continue;
      functions.push(functionOf(extend[i-1].color,extend[i].color));limits.push(extend[i].position);
    }
    const fn=functions.length<=1 ? functions[0] ?? functionOf(stops[0].color,stops[0].color) :
      "<< /FunctionType 3 /Domain [0 1] /Functions ["+functions.join(" ")+"] /Bounds ["+nums(limits.slice(0,-1))+
      "] /Encode ["+functions.map(()=>"0 1").join(" ")+"] >>";
    const linear=gradient.kind==="linear";
    const id=this.file.add("<< /ShadingType "+(linear ? 2 : 3)+" /ColorSpace /"+(alpha ? "DeviceGray" : cmyk ? "DeviceCMYK" : "DeviceRGB")+
      " /Coords ["+(linear ? "0 0 1 0" : "0 0 0 0 0 1")+"] /Extend [true true] /Function "+fn+" >>");
    surface.ops.push("q",pdfMatrix(frame),surface.use("Shading",id)+" sh","Q");
  }
}
