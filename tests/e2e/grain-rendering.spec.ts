import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as Fixture from "../fixtures/grain-rendering";

declare global {interface Window { FigcraftGrain:typeof Fixture }}
let bundle:string;
test.beforeAll(async()=>{
  const result=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"tests/fixtures/grain-rendering.ts",name:"FigcraftGrain",formats:["iife"]}}});
  const {output}=(Array.isArray(result)?result[0]:result) as {output:{type:string;code:string}[]};
  bundle=output.find(chunk=>chunk.type==="chunk")!.code;
});
test.beforeEach(async({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:bundle});
});
test("all noise modes preserve deterministic node seeds, anisotropic cells, blend and density",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftGrain.grainScene(document.querySelector("canvas")!));
  expect(r.mono).toEqual([255,0,0,255]);expect(r.multiply).toEqual([128,128,128,255]);
  const counts:Record<string,number>={};
  function reference(x:number,y:number){
    const wrap=(h:bigint)=>BigInt.asUintN(64,h);
    let h=wrap(0x9e3779b97f4a7c15n*BigInt(x)^0xc2b2ae3d27d4eb4fn*BigInt(y)^0x165667b19e3779f9n*BigInt(r.id));
    h=wrap((h^(h>>33n))*0xff51afd7ed558ccdn);
    h=wrap((h^(h>>33n))*0xc4ceb9fe1a85ec53n);
    return h^(h>>33n);
  }
  for(let y=0;y<60;y++) for(let x=0;x<60;x++){
    const h=reference(x,y), key=Number(h&65535n)/65536>=.3?"128,128,128,255": h>>63n?"0,0,255,255":"255,0,0,255";
    counts[key]=(counts[key]??0)+1;
  }
  expect(r.colours).toEqual(counts);
  const rgb=(h:bigint)=>[16n,32n,48n].map(s=>Math.round(Number((h>>s)&65535n)/65536*255)).concat(255);
  expect(r.anisotropic).toEqual([[0,0],[0,0],[1,0],[0,1]].map(([x,y])=>rgb(reference(x,y))));
});
test("texture roughens layer edges, respects clipping and renders stable pixels across viewport patches",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftGrain.grainEdges(document.querySelector("canvas")!));
  expect(r.rough).toBeGreaterThan(100);expect(r.clipped).toBe(0);
  expect(r.changed).toBeGreaterThan(500);expect(r.drift).toBe(0);expect(r.released).toBe(true);
});

test("repeated grain rendering stays inside a frame and leaves document subscribers idle",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftGrain.grainFrames(document.querySelector("canvas")!));
  await test.info().attach("grain frame timings",{body:JSON.stringify(r),contentType:"application/json"});
  expect(r.frames).toBe(40);expect(r.p95).toBeLessThan(16.7);expect(r.changes).toBe(0);
});
