import {readFileSync} from "node:fs";
import {unzipSync,strFromU8} from "fflate";
import {expect,it} from "vitest";
import {loadDesignDocument} from "../../src/engine/interchange/load";
import {decodeFigcraft} from "../../src/engine/file-format";

// Captured from upstream file.export and a fresh file.open/saveAs for each container.
// Both routes carry the same message. Metadata names and external ZIP resources can differ.
const files=unzipSync(readFileSync(new URL("../fixtures/native-fig-imports.zip",import.meta.url)));
const cases=Object.keys(files).filter(name=>name.endsWith(".fig")).map(name=>name.slice(0,-4));
for (const route of ["zip","raw"]) it.each(cases)("opens "+route+" Fig input and matches its native archive for %s",async name=>{
  const file=files[name+".fig"];
  const source=route==="zip" ? file : unzipSync(file)["canvas.fig"];
  const expected=await decodeFigcraft(files[name+"-"+route+".figcraft"]);
  const {warnings}=JSON.parse(strFromU8(files[name+"-"+route+".receipt.json"]));
  const {decoded,external}=await loadDesignDocument(source,undefined,()=>{},undefined,"supplied.fig");
  expect(external).toBe(true);
  expect(decoded.nextId).toBe(expected.nextId);
  expect(decoded.issues).toEqual(warnings);
  const {images={},...document}=decoded.document,{images:reference={},...native}=expected.document;
  expect(document).toEqual(native);
  expect(Object.keys(images).sort()).toEqual(Object.keys(reference).sort());
  for (const [key,image] of Object.entries(images)) {
    const original=reference[key];
    expect([image.width,image.height]).toEqual([original.width,original.height]);
    const bytes=Buffer.from(await image.bytes.arrayBuffer()), baseline=Buffer.from(await original.bytes.arrayBuffer());
    if (route==="raw" && warnings.some((s:string)=>s.includes("missing-image placeholder"))) {
      const {default:sharp}=await import("sharp");
      expect(await sharp(bytes).ensureAlpha().raw().toBuffer()).toEqual(await sharp(baseline).ensureAlpha().raw().toBuffer());
    } else expect(bytes.equals(baseline)).toBe(true);
  }
});
