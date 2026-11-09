/** OpenType CPAL palette zero and the v0 base/layer records shared by COLR versions 0 and 1. */
export interface ColourGlyphLayer {
  readonly id:number;
  readonly rgba:readonly [number,number,number,number];
}
type TableReader=(tag:string)=>DataView | undefined;
const black=Object.freeze([0,0,0,255] as const);

function paletteColour(table:DataView | undefined,index:number):ColourGlyphLayer["rgba"] {
  if (!table || table.byteLength<14 || !table.getUint16(4) || index>=table.getUint16(2)) return black;
  const record=table.getUint16(12)+index;
  if (record>=table.getUint16(6)) return black;
  const at=table.getUint32(8)+record*4;
  if (at+4>table.byteLength) return black;
  return Object.freeze([table.getUint8(at+2),table.getUint8(at+1),table.getUint8(at),table.getUint8(at+3)]);
}

export class FontColourTables {
  readonly #read:TableReader;
  readonly #layers=new Map<number,readonly ColourGlyphLayer[] | undefined>();
  constructor(read:TableReader) { this.#read=read; }

  layers(id:number):readonly ColourGlyphLayer[] | undefined {
    if (!Number.isInteger(id) || id<0 || id>65535) return undefined;
    if (this.#layers.has(id)) return this.#layers.get(id);
    const result=this.readLayers(id);
    if (this.#layers.size>=4096) this.#layers.clear();
    this.#layers.set(id,result);
    return result;
  }

  private readLayers(id:number) {
    const colr=this.#read("COLR"), palette=this.#read("CPAL");
    if (!colr || colr.byteLength<14) return undefined;
    const count=colr.getUint16(2), bases=colr.getUint32(4), layers=colr.getUint32(8);
    if (!bases || !layers || bases+count*6>colr.byteLength) return undefined;
    let lo=0,hi=count;
    while (lo<hi) {
      const mid=(lo+hi)>>>1;
      if (colr.getUint16(bases+mid*6)<id) lo=mid+1;
      else hi=mid;
    }
    if (lo===count || colr.getUint16(bases+lo*6)!==id) return undefined;
    const base=bases+lo*6, first=colr.getUint16(base+2), n=Math.min(256,colr.getUint16(base+4));
    if (!n || first+n>colr.getUint16(12) || layers+(first+n)*4>colr.byteLength) return undefined;
    const result:ColourGlyphLayer[]=[];
    for (let i=first;i<first+n;i++) {
      const at=layers+i*4;
      result.push(Object.freeze({id:colr.getUint16(at),rgba:paletteColour(palette,colr.getUint16(at+2))}));
    }
    return Object.freeze(result);
  }
}
