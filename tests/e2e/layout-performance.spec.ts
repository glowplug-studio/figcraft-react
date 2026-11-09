import {expect, test} from "@playwright/test";
import {build} from "vite";
import type {prepareLayout} from "../fixtures/layout-performance";

let code: string;
test.beforeAll(async () => {
  const out = await build({configFile:false,logLevel:"silent",build:{write:false,minify:true,
    lib:{entry:"tests/fixtures/layout-performance.ts",name:"FigcraftLayoutPerformance",formats:["iife"]}}});
  const result = Array.isArray(out) ? out[0] : out;
  if (!("output" in result)) throw Error("Layout fixture did not build");
  code = result.output.find(chunk=>chunk.type==="chunk")!.code;
});
for (const dense of [false,true]) for (const grid of [false,true]) {
  test(`10,000-node ${dense ? "single-frame" : "multi-frame"} ${grid ? "grid gap drag" : "wrapped reorder"}`, async ({page}) => {
    await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:code});
    const benchmark = await page.evaluateHandle(async ({grid,dense}) => {
      const fixture = (window as unknown as {FigcraftLayoutPerformance:{prepareLayout:typeof prepareLayout}}).FigcraftLayoutPerformance;
      return fixture.prepareLayout(document.querySelector("canvas")!,grid,dense);
    },{grid,dense});
    const cdp = await page.context().newCDPSession(page);
    const used = async () => {await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize;};
    const before = await used(), metrics = await benchmark.evaluate(run => run());
    const retainedBytes = await used() - before;
    await benchmark.dispose();
    await test.info().attach("layout-performance",{body:JSON.stringify({...metrics,retainedBytes}),contentType:"application/json"});
    expect(metrics).toMatchObject({nodes:10000,frames:dense ? 1 : 100,measured:60,previewChanged:true,restored:true,publications:0});
    expect(retainedBytes).toBeLessThan(8*1024*1024);
    expect(metrics.inputP95).toBeLessThan(16.7);
    expect(metrics.frameP95).toBeLessThan(16.7);
  });
}
