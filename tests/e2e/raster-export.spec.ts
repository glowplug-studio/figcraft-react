import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { build } from "vite";
import cases from "../fixtures/native-png-exports.json" with { type: "json" };
import svgScenes from "../fixtures/native-svg-export.json" with { type: "json" };
import jobCases from "../fixtures/native-export-jobs.json" with { type: "json" };
import codecs from "../fixtures/native-raster-codecs.json" with { type: "json" };
import { embeddedIcc } from "../../src/engine/icc-container";
import { iccDescription } from "../../src/engine/image-profile";
import { jpegHeader } from "../../src/engine/jpeg-header";
import type { replay } from "../fixtures/raster-export";

const { PNG } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle") as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } }
};

let script: string;
test.beforeAll(async () => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false,
    rollupOptions: {output:{inlineDynamicImports:true}},
    lib: { entry: "tests/fixtures/raster-export.ts", formats: ["es"] } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code;
  if (!code) throw new Error("Could not build export fixture");
  script = code;
});
async function loadExporter(page: Page) {
  await page.goto("/login");
  await page.setContent("<main></main>");
  const url = new URL("/raster-export-fixture.js",page.url()).href;
  await page.route(url,route=>route.fulfill({contentType:"application/javascript",body:script}));
  await page.evaluate(async url=>{Object.assign(window,{FigcraftRaster:await import(url)});},url);
}

test("PNG export matches independently rendered native pixels, size and colour tags", async ({ page }) => {
  await loadExporter(page);
  for (const entry of cases.filter(c => c.png)) {
    const base64 = await page.evaluate(commands => (window as unknown as { FigcraftRaster: { replay: typeof replay } }).FigcraftRaster.replay(commands), entry.commands);
    const bytes = Buffer.from(base64, "base64"), actual = PNG.sync.read(bytes), native = PNG.sync.read(Buffer.from(entry.png!, "base64"));
    expect([actual.width, actual.height], entry.name).toEqual([native.width, native.height]);
    for (let i = 0; i < actual.data.length; i += 4) {
      const alpha = actual.data[i + 3], nativeAlpha = native.data[i + 3];
      // The final 0.05-pixel strip has analytic coverage 12.75/255. Chromium includes it;
      // the native rasteriser has no covered sample there. Compare composited contributions.
      const fringe = entry.name === "float edge" && (i / 4) % actual.width === actual.width - 1;
      const tolerance = fringe ? 13 : 2;
      expect(Math.abs(alpha - nativeAlpha), entry.name).toBeLessThanOrEqual(tolerance);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs((actual.data[i + c] * alpha - native.data[i + c] * nativeAlpha) / 255), entry.name).toBeLessThanOrEqual(tolerance);
      }
    }
    const chunks: string[] = [];
    for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) chunks.push(bytes.toString("ascii", at + 4, at + 8));
    if (entry.name === "p3 tag") expect(chunks).toEqual(expect.arrayContaining(["cICP", "iCCP"]));
    else expect(chunks).toContain("sRGB");
  }
});

test("lossless WebP and baseline JPEG retain native profiles, alpha and full chroma", async ({ page }) => {
  await loadExporter(page);
  for (const entry of codecs) {
    const isJpeg = entry.name.startsWith("jpg"), p3 = entry.name.includes("displayP3");
    const mime = isJpeg ? "image/jpeg" : "image/webp";
    const encoded = await page.evaluate(commands => (window as unknown as { FigcraftRaster: { replay: typeof replay } }).FigcraftRaster.replay(commands), entry.commands);
    const bytes = Buffer.from(encoded, "base64");
    const icc = await embeddedIcc(Uint8Array.from(bytes), mime);
    if (isJpeg || p3) expect(icc && iccDescription(icc.profile)?.name, entry.name).toBe(p3 ? "Display P3" : "sRGB");
    else expect(icc).toBeUndefined();
    if (isJpeg) expect(jpegHeader(bytes)?.sampling).toEqual([17,17,17]);
    else expect(bytes.includes(Buffer.from("VP8L"))).toBe(true);
    const result = await page.evaluate(async ({ encoded, native, mime }) => {
      async function read(data: string) {
        const blob = await (await fetch("data:" + mime + ";base64," + data)).blob();
        const image = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        try {
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, image.width, image.height).data;
        } finally { image.close(); }
      }
      const a = await read(encoded), b = await read(native);
      let max = 0, sum = 0;
      for (let i = 0; i < a.length; i++) {
        const error = Math.abs(a[i] - b[i]); max = Math.max(max, error); sum += error;
      }
      return { max, mean: sum / a.length, length: a.length };
    }, { encoded, native: entry.data, mime });
    expect(result.length).toBe(24 * 20 * 4);
    if (isJpeg) expect(result.mean, entry.name).toBeLessThan(entry.name.endsWith("20") ? 2 : 0.6);
    else expect(result.max, entry.name).toBe(0);
  }
});

test("layer export command returns separate payloads and a ZIP with the same decoded PNGs", async ({page}) => {
  await loadExporter(page);
  const { commands, files } = jobCases[0];
  for (const zip of [false,true]) {
    const result = await page.evaluate(({commands,zip}) => {
      const batch = (window as unknown as {FigcraftRaster:{replayBatch:typeof import("../fixtures/raster-export").replayBatch}}).FigcraftRaster;
      return batch.replayBatch([...commands.slice(0,-1),["file.exportLayers",{ids:[2,3,4,5],zip}]]);
    },{commands,zip});
    expect(result.skipped).toBe(1);
    const records = result.files as {id:number;name:string;bytes:number;data?:string}[];
    expect(records.map(({id,name})=>({id,name}))).toEqual(files);
    const members = zip ? (await import("fflate")).unzipSync(Buffer.from(String(result.data),"base64")) : {};
    for (const file of records) {
      if (zip) expect(file.data).toBeUndefined();
      const bytes = zip ? Buffer.from(members[file.name]) : Buffer.from(file.data!,"base64");
      expect(bytes.byteLength).toBe(file.bytes);
      expect(PNG.sync.read(bytes).width).toBe(file.name.includes("@2x") ? 8 : 4);
    }
  }
});

test("a 4K JPEG export keeps its dimensions and releases its encoder worker", async ({page}) => {
  await loadExporter(page);
  const workers = new Set<ReturnType<Page["workers"]>[number]>();
  let created = 0;
  page.on("worker",worker=>{ created++; workers.add(worker); worker.on("close",()=>workers.delete(worker)); });
  const before = Date.now();
  const result = await page.evaluate(() => (window as unknown as { FigcraftRaster:{replay:typeof replay} }).FigcraftRaster.replay([
    ["shape.rectangle",{width:3840,height:2160}],["node.set",{props:{fill:"#34a589"}}],["file.export",{format:"jpg"}]
  ]));
  const bytes = Buffer.from(result,"base64");
  expect(jpegHeader(bytes)).toMatchObject({width:3840,height:2160});
  expect(created).toBe(1);
  await expect.poll(()=>workers.size).toBe(0);
  await test.info().attach("4k-jpeg",{body:JSON.stringify({durationMs:Date.now()-before,bytes:bytes.length,workerCountAfter:workers.size}),contentType:"application/json"});
});

test("exported SVGs match native browser rendering for paths, clips, masks, text and paint", async ({page}) => {
  await loadExporter(page);
  for (const scene of svgScenes) {
    const result = await page.evaluate(async ({commands,svg})=>{
      const fixture = (window as unknown as {FigcraftRaster:{replaySvg:typeof import("../fixtures/raster-export").replaySvg}}).FigcraftRaster;
      const actual = await fixture.replaySvg(commands);
      async function decode(text:string) {
        const root = new DOMParser().parseFromString(text,"image/svg+xml").documentElement;
        if (root.localName !== "svg") throw new Error("Invalid XML");
        const width = Number(root.getAttribute("width")), height = Number(root.getAttribute("height"));
        const img = new Image(), url = URL.createObjectURL(new Blob([text],{type:"image/svg+xml"}));
        try {
          img.src = url; await img.decode();
          const canvas=document.createElement("canvas"), scale=Math.min(1,256/Math.max(width,height));
          canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
          const ctx=canvas.getContext("2d")!;ctx.drawImage(img,0,0,canvas.width,canvas.height);
          return {width,height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
        } finally { URL.revokeObjectURL(url); }
      }
      const a=await decode(actual), b=await decode(svg);
      let max=0;
      if (a.width!==b.width || a.height!==b.height) throw new Error("Different bounds");
      for(let i=0;i<a.data.length;i++) max=Math.max(max,Math.abs(a.data[i]-b.data[i]));
      return max;
    },scene);
    expect(result, scene.name).toBe(0);
  }
});
