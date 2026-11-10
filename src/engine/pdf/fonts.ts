import type { ShapingFace } from "../shaping-face";
import type { FlowGlyph } from "../text-flow";
import { fontTables } from "../font-tables";
import { bake } from "../vector-drawable/geometry";
import { pdfPath } from "./graphics";
import { number, nums, PdfObjects, ref, unicodeHex } from "./objects";

interface UsedCode {gid:number; source:string}
interface UsedFace {id:number; names:Map<string,number>; codes:UsedCode[]}
const hex=(code:number,digits:number)=>code.toString(16).padStart(digits,"0");
function unicodeMap(codes:UsedCode[],digits=4) {
  const lines=["/CIDInit /ProcSet findresource begin","12 dict begin","begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /FigcraftUnicode def","/CMapType 2 def","1 begincodespacerange","<"+"0".repeat(digits)+"> <"+"F".repeat(digits)+">","endcodespacerange"];
  const entries=codes.flatMap((c,i)=>c.source ? ["<"+hex(i+1,digits)+"> <"+unicodeHex(c.source)+">"] : []);
  for (let i=0;i<entries.length;i+=100) {
    const group=entries.slice(i,i+100); lines.push(group.length+" beginbfchar",...group,"endbfchar");
  }
  lines.push("endcmap","CMapName currentdict /CMap defineresource pop","end","end");
  return lines.join("\n");
}
export class PdfFonts {
  private faces=new Map<ShapingFace,UsedFace[]>();
  constructor(private file:PdfObjects) {}
  use(g:FlowGlyph,source:string) {
    if (!g.size || Object.entries(g.coordinates).some(([tag,v])=>v!==g.face.axes[tag]?.default)) return;
    let batches=this.faces.get(g.face);
    if (!batches) {batches=[]; this.faces.set(g.face,batches);}
    let face=batches.at(-1);
    const key=g.id+":"+source;
    if (!face || face.codes.length===(g.face.truetype ? 65535 : 255) && !face.names.has(key)) {
      face={id:this.file.reserve(),names:new Map(),codes:[]};
      batches.push(face);
    }
    let cid=face.names.get(key);
    if (!cid) {cid=face.codes.push({gid:g.id,source});face.names.set(key,cid);}
    return {id:face.id,code:hex(cid,g.face.truetype ? 4 : 2)};
  }
  // Type 3 charprocs preserve CFF/CFF2 curves and Unicode selection, including
  // collections whose glyphs have no usable PostScript names or CID mapping.
  private outlineFont(face:ShapingFace,used:UsedFace) {
    const {bytes,index}=face.pdfFontSource(), tables=fontTables(bytes,index);
    const head=tables.get("head")!, hhea=tables.get("hhea")!, hmtx=tables.get("hmtx")!;
    const last=hhea.getUint16(34)-1;
    const box=[36,38,40,42].map(i=>head.getInt16(i));
    const widths=used.codes.map(({gid})=>hmtx.getUint16(4*Math.min(last,gid)));
    const names=used.codes.map(({gid})=>"/g"+gid), procs=new Map<number,number>();
    for (const [i,{gid}] of used.codes.entries()) {
      const width=widths[i];
      if (procs.has(gid)) continue;
      const path=pdfPath(bake(face.outline(gid),[1,0,0,-1,0,0]));
      procs.set(gid,this.file.stream("",width+" 0 "+nums(box)+" d1\n"+path+"\nf"));
    }
    const scale=number(1/face.upem);
    const dictionary=[...procs].map(([gid,id])=>"/g"+gid+" "+ref(id)).join(" ");
    this.file.set(used.id,"<< /Type /Font /Subtype /Type3 /Name /F"+used.id+" /FontBBox ["+nums(box)+
      "] /FontMatrix ["+scale+" 0 0 "+scale+" 0 0] /CharProcs << "+dictionary+
      " >> /Encoding << /Type /Encoding /Differences [1 "+names.join(" ")+"] >> /FirstChar 1 /LastChar "+widths.length+
      " /Widths ["+nums(widths)+"] /Resources << >> /ToUnicode "+ref(this.file.stream("",unicodeMap(used.codes,2)))+" >>");
  }
  async finish() {
    if (!this.faces.size) return;

    const file=this.file;
    for (const [face,batches] of this.faces) for (const used of batches) {
      if (!face.truetype) {
        this.outlineFont(face,used);
        continue;
      }
      const {subsetFont}=await import("./subset");
      const subset=await subsetFont(face.pdfFontSource,new Set(used.codes.map(c=>c.gid)));
      const tables=fontTables(subset,0),head=tables.get("head")!, hhea=tables.get("hhea")!,hmtx=tables.get("hmtx")!;
      const unit=1000/face.upem, lastMetric=hhea.getUint16(34)-1;
      const bbox=[36,38,40,42].map(at=>head.getInt16(at)*unit);
      const widths=used.codes.map(c=>hmtx.getUint16(Math.min(c.gid,lastMetric)*4)*unit);
      const prefix=Array.from({length:6},(_,i)=>String.fromCharCode(65+Math.floor(used.id/26**i)%26)).join("");
      const base="/"+prefix+"+"+(face.postscript || face.family).replace(/[^a-zA-Z0-9_-]/g,"");
      const fontFile=file.stream("/Length1 "+subset.length,subset);
      const descriptor=file.add("<< /Type /FontDescriptor /FontName "+base+" /Flags "+(face.italic ? 100 : 32)+
        " /FontBBox ["+nums(bbox)+"] /ItalicAngle "+(face.italic ? -12 : 0)+" /Ascent "+number(face.ascent*unit)+
        " /Descent "+number(-face.descent*unit)+" /CapHeight "+number(face.capHeight*unit)+" /StemV 80 /FontFile2 "+ref(fontFile)+" >>");
      const map=new Uint8Array((used.codes.length+1)*2), view=new DataView(map.buffer);
      used.codes.forEach(({gid},i)=>view.setUint16((i+1)*2,gid));
      const cid=file.add("<< /Type /Font /Subtype /CIDFontType2 /BaseFont "+base+
        " /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor "+ref(descriptor)+
        " /W [1 ["+nums(widths)+"]] /CIDToGIDMap "+ref(file.stream("",map))+" >>");
      file.set(used.id,"<< /Type /Font /Subtype /Type0 /BaseFont "+base+" /Encoding /Identity-H /DescendantFonts ["+ref(cid)+
        "] /ToUnicode "+ref(file.stream("",unicodeMap(used.codes)))+" >>");
    }
  }
}
