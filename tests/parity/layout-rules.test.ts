import {readFileSync} from "node:fs";
import {expect, it, vi} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {HierarchyDraft} from "../../src/engine/hierarchy";
import type {Document, TextNode} from "../../src/engine/document";

type Metrics = Record<string,[number,number,number]>;
type Bounds = [number,number,number,number];
interface Rule {
  name: string;
  metrics: Metrics;
  nodes: {id: number}[];
  frame: [number,number];
  children: Bounds[];
}

// Upstream crates/layout/src/behaviour_tests.rs supplies synthetic per-layer text measurements.
let metrics: Metrics;
vi.mock("../../src/engine/text-node-layout",async original => ({
  ...await original<typeof import("../../src/engine/text-node-layout")>(),
  measureLayoutText(node: TextNode,width?: number) {
    const [natural,height] = metrics[node.id];
    return {width:natural,height:width === undefined ? height : height*Math.max(1,Math.ceil(natural/Math.max(1,width)))};
  },
  textNodeLayout(node: TextNode) { return {layout:{lines:[{baseline:metrics[node.id][2]}]},dy:0}; },
}));

const rules: Rule[] = JSON.parse(readFileSync(new URL("../fixtures/native-layout-rules.json",import.meta.url),"utf8"));
it.each(rules)("$name",async rule => {
  metrics=rule.metrics;
  const nodes: Record<number,unknown> = Object.fromEntries(rule.nodes.map(n => [n.id,n]));
  nodes[1]={id:1,type:"page",name:"Page",width:0,height:0,children:[2]};
  const bytes=new TextEncoder().encode(JSON.stringify({name:rule.name,next_id:rule.nodes.length+2,pages:[1],current_page:1,nodes}));
  let document: Document=(await decodeFigcraft(bytes)).document;
  for (let pass=0;pass<2;pass++) {
    const draft=new HierarchyDraft(document), frame=draft.nodes[2];
    if (frame.kind !== "frame" || !frame.layout) throw Error("Expected a layout frame");
    draft.set({...frame,layout:{...frame.layout}});
    document=draft.finish();
    const laidOut=document.nodes[2];
    if (laidOut.kind !== "frame") throw Error("Missing layout frame");
    expect(laidOut.width).toBeCloseTo(rule.frame[0],6); expect(laidOut.height).toBeCloseTo(rule.frame[1],6);
    for (const [i,id] of laidOut.children.entries()) {
      const child=document.nodes[id];
      if (child.kind === "page") throw Error("Expected a child layer");
      for (const [axis,value] of [child.x,child.y,child.width,child.height].entries()) expect(value).toBeCloseTo(rule.children[i][axis],6);
    }
  }
});
