import { EditorEngine } from "../../src/engine/editor";
import { attributeDocument, type AttributeRecipe } from "./svg-attribute-documents";

const wrap=(body:string)=>'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'+body+'</svg>';
const rect='<rect width="10" height="10"/>';
const base64=(text:string)=>btoa(text);

export async function svgImportLimits() {
  const engine=new EditorEngine();
  const open=(text:string,name="Limits.svg")=>engine.openFile(new File([text],name));
  const nested=(n:number)=>"<g>".repeat(n)+rect+"</g>".repeat(n);
  const failure=async(fn:()=>Promise<unknown>)=>{
    const before=engine.getSnapshot(),history=engine.getUndoDepth();
    try {await fn();} catch (e) {
      if (engine.getSnapshot().document!==before.document || history!==engine.getUndoDepth()) throw new Error("Failed import mutated the document");
      return (e as Error).message;
    }
    throw new Error("Expected the import to be refused");
  };
  const deep=await failure(()=>open(wrap(nested(513))));
  const external=await failure(()=>open('<!DOCTYPE svg [<!ENTITY external SYSTEM "https://refused.invalid/entity">]>'+wrap("&external;")));
  const warnings=await open(wrap(nested(160)));
  const links=await open(wrap('<style>@import url(https://refused.invalid/style.css);</style><image href="https://refused.invalid/pixel.png" width="10" height="10"/>'+
    '<use href="https://refused.invalid/art.svg#shape"/><script>globalThis.figcraftSvgExecuted=true</script><foreignObject><div>ignored</div></foreignObject>'+rect));
  let embedded=wrap(rect);
  const embeddedNode=(src:string)=>'<image width="100" height="100" href="data:image/svg+xml;base64,'+base64(src)+'"/>';
  for(let i=0;i<4;i++) embedded=wrap(embeddedNode(embedded));
  const allowed=await open(embedded),denied=await open(wrap(embeddedNode(embedded)));
  const zipped=await new Response(new Blob([wrap(rect)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const compressed=await engine.openFile(new File([zipped],"Compressed.svgz"));
  return {deep,external,depthNotes:warnings.warnings,linkedLayers:links.summary.layers,allowedLayers:allowed.summary.layers,
    deniedLayers:denied.summary.layers,compressedLayers:compressed.summary.layers};
}

export async function svgImportRace() {
  let resume!:()=>void,reading!:()=>void;
  const delayed=new Promise<void>(r=>{resume=r;});
  const started=new Promise<void>(r=>{reading=r;});
  class DeferredSvg extends File {
    override async arrayBuffer() {reading();await delayed;return super.arrayBuffer();}
  }
  const engine=new EditorEngine(),old=engine.openFile(new DeferredSvg([wrap(rect)],"Old.svg"));
  await started;
  const newer=await engine.openFile(new File([wrap(rect)],"New.svg"));
  const before=engine.getSnapshot();
  resume();
  let reason="";
  try {await old;} catch(e) {reason=(e as Error).message;}
  return {reason,name:newer.summary.name,unchanged:before.document===engine.getSnapshot().document};
}

export async function largeSvgImport() {
  const source=wrap(Array.from({length:5000},(_,i)=>'<rect x="'+(i%100)+'" y="'+Math.floor(i/100)+'" width="1" height="1"/>').join(""));
  const engine=new EditorEngine(),file=new File([source],"Five thousand.svg");
  let ticks=0;
  const ticker=setInterval(()=>ticks++,8),start=performance.now();
  try {
    const result=await engine.openFile(file);
    return {layers:result.summary.layers,ticks,time:Math.round(performance.now()-start)};
  } finally {clearInterval(ticker);}
}

/** Each native attribute-limit case imported as native imported it, with file.import: its result or refusal, and
 * whether a refusal left the document and the undo history untouched. */
export async function svgAttributeImports(cases: readonly {name: string; recipe: AttributeRecipe}[]) {
  const out: {name: string; imported?: boolean; error?: string; unchanged?: boolean}[] = [];
  for (const c of cases) {
    const engine = new EditorEngine(), before = engine.getSnapshot(), history = engine.getUndoDepth();
    const bytes = new TextEncoder().encode(attributeDocument(c.recipe));
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try {
      await engine.executeAsync("file.import", {data: btoa(text), name: "a.svg"});
      out.push({name: c.name, imported: true});
    } catch (e) {
      out.push({name: c.name, error: (e as Error).message, unchanged: engine.getSnapshot().document === before.document && engine.getUndoDepth() === history});
    }
  }
  return out;
}

/** Each native filter-stack case imported with file.import: the receipt's warnings and the rectangle's effects as
 * node.get returns them. */
export async function svgFilterImports(cases: readonly {name: string; svg: string; rectangle: number}[]) {
  const out: {name: string; warnings: unknown; effects: unknown}[] = [];
  for (const c of cases) {
    const engine = new EditorEngine();
    const result = await engine.executeAsync("file.import", {data: btoa(c.svg), name: "f.svg"}) as {warnings?: unknown};
    const rect = engine.execute("node.get", {id: c.rectangle}) as {effects?: unknown[]} | null;
    out.push({name: c.name, warnings: result.warnings ?? [], effects: rect?.effects ?? []});
  }
  return out;
}
