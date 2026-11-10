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
