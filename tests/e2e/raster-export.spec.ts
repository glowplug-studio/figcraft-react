import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { build } from "vite";
import cases from "../fixtures/native-png-exports.json" with { type: "json" };
import svgScenes from "../fixtures/native-svg-export.json" with { type: "json" };
import svgShadows from "../fixtures/native-svg-shadow-export.json" with { type: "json" };
import svgDashes from "../fixtures/native-svg-dash-export.json" with { type: "json" };
import svgImages from "../fixtures/native-svg-effect-images.json" with { type: "json" };
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
    rolldownOptions: {output:{codeSplitting:false}},
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

async function compareSvg(page:Page,scene:{commands:unknown[][];svg:string}) {
  return page.evaluate(async ({commands,svg})=>{
    const fixture=(window as unknown as {FigcraftRaster:{replaySvg:typeof import("../fixtures/raster-export").replaySvg}}).FigcraftRaster;
    const actual=await fixture.replaySvg(commands);
    async function decode(text:string) {
      const root=new DOMParser().parseFromString(text,"image/svg+xml").documentElement;
      if (root.localName!=="svg") throw new Error("Invalid SVG");
      const width=Number(root.getAttribute("width")), height=Number(root.getAttribute("height"));
      const img=new Image(), url=URL.createObjectURL(new Blob([text],{type:"image/svg+xml"}));
      try {
        img.src=url; await img.decode();
        const canvas=document.createElement("canvas"), scale=Math.min(1,256/Math.max(width,height));
        canvas.width=Math.max(1,Math.ceil(width*scale)); canvas.height=Math.max(1,Math.ceil(height*scale));
        const ctx=canvas.getContext("2d")!;
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        return {width,height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
      } finally { URL.revokeObjectURL(url); }
    }
    const a=await decode(actual), b=await decode(svg);
    if (a.width!==b.width || a.height!==b.height) throw new Error("Different SVG bounds");
    let max=0, maxPremult=0, total=0;
    for (let i=0;i<a.data.length;i+=4) {
      for (let channel=0;channel<4;channel++) {
        const x=a.data[i+channel], y=b.data[i+channel];
        max=Math.max(max,Math.abs(x-y));
        const delta=channel===3 ? Math.abs(x-y) : Math.abs(x*a.data[i+3]-y*b.data[i+3])/255;
        maxPremult=Math.max(maxPremult,delta);
        total+=delta;
      }
    }
    const structure=(xml:string)=>xml.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g,"embedded-png");
    return {max,maxPremult,mean:total/a.data.length,structureMatches:structure(actual)===structure(svg)};
  },scene);
}

test("exported SVGs match native browser rendering for paths, clips, masks, text and paint",async ({page})=>{
  await loadExporter(page);
  for (const scene of [...svgScenes,...svgShadows,...svgDashes]) expect((await compareSvg(page,scene)).max,scene.name).toBe(0);
});

test("SVG export embeds the native effect layers, extents and isolated artwork",async ({page})=>{
  await loadExporter(page);
  for (const scene of svgImages) {
    const measured=await compareSvg(page,scene);
    await test.info().attach(scene.name,{body:JSON.stringify(measured),contentType:"application/json"});
    expect.soft(measured.structureMatches,scene.name).toBe(true);
    expect.soft(measured.mean,scene.name).toBeLessThan(0.25);
    expect.soft(measured.maxPremult,scene.name).toBeLessThanOrEqual(10);
  }
});

test("rasterised SVG patterns share the export root's remaining nesting depth",async ({page})=>{
  await loadExporter(page);
  for (const [outer,red] of [[1,true],[200,false]] as const) {
    const containsRed=await page.evaluate(async outer=>{
      const fixture=(window as unknown as {FigcraftRaster:{exportDeepPattern:typeof import("../fixtures/raster-export").exportDeepPattern}}).FigcraftRaster;
      const svg=await fixture.exportDeepPattern(outer,100);
      const element=new DOMParser().parseFromString(svg,"image/svg+xml").querySelector("image");
      if (!element) throw new Error("Missing embedded pattern image");
      const im=new Image(); im.src=element.getAttribute("href")!; await im.decode();
      const c=document.createElement("canvas"); c.width=im.width; c.height=im.height;
      const ctx=c.getContext("2d")!; ctx.drawImage(im,0,0);
      const rgba=ctx.getImageData(0,0,c.width,c.height).data;
      for (let i=0;i<rgba.length;i+=4) if (rgba[i]>200 && rgba[i+1]<60 && rgba[i+3]>200) return true;
      return false;
    },outer);
    expect(containsRed).toBe(red);
  }
});

test("editable SVG imports match native layer data, warnings, resources and the upstream pixel probes",async({page})=>{
  const {readFile}=await import("node:fs/promises");
  type RecordMap=Record<string,unknown>;
  type Scene={name:string;svg:string;error?:string;result?:RecordMap;document?:{
    nodes:Record<string,RecordMap>;imageIndex:{hash:string;width:number;height:number}[]}};
  const corpus:Scene[]=JSON.parse(await readFile(new URL("../fixtures/native-svg-import.json",import.meta.url),"utf8"));
  await loadExporter(page);
  let probes=0;
  function compare(native:unknown,actual:unknown,path:string) {
    if (typeof native==="number") {
      expect(typeof actual,path).toBe("number");
      expect(Math.abs(Number(actual)-native),path).toBeLessThanOrEqual(.0005+.000005*Math.abs(native));
    } else if (Array.isArray(native)) {
      expect(actual,path).toHaveLength(native.length);
      native.forEach((item,i)=>compare(item,(actual as unknown[])[i],path+"["+i+"]"));
    } else if (native && typeof native==="object") {
      for(const [k,v] of Object.entries(native)) compare(v,(actual as RecordMap)?.[k],path+"."+k);
    } else expect(actual,path).toEqual(native);
  }
  for (const scene of corpus) {
    const imported=page.evaluate(async ({name,svg})=>(window as unknown as {
      FigcraftRaster:Pick<typeof import("../fixtures/raster-export"),"importSvgFixture">
    }).FigcraftRaster.importSvgFixture(name,svg),{name:scene.name,svg:scene.svg});
    if (scene.error) {await expect(imported).rejects.toThrow("SVG import failed:");continue;}
    const result=await imported, native=scene.document!;
    expect(result.result,scene.name).toEqual(scene.result);
    expect(Object.keys(result.document.nodes),scene.name).toEqual(Object.keys(native.nodes));
    expect(result.document.imageIndex.map((i:{width:number;height:number})=>[i.width,i.height]).sort(),scene.name)
      .toEqual(native.imageIndex.map(i=>[i.width,i.height]).sort());
    for(const [id,node] of Object.entries(native.nodes)) {
      if (id==="1") continue;
      const actual=result.document.nodes[id];
      const expected:RecordMap={transform:[1,0,0,1,0,0],...node};
      // Vector tiles use the browser's PNG encoder. Their resource key hashes the encoded bytes.
      if (scene.name==="patterns" && ["tiled","spotted"].includes(String(node.name))) {
        const paint=(node.fills as RecordMap[])[0];
        const source=native.imageIndex.find(i=>i.hash===paint.image)!;
        const resource=result.document.imageIndex.find((i:{hash:string})=>i.hash===actual.fills[0].image);
        expect([resource.width,resource.height]).toEqual([source.width,source.height]);
        expected.fills=[{...paint,image:actual.fills[0].image}];
      }
      compare(expected,actual,scene.name+"."+id);
    }
    const im=PNG.sync.read(Buffer.from(result.png,"base64"));
    for (const m of scene.svg.matchAll(/<!-- probe (\d+) (\d+) #([\da-f]{8})(?: ~(\d+))?\s*-->/gi)) {
      const [x,y]=m.slice(1,3).map(Number), start=(im.width*y+x)*4;
      expect(x).toBeLessThan(im.width);expect(y).toBeLessThan(im.height);
      const expected=Buffer.from(m[3],"hex");
      for(let i=0;i<4;i++) expect(Math.abs(im.data[start+i]-expected[i]),scene.name+" at "+x+","+y).toBeLessThanOrEqual(Number(m[4] ?? 8));
      probes++;
    }
  }
  expect(probes).toBeGreaterThan(140);
});
