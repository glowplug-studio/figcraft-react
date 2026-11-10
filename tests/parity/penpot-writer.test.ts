import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import {parse,stringify} from "lossless-json";
import {it,expect} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {rootId} from "../../src/engine/interchange/penpot/archive";
import {PenpotLayoutWriter} from "../../src/engine/interchange/penpot/write-layout";
import {layerVisits,layerFields} from "../../src/engine/interchange/penpot/write-layers";
import {PenpotPaintWriter} from "../../src/engine/interchange/penpot/write-appearance";
import {PenpotComponentWriter} from "../../src/engine/interchange/penpot/write-components";
import {PenpotExportIds} from "../../src/engine/interchange/penpot/write-pages";
import {layerGeometry} from "../../src/engine/interchange/penpot/write-geometry";

const corpus=(name:string)=>unzipSync(readFileSync(new URL("../fixtures/"+name+".zip",import.meta.url)));
const outputs=corpus("native-penpot-exports");
const inputs=Object.assign({},...["native-penpot-files","native-penpot-archive-edges","native-penpot-prototype-edges"].map(corpus));
for (const [k,v] of Object.entries(corpus("native-sketch-files"))) inputs["native-sketch-files__"+k]=v;
const text=new TextDecoder();
it.each(Object.keys(outputs).filter(n=>n.endsWith(".penpot")))("matches native Penpot pages, geometry, paints, layout, components and media for %s",async name=>{
  const {document}=await decodeFigcraft(inputs[name.slice(0,-7)+".figcraft"]);
  const files=unzipSync(outputs[name]);
  const json=(p:string)=>JSON.parse(text.decode(files[p]));
  const ids=new PenpotExportIds(document),{file,manifest}=ids.headers();
  const layout=new PenpotLayoutWriter(ids,()=>{});
  const paints=new PenpotPaintWriter(ids,()=>{});
  const components=new PenpotComponentWriter(ids,()=>{});
  const native=json("manifest.json");
  expect(native.generatedBy).toBe("figcraft/0.15.0");
  expect(manifest).toEqual({...native,generatedBy:"figcraft-react"});
  const base="files/"+ids.file;
  // Compare the actual source number tokens on preserved fields, including integers above 2^53.
  const expected=parse(text.decode(files[base+".json"])) as Record<string,unknown>;
  expect(Object.keys(file).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(file)) expect(parse(stringify(file[key])!)).toEqual(expected[key]);
  for (const [index,[key,pageId]] of [...ids.pages].entries()) {
    const page=document.nodes[key],prefix=base+"/pages/"+pageId;
    if (page.kind!=="page") throw new Error("Missing page");
    const records=ids.pageRecords(page,pageId,index);
    expect(records.page).toEqual(json(prefix+".json"));
    expect(records.root).toEqual(json(prefix+"/"+rootId+".json"));
    const nativeIds=Object.keys(files).filter(p=>p.startsWith(prefix+"/") && p.endsWith(".json")).map(p=>p.slice(prefix.length+1,-5));
    const emitted=[rootId];
    for (const visit of layerVisits(ids,page)) {
      const {node:n,id,type}=visit;
      emitted.push(id);
      const shape=layerGeometry(document,n,id,type,()=>{});
      await paints.fields(n,type,shape);
      layerFields(ids,visit,pageId,shape,()=>{});
      layout.fields(n,type,visit.children,shape);
      components.fields(n,pageId,shape);
      const native=json(prefix+"/"+id+".json");
      // Text, prototype actions and variable bindings have separate writers. Compare every other field, including absence.
      delete native.interactions;
      delete native.appliedTokens;
      if (type==="text") {
        delete native.positionData;
        delete native.content;
        delete native.growType;
      }
      expect(JSON.parse(stringify(shape)!)).toEqual(native);
    }
    expect(emitted.sort()).toEqual(nativeIds.sort());
  }
  expect([...components.records.keys()].sort()).toEqual(Object.keys(files).filter(p=>p.startsWith(base+"/components/")).map(p=>p.slice(-41,-5)).sort());
  expect([...paints.media.values()].map(m=>m.id).sort()).toEqual(Object.keys(files).filter(p=>p.startsWith(base+"/media/")).map(p=>p.slice(-41,-5)).sort());
  for (const {object,ext,bytes} of paints.media.values()) expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(files["objects/"+object+"."+ext]);
  for (const [id,record] of components.records) expect(JSON.parse(stringify(record)!)).toEqual(json(base+"/components/"+id+".json"));
});
