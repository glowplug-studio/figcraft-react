import type { TextNode } from "./document";
import { fontGeneration } from "./font-generation";
import { newTextData } from "./text-data";
import { autoSizeText, familyStyles, localOnlyFont, prepareText, textFace } from "./text-node-layout";
import { paintText } from "./text-painter";
import { wordSegmenterReady } from "./text-word-starts";

export interface FamilySample {readonly url:string;readonly width:number;readonly height:number}
const samples=new Map<string,FamilySample|null>();
let generation=-1, cacheSize=0;

/** Render a visible menu label with the same glyph paths and embedded colours as the canvas. */
export async function familySample(family:string,density:number):Promise<FamilySample|null> {
  const version=fontGeneration();
  if (generation!==version) {generation=version;samples.clear();cacheSize=0;}
  if (localOnlyFont(family)) return null;
  const scale=Math.min(3,Math.max(1,density)), key=scale+"|"+family;
  const cached=samples.get(key);
  if (cached!==undefined) return cached;
  const styles=familyStyles(family);
  const style=styles.find(s=>s.toLowerCase()==="regular") ?? styles[0];
  const face=style && textFace(family,style);
  let sample:FamilySample|null=null;
  if (face && face.family.toLowerCase()===family.toLowerCase() && [...family].every(c=>c===" " || face.glyphFor(c.codePointAt(0)!))) {
    if (!wordSegmenterReady(family)) await prepareText(family);
    if (fontGeneration()!==version) return null;
    const text=newTextData(family);
    const node:TextNode=autoSizeText({kind:"text",id:"2",parent:"1",name:"",x:0,y:0,width:1,height:1,fill:"#ffffff",
      text:{...text,style:{...text.style,fontFamily:family,fontStyle:style,fontSize:13}}});
    const width=Math.min(400,node.width),height=Math.min(60,node.height);
    const canvas=document.createElement("canvas");
    canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
    const context=canvas.getContext("2d");
    if (context) {
      context.scale(scale,scale);
      // A family label has a single solid fill and needs no external paint resources.
      paintText(context,{...node,width,height},1).next();
      sample={url:canvas.toDataURL(),width:canvas.width/scale,height:canvas.height/scale};
    }
  }
  if (samples.size>=2000 || cacheSize+(sample?.url.length ?? 0)>8*1024*1024) {samples.clear();cacheSize=0;}
  samples.set(key,sample);cacheSize+=sample?.url.length ?? 0;
  return sample;
}
