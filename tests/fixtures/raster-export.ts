import { EditorEngine } from "../../src/engine/editor";

export async function replay(commands: readonly (readonly unknown[])[]) {
  const engine = new EditorEngine();
  for (const [command, params] of commands.slice(0, -1)) engine.execute(String(command), params);
  const before = engine.getSnapshot(), history = engine.getUndoDepth();
  const result = await engine.executeAsync("file.export", commands.at(-1)![1]);
  if (engine.getSnapshot().document !== before.document || engine.getUndoDepth() !== history || engine.getSnapshot().dirty !== before.dirty) throw new Error("Export mutated the drawing");
  return String(result.data);
}
