import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";

describe("native frame layout property editing", () => {
  it.each(["layout","layoutMode"])("applies %s before tuning for both creation and edits", mode => {
    for (const value of ["vertical",{mode:"vertical"}]) {
      const engine = new EditorEngine();
      const props = {gap:8,padding:4,crossAlign:"center",[mode]:value};
      engine.execute("node.create",{type:"frame",props});
      engine.execute("node.create",{type:"frame"});
      engine.execute("node.set",{id:3,props});
      for (const id of [2,3]) expect(engine.getSnapshot().document.nodes[id]).toMatchObject({
        layout:{mode:"vertical",gap:8,padding:[4,4,4,4],crossAlign:"center"},
      });
    }
  });

  it("tunes only frames, reports skipped layers and rolls the entire selection back on failure", () => {
    const engine = new EditorEngine();
    engine.execute("node.create",{type:"frame"});
    engine.execute("node.create",{type:"rectangle",parent:2,name:"Child"});
    const result = engine.execute("node.set",{ids:[2,3],props:{padding:[3,7],name:"Changed",rowGap:-2}});
    expect(result).toMatchObject({warnings:["`padding`, `rowGap` skipped on 3 “Child” (RECTANGLE): only frames, components and instances have auto layout"]});
    const before = engine.getSnapshot().document;
    expect(before.nodes[2]).toMatchObject({name:"Changed",layout:{mode:"horizontal",padding:[3,7,3,7],gap:0,crossGap:-2}});
    expect(before.nodes[3]).toMatchObject({name:"Changed",x:7,y:3});
    for (const props of [{layout:"grid"},{layoutMode:null,gap:12},{columnTracks:[{sizing:"fixed"}]},{wrap:"true"}]) {
      expect(() => engine.execute("node.set",{ids:[2,3],props})).toThrow();
      expect(engine.getSnapshot().document).toBe(before);
    }
  });

  it("resolves track aliases and retains native object defaults when replacing a layout", () => {
    const engine = new EditorEngine();
    engine.execute("node.create",{type:"frame",props:{layout:"grid",gridColumnTracks:["45PX","2fr","auto",{type:"stretch",size:3}]}});
    const saved = engine.getSnapshot().document;
    expect(saved.nodes[2]).toMatchObject({layout:{gridColumns:4,columnTracks:[
      {sizing:"fixed",value:45},{sizing:"fill",value:2},{sizing:"hug",value:0},{sizing:"fill",value:3},
    ]}});
    engine.execute("node.set",{id:2,props:{gridColumns:1.5}});
    expect(engine.getSnapshot().document.nodes[2]).toMatchObject({layout:{gridColumns:1,columnTracks:[{sizing:"fixed",value:45}]}});
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toBe(saved);
    engine.execute("node.set",{id:2,props:{layout:{reverseZ:true,unknownField:1,columnTracks:[{}]}}});
    expect(engine.getSnapshot().document.nodes[2]).toMatchObject({layout:{reverseZ:true,mode:"horizontal",gap:10,padding:[10,10,10,10],columnTracks:[{sizing:"fill",value:1}]}});
    engine.execute("node.set",{id:2,props:{layout:"NONE"}});
    expect(engine.getSnapshot().document.nodes[2]).not.toHaveProperty("layout");
  });
});

it("scrubs multiple frames from one snapshot and ignores releases from an expired field gesture", () => {
  const engine = new EditorEngine();
  for (let i=0;i<2;i++) engine.execute("node.create",{type:"frame", props:{layout:"grid",gap:7}});
  const base=engine.getSnapshot().document, depth=engine.getUndoDepth();
  const first=engine.beginLayoutField("node.set");
  for (const n of [10,12,18]) first.preview({ids:[2,3],props:{gap:n}});
  expect(engine.getSnapshot().document).toBe(base);
  for (const id of [2,3]) expect(engine.getRenderDocument().nodes[id]).toMatchObject({layout:{gap:18}});
  expect(engine.getUndoDepth()).toBe(depth);
  first.commit();
  expect(engine.getUndoDepth()).toBe(depth+1);
  const second=engine.beginLayoutField("layout.setTrack");
  first.cancel(); first.preview({ids:[2,3],props:{gap:40}}); first.commit();
  expect(engine.interacting).toBe(true);
  second.preview({id:2,axis:"columns",index:0,sizing:"fixed",value:30});
  expect(engine.getRenderDocument().nodes[2]).toMatchObject({layout:{columnTracks:[{sizing:"fixed",value:30}]}});
  second.cancel(); expect(engine.getUndoDepth()).toBe(depth+1);
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(base);
});
