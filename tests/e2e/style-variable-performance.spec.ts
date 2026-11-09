import {expect,test} from "@playwright/test";
import {build} from "vite";
import type {styleModePerformance as measureStyleModes} from "../fixtures/style-variable-performance";

for (const direct of [false,true]) test(`10,000 ${direct ? "direct layer" : "style"} consumers change mode together and pan within the frame budget`,async({page})=>{
  const buildResult=await build({configFile:false,logLevel:"silent",build:{write:false,minify:true,
    lib:{entry:"tests/fixtures/style-variable-performance.ts",name:"StyleVariablePerformance",formats:["iife"]}}});
  const bundle=Array.isArray(buildResult) ? buildResult[0] : buildResult;
  if (!("output" in bundle)) throw new Error("Missing benchmark bundle");
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({content:bundle.output.find(c=>c.type==="chunk")!.code});
  const metrics=await page.evaluate(async direct=>{
    const {styleModePerformance}=(window as unknown as {StyleVariablePerformance:{styleModePerformance:typeof measureStyleModes}}).StyleVariablePerformance;
    return styleModePerformance(document.querySelector("canvas")!,direct);
  },direct);
  await test.info().attach("style-variable-performance",{body:JSON.stringify(metrics),contentType:"application/json"});
  expect(metrics).toMatchObject({changed:10000,rounded:direct ? 10000 : 0,nodes:10101,publications:0,previewRestored:true,restored:true});
  expect(metrics.frameP95).toBeLessThan(16.7);
  expect(metrics.editMs).toBeLessThan(1000);
});
