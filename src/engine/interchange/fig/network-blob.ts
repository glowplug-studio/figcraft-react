import type {Point} from "../../geometry";

export interface NetworkBlob {
  vertices:(Point & {style:number})[];
  segments:{a:number;b:number;ta:Point;tb:Point;style:number}[];
  regions:{style:number;winding:"nonZero"|"evenOdd";loops:number[][]}[];
}
export function readNetworkBlob(bytes:Uint8Array):NetworkBlob|undefined {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=0;
  const uint=()=>{const n=view.getUint32(at,true);at+=4;return n;};
  const float=()=>{
    const n=view.getFloat32(at,true);at+=4;
    if (!Number.isFinite(n)) throw new RangeError();
    return n;
  };
  const point=()=>({x:float(),y:float()});
  const index=(cap:number)=>{const n=uint();if (n>=cap) throw new RangeError();return n;};
  const count=()=>{const n=uint();if (n>200000 || at+n*4>view.byteLength) throw new RangeError();return n;};
  try {
    const nv=uint(),ns=uint(),nr=uint();
    if (Math.max(nv,ns,nr)>200000 || at+nv*12+ns*28+nr*8>view.byteLength) return;
    const vertices:NetworkBlob["vertices"]=[],segments:NetworkBlob["segments"]=[],regions:NetworkBlob["regions"]=[];
    for (let i=0;i<nv;i++) vertices.push({style:uint(),...point()});
    for (let i=0;i<ns;i++) segments.push({style:uint(),a:index(nv),ta:point(),b:index(nv),tb:point()});
    let total=0;
    for (let i=0;i<nr;i++) {
      const word=uint(),loops:number[][]=[];
      for (let j=0,n=count();j<n;j++) {
        const length=count();total+=length;
        if (total>200000) return;
        const edges:number[]=[];
        for (let k=0;k<length;k++) edges.push(index(ns));
        loops.push(edges);
      }
      regions.push({style:word>>>1,winding:word&1 ? "nonZero" : "evenOdd",loops});
    }
    return {vertices,segments,regions};
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return;
  }
}
