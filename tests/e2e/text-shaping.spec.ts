import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import selection from "../fixtures/font-selection.json" with { type:"json" };
import cases from "../fixtures/text-shaping.json" with { type:"json" };
import type { ShapingFace } from "../../src/engine/shaping-face";

test("Chromium shapes pinned font bytes with the native glyph IDs, positions and scalar clusters", async ({page}) => {
  const result = await build({configFile:false,logLevel:"silent",build:{write:false,target:"esnext",assetsInlineLimit:0,
    rolldownOptions:{input:"tests/fixtures/text-shaping-browser.ts",preserveEntrySignatures:"strict",
      output:{entryFileNames:"shaper.js"}}}});
  if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one browser build");
  const files = new Map(result.output.map(chunk => ["/"+chunk.fileName,chunk]));
  const inputs = [...new Set([...cases.map(c=>c.file),...["Regular","Bold","Italic","SemiBold"].map(s=>"inter/Inter-"+s+".ttf")])];
  const fontFiles = new Map(await Promise.all(inputs.map(async file =>
    ["/fonts/"+file,await readFile(new URL("../../fonts/"+file,import.meta.url))] as const)));
  await page.route("https://shaper.test/**", async route => {
    const path = new URL(route.request().url()).pathname, font = fontFiles.get(path), chunk = files.get(path);
    if (path === "/") return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Shaping</title>"});
    if (font) return route.fulfill({contentType:"font/ttf",body:font});
    if (!chunk) return route.fulfill({status:404});
    if (chunk.type === "chunk") return route.fulfill({contentType:"text/javascript",body:chunk.code});
    return route.fulfill({contentType:"application/wasm",body:Buffer.from(chunk.source)});
  });
  const requests: string[] = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  await page.goto("https://shaper.test/");
  expect(requests.some(path => path.endsWith(".wasm"))).toBe(false);
  const actual = await page.evaluate(async fixtures => {
    const url = "/shaper.js";
    const api: typeof import("../../src/engine/font-source") = await import(url);
    const faces = new Map<string,ShapingFace>();
    const rows: number[][][] = [];
    for (const sample of fixtures) {
      let face = faces.get(sample.file);
      if (!face) {
        const bytes = await (await fetch("/fonts/"+sample.file)).arrayBuffer();
        face = (await api.readFontFaces(new Uint8Array(bytes)))[0];
        faces.set(sample.file,face);
      }
      const scalars = Array.from(sample.text,(c,source)=>({codePoint:c.codePointAt(0)!,source}));
      rows.push(face.shape(scalars,sample.rtl,sample.features as Record<string,boolean>,sample.axes as Record<string,number>)
        .map(g=>[g.id,g.cluster,g.advance,g.offsetX,g.offsetY]));
    }
    return rows;
  },cases);
  expect(actual).toEqual(cases.map(c=>c.glyphs));
  const selected = await page.evaluate(async ({inputs,selection}) => {
    const url = "/shaper.js";
    const api: typeof import("../fixtures/text-shaping-browser") = await import(url);
    const library = new api.FontLibrary();
    for (const path of inputs) {
      const bytes = await (await fetch("/fonts/"+path)).arrayBuffer();
      for (const face of await api.readFontFaces(new Uint8Array(bytes))) library.add(face);
    }
    const georgian = library.find("Noto Sans Georgian","Regular")!;
    const coordinates = (v: Readonly<Record<string,number>>) => [v.wght,v.wdth];
    return {
      instances:georgian.instances.map(i=>[i.name,coordinates(i.coordinates)]),
      settings:selection.settings.map(row=>{
        const [fontStyle,variations] = row as [string,Record<string,number>,unknown];
        return [fontStyle,variations,coordinates(georgian.axisValues({fontStyle,fontSize:17,variations}))];
      }),
      requests:selection.requests.map(([family,style])=>[family,style,library.find(family!,style!)?.postscript ?? null,library.defaultFace()?.postscript]),
      runs:selection.runs.map(({text})=>{
        const chars = Array.from(text);
        const runs = library.segments(chars,new api.TextGraphemes(text),0,chars.length,"Inter","Regular");
        return {text,glyphs:Array.from(runs).flatMap(({start,end,face})=>{
          const scalars = chars.slice(start,end).map((c,i)=>({codePoint:c.codePointAt(0)!,source:start+i}));
          return face.shape(scalars,false,{},{}).map(g=>[face.postscript,g.cluster,g.id]);
        })};
      }),
    };
  },{inputs,selection});
  expect(selected).toEqual(selection);
  expect(requests.filter(path => path.endsWith(".wasm"))).toHaveLength(1);
});
