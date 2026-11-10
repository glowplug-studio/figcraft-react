import {Zip,ZipDeflate,ZipPassThrough} from "fflate";
import {stringify} from "lossless-json";
import type {Document} from "../../document";
import {rootId} from "./archive";
import {PenpotPaintWriter} from "./write-appearance";
import {PenpotComponentWriter} from "./write-components";
import {layerGeometry} from "./write-geometry";
import {layerFields,layerVisits} from "./write-layers";
import {PenpotLayoutWriter} from "./write-layout";
import {PenpotExportIds} from "./write-pages";
import {PenpotPrototypeWriter} from "./write-prototype";
import {writeText} from "./write-text";
import {PenpotTokenWriter} from "./write-tokens";

const utf8=new TextEncoder(),MiB=1024**2;

export async function writePenpotDocument(doc:Document,checkCurrent:()=>void) {
  checkCurrent();
  const ids=new PenpotExportIds(doc),warnings=new Set<string>();
  const warn=(message:string)=>{if (warnings.size<100) warnings.add(message);};
  const paints=new PenpotPaintWriter(ids,warn),layout=new PenpotLayoutWriter(ids,warn),components=new PenpotComponentWriter(ids,warn);
  const prototypes=new PenpotPrototypeWriter(ids,warn),tokens=new PenpotTokenWriter(ids,warn);
  const base="files/"+ids.file,{manifest,file}=ids.headers(),parts:Blob[]=[];
  let bytes=0,compressed=0,entries=0,lastYield=performance.now(),pageBytes=0;
  let buffer:Uint8Array<ArrayBuffer>[]=[],bufferSize=0;
  const zip=new Zip((error,data,final)=>{
    if (error) throw error;
    compressed+=data.byteLength;
    if (compressed>512*MiB) throw new Error("Penpot archive exceeds 512 MiB");
    buffer.push(data as Uint8Array<ArrayBuffer>);
    bufferSize+=data.byteLength;
    if (final || bufferSize>=MiB) {
      parts.push(new Blob(buffer));
      buffer=[];bufferSize=0;
    }
  });
  async function checkpoint() {
    if (performance.now()-lastYield>=8) {
      await new Promise<void>(resolve=>setTimeout(resolve,0));
      lastYield=performance.now();
    }
    checkCurrent();
  }
  function member(path:string,size:number,compress:boolean) {
    bytes+=size;
    if (++entries>100000 || bytes>1024*MiB) throw new Error("Penpot archive exceeds the member or expanded size limit");
    const entry=compress ? new ZipDeflate(path,{level:1}) : new ZipPassThrough(path);
    zip.add(entry);
    return entry;
  }
  async function json(path:string,value:unknown,layer=false) {
    const encoded=utf8.encode(typeof value==="string" ? value : stringify(value));
    if (encoded.length>16*MiB) throw new Error("Penpot JSON member exceeds 16 MiB");
    if (layer && (pageBytes+=encoded.length)>128*MiB) throw new Error("Penpot page exceeds 128 MiB");
    const entry=member(path,encoded.length,true);
    for (let i=0;i<encoded.length;i+=65536) {
      entry.push(encoded.subarray(i,i+65536),i+65536>=encoded.length);
      await checkpoint();
    }
  }
  try {
    await json("manifest.json",manifest);
    await json(base+".json",file);
    const library=tokens.source();
    if (library!==undefined) await json(base+"/tokens.json",library);
    if (ids.pages.size>500) throw new Error("Penpot archive exceeds 500 pages");
    let index=0;
    for (const [key,pageId] of ids.pages) {
      const page=doc.nodes[key],prefix=base+"/pages/"+pageId;
      if (page.kind!=="page") continue;
      const records=ids.pageRecords(page,pageId,index++);
      await json(prefix+".json",records.page);
      pageBytes=0;
      let count=1;
      for (const visit of layerVisits(ids,page)) {
        if (++count>50000) throw new Error("Penpot page exceeds 50000 layers");
        const {node:n,id,type}=visit,shape=layerGeometry(doc,n,id,type,warn);
        await paints.fields(n,type,shape);
        layerFields(ids,visit,pageId,shape,warn);
        layout.fields(n,type,visit.children,shape);
        if (type==="text" && n.kind==="text") await writeText(n,paints,shape);
        prototypes.fields(n,shape);
        components.fields(n,pageId,shape);
        tokens.fields(n,shape);
        await json(prefix+"/"+id+".json",shape,true);
      }
      await json(prefix+"/"+rootId+".json",records.root,true);
    }
    for (const [id,record] of components.records) await json(base+"/components/"+id+".json",record);
    for (const media of paints.media.values()) {
      const {id,object,width,height,mtype,bytes,ext}=media;
      await json(base+"/media/"+id+".json",{id,name:"image",width,height,mtype,mediaId:object,isLocal:true});
      await json("objects/"+object+".json",{id:object,size:bytes.size,contentType:mtype,bucket:"file-media-object"});
      if (bytes.size>128*MiB) throw new Error("Penpot image exceeds 128 MiB");
      const entry=member("objects/"+object+"."+ext,bytes.size,false);
      for (let i=0;i<bytes.size;i+=MiB) {
        entry.push(new Uint8Array(await bytes.slice(i,i+MiB).arrayBuffer()));
        await checkpoint();
      }
      entry.push(new Uint8Array(),true);
    }
    zip.end();
    checkCurrent();
    return {format:"penpot" as const,blob:new Blob(parts,{type:"application/zip"}),warnings:[...warnings]};
  } finally {zip.terminate();}
}
