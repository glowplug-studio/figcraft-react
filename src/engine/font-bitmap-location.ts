import type { FontStrike } from "./font-bitmap";

interface Location { format:number; start:number; end:number; metrics?:number }

function lookup(table:DataView,strike:number,id:number):Location | undefined {
  if (id<table.getUint16(strike+40) || id>table.getUint16(strike+42)) return undefined;
  const list=table.getUint32(strike), count=table.getUint32(strike+8);
  if (list+count*8>table.byteLength) return undefined;
  for (let i=0;i<count;i++) {
    const at=list+i*8, first=table.getUint16(at), last=table.getUint16(at+2);
    if (id<first || id>last) continue;
    const base=list+table.getUint32(at+4), index=table.getUint16(base),format=table.getUint16(base+2);
    const offset=table.getUint32(base+4), glyph=id-first;
    if (index===1 || index===3) {
      const stride=index===1 ? 4 : 2, pos=base+8+stride*glyph;
      const value=(p:number)=>index===1 ? table.getUint32(p) : table.getUint16(p);
      return {format,start:offset+value(pos),end:offset+value(pos+stride)};
    }
    const size=table.getUint32(base+8);
    if (index===2) return {format,start:offset+glyph*size,end:offset+(glyph+1)*size,metrics:base+12};
    if (index!==4 && index!==5) return undefined;
    const n=index===4 ? size : table.getUint32(base+20), stride=index===4 ? 4 : 2, array=base+(index===4 ? 12 : 24);
    if (array+stride*(n+Number(index===4))>table.byteLength) return undefined;
    let lo=0,hi=n;
    while (lo<hi) {
      const mid=(lo+hi)>>>1;
      if (table.getUint16(array+mid*stride)<id) lo=mid+1;
      else hi=mid;
    }
    if (lo===n || table.getUint16(array+lo*stride)!==id) return undefined;
    if (index===5) return {format,start:offset+lo*size,end:offset+(lo+1)*size,metrics:base+12};
    return {format,start:offset+table.getUint16(array+lo*4+2),end:offset+table.getUint16(array+(lo+1)*4+2)};
  }
  return undefined;
}

function bdtGlyph(loc:DataView,data:DataView,tag:string,strike:number,id:number):FontStrike | undefined {
  const l=lookup(loc,strike,id);
  if (!l || l.end<l.start || l.end>data.byteLength) return undefined;
  const f=l.format, depth=loc.getUint8(strike+46);
  const isPng=f>=17 && f<=19 && tag==="CBDT";
  if (!isPng && ![1,2,5,6,7].includes(f)) return undefined;
  const inLocation=f===5 || f===19;
  const small=f===1 || f===2 || f===17, bytes=inLocation ? 0 : small ? 5 : 8;
  if (l.start+bytes>l.end || (inLocation && l.metrics===undefined)) return undefined;
  const m=inLocation ? loc : data, at=inLocation ? l.metrics! : l.start;
  const metricWidth=m.getUint8(at+1),metricHeight=m.getUint8(at);
  const innerX=m.getInt8(at+2),innerY=m.getInt8(at+3),ppem=loc.getUint8(strike+45);
  let offset=l.start+bytes, length=l.end-offset, width=metricWidth,height=metricHeight;
  let format:FontStrike["format"];
  if (isPng) {
    if (depth!==32 || length<4) return undefined;
    const n=data.getUint32(offset);offset+=4;
    if (n>l.end-offset) return undefined;
    length=n;
    // Bitmap selection precedes PNG decoding. A malformed preferred strike hides that glyph.
    width=n>=24 ? data.getUint32(offset+16) : 0; height=n>=24 ? data.getUint32(offset+20) : 0;
    format="png";
  } else {
    const byteAligned=f===1 || f===6;
    const n=byteAligned ? Math.ceil(metricWidth*depth/8)*metricHeight : Math.ceil(metricWidth*metricHeight*depth/8);
    if (n>length) return undefined;
    length=n;
    if (byteAligned && depth===32) format="bgra";
    else if ([1,2,4,8].includes(depth)) format="mask";
    else return undefined;
  }
  return {table:tag,offset,length,width,height,ppem,innerX,innerY,bottomOrigin:false,format};
}

export function bdtStrike(loc:DataView,data:DataView,tag:string,id:number,size:number):FontStrike | undefined {
  if (loc.byteLength<8 || data.byteLength<4) return undefined;
  const count=loc.getUint32(4);
  if (8+48*count>loc.byteLength) return undefined;
  let best:FontStrike | undefined;
  for (let i=0;i<count;i++) {
    const strike=8+i*48,ppem=loc.getUint8(strike+45);
    if (best && !(ppem>=size && ppem<best.ppem || best.ppem<size && ppem>best.ppem)) continue;
    try { best=bdtGlyph(loc,data,tag,strike,id) ?? best; }
    catch (error) { if (!(error instanceof RangeError)) throw error; }
  }
  return best;
}
