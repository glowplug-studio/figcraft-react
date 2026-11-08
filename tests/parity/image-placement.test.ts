import { describe,it,expect } from "vitest";
import { cropFromRect, cropRect, imagePixelDensity, imageTransform, placedImageSize, placementCrop, type ImagePlacement } from "../../src/engine/image-placement";
import { transformPoint } from "../../src/engine/affine";

const base:ImagePlacement = {scale_mode:"fill",rotation:0,scale:1,crop:null};
const signature = [137,80,78,71,13,10,26,10];
function chunk(name:string,bytes:number[]) {
  const chunk=new Uint8Array(bytes.length+12);
  new DataView(chunk.buffer).setUint32(0,bytes.length);
  chunk.set(new TextEncoder().encode(name),4); chunk.set(bytes,8);
  return chunk;
}
function density(x:number,y=x,unit=1) {
  const phys=new DataView(new ArrayBuffer(9));
  phys.setUint32(0,x); phys.setUint32(4,y); phys.setUint8(8,unit);
  return chunk("pHYs",[...new Uint8Array(phys.buffer)]);
}
describe("native image placement geometry",()=>{
  it("honours only 2× to 4× metre-based screen density before image data",()=>{
    const png=(...chunks:Uint8Array[])=>Uint8Array.from([...signature,...chunks.flatMap(c=>[...c])]);
    for (const d of [2,3,4]) expect(imagePixelDensity(png(chunk("IHDR",Array(13).fill(0)),density(Math.round(d*72/.0254))))).toBe(d);
    for (const c of [density(11811),density(5551),density(5630),density(5709),density(5669,5670),density(5669,5669,0)]) expect(imagePixelDensity(png(c))).toBe(1);
    expect(imagePixelDensity(png(chunk("IDAT",[]),density(5669)))).toBe(1);
    expect(imagePixelDensity(png(density(5669)).subarray(0,20))).toBe(1);
    expect(imagePixelDensity(Uint8Array.from([71,73,70]))).toBe(1);
  });
  it("preserves logical density, the 4096-side limit and explicit dimension precedence",()=>{
    expect(placedImageSize(800,600,2)).toEqual({width:400,height:300});
    expect(placedImageSize(8192,100,1)).toEqual({width:4096,height:50});
    expect(placedImageSize(800,600,2,200)).toEqual({width:200,height:150});
    expect(placedImageSize(2400,1200,1,100,70)).toEqual({width:100,height:70});
    expect(placedImageSize(2400,1200,1,undefined,70)).toEqual({width:2400,height:70});
  });
  it("round-trips native crop rectangles and preserves fitted placement when entering Crop",()=>{
    const crop=placementCrop({...base,scale_mode:"crop"},200,100,100,100);
    expect(cropRect(crop).map(v=>v+0)).toEqual([-.5,0,1.5,1]);
    expect(cropFromRect(1.5,1,-.5,0).map(v=>v+0)).toEqual(crop);
    for (const rotation of [-3,-2,-1,0,1,2,3,4]) for (const scale_mode of ["fill","fit"] as const) {
      const paint={...base,rotation,scale_mode};
      const switched={...paint,scale_mode:"crop" as const,crop:placementCrop(paint,39,70,115,24)};
      const a=imageTransform(paint,39,70,115,24),b=imageTransform(switched,39,70,115,24);
      a.forEach((n,i)=>expect(b[i]).toBeCloseTo(n,8));
    }
  });
  it("maps the original pixel corners for all quarter turns and keeps tile origin and scale",()=>{
    const wanted=[[0,0],[10,0],[20,10],[0,20]];
    for (let rotation=0;rotation<4;rotation++) {
      const matrix=imageTransform({...base,scale_mode:"tile",rotation,scale:.5},40,20,300,300);
      const p=transformPoint(matrix,{x:0,y:0});
      expect([p.x,p.y]).toEqual(wanted[rotation]);
    }
    const fallback=imageTransform({...base,scale_mode:"tile",rotation:-1,scale:0},40,20,100,100);
    expect(transformPoint(fallback,{x:40,y:20})).toEqual({x:20,y:0});
  });
  it("retains valid skewed or flipped crop coefficients and falls back for invalid axes",()=>{
    const skew=[-1,.2,.25,1,.75,.05] as const;
    expect(placementCrop({...base,scale_mode:"crop",crop:skew},100,100,80,60)).toBe(skew);
    const p=placementCrop({...base,scale_mode:"crop",crop:[0,0,0,1,0,0]},200,100,100,100);
    expect(p).toEqual([.5,0,0,1,.25,0]);
    expect(cropFromRect(1,0,1,0).every(Number.isFinite)).toBe(true);
  });
});
