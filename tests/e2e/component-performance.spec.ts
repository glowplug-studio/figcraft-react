import {expect,test} from "@playwright/test";
import {build} from "vite";
import nativeThumbnails from "../fixtures/native-asset-thumbnails.json" with {type:"json"};
import type {prepareComponents,compareThumbnails} from "../fixtures/component-performance";

let code:string;
test.beforeAll(async()=>{
  const output = await build({configFile:false,logLevel:"silent",build:{write:false,minify:true,
    lib:{entry:"tests/fixtures/component-performance.ts",name:"ComponentPerformance",formats:["iife"]}}});
  const bundle = Array.isArray(output) ? output[0] : output;
  if (!("output" in bundle)) throw Error("Component benchmark did not build");
  code = bundle.output.find(chunk=>chunk.type === "chunk")!.code;
});
for (const mains of [1,100]) test(`10,001-layer Assets hover, rendering and propagation with ${mains} main components`,async({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:code});
  const run = await page.evaluateHandle(async mains=>{
    const fixture = (window as unknown as {ComponentPerformance:{prepareComponents:typeof prepareComponents}}).ComponentPerformance;
    return fixture.prepareComponents(document.querySelector("canvas")!,mains);
  },mains);
  const session = await page.context().newCDPSession(page);
  const heap = async()=>{await session.send("HeapProfiler.collectGarbage");return (await session.send("Runtime.getHeapUsage")).usedSize;};
  const start = await heap(), metrics = await run.evaluate(measure=>measure());
  const retainedBytes = await heap()-start;
  await run.dispose();
  await test.info().attach("component-performance",{body:JSON.stringify({...metrics,retainedBytes}),contentType:"application/json"});
  expect(metrics).toMatchObject({nodes:10001,instances:1000-mains,hits:70,publications:0,restored:true,changedCopies:1000/mains-1});
  expect(metrics.inputP95).toBeLessThan(16.7);
  expect(metrics.frameP95).toBeLessThan(16.7);
  expect(retainedBytes).toBeLessThan(8*1024*1024);
});

test("isolated component thumbnails match native bounds, raster size and pixels for clips, overflow, shadows and mask runs",async({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:code});
  const actual=await page.evaluate(async()=>{
    const fixture=(window as unknown as {ComponentPerformance:{compareThumbnails:typeof compareThumbnails}}).ComponentPerformance;
    return fixture.compareThumbnails(document.querySelector("canvas")!);
  });
  expect(actual).toEqual(nativeThumbnails.map(({name,bounds,size,pixels})=>({name,bounds,size,pixels})));
  await expect(page.locator("canvas")).toHaveScreenshot("masked-component-thumbnail.png",{animations:"disabled",maxDiffPixels:0});
});
