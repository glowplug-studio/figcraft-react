import {expect,test} from "@playwright/test";
import {openTextFixture} from "../fixtures/serve-text-module";

test("typing and selection across 100 visible text layers in a 10000-node drawing meet the frame budget",async ({page})=>{
  await openTextFixture(page,"tests/fixtures/text-edit-performance.ts");
  const benchmark=await page.evaluateHandle(async ()=>{
    const entry="/editor.js",api:typeof import("../fixtures/text-edit-performance")=await import(entry);
    return api.prepareTextBenchmark();
  });
  const cdp=await page.context().newCDPSession(page);
  const retained=async()=>{await cdp.send("HeapProfiler.collectGarbage");return (await cdp.send("Runtime.getHeapUsage")).usedSize;};
  const before=await retained();
  const result=await benchmark.evaluate(run=>run());
  const growth=(await retained())-before;
  await benchmark.dispose();
  await test.info().attach("text-edit-frames",{body:JSON.stringify({...result,retainedBytes:growth}),contentType:"application/json"});
  expect(result).toMatchObject({nodes:10000,visible:100,frames:110,rootNotifications:0,text:"Label 0"});
  expect(result.frameP95).toBeLessThan(16.7);
  expect(result.inputP95).toBeLessThan(16.7);
  expect(growth).toBeLessThan(8*1024*1024);
});
