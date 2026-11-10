import type { DocumentNode } from "../../document";
import type { SharedStyle } from "../../shared-styles";
import { compareScalarKeys } from "../../text-breaks";
import { prepareImportFonts } from "../../text-node-layout";
import { object, string } from "../rest/values";
import { PenpotArchive, isUuid } from "./archive";
import { fontRefs, penpotStyle } from "./text";
import { clipped } from "./values";

export async function typography(archive: PenpotArchive, base: string, styles: SharedStyle[], warn: (message:string)=>void) {
  const prefix=base+"/typographies/";
  const paths=Array.from(archive.names()).filter(p=>p.startsWith(prefix) && p.endsWith(".json") && isUuid(p.slice(prefix.length,-5)));
  const refs=new Map<string,ReturnType<typeof fontRefs>[number]>();
  if (paths.length>2048) warn("Penpot typography library exceeds 2048 entries; truncated");
  for (const path of paths.slice(0,2048)) {
    if (styles.length>=8192) {warn("Imported Penpot styles capped at 8192 entries");break;}
    let v;
    try {v=object(await archive.json(path));} catch {archive.check();warn("A Penpot typography definition could not be decoded");continue;}
    if (!isUuid(v.id) || typeof v.name!=="string" || !v.name) continue;
    for (const ref of fontRefs(v,"custom-")) if (refs.size<128) refs.set(JSON.stringify(ref),ref);
    const dir = string(v.path);
    styles.push({type:"text", id:"penpot:text:"+base+":"+v.id, name:clipped((dir ? dir+"/" : "")+v.name,256), style:penpotStyle(v),
      description:"Imported from Penpot typography library"});
  }
  return [...refs.values()];
}

export async function missingFonts(nodes: Readonly<Record<string,DocumentNode>>) {
  const texts=Object.values(nodes).filter(n=>n.kind==="text" && n.text.characters);
  if (!texts.length) return;
  const library=await prepareImportFonts(), families=library.families();
  if (!families.length) return;
  const available=new Set(families.map(n=>n.trim().toLowerCase()));
  const missing=new Map<string,Set<string>>(), clean=(s:string,max:number)=>clipped(s.replace(/\p{Cc}/gu,""),max);
  for (const node of texts) {
    if (node.kind!=="text") continue;
    const used=new Set<string>(), length=Math.min(100000,Array.from(node.text.characters).length);
    let covered=0, uncovered=false;
    for (const run of node.text.runs) {
      const start=Math.min(length,run.start), end=Math.min(length,run.end);
      if (start>=end) continue;
      used.add(run.style.fontFamily);
      if (start>covered) uncovered=true;
      covered=Math.max(covered,end);
    }
    if (uncovered || covered<length) used.add(node.text.style.fontFamily);
    for (const name of used) {
      const lower=name.trim().toLowerCase();
      if (!lower || available.has(lower) || ["sans-serif","serif","monospace","system-ui"].includes(lower)) continue;
      const family=clean(name.trim(),160), examples=missing.get(family) ?? new Set<string>();
      examples.add(clean(node.name,80)); missing.set(family,examples);
    }
  }
  if (!missing.size) return;
  const names=[...missing.keys()].sort(compareScalarKeys).slice(0,8).map(name=>"'"+name+"' (e.g. '"+[...missing.get(name)!].sort(compareScalarKeys)[0]+"')").join(", ");
  const extra=missing.size>8 ? " and "+(missing.size-8)+" more" : "";
  return "Penpot: "+missing.size+" font family/families are not installed or embedded: "+names+extra+". FigCraft uses fallback fonts for display, but preserves the original family names; install the licensed fonts and reopen the file to restore text metrics.";
}
