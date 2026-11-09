import { validOpenTypeTag } from "./text-case";

/** Table offsets in both sfnt files and TrueType collections are relative to the file. */
export function fontTables(bytes: Uint8Array, faceIndex: number) {
  const file = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tables = new Map<string,DataView>();
  const start = file.getUint32(0) === 0x74746366 ? file.getUint32(12+faceIndex*4) : 0;
  if (start+12 > file.byteLength) return tables;
  const count = file.getUint16(start+4);
  if (start+12+count*16 > file.byteLength) return tables;
  for (let i=0; i<count; i++) {
    const entry = start+12+i*16;
    const offset = file.getUint32(entry+8), length = file.getUint32(entry+12);
    if (!length || offset+length > file.byteLength) continue;
    const tag = String.fromCharCode(...bytes.subarray(entry,entry+4));
    tables.set(tag,new DataView(bytes.buffer,bytes.byteOffset+offset,length));
  }
  return tables;
}

export const normaliseFontStyle = (name: string) => name.toLowerCase().replace(/[ _-]/g,"");
export interface FontAxis {
  readonly axisIndex: number;
  readonly tag: string;
  readonly nameId: number;
  readonly name: string;
  readonly flags: number;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

export interface FontInstance {
  readonly name: string;
  readonly coordinates: Readonly<Record<string,number>>;
}

export function fontVariations(table: DataView | undefined, nameOf: (id: number)=>string) {
  const axes: Record<string,FontAxis> = Object.create(null);
  const instances: FontInstance[] = [];
  const result = () => ({axes:Object.freeze(axes),instances:Object.freeze(instances)});
  if (!table || table.byteLength < 16 || table.getUint16(0) !== 1) return result();
  const start = table.getUint16(4), count = table.getUint16(8), stride = table.getUint16(10);
  const instanceStart = start+count*stride;
  if (start < 16 || stride < 20 || !count || instanceStart > table.byteLength) return result();
  const labels: Readonly<Record<string,string>> = {wght:"Weight",wdth:"Width",slnt:"Slant",ital:"Italic",opsz:"Optical size"};
  const tags: string[] = [];
  for (let index=0; index<count; index++) {
    const pos = start+index*stride;
    const tag = String.fromCharCode(...new Uint8Array(table.buffer,table.byteOffset+pos,4));
    const min = table.getInt32(pos+4)/65536, def = table.getInt32(pos+8)/65536, max = table.getInt32(pos+12)/65536;
    if (!validOpenTypeTag(tag) || min > max || Object.hasOwn(axes,tag)) {
      for (const key of tags) delete axes[key];
      return result();
    }
    tags.push(tag);
    const nameId = table.getUint16(pos+18);
    axes[tag] = Object.freeze({axisIndex:index,tag,nameId,name:nameOf(nameId) || labels[tag] || tag,flags:table.getUint16(pos+16),
      min,default:Math.max(min,Math.min(max,def)),max});
  }
  const size = table.getUint16(14);
  if (size < 4+count*4) return result();
  const names = new Set<string>();
  const records = Math.min(512,table.getUint16(12),Math.floor((table.byteLength-instanceStart)/size));
  for (let i=0; i<records; i++) {
    const pos = instanceStart+i*size, name = nameOf(table.getUint16(pos));
    const key = normaliseFontStyle(name);
    if (!name || names.has(key)) continue;
    names.add(key);
    const coordinates = Object.fromEntries(tags.map((tag,j)=>[tag,table.getInt32(pos+4+4*j)/65536]));
    instances.push(Object.freeze({name,coordinates:Object.freeze(coordinates)}));
  }
  return result();
}
