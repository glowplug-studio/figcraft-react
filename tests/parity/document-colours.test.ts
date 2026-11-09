import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {pageColours} from "../../src/engine/document-colours";

it("counts visible solid fills and strokes by RGBA under each page, then sorts by frequency and RGB",()=>{
  const e=new EditorEngine();
  for (const [i,fill] of ["red","red","#ff000080","#ff000040"].entries()) {
    e.execute("shape.rectangle",{x:i*20,y:0,width:10,height:10});
    e.execute("node.set",{id:2+i,props:{fills:[fill,{type:"solid",color:"#ffee00",visible:false}],strokes:["blue"],visible:i!==0}});
  }
  const document=e.getSnapshot().document;
  const rows=pageColours(document);
  expect(pageColours(document)).toBe(rows);
  expect(rows.map(r=>[r.hex,r.count])).toEqual([["#0000FFFF",4],["#FF0000FF",2],["#FF000040",1],["#FF000080",1]]);
  expect(e.execute("paint.documentColors",{limit:"2px"})).toEqual({colors:[{color:"0000FF",count:4},{color:"FF0000",count:2}]});
  e.execute("page.add");
  expect(e.execute("paint.documentColors")).toEqual({colors:[]});
  expect(e.execute("paint.documentColors",{page:1,limit:-2})).toEqual({colors:[{color:"0000FF",count:4}]});
});
