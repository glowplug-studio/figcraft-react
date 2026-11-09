import {CanvasController, EditorEngine} from "@glowplug-studio/figcraft-react";

export const engine=new EditorEngine();
export async function start() {
  const canvas=document.querySelector("canvas")!;
  new CanvasController(canvas,engine,message=>{throw new Error(message);});
  const {id}=await engine.executeAsync("text.create",{text:"A🙂BC",x:20,y:30});
  engine.execute("text.edit.begin",{id});
  return id;
}
