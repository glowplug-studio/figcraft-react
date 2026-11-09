import type { FontLibrary } from "./font-library";
import type { ParaList } from "./text-data";
import { textSize, type TextStyle } from "./text-style";
import type { StyledGlyph } from "./styled-glyphs";
import type { ShapingFace } from "./shaping-face";

const romanDigits: readonly (readonly [number,string])[]=[[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],
  [50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]];
function numberLabel(n:number,level:number) {
  if (level%3===0) return String(n);
  if (level%3===1) {
    let label="";
    while (n>0) { n--; label=String.fromCharCode(97+n%26)+label; n=Math.floor(n/26); }
    return label;
  }
  if (n<1 || n>3999) return String(n);
  let label="";
  for (const [value,digit] of romanDigits) while (n>=value) { label+=digit; n-=value; }
  return label;
}

export class TextListLayout {
  readonly markers:string[];
  readonly step:number;
  constructor(readonly lists:readonly ParaList[], firstStyle:TextStyle, firstFace:ShapingFace | undefined) {
    const counts:{kind:ParaList["list"]; n:number}[]=[];
    let widest=0;
    const size=textSize(firstStyle), widths=new Map<string,number>();
    this.markers=lists.map(p=>{
      if (p.list==="none") { counts.length=0; return ""; }
      const level=Math.min(8,p.indent);
      counts.length=level+1;
      const last=counts[level], n=last?.kind===p.list ? last.n+1 : p.startOffset+1;
      counts[level]={kind:p.list,n};
      if (p.list==="bulleted") return "•";
      const marker=numberLabel(n,level)+".";
      let width=widths.get(marker);
      if (width===undefined) {
        width=firstFace ? firstFace.nominalRun(marker,{},size).reduce((sum,g)=>sum+g.advance,0) : size*0.6*marker.length;
        widths.set(marker,width);
      }
      widest=Math.max(widest,width);
      return marker;
    });
    this.step=lists.some(p=>p.list!=="none" || p.indent>0) ? Math.max(widest+size*0.5,size*1.5) : 0;
  }

  marker(para:number, rtl:boolean, end:number, hang:number, style:TextStyle, own:ShapingFace | undefined,
    initial:StyledGlyph | undefined, defaultFace:ShapingFace | undefined, fonts:FontLibrary) {
    const p=this.lists[para], numbered=p.list==="numbered";
    const text=rtl && numbered ? "."+this.markers[para].slice(0,-1) : this.markers[para];
    const has=(f:ShapingFace)=>Array.from(text).every(c=>f.glyphFor(c.codePointAt(0)!));
    const preferred=own && has(own) ? own : undefined;
    const fallback=preferred ? undefined : [...fonts.fallbacks("Regular"),...fonts.emojiFallbacks()].find(has);
    const face=preferred ?? fallback ?? initial?.face ?? defaultFace;
    if (!face) return [];
    const coordinates=preferred ? face.axisValues(style) : fallback ? {} : initial?.coordinates ?? {};
    const size=textSize(style), run=face.nominalRun(text,coordinates,size);
    const advance=run.reduce((s,g)=>s+g.advance,0), gutter=this.step*p.indent-hang;
    let x=rtl ? end+(numbered ? size*0.5 : Math.max(0,this.step-advance))
      : gutter+(numbered ? Math.max(0,this.step-size*0.5-advance) : 0);
    return run.map(g=>{
      const glyph={...g,x,face,coordinates,size};
      x+=g.advance;
      return glyph;
    });
  }
}
