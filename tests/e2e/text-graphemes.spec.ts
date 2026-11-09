import { expect, test } from "@playwright/test";
import { build } from "vite";
import reference from "../fixtures/grapheme-steps.json" with { type:"json" };
import type * as Graphemes from "../../src/engine/text-graphemes";

declare global { interface Window { FigcraftGraphemes: typeof Graphemes } }

test("Chromium caret and backspace steps agree with native Unicode editing", async ({page}) => {
  const result = await build({configFile:false,logLevel:"silent",build:{write:false,lib:{
    entry:"src/engine/text-graphemes.ts",name:"FigcraftGraphemes",formats:["iife"]}}});
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!("output" in bundle)) throw new Error("Expected one browser build");
  const code = bundle.output.find(chunk => chunk.type === "chunk")!.code;
  await page.setContent("<title>Grapheme editing</title>");
  await page.addScriptTag({content:code});
  const rows = await page.evaluate(fixtures => fixtures.map(({text,steps}) => {
    const map = new window.FigcraftGraphemes.TextGraphemes(text);
    return steps.map((_,i)=>[map.step(i,false),map.step(i,true),map.backspace(i)]);
  }),reference);
  expect(rows).toEqual(reference.map(c=>c.steps));
});
