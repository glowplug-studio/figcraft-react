import { bdtStrike } from "./font-bitmap-location";
import type { CurveElement } from "./curve-flatten";

export interface ColourBitmap {
  readonly width:number;
  readonly height:number;
  readonly left:number;
  readonly top:number;
  /** Premultiplied RGBA, as stored in the native colour-glyph cache. */
  readonly rgba:Uint8Array;
}

export type FontTableReader=(tag:string)=>DataView | undefined;
export interface FontStrike {
  table:string; offset:number; length:number;
  width:number; height:number; ppem:number;
  innerX:number; innerY:number; bottomOrigin:boolean;
  format:"png" | "bgra" | "mask";
}

function sbixStrike(table:DataView,id:number,size:number):FontStrike | undefined {
  if (table.byteLength<8) return undefined;
  const count=table.getUint32(4);
  if (count>(table.byteLength-8)/4) return undefined;
  const request=Math.fround(size);
  let best:FontStrike | undefined;
  for (let i=0;i<count;i++) {
    const strike=table.getUint32(8+4*i);
    const record=strike+4+4*id;
    if (record+8>table.byteLength) continue;
    const ppem=table.getUint16(strike);
    if (best && !(ppem>=request && ppem<best.ppem || best.ppem<request && ppem>best.ppem)) continue;
    const begin=strike+table.getUint32(record), end=strike+table.getUint32(record+4);
    if (begin+32>end || end>table.byteLength || table.getUint32(begin+4)!==0x706e6720) continue;
    const offset=begin+8;
    best={table:"sbix",offset,length:end-offset,width:table.getUint32(offset+16),height:table.getUint32(offset+20),
      ppem,innerX:table.getInt16(begin),innerY:table.getInt16(begin+2),bottomOrigin:true,format:"png"};
  }
  return best;
}

function bearings(read:FontTableReader,id:number,outline:()=>readonly CurveElement[]) {
  const hhea=read("hhea"), hmtx=read("hmtx");
  const count=hhea && hhea.byteLength>=36 ? hhea.getUint16(34) : 0;
  const at=id<count ? id*4+2 : count*4+(id-count)*2;
  const left=hmtx && at+2<=hmtx.byteLength ? hmtx.getInt16(at) : 0;
  if (read("CFF ") || read("CFF2") || read("gvar")) {
    let lowest=Infinity;
    for (const el of outline()) for (let i=2;i<el.length;i+=2) lowest=Math.min(lowest,-Number(el[i]));
    return [left,Number.isFinite(lowest) ? lowest : 0];
  }
  const head=read("head"),loca=read("loca"),glyf=read("glyf");
  if (!head || head.byteLength<52 || !loca || !glyf) return [left,0];
  const long=head.getInt16(50)!==0, stride=long ? 4 : 2;
  if ((id+2)*stride>loca.byteLength) return [left,0];
  const offset=(i:number)=>long ? loca.getUint32(i*4) : loca.getUint16(i*2)*2;
  const begin=offset(id),end=offset(id+1);
  return [left,begin+10<=end && end<=glyf.byteLength ? glyf.getInt16(begin+4) : 0];
}

/** Native bitmap resampling averages whole source pixels on reduction and interpolates on enlargement. */
function resize(src:Uint8Array,sw:number,sh:number,dw:number,dh:number) {
  if (sw===dw && sh===dh) return src;
  const out=new Uint8Array(dw*dh*4), enlarge=dw>=sw && dh>=sh;
  for (let y=0;y<dh;y++) {
    for (let x=0;x<dw;x++) {
      const dst=(y*dw+x)*4;
      if (enlarge) {
        // Figcraft offsets the normalised destination coordinate before scaling into the strike.
        const sx=Math.max(0,Math.min(sw-1,(x/dw+0.5)*sw-0.5)),sy=Math.max(0,Math.min(sh-1,(y/dh+0.5)*sh-0.5));
        const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,sw-1),y1=Math.min(y0+1,sh-1);
        const fx=sx-x0,fy=sy-y0;
        for (let c=0;c<4;c++) {
          const top=src[(y0*sw+x0)*4+c]*(1-fx)+src[(y0*sw+x1)*4+c]*fx;
          const bottom=src[(y1*sw+x0)*4+c]*(1-fx)+src[(y1*sw+x1)*4+c]*fx;
          out[dst+c]=Math.round(top*(1-fy)+bottom*fy);
        }
      } else {
        const fx=sw/dw,fy=sh/dh;
        const x0=Math.floor(x*fx),y0=Math.floor(y*fy),x1=Math.min(sw,Math.ceil((x+1)*fx)),y1=Math.min(sh,Math.ceil((y+1)*fy));
        const n=(x1-x0)*(y1-y0), sum=[0,0,0,0];
        for (let j=y0;j<y1;j++) for (let i=x0;i<x1;i++) {
          const p=(j*sw+i)*4;
          for (let c=0;c<4;c++) sum[c]+=src[p+c];
        }
        for (let c=0;c<4;c++) out[dst+c]=Math.round(sum[c]/n);
      }
    }
  }
  return out;
}

export function readStrikeBitmap(read:FontTableReader,id:number,upem:number,size:number,
  outline:()=>readonly CurveElement[],png:(data:DataView,w:number,h:number)=>Uint8Array | undefined):ColourBitmap | undefined {
  const sbix=read("sbix");
  let strike:FontStrike | undefined;
  if (sbix && sbix.byteLength>=8 && 8+sbix.getUint32(4)*4<=sbix.byteLength) strike=sbixStrike(sbix,id,size);
  else {
    for (const [locTag,dataTag] of [["CBLC","CBDT"],["EBLC","EBDT"]]) {
      const loc=read(locTag), data=read(dataTag);
      if (!loc || loc.byteLength<8 || 8+48*loc.getUint32(4)>loc.byteLength || !data || data.byteLength<4) continue;
      strike=bdtStrike(loc,data,dataTag,id,Math.fround(size));
      break;
    }
  }
  if (!strike || strike.format==="mask" || !strike.width || !strike.height || strike.width>1024 || strike.height>1024) return undefined;
  const [bearingX,bearingY]=strike.bottomOrigin ? bearings(read,id,outline) : [0,0];
  const table=read(strike.table)!;
  const data=new DataView(table.buffer,table.byteOffset+strike.offset,strike.length);
  const sw=strike.width,sh=strike.height;
  let rgba:Uint8Array | undefined;
  if (strike.format==="bgra") {
    if (data.byteLength<sw*sh*4) return undefined;
    rgba=new Uint8Array(data.buffer,data.byteOffset,sw*sh*4).slice();
    for (let i=0;i<rgba.length;i+=4) {
      const blue=rgba[i]; rgba[i]=rgba[i+2]; rgba[i+2]=blue;
    }
  } else {
    rgba=png(data,sw,sh);
    if (!rgba || rgba.length!==sw*sh*4) return undefined;
    for (let i=0;i<rgba.length;i+=4) {
      const a=rgba[i+3];
      for (let c=0;c<3;c++) rgba[i+c]=Math.floor((rgba[i+c]*a+127)/255);
    }
  }
  const scale=size/Math.max(1,strike.ppem), units=size/Math.max(1,upem);
  const width=Math.min(512,Math.max(1,Math.round(sw*scale))),height=Math.min(512,Math.max(1,Math.round(sh*scale)));
  return {width,height,left:strike.innerX*scale+bearingX*units,top:-(strike.innerY+(strike.bottomOrigin ? sh : 0))*scale-bearingY*units,
    rgba:resize(rgba,sw,sh,width,height)};
}
