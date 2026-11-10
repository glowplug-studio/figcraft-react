import { newDocument, type DocumentNode, type FrameNode, type PageNode } from "../../src/engine/document";
import { readPaint } from "../../src/engine/solid-paint";
import { readEffect } from "../../src/engine/effects";

// From upstream svg::pattern_depth_tests. The referenced subtree is outside the exported root.
export function deepPatternDocument(outer:number,inner:number,shadow=false) {
  const doc=newDocument();
  const page=doc.nodes[doc.currentPage] as PageNode;
  const nodes:Record<string,DocumentNode>={...doc.nodes,[page.id]:{...page,children:["2","1000"]}};
  function frames(base:number,count:number) {
    for (let i=0;i<count;i++) {
      const id=String(base+i);
      const n:FrameNode={id,name:"F",kind:"frame",parent:i ? String(base+i-1) : page.id,
        x:0,y:0,width:8,height:8,clip:false,children:i<count-1 ? [String(base+i+1)] : [],fill:"#000000",fills:[]};
      nodes[id]=n;
    }
  }
  frames(2,outer); frames(1000,inner);
  const source=nodes["1000"] as FrameNode;
  if (shadow) nodes[source.id]={...source,effects:[readEffect({type:"dropShadow"},"command")]};
  const art=nodes[String(1000+inner-1)] as FrameNode;
  nodes[art.id]={...art,fill:"#FF0000",fills:[readPaint("#ff0000",true)]};
  const last=nodes[String(2+outer-1)] as FrameNode;
  nodes[last.id]={...last,fills:[readPaint({type:"pattern",source:1000})]};
  return {...doc,nodes};
}
