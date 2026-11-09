import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { guideRects } from "../../src/engine/layout-guides";
import { readGrids } from "../../src/engine/shared-styles";
import { SnapTargets } from "../../src/engine/snapping";

it("lays out square grids, fixed auto-count columns and stretched rows within native iteration limits", () => {
  const [square,columns,rows] = readGrids([{}, {kind:"columns",align:"max",count:0,size:20,gutter:10,offset:5},
    {kind:"rows",count:2,offset:5,gutter:10}]);
  expect([...guideRects(square,10,10)]).toEqual([[0,0,0,10],[10,0,10,10],[0,0,10,0],[0,10,10,10]]);
  expect([...guideRects(columns,100,80)]).toEqual([[15,0,35,80],[45,0,65,80],[75,0,95,80]]);
  expect([...guideRects(rows,100,80)]).toEqual([[0,5,100,35],[0,45,100,75]]);
  expect([...guideRects({...columns,count:901},5,5)]).toHaveLength(500);
  expect([...guideRects({...square,size:1},5000,5000)]).toHaveLength(8000);
});

it("adds, reorders and removes guides atomically and snaps children to visible parent bands", () => {
  const e=new EditorEngine();
  e.execute("node.create",{type:"frame",x:20,y:10,width:120,height:80});
  e.execute("node.create",{type:"rectangle",parent:2,width:10,height:10});
  const doc=()=>e.getSnapshot().document;
  const guides=()=>doc().nodes[2].grids;
  const xs=()=>new SnapTargets(doc(),["3"]).xs.map(span=>span[0]);
  e.execute("grid.add",{id:2,grid:{kind:"columns",align:"min",count:2,size:17,gutter:8,offset:7.5}});
  expect(xs()).toEqual(expect.arrayContaining([27.5,44.5,52.5,69.5]));
  e.execute("view.layoutGrids");
  expect(xs()).toContain(27.5);
  const one=doc();
  e.execute("grid.add",{id:2,grid:null});
  e.execute("grid.move",{id:2,from:0,to:1});
  expect(guides()?.map(g=>g.kind)).toEqual(["grid","columns"]);
  const both=doc();
  e.execute("grid.remove",{id:2,index:19});
  expect(doc()).toBe(both);
  e.execute("grid.remove",{id:2,index:1});
  expect(xs()).not.toContain(27.5);
  e.execute("edit.undo"); expect(doc()).toBe(both);
  e.execute("edit.undo"); e.execute("edit.undo"); expect(doc()).toBe(one);
  e.execute("node.set",{id:2,props:{grids:[{...guides()![0],visible:false}]}});
  expect(xs()).not.toContain(27.5);
  e.execute("edit.undo");
  e.execute("node.set",{id:2,rotation:30});
  expect(xs()).toHaveLength(3);
});
