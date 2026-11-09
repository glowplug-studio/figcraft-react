import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { layerBlendPixels } from "../fixtures/blend-rendering";

test("all 19 layer blend modes match native colours and preserve group isolation under frame clips",async({page})=>{
  const buildResult=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{entry:"tests/fixtures/blend-rendering.ts",name:"FigcraftBlend",formats:["iife"]}}});
  const output=(Array.isArray(buildResult)?buildResult[0]:buildResult) as {output:{type:string;code?:string}[]};
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({content:output.output.find(c=>c.type==="chunk")!.code!});
  const result=await page.evaluate(()=>(window as unknown as {FigcraftBlend:{layerBlendPixels:typeof layerBlendPixels}}).FigcraftBlend.layerBlendPixels(document.querySelector("canvas")!));
  // Independent evaluations of blend_ref in paint_behaviour_tests.rs on #CC6633 and #66CCEE.
  const colours=[[102,204,238],[102,204,238],[102,102,51],[82,82,48],[51,51,34],[128,64,36],[204,204,238],
    [224,224,241],[255,255,255],[255,255,255],[194,163,95],[196,138,106],[163,194,228],[102,102,187],
    [143,143,194],[42,157,195],[195,105,59],[52,154,188],[254,152,101]];
  expect(result.layers).toHaveLength(colours.length);
  result.layers.forEach((rgba,i)=>rgba.forEach((v,c)=>expect(Math.abs(v-(colours[i][c]??255)),JSON.stringify({i,rgba})).toBeLessThanOrEqual(3)));
  expect(result.pass).toEqual([[0,255,0,255],[255,255,0,255],[255,255,0,255]]);
  expect(result.isolated).toEqual([0,255,255,255]);
  await test.info().attach("layer blend pixels",{body:JSON.stringify(result),contentType:"application/json"});
});
