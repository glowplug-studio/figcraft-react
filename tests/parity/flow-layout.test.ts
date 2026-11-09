import {reflowChangedFrames} from "../../src/engine/layout-reflow";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {readAutoLayout, readChildLayout} from "../../src/engine/auto-layout";
import {newDocument, pageOf, type DocumentNode, type FrameNode, type LayerNode} from "../../src/engine/document";
import {HierarchyDraft} from "../../src/engine/hierarchy";
import {newTextData} from "../../src/engine/text-data";
import {prepareText} from "../../src/engine/text-node-layout";

interface Layer {
  kind: "frame" | "rectangle" | "text"; parent: number; width: number; height: number; child: unknown;
  layout?: unknown; characters?: string; autoResize?: "none" | "height" | "widthAndHeight" | "truncate";
}
const cases: {name: string; layers: Layer[]; expected: [number,number,number,number,string|null][]}[] =
  JSON.parse(readFileSync(new URL("../fixtures/native-flow-layout.json", import.meta.url), "utf8"));

// Native layout_page with the pinned engine TextMeasure and the same bundled font catalogue.
it.each(cases)("matches native $name, including nested frame and text sizes", async ({layers, expected}) => {
  const base = newDocument(), nodes: Record<string, DocumentNode> = {...base.nodes};
  nodes["1"] = {...pageOf(base), children: ["2"]};
  for (const [index, layer] of layers.entries()) {
    const id = String(index+2), parent = String(layer.parent);
    const common = {id,parent,name:"Layer",width:layer.width,height:layer.height,x:0,y:0,fill:"transparent",
      ...readChildLayout(layer.child,layer.kind === "text")};
    if (layer.kind === "text") {
      await prepareText(layer.characters);
      nodes[id] = {...common,kind:"text",text:{...newTextData(),characters:layer.characters!,autoResize:layer.autoResize!}};
    } else if (layer.kind === "frame") {
      nodes[id] = {...common,kind:"frame",clip:false,children:layers.flatMap((v,i)=>String(v.parent)===id ? [String(i+2)] : [])};
    } else nodes[id] = {...common,kind:"rectangle"};
  }
  const draft = new HierarchyDraft({...base,nodes});
  for (const [i, layer] of layers.entries()) {
    if (layer.kind === "frame") draft.set({...nodes[i+2] as FrameNode,layout:readAutoLayout(layer.layout)});
  }
  reflowChangedFrames(draft);
  const result = draft.document;
  for (const [i, values] of expected.entries()) {
    const node = result.nodes[i+2] as LayerNode;
    [node.width,node.height,node.x,node.y].forEach((v,k)=>expect(v).toBeCloseTo(Number(values[k]),7));
    expect(node.kind === "text" ? node.text.autoResize : null).toBe(values[4]);
  }
});
