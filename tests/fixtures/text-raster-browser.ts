import {EditorEngine,renderDocument} from "@glowplug-studio/figcraft-react";

export async function rasterTextScene(commands:readonly (readonly unknown[])[]) {
  const engine=new EditorEngine(), canvas=document.createElement("canvas");
  canvas.width=240;canvas.height=144;
  const ctx=canvas.getContext("2d")!;
  for (const [name,params] of commands) await engine.executeAsync(String(name),params);
  await renderDocument(ctx,engine.getSnapshot().document,canvas.width,canvas.height);
  return ctx.getImageData(0,0,canvas.width,canvas.height).data;
}
