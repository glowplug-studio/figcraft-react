import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {identity} from "../../affine";
import {isFrameLike,isLeaf,pageColour,type Document,type DocumentGuide,type DocumentNode,type PageNode} from "../../document";
import {worldTransform} from "../../hierarchy";
import {isUuid,rootId} from "./archive";
import {object} from "../rest/values";
import {clipped} from "./values";
import {baseShape,rawSvg,penpotType,rgb,rounded,sourceValue,type Fields} from "./write-geometry";

const utf8=new TextEncoder();
export function derivedId(seed:string) {
  const bytes=sha256(utf8.encode(seed)).subarray(0,16);
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=bytesToHex(bytes);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}

const features=["fdata/path-data","design-tokens/v1","variants/v1","layout/grid","components/v2","fdata/shape-data-type"];
const migrations=[
  "legacy-2","legacy-3","legacy-5","legacy-6",
  "legacy-7","legacy-8","legacy-9","legacy-10",
  "legacy-11","legacy-12","legacy-13","legacy-14",
  "legacy-16","legacy-17","legacy-18","legacy-19",
  "legacy-25","legacy-26","legacy-27","legacy-28",
  "legacy-29","legacy-31","legacy-32","legacy-33",
  "legacy-34","legacy-36","legacy-37","legacy-38",
  "legacy-39","legacy-40","legacy-41","legacy-42",
  "legacy-43","legacy-44","legacy-45","legacy-46",
  "legacy-47","legacy-48","legacy-49","legacy-50",
  "legacy-51","legacy-52","legacy-53","legacy-54",
  "legacy-55","legacy-56","legacy-57","legacy-59",
  "legacy-62","legacy-65","legacy-66","legacy-67",
  "0001-remove-tokens-from-groups","0002-normalize-bool-content-v2","0002-clean-shape-interactions","0003-fix-root-shape",
  "0003-convert-path-content-v2","0005-deprecate-image-type","0006-fix-old-texts-fills","0008-fix-library-colors-v4",
  "0009-clean-library-colors","0009-add-partial-text-touched-flags","0010-fix-swap-slots-pointing-non-existent-shapes","0011-fix-invalid-text-touched-flags",
  "0012-fix-position-data","0013-fix-component-path","0013-clear-invalid-strokes-and-fills","0014-fix-tokens-lib-duplicate-ids",
  "0014-clear-components-nil-objects","0015-fix-text-attrs-blank-strings","0015-clean-shadow-color","0016-copy-fills-from-position-data-to-text-node",
  "0017-fix-layout-flex-dir","0018-remove-unneeded-objects-from-components","0019-fix-missing-swap-slots","0020-sync-component-id-with-near-main",
  "0021-fix-shape-svg-attrs","0022-normalize-component-root-and-resync","0023-repair-token-themes-with-inexistent-sets","0024b-fix-stroke-cap-placement",
  "0025-repair-empty-text-content","0026-fix-svg-raw-shapes-uuids",
];

export class PenpotExportIds {
  readonly file:string;
  readonly pages=new Map<string,string>();
  readonly layers=new Map<string,string>();
  readonly components=new Map<string,string>();
  readonly guideLayers=new Map<string,DocumentNode[]>();
  constructor(readonly doc:Document) {
    this.file=doc.pages.map(id=>doc.nodes[id]?.sourceMetadata?.["penpot.fileId"]).find(isUuid) ?? derivedId("file:"+doc.name);
    const pageIds=new Set<string>(),masters=new Set<string>();
    for (const [index,key] of doc.pages.entries()) {
      const page=doc.nodes[key];
      if (page?.kind!=="page") continue;
      const saved=page.sourceMetadata?.["penpot.pageId"];
      const pageId=isUuid(saved) && !pageIds.has(saved) ? saved : derivedId(this.file+":page:"+index+":"+key);
      this.pages.set(key,pageId);pageIds.add(pageId);
      const taken=new Set([rootId]), pending=[...page.children].reverse(),guides=[];
      while (pending.length) {
        const id=pending.pop()!,n=doc.nodes[id];
        if (!n || this.layers.has(id) || !penpotType(n)) continue;
        const saved=n.sourceMetadata?.["penpot.id"];
        let uuid=isUuid(saved) && !taken.has(saved) ? saved : undefined,salt=0;
        while (!uuid) {
          const candidate=derivedId(this.file+":"+pageId+":"+id+":"+salt++);
          if (!taken.has(candidate)) uuid=candidate;
        }
        taken.add(uuid);this.layers.set(id,uuid);
        if (n.guides?.length) guides.push(n);
        if (n.kind==="component") {
          const saved=n.sourceMetadata?.["penpot.componentMasterId"];
          const master=isUuid(saved) && !masters.has(saved) ? saved : derivedId(this.file+":component:"+id);
          masters.add(master);this.components.set(id,master);
        }
        const children=this.children(n);
        for (let i=children.length-1;i>=0;i--) pending.push(children[i]);
      }
      this.guideLayers.set(key,guides);
    }
  }
  children(n:DocumentNode) {
    if (isLeaf(n)) return [];
    const raw=rawSvg(n);
    const kids=n.children.filter(id=>{
      const child=this.doc.nodes[id];
      return child && penpotType(child) && (!raw || child.sourceMetadata?.["penpot.id"]!==undefined);
    });
    if (isFrameLike(n) && (n.layout?.mode==="horizontal" || n.layout?.mode==="vertical")) kids.reverse();
    return kids;
  }
  headers() {
    const first=this.doc.nodes[this.doc.pages[0]],raw=first && sourceValue(first,"file"),h=object(raw);
    const name=clipped(this.doc.name,256);
    const get=(k:string,fallback:unknown)=>Object.hasOwn(h,k) ? h[k] : fallback;
    const file:Fields={id:this.file,name,features:get("features",features),version:get("version",67),revn:1,vern:0,
      isShared:get("isShared",false),hasMediaTrimmed:false,options:get("options",{componentsV2:true,baseFontSize:"16px"})};
    if (raw==null || Object.hasOwn(h,"migrations")) file.migrations=raw==null ? migrations : h.migrations;
    for (const k of ["createdAt","modifiedAt"]) if (Object.hasOwn(h,k)) file[k]=h[k];
    const manifest={type:"penpot/export-files",version:1,generatedBy:"figcraft-react",refer:"penpot",files:[{id:this.file,name,features:file.features}],relations:[]};
    return {file,manifest};
  }
  pageRecords(n:PageNode,pageId:string,index:number) {
    const background=rgb(pageColour(n)),root={...baseShape(rootId,"Root Frame","frame",0,0,.01,.01,identity),
      parentId:rootId,frameId:rootId,pageId,fills:[{fillColor:background,fillOpacity:1}],strokes:[],shapes:n.children.flatMap(id=>this.layers.get(id) ?? [])};
    const page:Fields={id:pageId,name:n.name,index,background};
    const flows:Fields=Object.create(null),guides:Fields=Object.create(null);
    for (const [i,flow] of (n.flows ?? []).entries()) {
      const start=this.layers.get(flow.start);
      if (!start) continue;
      const id=derivedId(pageId+":flow:"+i+":"+flow.name);
      flows[id]={id,name:flow.name,startingFrame:start};
    }
    function guide(id:string,g:DocumentGuide,offset:number,frameId?:string) {
      guides[id]={id,axis:g.vertical?"x":"y",position:rounded(offset+g.offset),...(frameId && {frameId})};
    }
    n.guides?.forEach((g,i)=>guide(derivedId(pageId+":guide:"+i),g,0));
    for (const layer of this.guideLayers.get(n.id) ?? []) {
      const matrix=worldTransform(this.doc,layer.id),frame=this.layers.get(layer.id)!;
      layer.guides?.forEach((g,i)=>guide(derivedId(pageId+":"+frame+":guide:"+i),g,g.vertical?matrix[4]:matrix[5],frame));
    }
    if (Object.keys(flows).length) page.flows=flows;
    if (Object.keys(guides).length) page.guides=guides;
    return {page,root};
  }
}
