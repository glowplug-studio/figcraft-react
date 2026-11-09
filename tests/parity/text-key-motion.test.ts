import { expect,it } from "vitest";
import reference from "../fixtures/native-text-key-motion.json" with {type:"json"};
import { EditorEngine } from "../../src/engine/editor";
import { textKeyMotion } from "../../src/engine/text-key-motion";

it.each(reference)("uses native scalar selection and deletion boundaries in $text",async ({text,cases})=>{
  const e=new EditorEngine(), id=String((await e.executeAsync("text.create",{text,x:10,y:20})).id);
  const node=e.getSnapshot().document.nodes[id];
  if (node.kind!=="text") throw new Error("Expected a text layer");
  for (const row of cases) {
    const result=textKeyMotion(node,row,row.key,{shift:row.mod==="shift",word:row.mod==="alt",line:row.mod==="cmd"});
    if (result && "remove" in result) {
      const [start,end]=result.remove, chars=Array.from(text);
      expect([...chars.slice(0,start),...chars.slice(end)].join("")).toBe(row.after);
      expect(row.expected).toEqual([start,start]);
    } else expect(result).toEqual({selection:{anchor:row.expected[0],caret:row.expected[1]}});
  }
});
