import { EditorEngine } from "../../src/engine/editor";

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
