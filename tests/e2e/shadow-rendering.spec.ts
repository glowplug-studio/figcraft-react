import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as Fixture from "../fixtures/shadow-rendering";

declare global {interface Window { FigcraftShadows:typeof Fixture }}
let bundle:string;
test.beforeAll(async()=>{
  const result=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"tests/fixtures/shadow-rendering.ts",name:"FigcraftShadows",formats:["iife"]}}});
  const {output}=(Array.isArray(result)?result[0]:result) as {output:{type:string;code:string}[]};
  bundle=output.find(chunk=>chunk.type==="chunk")!.code;
});
test.beforeEach(async({page})=>{
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:bundle});
});
const red=[255,0,0,255],blue=[0,0,255,255],green=[0,255,0,255],white=[255,255,255,255],clear=[0,0,0,0];

test("drop shadows obey translucent cover, show-behind, list order, visibility and soft edges",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftShadows.stackSamples(document.querySelector("canvas")!));
  expect(r.covered).toEqual([[0,0,255,128],[0,0,255,128],[255,0,0,128]]);
  expect(r.behind[3]).toBe(192); expect(r.behind[0]).toBeCloseTo(85,-1); expect(r.behind[2]).toBeCloseTo(170,-1);
  expect(r.order).toEqual(green); expect(r.hidden).toEqual(red);
  expect(r.soft[0]).toEqual(blue); expect(r.soft.at(-1)).toEqual(clear);
  const alphas=r.soft.slice(1,-1).map(p=>p[3]);
  // Independent direct neighbourhood sums on the 20 × 20 opaque source.
  expect(alphas).toEqual([110,78,50,14]);
});

test("shadow spread follows ellipses and inner shadows sit below frame children and strokes",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftShadows.silhouetteSamples(document.querySelector("canvas")!));
  expect(r.ellipse).toEqual([red,clear,red]); expect(r.framePixels).toEqual([green,red,blue,white,clear]);
  expect(r.group).toEqual([green,blue,red,clear,red]);
});

test("offscreen casters, isolated ancestor bounds, zoom and shared layer reservations include shadows",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftShadows.boundsSamples(document.querySelector("canvas")!));
  expect(r.offscreen).toEqual(red); expect(r.isolated).toEqual([255,0,0,128]);
  expect(r.limited).toEqual(clear); expect(r.restored).toEqual(r.isolated); expect(r.zoom).toEqual(r.isolated);
});

test("opaque images retain outline shadows and transparent image fills cast and hide from their pixels",async({page})=>{
  const run=(transparent:boolean)=>page.evaluate(flag=>window.FigcraftShadows.imageSamples(document.querySelector("canvas")!,flag),transparent);
  const opaque=await run(false), cut=await run(true);
  const halfBlue=[0,0,255,128], halfRed=[255,0,0,128];
  expect(opaque.drop).toEqual([halfBlue,halfBlue,halfBlue,halfRed]);
  expect(opaque.inner).toEqual([blue,blue,red]);
  expect(cut.drop[0]).toEqual(halfBlue); expect(cut.drop[1][3]).toBe(160);
  expect(cut.drop.slice(2)).toEqual([halfRed,clear]); expect(cut.inner).toEqual([blue,red,clear]);
  expect(opaque.released && cut.released).toBe(true);
});

test("a scaled parent transforms outline spread and preserves the page-space drop offset",async({page})=>{
  const r=await page.evaluate(()=>window.FigcraftShadows.scaledOutlines(document.querySelector("canvas")!));
  expect(r).toEqual([[0,0,255,128],[255,0,0,128],[255,0,0,128],clear,[255,0,0,128]]);
});
