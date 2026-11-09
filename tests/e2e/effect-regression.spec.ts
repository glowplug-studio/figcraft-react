import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as Fixture from "../fixtures/effect-regression";

declare global { interface Window { EffectRegression: typeof Fixture; editEffect: Awaited<ReturnType<typeof Fixture.prepareEffectEdits>> } }
let bundle: string;
test.beforeAll(async () => {
  const built = await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"tests/fixtures/effect-regression.ts",name:"EffectRegression",formats:["iife"]}}});
  const {output}=(Array.isArray(built)?built[0]:built) as {output:{type:string;code:string}[]};
  bundle=output.find(c=>c.type==="chunk")!.code;
});
test.beforeEach(async ({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:bundle});
});
test("glass cuts match whole frames for analytic, smoothed and oversized shapes",async ({page})=>{
  const results = await page.evaluate(()=>[
    window.EffectRegression.cutGlass(20,0,1.5,false),
    window.EffectRegression.cutGlass(24,.65,1.5,false),
    window.EffectRegression.cutGlass(60,.65,1.5,true)]);
  expect(results).toEqual(Array(3).fill({different:0,worst:0}));
});
test("live glass edits in 10000 nodes respect the input, frame and retained heap budgets",async ({page})=>{
  await page.evaluate(async()=>{window.editEffect=await window.EffectRegression.prepareEffectEdits(document.querySelector("canvas")!);});
  const cdp=await page.context().newCDPSession(page);
  const heap=async()=>{await cdp.send("HeapProfiler.collectGarbage"); return await cdp.send("Runtime.getHeapUsage");};
  await page.evaluate(()=>window.editEffect());
  const before=await heap(), edit=await page.evaluate(()=>window.editEffect()), after=await heap();
  await test.info().attach("effect editing", {body:JSON.stringify({edit,before,after}),contentType:"application/json"});
  expect(edit).toMatchObject({nodes:10000,frames:110,publications:0,restored:true});
  expect(edit.inputP95).toBeLessThan(8); expect(edit.frameP95).toBeLessThan(16.7);
  expect(after.usedSize-before.usedSize).toBeLessThan(4*1024*1024);
  expect(after.backingStorageSize-before.backingStorageSize).toBeLessThan(4*1024*1024);
});
test("the seven layer effects preserve their fixed Chromium appearance",async ({page})=>{
  await page.evaluate(()=>window.EffectRegression.effectSamples(document.querySelector("canvas")!));
  await expect(page.locator("canvas")).toHaveScreenshot("seven-native-effects.png");
});
