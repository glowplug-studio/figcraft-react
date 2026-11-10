import type { Colour } from "../colour";
import { toRgba8 } from "../colour";
import type { PrintSettings } from "../export-settings";
import { number, nums } from "./objects";

export function ink(c:Colour,cmyk:boolean) {
  const [r,g,b]=toRgba8(c).slice(0,3).map(v=>v/255);
  if (!cmyk) return [r,g,b];
  const max=Math.max(r,g,b);
  return max<=1e-6 ? [0,0,0,1] : [(max-r)/max,(max-g)/max,(max-b)/max,1-max].map(v=>Math.round(v*255)/255);
}
export function printSheet(w:number,h:number,p:PrintSettings) {
  const bleed=Math.max(0,Math.min(144,p.bleed)), crop=p.cropMarks, bleedMarks=p.bleedMarks && bleed>0;
  const margin=bleed+(crop || bleedMarks ? 24 : 0);
  if (w+2*margin>200000 || h+2*margin>200000)
    throw new Error("a "+Math.round(w)+" × "+Math.round(h)+" page is too large for PDF");
  w=Math.max(1,w); h=Math.max(1,h);
  const width=w+margin*2, height=h+margin*2;
  const box=(inset:number)=>"["+nums([inset,inset,width-inset,height-inset])+"]";
  const boxes="/MediaBox "+box(0)+(margin>0 ? " /TrimBox "+box(margin)+" /BleedBox "+box(margin-bleed) : "");
  const inset=margin-bleed;
  const clip=margin>0 ? nums([inset,inset,width-inset*2,height-inset*2])+" re W n" : "";
  const marks:string[]=[];
  if (crop || bleedMarks) {
    marks.push(p.cmyk ? "1 1 1 1 K" : "0 G","0.25 w");
    for (const edge of [...(crop ? [0] : []),...(bleedMarks ? [bleed] : [])]) {
      for (const sx of [-1,1]) for (const sy of [-1,1]) {
        const x=margin+(sx>0 ? w : 0), y=margin+(sy>0 ? h : 0);
        marks.push(nums([x+sx*(bleed+3),y+sy*edge])+" m "+nums([x+sx*(bleed+21),y+sy*edge])+" l",
          nums([x+sx*edge,y+sy*(bleed+3)])+" m "+nums([x+sx*edge,y+sy*(bleed+21)])+" l");
      }
    }
    marks.push("S");
  }
  return {width,height,margin,bleed,boxes,clip,marks:marks.join("\n"),flip:"1 0 0 -1 0 "+number(height)+" cm"};
}
