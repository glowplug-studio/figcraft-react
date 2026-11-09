import {expect,it} from "vitest";
import {progressiveBlur} from "../../src/engine/blur-renderer";
import {blurPixels} from "../../src/engine/effect-raster";

it("interpolates adjacent premultiplied levels at transformed pixel centres, in both ramp directions",()=>{
  const w=21,h=18,src=Uint8Array.from({length:w*h*4},(_,i)=>(i*53+71)%256);
  for (const reverse of [false,true]) {
    const out=src.slice();
    progressiveBlur(out,w,h,reverse?1:0,reverse?0:1,{x:6,y:4},{x:10,y:12});
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) for(let c=0;c<4;c++) {
      let summedRows=0;
      for(let yy=y-1;yy<=y+1;yy++){
        let row=0;
        if(yy>=0 && yy<h) for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++) row+=src[(yy*w+xx)*4+c];
        summedRows+=Math.floor(row/3);
      }
      const average=Math.floor(summedRows/3);
      const t=Math.max(0,Math.min(1,((x+.5-6)*4+(y+.5-4)*8)/80));
      const mix=Math.round((reverse?1-t:t)*255), i=(y*w+x)*4+c;
      expect(out[i]).toBe(Math.floor((src[i]*(255-mix)+average*mix+127)/255));
    }
  }
});

it("uses the end radius for coincident handles or nearly equal radii and preserves level selection after cropping",()=>{
  const w=180,h=70,src=Uint8Array.from({length:w*h*4},(_,i)=>(i*13+i%77)%256);
  for(const [delta,r] of [[0,0],[.049,200]]){
    const expected=src.slice(), actual=src.slice(); blurPixels(expected,w,h,4,2);
    progressiveBlur(actual,w,h,2-delta,2,{x:0,y:0},{x:r,y:r});
    expect(actual).toEqual(expected);
  }
  const full=src.slice();
  progressiveBlur(full,w,h,0,12,{x:8,y:3},{x:170,y:15});
  const left=16,width=150,sub=new Uint8Array(width*h*4);
  for(let y=0;y<h;y++) sub.set(src.subarray((y*w+left)*4,(y*w+left+width)*4),y*width*4);
  progressiveBlur(sub,width,h,0,12,{x:8-left,y:3},{x:170-left,y:15});
  for(let y=0;y<h;y++) expect(sub.subarray((y*width+40)*4,(y*width+width-40)*4))
    .toEqual(full.subarray((y*w+left+40)*4,(y*w+left+width-40)*4));
});
