import { expect,it } from "vitest";
import { newDocument } from "../../src/engine/document";
import { getNode } from "../../src/engine/inspect";
import { readTextData } from "../../src/engine/text-data";
import cases from "../fixtures/native-text-inspection.json";

// Captured from automation::inspect::text_props at a4251ca8 with full and outline InspectOptions.
it.each(cases.map((entry,index)=>({entry,index})))("exposes native text inspection fields for fixture $index",({entry})=>{
  const base=newDocument(), node={id:"2",kind:"text" as const,name:"Text",parent:base.currentPage,x:0,y:0,width:150,height:30,
    fill:"#000000",text:readTextData(entry.text)};
  const doc={...base,nodes:{...base.nodes,"2":node}};
  const result=getNode(doc,entry.outline ? {id:2,outline:true} : {id:2,fields:Object.keys(entry.expected)});
  if (entry.outline) expect(result).toMatchObject(entry.expected);
  else expect(result).toEqual({id:2,...entry.expected});
});
