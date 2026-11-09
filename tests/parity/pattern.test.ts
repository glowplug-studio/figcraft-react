import {describe,expect,it} from "vitest";
import {patternCell,patternResolution,readPattern} from "../../src/engine/pattern";

describe("native live pattern cell geometry",()=>{
  const base = readPattern({source:7,spacing:[5,10]});
  it("reads old source-only paints without rounding a u64 source",()=>{
    expect(readPattern({source:"18446744073709551615"})).toEqual({source:"18446744073709551615",tile:"grid",scale:1,spacing:[0,0],align:"start"});
    for (const source of [Number.MAX_SAFE_INTEGER+1,"18446744073709551616",-1,undefined]) expect(()=>readPattern({source})).toThrow();
    for (const raw of [{tile:"hex"},{scale:NaN},{spacing:[1]},{spacing:[true,0]},{align:"middle"}]) expect(()=>readPattern({source:1,...raw})).toThrow();
  });
  it("calculates wrapped half-row and half-column offsets with fixed document-unit gaps",()=>{
    expect(patternCell(base,20,10,100,100)).toMatchObject({size:[25,20],origin:[0,0],tiles:[[0,0]]});
    expect(patternCell({...base,tile:"horizontalHex"},20,10,100,100)).toMatchObject({size:[25,40],tiles:[[0,0],[12.5,20],[-12.5,20]]});
    expect(patternCell({...base,tile:"verticalHex"},20,10,100,100)).toMatchObject({size:[50,20],tiles:[[0,0],[25,10],[25,-10]]});
  });
  it("aligns a single scaled tile within the destination",()=>{
    expect(patternCell({...base,scale:2,align:"center"},20,10,100,100)).toMatchObject({size:[45,30],origin:[30,40]});
    expect(patternCell({...base,scale:2,align:"end"},20,10,100,100)?.origin).toEqual([60,80]);
    expect(patternCell({...base,align:"end"},20,10,5,5)?.origin).toEqual([-15,-5]);
  });
  it("clamps at render time and rejects zero-sized or non-finite source geometry",()=>{
    for (const width of [0,-1,1e-6,NaN,Infinity]) expect(patternCell(base,width,10,10,10)).toBeUndefined();
    expect(patternCell({...base,scale:NaN,spacing:[Infinity,-5]},10,10,10,10)).toMatchObject({scale:1,size:[10,10]});
    expect(patternCell({...base,scale:1e9,spacing:[1e9,0]},10,10,10,10)).toMatchObject({scale:100,size:[11000,1000]});
    expect(patternCell({...base,scale:-1,align:"end"},10,10,Infinity,NaN)).toMatchObject({scale:.01,origin:[0,0]});
  });
  it("rounds cell texels per axis and bounds both sides at the displayed scale",()=>{
    const cell = patternCell(base,20,10,100,100)!;
    expect(patternResolution(cell,NaN)).toEqual({width:25,height:20,kx:1,ky:1});
    expect(patternResolution(cell,.5)).toEqual({width:13,height:10,kx:13/25,ky:.5});
    expect(patternResolution({...cell,size:[8192,1]},2)).toEqual({width:2048,height:1,kx:.25,ky:1});
    expect(patternResolution({...cell,size:[4,Infinity]},1)).toBeUndefined();
  });
});
