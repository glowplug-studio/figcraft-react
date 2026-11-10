import { newDocument, withLayerTransform, type DocumentNode } from "../../document";
import { readNode,wireNode } from "../../file-format";
import type { ImageResource } from "../../image-resource";
import { entries, object, string, type JsonObject } from "../rest/values";
import { PenpotArchive } from "./archive";
import { keepSource, sourceJson } from "./values";

const utf8=new TextEncoder(), validName=/^[A-Za-z_:][A-Za-z0-9_.:-]{0,99}$/;
const maxMarkup=128*1024;
function escape(text:string,attribute:boolean) {
  return text.replace(/[&<>"'\p{Cc}]/gu,c=>{
    if (c==="&") return "&amp;";
    if (c==="<") return "&lt;";
    if (c===">") return "&gt;";
    if (c==='"') return attribute ? "&quot;" : c;
    if (c==="'") return attribute ? "&apos;" : c;
    return "\t\r\n".includes(c) ? c : "";
  });
}
function markup(shape:JsonObject,width:number,height:number,archive:PenpotArchive) {
  const wrap=(s:string)=>'<svg xmlns="http://www.w3.org/2000/svg" width="'+Math.max(width,1)+'" height="'+Math.max(height,1)+'">'+s+'</svg>';
  const raw=string(object(shape.svgAttrs ?? shape["svg-attrs"]).raw) ?? string(shape.content);
  if (raw!==undefined) {
    const xml=raw.trim();
    if (xml.length>maxMarkup || utf8.encode(xml).length>maxMarkup || !xml.startsWith("<")) return;
    return xml.startsWith("<svg") || xml.startsWith("<?xml") ? xml : wrap(xml);
  }
  const chunks:string[]=[];
  let size=0;
  function write(s:string) {
    if (s.length>maxMarkup-size) return false;
    size+=utf8.encode(s).length;
    if (size>maxMarkup) return false;
    chunks.push(s);return true;
  }
  function tree(item:unknown,depth:number):boolean {
    if (depth>64) return false;
    if (item===null) return true;
    if (typeof item==="string") return item.length<=maxMarkup && write(escape(item,false));
    if (Array.isArray(item)) return item.length<=8192 && item.every(v=>tree(v,depth+1));
    const n=object(item),tag=string(n.tag);
    if (!tag || !validName.test(tag) || !write("<"+tag)) return false;
    const attrs=object(n.attrs),fields=entries(attrs);
    if (fields.length>256) return false;
    for (const [k,v] of fields) {
      if (!validName.test(k) || k.toLowerCase().startsWith("on")) continue;
      const s=typeof v==="string" ? v : typeof v==="number" || typeof v==="boolean" ? sourceJson(v,archive.numbers,attrs,k) : undefined;
      if (s!==undefined && (s.length>maxMarkup || !write(" "+k+'="'+escape(s,true)+'"'))) return false;
    }
    return write(">") && (!Object.hasOwn(n,"content") || tree(n.content,depth+1)) && write("</"+tag+">");
  }
  if (!tree(shape.content,0)) return;
  const xml=chunks.join("");
  if (!/^<svg[ >]/.test(xml)) return wrap(xml);
  return xml.slice(0,xml.indexOf(">")).includes("xmlns=") ? xml : xml.replace("<svg",'<svg xmlns="http://www.w3.org/2000/svg"');
}
type Warn=(message:string)=>void;
export class RawSvgLayers {
  private retained=0;
  constructor(private archive:PenpotArchive) {}
  keep(layer:JsonObject,name:string,w:number,h:number,meta:Record<string,string>,warn:Warn) {
    for (const k of ["content","svgAttrs","svg-attrs"]) keepSource(meta,"penpot.source."+k,layer[k],this.archive.numbers,16384,layer,k);
    const xml=markup(layer,w,h,this.archive);
    if (!xml) {warn("SVG layer '"+name+"' has no safely readable SVG markup; kept as frame");return;}
    const bytes=utf8.encode(xml).length;
    if (bytes>8*1024*1024-this.retained) {warn("SVG layer '"+name+"' exceeds the 8 MiB raw SVG import budget; kept as frame");return;}
    this.retained+=bytes;meta["penpot.svgRawXml"]=xml;meta["penpot.svgRawStatus"]="pending";
  }
  async expand(nodes:Record<string,DocumentNode>,next:number,resources:Record<string,ImageResource>,warn:Warn) {
    let expanded=0;
    for (const n of Object.values(nodes)) {
      const meta=n.sourceMetadata,xml=meta?.["penpot.svgRawXml"];
      if (meta?.["penpot.svgRawStatus"]!=="pending" || !xml || n.kind!=="frame") continue;
      if (n.children.length) {warn("Penpot SVG '"+n.name+"': has separate child layers; the original tree was preserved to prevent duplicate rendering");continue;}
      let status="not-expanded";
      try {
        const {importSvg}=await import("../../svg-import/document");
        const imported=await importSvg(newDocument(n.name),BigInt(next),utf8.encode(xml),n.name,0,0,false,()=>this.archive.check());
        this.archive.check();next=Number(imported.nextId);
        const frame=imported.document.nodes[imported.id];
        if (frame.kind!=="frame" || !frame.children.length) warn("Penpot SVG '"+n.name+"' has no supported drawable elements; the original markup is preserved");
        else {
          const scale=(a:number,b:number)=>Math.min(1e4,Math.max(.0001,a/b));
          const additions:Record<string,DocumentNode>=Object.create(null);
          for (const item of Object.values(imported.document.nodes)) {
            if (item.kind==="page") continue;
            const local=item.id===frame.id ? withLayerTransform({...item,parent:n.id},[scale(n.width,frame.width),0,0,scale(n.height,frame.height),0,0]) : item;
            // SVG text's auto-resize already carries its native sizing. The host's
            // interactive text-sizing axes aren't stored by the Penpot file loader.
            const layer=local.kind==="text" ? {...local,textSizing:undefined} : local;
            additions[item.id]=readNode(item.id,wireNode(item.id,layer));
          }
          Object.assign(nodes,additions);
          Object.assign(resources,imported.document.images);
          for (const issue of imported.warnings) warn("Penpot SVG '"+n.name+"': "+issue);
          expanded++;status="expanded";
          nodes[n.id]={...n,children:[frame.id]};
        }
      } catch (e) {
        this.archive.check();
        warn("Penpot SVG '"+n.name+"' could not be imported: "+(e instanceof Error ? e.message : String(e))+"; its original markup is preserved");
      }
      nodes[n.id]={...nodes[n.id],sourceMetadata:{...meta,"penpot.svgRawStatus":status}};
    }
    if (expanded) warn("Penpot: "+expanded+" raw SVG layer(s) converted to editable SVG content");
    return next;
  }
}
