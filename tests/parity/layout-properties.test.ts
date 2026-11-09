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

it("applies native mixed geometry edits to each layer's own value in one step", () => {
  const engine=new EditorEngine();
  for (const [x,y,width,height] of [[10,20,40,30],[100,50,20,20]]) {
    engine.execute("node.create",{type:"rectangle",props:{x,y,width,height}});
  }
  engine.execute("select.set",{ids:[2,3]});
  const values = () => [2,3].map(id => {
    const node=engine.getSnapshot().document.nodes[id];
    if (node.kind==="page") throw Error("Missing layer");
    return [node.x,node.y,node.width,node.height];
  });
  let depth=engine.getUndoDepth();
  for (const [key,kind,operand,expected] of [
    ["x","add",10,[[20,20,40,30],[110,50,20,20]]],
    ["width","multiply",2,[[20,20,80,30],[110,50,40,20]]],
    ["width","divide",4,[[20,20,20,30],[110,50,10,20]]],
    ["height","multiply",.5,[[20,20,20,15],[110,50,10,10]]],
    ["y","add",6,[[20,26,20,15],[110,56,10,10]]],
  ] as const) {
    expect(engine.editMixedGeometry(key,{kind,value:operand})).toEqual([]);
    expect(values()).toEqual(expected); expect(engine.getUndoDepth()).toBe(++depth);
  }
  expect(engine.editMixedGeometry("y",{kind:"divide",value:0})).toEqual([]);
  expect(engine.getUndoDepth()).toBe(depth);
  engine.execute("edit.undo"); expect(values()).toEqual([[20,20,20,15],[110,50,10,10]]);
});

it("keeps successful geometry edits when another page child would overflow",() => {
  const engine = new EditorEngine();
  engine.execute("node.create",{type:"rectangle",props:{width:4,x:0}});
  engine.execute("node.create",{type:"rectangle",props:{width:1.5e308,x:0}});
  engine.execute("select.set",{ids:[2,3]});
  const before = engine.getSnapshot().document;
  expect(engine.editMixedGeometry("x",{kind:"add",value:5e307})).toHaveLength(1);
  expect(engine.getSnapshot().document.nodes[2]).toMatchObject({x:5e307});
  expect(engine.getSnapshot().document.nodes[3]).toBe(before.nodes[3]);
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
});

it("takes mixed widths before a selected parent's resize changes its pinned child",() => {
  const engine = new EditorEngine();
  engine.execute("node.create",{type:"frame",props:{width:100,height:50}});
  engine.execute("node.create",{type:"rectangle",parent:2,props:{width:20,height:10,constraints:{horizontal:"scale"}}});
  engine.execute("select.set",{ids:[2,3]});
  const before=engine.getSnapshot().document;
  expect(engine.editMixedGeometry("width",{kind:"add",value:10})).toEqual([]);
  expect(engine.getSnapshot().document.nodes[2]).toMatchObject({width:110});
  expect(engine.getSnapshot().document.nodes[3]).toMatchObject({width:30});
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
});
