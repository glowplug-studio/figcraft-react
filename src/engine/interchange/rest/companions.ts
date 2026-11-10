import { imageHash, imageResource, MAX_IMAGE_BYTES, readImageResource, validImageKey, type ImageResource } from "../../image-resource";
import { hasRestVariables } from "../../variable-rest";
import { children, list, object, string, type JsonObject } from "./values";

export type FileLookup=(name:string)=>Promise<File|undefined>;
export interface RestFolder {readonly file:FileLookup; readonly image:FileLookup}
export async function siblingVariables(folder:RestFolder,filename:string) {
  if (!/\.json$/i.test(filename)) return;
  for (const path of [filename.replace(/\.json$/i,".variables.json"),"variables.json"]) {
    if (path===filename) continue;
    const file=await folder.file(path);
    if (!file || file.size>MAX_IMAGE_BYTES) continue;
    try {const json:unknown=JSON.parse(await file.text());if (hasRestVariables(json)) return json;} catch { /* Try the next sibling. */ }
  }
}
export class SiblingImages {
  readonly found=new Map<string,{key:string;resource:ImageResource}>();
  readonly #seen=new Set<string>();
  readonly #byDigest=new Map<string,ImageResource>();
  constructor(readonly lookup:FileLookup) {}
  async prepare(node:JsonObject,checkCurrent:()=>void) {
    const paints=[...list(node.fills),...list(node.strokes)];
    if (node.type==="TEXT" || node.style) {
      paints.push(...list(object(node.style).fills));
      const table=object(node.styleOverrideTable);
      const used=new Set(children(node.characterStyleOverrides).slice(0,2*1048576));
      for (const id of used) if (typeof id==="number" && id>0 && Object.hasOwn(table,String(id))) {
        for (const p of list(object(table[String(id)]).fills)) paints.push(p);
      }
    }
    for (const value of paints) {
      const p=object(value), ref=string(p.imageRef);
      if (p.type!=="IMAGE" || !ref || !validImageKey(ref) || this.#seen.has(ref)) continue;
      this.#seen.add(ref);
      for (const suffix of ["",".png",".jpg",".jpeg",".gif",".webp"]) {
        const file=await this.lookup(ref+suffix);
        checkCurrent();
        if (!file || file.size>MAX_IMAGE_BYTES) continue;
        const bytes=new Uint8Array(await file.arrayBuffer());
        const resource=imageResource(bytes,file);
        if (resource.width && resource.height) {
          const key=await imageHash(bytes);
          const shared=this.#byDigest.get(key) ?? Object.freeze({...await readImageResource(bytes,resource),digest:key});
          this.#byDigest.set(key,shared);
          this.found.set(ref,{key,resource:shared});
        }
        checkCurrent();
        break;
      }
    }
  }
}
