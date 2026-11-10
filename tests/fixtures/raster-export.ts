import { EditorEngine } from "../../src/engine/editor";

export async function replay(commands: readonly (readonly unknown[])[]) {
  const engine = new EditorEngine();
  for (const [command, params] of commands.slice(0, -1)) engine.execute(String(command), params);
  const before = engine.getSnapshot(), history = engine.getUndoDepth();
  const result = await engine.executeAsync("file.export", commands.at(-1)![1]);
  if (engine.getSnapshot().document !== before.document || engine.getUndoDepth() !== history || engine.getSnapshot().dirty !== before.dirty) throw new Error("Export mutated the drawing");
  return String(result.data);
}

export async function replayBatch(commands: readonly (readonly unknown[])[]) {
  const engine = new EditorEngine();
  for (const [command, params] of commands.slice(0,-1)) engine.execute(String(command),params);
  const before = engine.getSnapshot();
  const result = await engine.executeAsync("file.exportLayers", commands.at(-1)![1]);
  if (engine.getSnapshot().document !== before.document || before.dirty !== engine.getSnapshot().dirty) throw new Error("Batch export mutated the drawing");
  return result;
}

export async function replaySvg(commands: readonly (readonly unknown[])[]) {
  const engine = new EditorEngine();
  for (const [command,params] of commands.slice(0,-1)) {
    if (command === "text.create") await engine.executeAsync(command,params);
    else engine.execute(String(command),params);
  }
  const file = await engine.exportGraphic({...commands.at(-1)![1] as Record<string,unknown>,format:"svg"});
  return file.blob.text();
}

export async function exportDeepPattern(outer:number,inner:number) {
  const {deepPatternDocument}=await import("./svg-depth");
  const {renderSvgExport}=await import("../../src/engine/export-svg");
  return (await renderSvgExport(deepPatternDocument(outer,inner,true),["2"],{})).text();
}

export async function importSvgFixture(name:string,svg:string,profile="srgb") {
  const engine=new EditorEngine();
  if (profile!=="srgb") engine.execute("file.colorProfile",{profile});
  const bytes=new TextEncoder().encode(svg);
  const data=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(""));
  const result=await engine.executeAsync("file.import",{name:name+".svg",data,x:0,y:0});
  const {prepareArchive}=await import("../../src/engine/file-format");
  const wire=await prepareArchive(engine.getSnapshot().document);
  return {result,document:JSON.parse(await wire.json.text()),png:await importPixels(engine,result!.id)};

}

export { svgImportLimits,svgImportRace,largeSvgImport } from "./svg-import-limits";


async function importPixels(engine:EditorEngine,id:unknown) {
  const file=await engine.exportRaster({id});
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error);
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file.blob);
  });
}

export async function svgImportRoundTrips(svg:string) {
  const images:string[]=[];
  let file=new File([svg],"Round trip.svg");
  for(let i=0;i<3;i++) {
    const engine=new EditorEngine();
    await engine.openFile(file);
    const doc=engine.getSnapshot().document,page=doc.nodes[doc.currentPage];
    if (page.kind!=="page") throw new Error("Missing page");
    const id=page.children[0];
    images.push(await importPixels(engine,id));
    if (i<2) {
      const {blob}=await engine.exportGraphic({format:"svg",id});
      file=new File([blob],"Round trip.svg");
    }
  }
  return images;
}
