import { readFile } from "node:fs/promises";

/** An uninstalled test family. The replacement has the same UTF-16 length as Inter. */
export async function renamedFont(style:"Bold"|"Regular"="Regular") {
  const file=await readFile(new URL("../../fonts/inter/Inter-"+style+".ttf",import.meta.url));
  const before=Buffer.from("Inter","utf16le").swap16(), after=Buffer.from("Proof","utf16le").swap16();
  for (let i=0;i<file.readUInt16BE(4);i++) {
    const entry=12+i*16;
    if (file.toString("ascii",entry,entry+4)!=="name") continue;
    const start=file.readUInt32BE(entry+8);
    const names=file.subarray(start,start+file.readUInt32BE(entry+12));
    for (let pos=names.indexOf(before);pos>=0;pos=names.indexOf(before,pos+after.length)) after.copy(names,pos);
  }
  return file;
}

/** TrueType collection table offsets are relative to the collection, including shared tables. */
export function fontCollection(fonts:readonly Buffer[]) {
  const header=12+4*fonts.length;
  const padded=fonts.map(f=>Math.ceil(f.length/4)*4);
  const result=Buffer.alloc(header+padded.reduce((a,b)=>a+b,0));
  result.write("ttcf"); result.writeUInt32BE(0x10000,4); result.writeUInt32BE(fonts.length,8);
  let start=header;
  for (const [index,font] of fonts.entries()) {
    result.writeUInt32BE(start,12+4*index); font.copy(result,start);
    for (let i=0;i<font.readUInt16BE(4);i++) {
      const pos=12+i*16+8;
      result.writeUInt32BE(start+font.readUInt32BE(pos),start+pos);
    }
    start+=padded[index];
  }
  return result;
}

/** A packaged Inter file with its name table rebuilt for another family and style (appended, so any length fits). */
export async function retitledFont(source:"Bold"|"Italic"|"Regular"|"SemiBold",family:string,style:string) {
  const file=await readFile(new URL("../../fonts/inter/Inter-"+source+".ttf",import.meta.url));
  let dir=-1;
  for (let i=0;i<file.readUInt16BE(4);i++) if (file.toString("ascii",12+i*16,16+i*16)==="name") dir=12+i*16;
  const names:Record<number,string>={1:family,2:style,4:family+(style==="Regular" ? "" : " "+style),6:(family+"-"+style).replace(/\s/g,""),16:family,17:style};
  const strings=Object.values(names).map(s=>Buffer.from(s,"utf16le").swap16());
  const header=6+strings.length*12, table=Buffer.alloc(header+strings.reduce((n,s)=>n+s.length,0));
  table.writeUInt16BE(strings.length,2); table.writeUInt16BE(header,4);
  let offset=0;
  Object.keys(names).forEach((id,i)=>{
    for (const [j,v] of [3,1,0x409,Number(id),strings[i].length,offset].entries()) table.writeUInt16BE(v,6+i*12+j*2);
    strings[i].copy(table,header+offset); offset+=strings[i].length;
  });
  const start=Math.ceil(file.length/4)*4, out=Buffer.alloc(start+Math.ceil(table.length/4)*4);
  file.copy(out); table.copy(out,start);
  out.writeUInt32BE(start,dir+8); out.writeUInt32BE(table.length,dir+12);
  return out;
}
