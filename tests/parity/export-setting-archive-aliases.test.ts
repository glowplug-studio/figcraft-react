import {expect,it} from "vitest";
import fixture from "../fixtures/native-export-setting-archive-aliases.json";
import {EditorEngine} from "../../src/engine/editor";
import {decodeFigcraft,encodeFigcraft} from "../../src/engine/file-format";

// Native full file.open observations at bad07e44; aliases also apply to archive
// deserialisation. Unlike node.set, a file rejects duplicate alias/canonical fields.
interface Case {name:string;settings:unknown[];exports?:unknown[];error?:string}
it.each(fixture.cases as Case[])("preserves native archive export aliases: $name",async row=>{
  const base=fixture.baseDocument;
  const document={...base,nodes:{...base.nodes,"2":{...base.nodes["2"],exports:row.settings}}};
  const bytes=new TextEncoder().encode(JSON.stringify(document));
  const engine=new EditorEngine(),before=engine.getSnapshot();
  if(row.error){
    expect(row.error).toContain("duplicate field");
    await expect(engine.openFile(new File([bytes],"aliases.figcraft"))).rejects.toThrow(/duplicate field/);
    expect(engine.getSnapshot()).toBe(before);
  }else{
    await engine.openFile(new File([bytes],"aliases.figcraft"));
    expect(engine.execute("node.get",{id:2})?.exports).toEqual(row.exports);
    const reopened=await decodeFigcraft(await encodeFigcraft(engine.getSnapshot().document));
    expect(reopened.document.nodes["2"].exports).toEqual(row.exports);
  }
});
