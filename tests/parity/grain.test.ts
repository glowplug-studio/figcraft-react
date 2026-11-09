import {describe,expect,it} from "vitest";
import {readEffect} from "../../src/engine/effects";
import {GrainHash,grainPixels} from "../../src/engine/grain-renderer";
import {identity} from "../../src/engine/affine";

const mask=(1n<<64n)-1n;
function coordinate(v:number) {
  const n=BigInt(v);
  return n >= 1n<<63n ? (1n<<63n)-1n : n < -(1n<<63n) ? -(1n<<63n) : n;
}
function referenceHash(x:number,y:number,seed:number) {
  const ix=coordinate(x),iy=coordinate(y);
  let h=((ix*0x9e3779b97f4a7c15n)^(iy*0xc2b2ae3d27d4eb4fn)^(BigInt(seed>>>0)*0x165667b19e3779f9n)) & mask;
  h=((h^(h>>33n))*0xff51afd7ed558ccdn)&mask;
  h=((h^(h>>33n))*0xc4ceb9fe1a85ec53n)&mask;
  return h^(h>>33n);
}
const unit=(h:bigint,shift:bigint)=>Number((h>>shift)&65535n)/65536;
function grain(properties: Record<string,unknown>) {
  const effect=readEffect(properties,"archive");
  if(effect.type!=="noise" && effect.type!=="texture") throw Error("Expected a grain effect");
  return effect;
}

describe("native grain effects",()=>{
  it("matches independent u64 wrapping arithmetic across signed and saturated cell coordinates",()=>{
    const xs=[0,1,-1,-65537,2**32-1,2**32+1,-(2**40),2**53,2**63,-(2**64)];
    for(const id of [0,1,3,0x7fffffff,0xdeadbeef,0xffffffff]){
      const hash=new GrainHash(id);
      for(const x of xs) for(const y of xs) {
        hash.set(x,y);
        expect(BigInt(hash.lo)+(BigInt(hash.hi)<<32n)).toBe(referenceHash(x,y,id));
      }
    }
  });
  it("generates premultiplied mono, duo and multi grains in local anisotropic cells",()=>{
    const w=17,h=13,seed=0xf011fb42;
    const src=Uint8Array.from({length:w*h*4},(_,i)=>i%4===3 ? (i*61)%256 : 0);
    for(const mode of ["mono","duo","multi"]) {
      const e=grain({type:"noise",size:2,sizeY:.5,density:.25,mode,color:"#ff0000",secondary:"#00ff00",opacity:.5});
      const pixels=grainPixels(src,w,h,e,[1,0,0,1,5,-3],1,seed)!;
      const expected=new Uint8Array(src.length);
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const at=(y*w+x)*4, hv=referenceHash(Math.floor((x+.5-5)/4),Math.floor(y+.5+3),seed);
        if(unit(hv,0n)>=.25) continue;
        const a=Math.fround(Math.fround(src[at+3]/255)*(mode==="multi"?.5:1));
        const channels=mode==="multi" ? [unit(hv,16n),unit(hv,32n),unit(hv,48n)] :
          mode==="duo" && hv>>63n ? [0,1,0] : [1,0,0];
        [ ...channels,1 ].forEach((v,i)=>{expected[at+i]=Math.round(Math.fround(Math.fround(v*a)*255));});
      }
      expect(pixels).toEqual(expected);
    }
    const noise=grain({type:"noise",density:0});
    expect(grainPixels(src,w,h,noise,identity,1,seed)).toBeUndefined();
    expect(grainPixels(src,w,h,grain({type:"texture"}),[0,0,0,0,0,0],1,seed)).toBeUndefined();
  });
  it("samples independent whole-pixel disc offsets, clips fractional coverage and keeps the original layer intact",()=>{
    const w=21,h=13,seed=8;
    const input=Uint8Array.from({length:w*h*4},(_,i)=>{
      const a=Math.floor(i/4)%5*54;
      return i%4===3?a:Math.floor(a*((i*17)%100)/100);
    });
    const original=input.slice();
    for(const clipToShape of [true,false]){
      const tex=grain({type:"texture",radius:3,size:1,sizeY:.5,clipToShape});
      const actual=grainPixels(input,w,h,tex,identity,1,seed)!;
      const expected=new Uint8Array(input.length);
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const hv=referenceHash(Math.floor(x/2),y,seed^0x7e57);
        const theta=unit(hv,0n)*2*Math.PI, radius=3*Math.sqrt(unit(hv,16n));
        const xx=x+Math.round(Math.cos(theta)*radius), yy=y+Math.round(Math.sin(theta)*radius);
        if(xx<0||xx>=w||yy<0||yy>=h) continue;
        const at=(y*w+x)*4, src=(yy*w+xx)*4;
        for(let c=0;c<4;c++) expected[at+c]=Math.round(input[src+c]*(clipToShape?input[at+3]/255:1));
      }
      expect(actual).toEqual(expected);
    }
    expect(input).toEqual(original);
    expect(grainPixels(input,w,h,grain({type:"texture",radius:.49}),identity,1,seed)).toBeUndefined();
  });
});
