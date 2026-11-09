import { expect, it } from "vitest";
import { blurPixels, dropShadowPixels, innerShadowPadding, innerShadowPixels, spreadPixels } from "../../src/engine/effect-raster";

// Direct neighbourhood sums are deliberately independent of the sliding-window implementation.
function referenceBlur(input: Uint8Array, width: number, height: number, channels: 1 | 4, radii: number[]) {
  let base = input;
  for (const vertical of [false,true]) for (const r of radii) {
    const next = new Uint8Array(base.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < channels; c++) {
      let sum = 0;
      for (let d = -r; d <= r; d++) {
        const xx = vertical ? x : x + d, yy = vertical ? y + d : y;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height) sum += base[(yy * width + xx) * channels + c];
      }
      next[(y * width + x) * channels + c] = Math.floor(sum / (2 * r + 1));
    }
    base = next;
  }
  return base;
}
it("matches all six native integer box passes on coverage and premultiplied RGBA", () => {
  for (const channels of [1,4] as const) for (const [w,h] of [[1,7],[7,1],[5,13],[23,11]]) {
    const input = Uint8Array.from({length:w*h*channels},(_,i)=>(i*101+37)%256);
    for (const [sigma,radii] of [[.3,[0,0,0]],[1,[0,0,1]],[2,[1,1,2]],[3,[2,2,3]]] as const) {
      const result = input.slice();
      blurPixels(result,w,h,channels,sigma);
      expect(result).toEqual(referenceBlur(input,w,h,channels,[...radii]));
    }
    const huge = input.slice(); blurPixels(huge,w,h,channels,1e30);
    expect(huge.some(Boolean)).toBe(false);
  }
});
it("grows and erodes pixel silhouettes with transparent borders including extreme spreads", () => {
  const width = 19, height = 7;
  const input = Uint8Array.from({length:width*height},(_,i)=>(37*i+21)%256);
  for (const spread of [-410,-4,-1,0,1,3,410]) {
    const radius = Math.min(400,Math.abs(spread)), grow = spread > 0;
    const result = input.slice();
    spreadPixels(result,width,height,spread);
    const expected = input.map((_,i)=>{
      const x=i%width, y=Math.floor(i/width);
      if (!grow && (x < radius || y < radius || x+radius >= width || y+radius >= height)) return 0;
      let best = grow ? 0 : 255;
      for (let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)
        for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++)
          best=(grow?Math.max:Math.min)(best,input[yy*width+xx]);
      return best;
    });
    expect(result).toEqual(expected);
  }
});

it("casts through transparent image holes and uses the independent geometric cover of translucent fills", () => {
  const source = Uint8Array.of(0,128,255,0,128,0,0), cover = Uint8Array.of(0,255,255,255,255,0,0);
  const shadow = {offset:[1,0] as const,radius:0,spread:0,showBehind:false,color:{r:1,g:0,b:0,a:1}};
  const alpha = (rgba: Uint8Array) => [...rgba.filter((_,i)=>i%4===3)];
  expect(alpha(dropShadowPixels(source,7,1,shadow,1))).toEqual([0,0,0,255,0,128,0]);
  expect(alpha(dropShadowPixels(source,7,1,shadow,1,cover))).toEqual([0,0,0,0,0,128,0]);
  expect(alpha(dropShadowPixels(source,7,1,{...shadow,offset:[-.5,0],showBehind:true},1))).toEqual([128,255,0,128,0,0,0]);
  expect(alpha(dropShadowPixels(source,7,1,{...shadow,offset:[1e30,0]},1))).toEqual(Array(7).fill(0));
  const prepared = Uint8Array.of(1,2,3,4,5,6,7);
  expect(alpha(dropShadowPixels(source,7,1,shadow,1,cover,prepared))).toEqual([1,0,0,0,0,6,7]);
  expect([...dropShadowPixels(Uint8Array.of(1),1,1,{...shadow,offset:[0,0],color:{r:1,g:0,b:0,a:.5}},1,Uint8Array.of(128))]).toEqual([0,0,0,0]);
  expect([...source]).toEqual([0,128,255,0,128,0,0]);
});

it("casts an inner shadow from outside filled islands and holes, clips before tinting and preserves the source", () => {
  const cover = Uint8Array.of(0,255,255,0,128,0,0);
  const shadow = {offset:[1,0] as const,radius:0,spread:0,showBehind:false,color:{r:1,g:0,b:0,a:.5}};
  const rgba = innerShadowPixels(cover,7,1,shadow,1);
  expect([...rgba.filter((_,i)=>i%4===3)]).toEqual([0,128,0,0,64,0,0]);
  expect([...rgba.filter((_,i)=>i%4===0)]).toEqual([0,128,0,0,64,0,0]);
  expect(innerShadowPadding({...shadow,spread:3},1,true)).toBe(15);
  expect(innerShadowPadding({...shadow,radius:100000},1,false)).toBe(2050);
  const filled = new Uint8Array(7 * 7).fill(255);
  const soft = innerShadowPixels(filled,7,7,{...shadow,offset:[0,0],radius:2},1);
  expect(soft[3]).toBeGreaterThan(0);
  expect(soft[4*(3*7+3)+3]).toBe(0);
  expect([...cover]).toEqual([0,255,255,0,128,0,0]);
});
