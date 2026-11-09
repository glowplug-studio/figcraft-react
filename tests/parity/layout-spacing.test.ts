import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { FrameNode } from "../../src/engine/document";
import { LayoutSpacingInteraction } from "../../src/engine/layout-spacing-interaction";
import { layoutZones } from "../../src/engine/layout-zones";
import { pageToScreen } from "../../src/engine/viewport";

function scene(props: Record<string,unknown>, width = 120) {
  const engine = new EditorEngine();
  engine.execute("frame.create",{x:100,y:100,width:300,height:300,props:{layout:"horizontal",padding:0,gap:10,crossGap:10,...props}});
  for (let i=0; i<3; i++) engine.execute("shape.rectangle",{parent:2,x:0,y:0,width,height:60});
  engine.execute("select.set",{ids:[2]});
  engine.execute("view.zoom100");
  const handles = new LayoutSpacingInteraction(engine);
  const point = (x: number,y: number) => pageToScreen(engine.getView(),{x,y});
  const layout = () => (engine.getRenderDocument().nodes[2] as FrameNode).layout;
  return {engine, handles, point, layout};
}

it("takes the visible auto cross-gap as its initial value and restores spread rows on undo", () => {
  const {engine,handles,point,layout} = scene({wrap:true,contentAlign:"spaceBetween"});
  const before = engine.getSnapshot().document;
  expect(handles.down(point(250,250))).toBe(true);
  handles.move(point(250,270),false);
  expect(layout()).toMatchObject({contentAlign:"auto",crossGap:200});
  expect(engine.getSnapshot().document).toBe(before);
  handles.up(); engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
});

it("fixes the resolved main gap and subsequently edits its stored distance", () => {
  const {handles,point,layout} = scene({mainAlign:"spaceBetween"},60);
  expect(handles.down(point(190,130))).toBe(true);
  handles.move(point(180,130),false); handles.up();
  expect(layout()).toMatchObject({mainAlign:"min",gap:50});
  expect(handles.down(point(185,130))).toBe(true);
  handles.move(point(191,130),false); handles.up();
  expect(layout()).toMatchObject({mainAlign:"min",gap:56});
});

it("drags a pair of padding sides at the current zoom, keeps the other side on Shift release and cancels", () => {
  const {engine,handles,point,layout} = scene({padding:[12,18,23,14]});
  engine.execute("view.zoom50");
  const before = engine.getSnapshot().document;
  expect(handles.down(point(392,180))).toBe(true);
  handles.move(point(386,180),true);
  expect(layout()?.padding).toEqual([12,24,23,24]);
  handles.move(point(380,180),false);
  expect(layout()?.padding).toEqual([12,30,23,24]);
  handles.cancel(); expect(engine.getRenderDocument()).toBe(before);
});

it("outlines grid tracks, uses separate row and column gaps and excludes rotated frames", () => {
  const {engine,handles,point,layout} = scene({layout:"grid",gridColumns:2,gridRows:2,gap:20,crossGap:30});
  const doc=engine.getSnapshot().document;
  const zones=layoutZones(doc,doc.nodes[2] as FrameNode,engine.getView())!;
  expect(zones.tracks).toHaveLength(8);
  expect(zones.gaps.map(z=>z.key)).toEqual(["gap","crossGap"]);
  expect(handles.down(point(250,150))).toBe(true);
  handles.move(point(265,150),false); handles.up();
  expect(layout()).toMatchObject({gap:35,crossGap:30});
  expect(handles.down(point(150,250))).toBe(true);
  handles.move(point(150,150),false); handles.up();
  expect(layout()?.crossGap).toBe(0);
  engine.execute("node.set",{id:2,rotation:3});
  expect(handles.down(point(251,150))).toBe(false);
});
