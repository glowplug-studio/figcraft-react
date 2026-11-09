import { expect, test } from "@playwright/test";
import { build } from "vite";
import reference from "../fixtures/text-bidi.json" with {type:"json"};
import type { ParaList } from "../../src/engine/text-data";

declare global { interface Window { FigcraftBidi: typeof import("../../src/engine/text-bidi") } }
test("Chromium resolves mixed-direction paragraphs, isolates and visual justification like native",async ({page})=>{
  const result=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"src/engine/text-bidi.ts",name:"FigcraftBidi",formats:["iife"]}}});
  const bundle=Array.isArray(result) ? result[0] : result;
  if (!("output" in bundle)) throw new Error("Expected one bidi build");
  await page.setContent("<title>Paragraph directions</title>");
  await page.addScriptTag({content:bundle.output.find(chunk=>chunk.type==="chunk")!.code});
  const actual=await page.evaluate(fixtures=>fixtures.map(({text,paragraphs})=>{
    const api=window.FigcraftBidi;
    const bidi=api.textBidi(text,paragraphs as Pick<ParaList,"direction">[]);
    if (!bidi) return null;
    const gaps=Array.from(bidi.levels,(_,i)=>i%3===1);
    return [[...bidi.levels],Array.from(bidi.paragraphRtl,Boolean),[...api.visualOrder(bidi.levels)],
      api.visualGaps(bidi.levels,gaps,Math.max(0,gaps.length-2))];
  }),reference);
  expect(actual).toEqual(reference.map(f=>f.expected));
});
