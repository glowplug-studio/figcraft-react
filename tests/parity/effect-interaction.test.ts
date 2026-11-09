import { expect, test } from "vitest";
import { pageToScreen } from "../../src/engine/viewport";
import { EditorEngine } from "../../src/engine/editor";
import { BlurInteraction } from "../../src/engine/blur-interaction";

function scene() {
  const engine = new EditorEngine();
  const id = String(engine.execute("shape.rectangle", {x:30,y:40,width:100,height:80,
    props:{effects:[{type:"layerBlur",blurType:"progressive"},{type:"glass"}]}}).id);
  engine.execute("select.set",{ids:[id]});
  return {engine,id};
}

test("effect scrubs preview only the canvas and commit once, stale gestures cannot replace a new one", () => {
  const {engine,id} = scene();
  const before = engine.getSnapshot().document, undo = engine.getUndoDepth();
  const effect = before.nodes[id].effects![1];
  if (effect.type !== "glass") throw new Error("wrong fixture");
  const gesture = engine.beginEffectPreview(1)!;
  let publications = 0;
  const off = engine.subscribe(()=>publications++);
  for (let depth = 21; depth < 41; depth++) gesture.preview({...effect,depth});
  expect(publications).toBe(0);
  expect(engine.getRenderDocument().nodes[id].effects![1]).toMatchObject({depth:40});
  expect(engine.getSnapshot().document).toBe(before);
  gesture.commit(); expect(publications).toBe(1); expect(engine.getUndoDepth()).toBe(undo+1);
  const replacement = engine.beginEffectPreview(1)!;
  gesture.cancel(); expect(engine.interacting).toBe(true);
  replacement.preview({...effect,depth:30});
  engine.setEditable(false); replacement.commit();
  expect(engine.getSnapshot().document.nodes[id].effects![1]).toMatchObject({depth:40});
  expect(engine.beginEffectPreview(1)).toBeUndefined(); off();
});

test("open effect settings track moving, removal and access loss", () => {
  const {engine,id} = scene();
  engine.toggleEffectSettings(1);
  engine.execute("effect.move",{id,from:1,to:0});
  expect(engine.getSnapshot().openEffects).toEqual([0]);
  engine.toggleEffectSettings(1);
  engine.execute("effect.remove",{id,index:0});
  expect(engine.getSnapshot().openEffects).toEqual([0]);
  engine.execute("effect.copy",{id,index:0});
  expect(engine.hasCopiedEffect()).toBe(true);
  engine.setEditable(false);
  expect(engine.getSnapshot().openEffects).toBeUndefined();
  expect(engine.hasCopiedEffect()).toBe(false);
});

test("blur handles require an open visible progressive effect and store unit-box endpoints", () => {
  const {engine,id} = scene();
  const blur = new BlurInteraction(engine);
  const start = pageToScreen(engine.getView(), {x:80,y:40}), end = pageToScreen(engine.getView(), {x:130,y:120});
  expect(blur.down(start)).toBe(false);
  engine.toggleEffectSettings(0);
  expect(blur.down(start)).toBe(true);
  blur.move(end);
  expect(engine.getRenderDocument().nodes[id].effects![0]).toMatchObject({start:[1,1]});
  blur.cancel();
  expect(engine.getSnapshot().document.nodes[id].effects![0]).toMatchObject({start:[.5,0]});
  expect(blur.down(start)).toBe(true);
  blur.move(end); blur.up();
  expect(engine.getSnapshot().document.nodes[id].effects![0]).toMatchObject({start:[1,1]});
  engine.execute("effect.set",{id,index:0,effect:{type:"layerBlur",blurType:"progressive",visible:false}});
  expect(blur.down(start)).toBe(false);
});
