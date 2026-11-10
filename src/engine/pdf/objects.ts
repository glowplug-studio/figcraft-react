import { zlibSync } from "fflate";

const ascii=new TextEncoder();
export const ref=(id:number)=>id+" 0 R";
export function number(n:number) {
  if (!Number.isFinite(n)) throw new Error("Non-finite PDF coordinate");
  if (Math.abs(n)>=1e21) throw new Error("PDF coordinate exceeds the numeric range");
  return n.toFixed(7).replace(/\.?0+$/,"") || "0";
}
export const nums=(values:readonly number[])=>values.map(number).join(" ");
export function unicodeHex(text:string) {
  let hex="";
  for (let i=0;i<text.length;i++) hex+=text.charCodeAt(i).toString(16).padStart(4,"0");
  return hex;
}
export const pdfString=(text:string)=>/^[\x20-\x7e]*$/.test(text)
  ? "("+text.replace(/[()\\]/g,c=>"\\"+c)+")" : "<FEFF"+unicodeHex(text)+">";

export class PdfObjects {
  private objects:(Blob | undefined)[]=[];
  reserve() {this.objects.push(undefined); return this.objects.length;}
  set(id:number,data:Blob | string) {this.objects[id-1]=typeof data==="string" ? new Blob([data]) : data;}
  add(body:string) {const id=this.reserve(); this.set(id,body); return id;}
  stream(dictionary:string,data:Uint8Array | string,compress=true) {
    const raw=typeof data==="string" ? ascii.encode(data) : data;
    const bytes=compress ? zlibSync(raw,{level:6}) : raw;
    return this.encodedStream(dictionary,new Blob([Uint8Array.from(bytes)]),compress ? "FlateDecode" : undefined);
  }
  encodedStream(dictionary:string,bytes:Blob,filter?:string) {
    const id=this.reserve();
    this.set(id,new Blob(["<< "+dictionary+" /Length "+bytes.size+(filter ? " /Filter /"+filter : "")+" >>\nstream\n",
      bytes,"\nendstream"]));
    return id;
  }
  finish(root:number,info:number) {
    const chunks:BlobPart[]=[new Uint8Array([37,80,68,70,45,49,46,55,10,37,226,227,207,211,10])];
    let pos=15;
    const rows=["0000000000 65535 f "];
    this.objects.forEach((obj,i)=>{
      if (!obj) throw new Error("Unwritten PDF object "+(i+1));
      const start=(i+1)+" 0 obj\n", end="\nendobj\n";
      rows.push(String(pos).padStart(10,"0")+" 00000 n ");
      chunks.push(start,obj,end); pos+=start.length+obj.size+end.length;
    });
    chunks.push("xref\n0 "+rows.length+"\n"+rows.join("\n")+"\ntrailer\n<< /Size "+rows.length+
      " /Root "+ref(root)+" /Info "+ref(info)+" >>\nstartxref\n"+pos+"\n%%EOF\n");
    return new Blob(chunks,{type:"application/pdf"});
  }
}

type ResourceType="ExtGState" | "XObject" | "Shading" | "Pattern" | "Font";
export class PdfSurface {
  readonly ops:string[]=[];
  private refs=new Map<ResourceType,Set<number>>();
  use(type:ResourceType,id:number) {
    let ids=this.refs.get(type);
    if (!ids) {ids=new Set(); this.refs.set(type,ids);}
    ids.add(id);
    return "/R"+id;
  }
  resources() {
    let text="<<";
    for (const [type,ids] of this.refs) text+=" /"+type+" << "+[...ids].map(id=>"/R"+id+" "+ref(id)).join(" ")+" >>";
    return text+" >>";
  }
  stream(file:PdfObjects,dictionary="") {return file.stream(dictionary,this.ops.join("\n"));}
}
