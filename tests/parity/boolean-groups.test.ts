import { describe, expect, it, vi } from "vitest";
import * as pathOps from "../../src/engine/path-boolean";
import { booleanResult } from "../../src/engine/boolean-result";
import { type BooleanNode, type LayerNode, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";
import { MoveInteraction } from "../../src/engine/move-interaction";
import { hitRectangle } from "../../src/engine/selection";
import { vectorFillContains } from "../../src/engine/vector-path";

const plain = { shiftKey:false, ctrlKey:false, metaKey:false, altKey:false };
function setup() {
  const engine = new EditorEngine();
  const rect = (x:number,y:number,width:number,fill:string) => String(engine.execute("shape.rectangle",{x,y,width,height:width,props:{fill}}).id);
  const a = rect(0,0,100,"#ff0000"), b = rect(50,50,100,"#00ff00");
  const g = String(engine.execute("bool.subtract",{ids:[b,a]}).id);
  const doc = () => engine.getSnapshot().document;
  const group = () => doc().nodes[g] as BooleanNode;
  const inside = (x:number,y:number) => vectorFillContains(booleanResult(doc(),group(),0,true)!.network,{x,y});
  return { engine, rect, a, b, g, doc, group, inside };
}
describe("native live boolean groups", () => {
  it("wraps the operands in layer order, follows native paint ownership and saves the editable tree", async () => {
    const s=setup();
    expect(s.group()).toMatchObject({kind:"booleanOp",op:"subtract",name:"Subtract",children:[s.a,s.b],fill:"#ff0000",blend:"normal",width:150,height:150});
    expect(worldTransform(s.doc(),s.b)).toEqual([1,0,0,1,50,50]);
    expect([s.inside(10,10),s.inside(75,75),s.inside(125,125)]).toEqual([true,false,false]);
    s.engine.execute("bool.exclude",{id:s.b});
    const saved=(await decodeFigcraft(await encodeFigcraft(s.doc()))).document;
    expect(saved.nodes[s.g]).toMatchObject({kind:"booleanOp",op:"subtract",children:[s.a,s.b]});
    expect(saved.nodes[s.b]).toMatchObject({boolOp:"exclude",parent:s.g});
    s.engine.execute("node.set",{id:s.g,props:{name:"Custom"}});
    s.engine.execute("bool.intersect",{id:s.g});
    expect(s.group().name).toBe("Custom");
    expect([s.inside(20,20),s.inside(75,75)]).toEqual([false,true]);
    expect((s.doc().nodes[s.b] as LayerNode).boolOp).toBeUndefined();
  });
  it("changes per-operand operations, resets group overrides, releases them on ungroup and undoes atomically", () => {
    const s=setup(), c=s.rect(200,0,50,"#0000ff");
    s.engine.execute("node.reparent",{id:c,parent:s.g}); const old=s.doc();
    expect(s.engine.execute("bool.union",{ids:[c]})).toEqual({ids:[c],operation:"union"});
    expect(s.inside(210,10)).toBe(true);
    s.engine.execute("edit.undo"); expect(s.doc()).toBe(old);
    s.engine.execute("edit.redo"); s.engine.execute("bool.subtract",{id:c});
    expect((s.doc().nodes[c] as LayerNode).boolOp).toBeUndefined();
    s.engine.execute("node.set",{id:s.b,props:{booleanOperation:"intersect"}});
    expect([s.inside(10,10),s.inside(75,75)]).toEqual([false,true]);
    s.engine.execute("node.set",{id:s.b,props:{operandOperation:null}});
    expect(s.inside(75,75)).toBe(false);
    s.engine.execute("bool.union",{id:s.g}); expect(s.group().name).toBe("Union");
    s.engine.execute("node.set",{id:s.b,props:{operandOperation:"subtract"}});
    s.engine.execute("object.ungroup",{id:s.g});
    expect((s.doc().nodes[s.b] as LayerNode).boolOp).toBeUndefined();
    expect(()=>s.engine.execute("node.set",{id:s.b,props:{booleanOperation:"union"}})).toThrow();
  });
  it("passes clicks through cuts and reaches operands with deep selection and double-click", () => {
    const s=setup(), move=new MoveInteraction(s.engine,e=>{throw Error(e);});
    s.engine.execute("select.none"); expect(hitRectangle(s.doc(),{x:75,y:75})).toBeUndefined();
    expect(hitRectangle(s.doc(),{x:20,y:20})).toBe(s.g);
    const click=(x:number,y:number,ctrlKey=false)=>{move.down({x,y},{...plain,ctrlKey});move.up({x,y},{...plain,ctrlKey});};
    click(20,20); expect(s.engine.getSnapshot().selection).toEqual([s.g]);
    click(20,20,true); expect(s.engine.getSnapshot().selection).toEqual([s.a]);
    click(125,125); expect(s.engine.getSnapshot().selection).toEqual([s.b]);
    s.engine.execute("select.set",{ids:[s.g]});move.doubleClick({x:125,y:125});
    expect(s.engine.getSnapshot().selection).toEqual([s.b]);move.doubleClick({x:125,y:125});
    expect(s.engine.getVectorEdit()?.id).toBe(s.b);expect(s.doc().nodes[s.b].parent).toBe(s.g);
  });
  it("flattens the computed silhouette, preserving its hole and top-level position", () => {
    const s=setup(), before=s.doc();
    const id=String(s.engine.execute("bool.flatten",{id:s.g}).id), flat=s.doc().nodes[id] as VectorNode;
    expect(s.doc().nodes[s.a]).toBeUndefined();expect(flat.kind).toBe("vector");
    expect(vectorFillContains(flat.network,{x:10,y:10})).toBe(true);
    expect(vectorFillContains(flat.network,{x:75,y:75})).toBe(false);
    expect(flat.fill).toBe("#ff0000");s.engine.execute("edit.undo");expect(s.doc()).toBe(before);
  });
  it("uses painted strokes, transformed nested groups and only visible children as operands", () => {
    const s=setup(), e=s.engine;
    const child=String(e.execute("shape.line",{x:200,y:20,width:100,props:{stroke:"black",strokeWeight:10}}).id);
    const nested=String(e.execute("object.group",{id:child}).id);
    const groupId=String(e.execute("bool.union",{ids:[s.g,nested]}).id);
    const result=()=>booleanResult(s.doc(),s.doc().nodes[groupId] as BooleanNode,0,true)!.network;
    expect(vectorFillContains(result(),{x:230,y:22})).toBe(true);
    expect(vectorFillContains(result(),{x:230,y:30})).toBe(false);
    expect(vectorFillContains(result(),{x:75,y:75})).toBe(false);
    e.execute("node.set",{id:nested,props:{visible:false}});
    expect(vectorFillContains(result(),{x:230,y:22})).toBe(false);
  });
  it("inspects group and operand operations with native filtered fields and child depth", () => {
    const s = setup();
    s.engine.execute("node.set", { id: s.b, props: { operandOperation: "intersect" } });
    const fields = ["booleanOperation", "operandOperation", "type", "x", "y"];
    const depth = s.engine.getUndoDepth();
    expect(s.engine.execute("node.get", { id: s.g, fields })).toEqual({
      id: Number(s.g), type: "BOOLEAN_OPERATION", booleanOperation: "subtract", x: 0, y: 0,
      children: [
        { id: Number(s.a), type: "RECTANGLE", x: 0, y: 0 },
        { id: Number(s.b), type: "RECTANGLE", operandOperation: "intersect", x: 50, y: 50 },
      ],
    });
    expect(s.engine.execute("node.get", { id: s.doc().currentPage, outline: true })).toMatchObject({
      type: "PAGE", visible: true, children: [{ name: "Subtract", childCount: 2 }],
    });
    expect(s.engine.execute("node.get", { id: s.b })).toMatchObject({
      absoluteBounds: { x: 50, y: 50, width: 100, height: 100 }, fills: [{ type: "solid", color: "#00FF00" }],
    });
    expect(s.engine.execute("node.get", { id: 123456 })).toBeNull();
    expect(() => s.engine.execute("node.get", { id: s.b, fields, outline: true })).toThrow("combined");
    expect(() => s.engine.execute("node.get", { id: s.b, fields: ["unknown"] })).toThrow("Unknown field");
    expect(s.engine.getUndoDepth()).toBe(depth);
    s.engine.execute("node.set", { id: s.b, props: { operandOperation: null } });
    expect(s.engine.execute("node.get", { id: s.b })).not.toHaveProperty("operandOperation");
  });

  it("reuses every unchanged fold below an edited operand", () => {
    const e = new EditorEngine();
    const ids = Array.from({ length: 8 }, (_, i) => String(e.execute("shape.rectangle", {
      x: 21 + i * 17, y: 0, width: 22, height: 17,
    }).id));
    const id = String(e.execute("bool.union", { ids }).id);
    const render = () => {
      const d = e.getSnapshot().document;
      return booleanResult(d, d.nodes[id] as BooleanNode, 0, true);
    };
    const step = vi.spyOn(pathOps, "booleanStep");
    try {
      expect(render()).toBeDefined();
      expect(step).toHaveBeenCalledTimes(7);
      step.mockClear();
      expect(render()).toBe(render());
      expect(step).not.toHaveBeenCalled();
      e.execute("node.set", { id: ids[7], props: { width: 27 } });
      render();
      expect(step).toHaveBeenCalledTimes(1);
      step.mockClear();
      e.execute("node.set", { id: ids[0], props: { width: 24 } });
      render();
      expect(step).toHaveBeenCalledTimes(7);
    } finally { step.mockRestore(); }
  });

  it("remembers a refused dense crossing group after unrelated edits and atomically rejects flatten", () => {
    const e = new EditorEngine();
    const bars = (across: boolean) => Array.from({ length: 750 }, (_, i) => {
      const offset = 4 * i;
      return across ? `M0 ${offset}h3000v2h-3000z` : `M${offset} 0h2v3000h-2z`;
    }).join(" ");
    const ids = [true, false].map(across => String(e.execute("vector.create", { path: bars(across) }).id));
    const id = String(e.execute("bool.union", { ids }).id);
    const result = () => {
      const d = e.getSnapshot().document;
      return booleanResult(d, d.nodes[id] as BooleanNode);
    };
    const step = vi.spyOn(pathOps, "booleanStep");
    try {
      expect(result()).toBeUndefined();
      expect(step).toHaveBeenCalledTimes(1);
      e.execute("shape.rectangle", { width: 10, height: 10 });
      expect(result()).toBeUndefined();
      const before = e.getSnapshot();
      expect(() => e.execute("bool.flatten", { id })).toThrow("too complex");
      expect(e.getSnapshot()).toBe(before);
      expect(step).toHaveBeenCalledTimes(1);
      e.execute("node.set", { id: ids[1], props: { visible: false } });
      expect(result()).toBeDefined();
    } finally { step.mockRestore(); }
  });
});
