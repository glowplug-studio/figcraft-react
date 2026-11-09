import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import flow from "../fixtures/text-flow.json" with { type:"json" };
import wordSamples from "../fixtures/text-word-starts.json" with { type:"json" };
import outlines from "../fixtures/text-outlines.json" with { type:"json" };
import styled from "../fixtures/styled-glyphs.json" with { type:"json" };
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
  fontFiles.set("/fonts/outline-cff.ttc", await readFile(new URL("../fixtures/outline-cff.ttc", import.meta.url)));
  let failFirstWordRequest = true;
  await page.route("https://shaper.test/**", async route => {
    const path = new URL(route.request().url()).pathname, font = fontFiles.get(path), chunk = files.get(path);
    if (path === "/") return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Shaping</title>"});
    if (font) return route.fulfill({contentType:"font/ttf",body:font});
    if (path.includes("line-segmenter") && path.endsWith(".wasm") && failFirstWordRequest) {
      failFirstWordRequest = false;
      return route.fulfill({status:503});
    }
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
  const selected = await page.evaluate(async ({inputs,selection,styled,flow}) => {
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
      flow:flow.map(({input,boxWidth,boxHeight,savedBreaks})=>{
        const text=api.readTextData(input);
        const result=api.layoutTextFlow(savedBreaks ? {...text,savedBreaks} : text,library,{width:boxWidth ?? undefined,height:boxHeight ?? undefined},[]);
        return {width:result.width,height:result.height,lines:result.lines,truncated:result.truncated,
          glyphs:result.glyphs.map(g=>[g.face.postscript,g.id,g.start,g.end,g.x,g.y,g.advance,g.size,g.rtl])};
      }),
      styled:styled.map(({input,baseline})=>{
        const items = [...api.styledGlyphs(api.readTextData(input),library,undefined)];
        let x = 0;
        const glyphs = items.map(g=>{
          const row = [g.face.postscript,g.id,g.start,g.end,x+g.offsetX,baseline-g.offsetY,g.size,g.advance];
          x += g.advance;
          return row;
        });
        return {glyphs,width:x-(items.at(-1)?.spacing ?? 0)};
      }),
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
  },{inputs,selection,styled,flow});
  expect(selected).toEqual({...selection,flow:flow.map(({width,height,lines,glyphs,truncated})=>({width,height,lines,glyphs,truncated})),styled:styled.map(({glyphs,width})=>({glyphs,width}))});
  const masks = await page.evaluate(async samples => {
    const url = "/shaper.js";
    const api: typeof import("../fixtures/text-shaping-browser") = await import(url);
    const fonts = new Map<string,Awaited<ReturnType<typeof api.readFontFaces>>>();
    const results = [];
    for (const {file,index,id,axes,path} of samples) {
      if (!fonts.has(file)) {
        const bytes = await (await fetch("/fonts/"+file)).arrayBuffer();
        fonts.set(file, await api.readFontFaces(new Uint8Array(bytes)));
      }
      const face = fonts.get(file)![index];
      const size = 110, x = 42, y = 126;
      const warp = [1,0.14,-0.18,0.97,12,2] as const;
      const target = new OffscreenCanvas(240,190).getContext("2d")!;
      const native = new OffscreenCanvas(240,190).getContext("2d")!;
      native.transform(...warp);
      native.translate(x,y);
      native.scale(size/face.upem,size/face.upem);
      for (const [kind,...v] of path) {
        const [a,b,c,d,e,f] = v as number[];
        if (kind==="M") native.moveTo(a,b);
        else if (kind==="L") native.lineTo(a,b);
        else if (kind==="Q") native.quadraticCurveTo(a,b,c,d);
        else if (kind==="C") native.bezierCurveTo(a,b,c,d,e,f);
        else native.closePath();
      }
      const placed = api.glyphPath({face,id,size,x,y,warp,coordinates:axes as Record<string,number>});
      for (const c of placed) {
        if (c[0]==="M") target.moveTo(c[1],c[2]);
        else if (c[0]==="L") target.lineTo(c[1],c[2]);
        else if (c[0]==="C") target.bezierCurveTo(c[1],c[2],c[3],c[4],c[5],c[6]);
        else target.closePath();
      }
      native.fill();
      target.fill();
      const a = native.getImageData(0,0,240,190).data;
      const b = target.getImageData(0,0,240,190).data;
      let ink = 0, error = 0, interior = 0;
      for (let i=3;i<a.length;i+=4) {
        ink += a[i];
        error += Math.abs(a[i]-b[i]);
        if ((a[i]===255 && b[i]===0) || (a[i]===0 && b[i]===255)) interior++;
      }
      results.push({file,id,interior,relativeError:error / Math.max(ink,1)});
    }
    return results;
  }, outlines);
  for (const mask of masks) {
    expect(mask.interior,JSON.stringify(mask)).toBe(0);
    expect(mask.relativeError,JSON.stringify(mask)).toBeLessThan(0.015);
  }
  const plain = await page.evaluate(async () => {
    const url = "/shaper.js";
    const api: typeof import("../fixtures/text-shaping-browser") = await import(url);
    return (await api.textWordStarts("日本語 and English")).length;
  });
  expect(plain).toBe(0);
  expect(requests.filter(path => path.endsWith(".wasm"))).toHaveLength(1);
  await expect(page.evaluate(async () => {
    const url = "/shaper.js";
    const api: typeof import("../fixtures/text-shaping-browser") = await import(url);
    await api.textWordStarts("ภาษาไทย");
  })).rejects.toThrow("HTTP 503");
  const wordResults = await page.evaluate(async samples => {
    const url = "/shaper.js";
    const api: typeof import("../fixtures/text-shaping-browser") = await import(url);
    const library = new api.FontLibrary();
    const bytes = await (await fetch("/fonts/inter/Inter-Regular.ttf")).arrayBuffer();
    for (const face of await api.readFontFaces(new Uint8Array(bytes))) library.add(face);
    return Promise.all(samples.map(async ({text,width}) => {
      const [flags, result] = await Promise.all([
        api.textWordStarts(text),
        api.layoutText(api.readTextData({characters:text,auto_resize:"height"}), library, {width}),
      ]);
      return {length:flags.length,starts:[...flags.keys()].filter(i => flags[i]),
        flow:{width:result.width,height:result.height,lines:result.lines.map(l => [l.start,l.end,l.width,l.baseline])}};
    }));
  }, wordSamples);
  expect(wordResults).toEqual(wordSamples.map(({length,starts,flow}) => ({length,starts,flow})));
  expect(requests.filter(path => path.includes("line-segmenter") && path.endsWith(".wasm"))).toHaveLength(2);
});
