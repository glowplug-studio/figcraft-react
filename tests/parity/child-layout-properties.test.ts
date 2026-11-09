import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { layerSizing } from "../../src/engine/auto-layout";
import type { LayerNode } from "../../src/engine/document";

function engineWithFrame() {
  const engine = new EditorEngine();
  engine.execute("node.create",{type:"frame",width:110,height:80,props:{layout:"row",padding:5}});
  engine.execute("node.create",{type:"rectangle",parent:2,width:20,height:30});
  return engine;
}

describe("native child layout editing", () => {
  it("settles conflicting hug and fill axes in the direction of the edit", () => {
    const e=engineWithFrame(), node=(id:number)=>e.getSnapshot().document.nodes[id] as LayerNode;
    e.execute("node.set",{id:3,sizingH:"fill"});
    expect(node(3).width).toBe(100);
    const before=e.getSnapshot().document;
    e.execute("node.set",{id:2,sizingH:"hug"});
    expect(layerSizing(node(3)).horizontal).toBe("fixed");
    expect(layerSizing(node(2)).horizontal).toBe("hug");
    e.execute("node.set",{id:3,layoutSizingHorizontal:"stretch"});
    expect(layerSizing(node(2)).horizontal).toBe("fixed");
    expect(layerSizing(node(3)).horizontal).toBe("fill");
    e.execute("edit.undo"); e.execute("edit.undo");
    expect(e.getSnapshot().document).toBe(before);
    e.execute("node.set",{id:2,layout:null});
    expect(layerSizing(node(3)).horizontal).toBe("fixed");
  });

  it("interprets full-space explicit dimensions on unrotated flow axes", () => {
    const e=engineWithFrame(), mode=()=>layerSizing(e.getSnapshot().document.nodes[3] as LayerNode);
    e.execute("transform.resize",{id:3,width:100,height:70});
    expect(mode()).toEqual({horizontal:"fill",vertical:"fill"});
    e.execute("transform.nudgeSize",{id:3,dw:-1});
    expect(mode()).toEqual({horizontal:"fixed",vertical:"fill"});
    e.execute("node.create",{type:"rectangle",parent:2});
    e.execute("node.set",{id:3,width:100});
    expect(mode().horizontal).toBe("fixed");
    e.execute("node.set",{id:3,rotation:90});
    e.execute("node.set",{id:3,height:70});
    expect(mode().vertical).toBe("fixed");
    expect(()=>e.execute("node.set",{id:3,sizingV:"hug"})).toThrow(/Hug/);
  });

  it("keeps the creation position of an absolute child and resets anchors, spans and contradictory limits", () => {
    const e=engineWithFrame();
    e.execute("node.create",{type:"rectangle",parent:2,x:57,y:29,props:{ignoreAutoLayout:"yes"}});
    expect(e.getSnapshot().document.nodes[4]).toMatchObject({x:57,y:29,childLayout:{absolute:true}});
    e.execute("node.set",{id:3,props:{gridColumnAnchorIndex:5000,gridRow:3.6,gridRowSpan:-2,gridColumnSpan:5000,
      gridChildVerticalAlign:"CENTER",maxWidth:30,minWidth:60}});
    expect(e.getSnapshot().document.nodes[3]).toMatchObject({childLayout:{gridColumn:999,gridRow:3,gridRowSpan:1,
      gridColumnSpan:1000,gridAlignV:"center",minWidth:60,maxWidth:60}});
    e.execute("node.set",{id:3,props:{gridColumn:"auto",gridRow:null,gridAlignV:"auto",maxWidth:21}});
    const node=e.getSnapshot().document.nodes[3] as LayerNode;
    expect(node.childLayout).toEqual({minWidth:21,maxWidth:21,gridColumnSpan:1000,gridRowSpan:1});
  });

  it("refits an unchanged paragraph line limit after its parent clamps its width", async () => {
    const e=engineWithFrame();
    await e.executeAsync("text.create",{text:"Wrap this line twice",width:65,parent:2});
    e.execute("node.set",{id:4,maxWidth:33,maxHeight:60});
    e.execute("text.maxLines",{ids:[2],lines:0});
    expect(e.getSnapshot().document.nodes[4]).toMatchObject({width:33,height:60,text:{maxLines:0}});
    e.execute("text.maxLines",{ids:[2],lines:2});
    expect((e.getSnapshot().document.nodes[4] as LayerNode).childLayout).toEqual({maxWidth:33});
    e.execute("node.set",{id:4,maxHeight:45});
    expect(e.getSnapshot().document.nodes[4]).toMatchObject({childLayout:{maxHeight:45},text:{maxLines:0}});
    e.execute("node.set",{id:4,props:{maxLines:2,maxHeight:25}});
    expect((e.getSnapshot().document.nodes[4] as LayerNode).childLayout).toEqual({maxWidth:33});
  });
});
