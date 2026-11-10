import { expect,it } from "vitest";
import { decodeFigcraft } from "../../src/engine/file-format";
import { importRestDocument } from "../../src/engine/interchange/rest/document";
import corpus from "../fixtures/native-rest-documents.json";

const fixtures=corpus.filter(c=>c.name!=="section and slice");
it.each(fixtures)("reads the native REST file and warnings for $name",async entry=>{
  const actual=await importRestDocument(entry.source,undefined,undefined,"variables" in entry ? entry.variables : undefined);
  const expected=await decodeFigcraft(Uint8Array.from(Buffer.from(entry.archive,"base64")));
  expect(actual?.issues).toEqual(entry.opened.warnings);
  expect(actual?.nextId).toBe(expected.nextId);
  expect(actual?.document.currentPage).toBe(expected.document.currentPage);
  expect(actual?.document.name).toBe(expected.document.name);
  expect(actual?.document.pages).toEqual(expected.document.pages);
  expect(actual?.document.nodes).toEqual(expected.document.nodes);
  expect(actual?.document.styles ?? []).toEqual(expected.document.styles ?? []);
  expect(actual?.document.variables).toEqual(expected.document.variables);
  expect(Object.keys(actual?.document.images ?? {}).sort()).toEqual(Object.keys(expected.document.images ?? {}).sort());
});

it("limits encoded REST JSON nesting at the boundary accepted by serde_json",async()=>{
  const { loadDesignDocument }=await import("../../src/engine/interchange/load");
  const source=(depth:number)=>{
    let node:unknown={type:"RECTANGLE",name:'label with " brackets ] } [ {'};
    for (let i=0;i<depth;i++) node={type:"FRAME",children:[node]};
    return new Blob([JSON.stringify({document:{type:"DOCUMENT",children:[{type:"CANVAS",children:[node]}]}})]);
  };
  const ok=await loadDesignDocument(source(60),undefined,()=>{});
  expect(Object.keys(ok.decoded.document.nodes)).toHaveLength(62);
  await expect(loadDesignDocument(source(61),undefined,()=>{})).rejects.toThrow(/recursion limit/);
});
it("loads only supplied image siblings, hashes their bytes and ignores invalid or missing references",async()=>{
  const { loadDesignDocument }=await import("../../src/engine/interchange/load");
  const { imageHash }=await import("../../src/engine/image-resource");
  const image=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNIcAAAAASUVORK5CYII=","base64"));
  const file=new File([image],"logo.png"), requested:string[]=[];
  const vars=corpus.find(c=>c.name==="companion variables")!;
  const source={nodes:{a:{document:{type:"RECTANGLE",fills:["logo","logo","../private","missing"].map(imageRef=>({type:"IMAGE",imageRef}))}}}};
  const folder={file:async(name:string)=>name==="variables.json" ? new File([JSON.stringify("variables" in vars ? vars.variables : {})],name) : undefined,
    image:async(name:string)=>{requested.push(name);return name==="logo.png" ? file : undefined;}};
  const {decoded}=await loadDesignDocument(new Blob([JSON.stringify(source)]),undefined,()=>{},folder,"design.json");
  const key=await imageHash(image), resources=decoded.document.images!;
  expect(Object.keys(resources).sort()).toEqual([key,"rest-image-missing","missing"].sort());
  expect(resources[key].width).toBe(1);
  expect(new Uint8Array(await resources[key].bytes.arrayBuffer())).toEqual(image);
  expect(decoded.document.variables?.variables.map(v=>v.id)).toContain("w");
  expect(decoded.issues?.some(w=>w.startsWith("2 images without image data"))).toBe(true);
  expect(requested.filter(n=>n==="logo.png")).toHaveLength(1);
  expect(requested.some(n=>n.includes("/"))).toBe(false);
});
