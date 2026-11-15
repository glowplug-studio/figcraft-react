import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "fflate";
import {parse} from "lossless-json";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {collaborationDiff,collaborationDiffReceipt} from "../../src/engine/sharing/collaboration-diff";
import {changeMessageSize,encodeChangeMessage} from "../../src/engine/sharing/session-postcard";
import {nativeLiveChange,type NativeChange} from "../support/nativeLiveChange";

type WireCase={name:string;bytes:number;count:number;encoded:number[];readableJson:string};
const fixture=JSON.parse(readFileSync(new URL("../fixtures/native-public-diff-wire.json",import.meta.url),"utf8")) as {nativeRevision:string;cases:WireCase[]};

// Independent expected browser representation of the native readable tokens.
function expectedReadable(text:string):unknown {
  return parse(text,null,{parseNumber:token=>{
    if(!/^-?\d+$/.test(token))return Number(token);
    const integer=BigInt(token),limit=BigInt(Number.MAX_SAFE_INTEGER);
    return integer>=-limit && integer<=limit?Number(integer):token;
  }});
}

it.each(fixture.cases)("matches native change-vector bytes, size and readable receipt: $name",row=>{
  const changes=(parse(row.readableJson) as NativeChange[]).map(nativeLiveChange);
  expect(encodeChangeMessage(changes)).toEqual(Uint8Array.from(row.encoded));
  expect(changeMessageSize(changes)).toBe(row.bytes);
  expect(row.encoded).toHaveLength(row.bytes);
  expect(collaborationDiffReceipt(changes)).toEqual({changes:expectedReadable(row.readableJson),count:row.count,bytes:row.bytes});
});

it("preserves native numeric tokens for bytes while exposing plain readable JSON values",()=>{
  expect(fixture.cases).toHaveLength(52);
  expect(fixture.nativeRevision).toBe("bad07e4433240cad046589129c084bd2fc36f097");
  const row=fixture.cases.find(row=>row.name==="set")!;
  const changes=(parse(row.readableJson) as NativeChange[]).map(nativeLiveChange);
  expect(collaborationDiffReceipt(changes).changes).toEqual([{set:{id:128,prop:"pluginData",value:{
    a:{array:[null,true,-1],float:1,u64:"18446744073709551615"},z:"é🙂\n",
  }}}]);
  const serialised=JSON.stringify(collaborationDiffReceipt(changes));
  expect(serialised).toContain('"u64":"18446744073709551615"');
  expect(serialised).not.toContain("isLosslessNumber");
  expect(collaborationDiffReceipt([{type:"setDoc",prop:"name",value:'{"negative":-9007199254740992,"safe":9007199254740991,"float":1.0}'}]).changes)
    .toEqual([{setDoc:{prop:"name",value:{negative:"-9007199254740992",safe:9007199254740991,float:1}}}]);
  expect(fixture.cases.find(row=>row.name==="float-one")!.bytes).toBe(9);
  expect(fixture.cases.find(row=>row.name==="integer-one")!.bytes).toBe(7);
  expect(encodeChangeMessage([])).toEqual(new Uint8Array([1,0]));
});

it("projects complete native ordered document diffs through a fresh baseline replica",async()=>{
  const corpus=unzipSync(readFileSync(new URL("../fixtures/native-ordered-changes.zip",import.meta.url)));
  const batches=strFromU8(corpus["changes.jsonl"]).trim().split("\n");
  for(const [i,line] of batches.entries()){
    const before=(await decodeFigcraft(corpus[i+".figcraft"])).document;
    const after=(await decodeFigcraft(corpus[(i+1)+".figcraft"])).document;
    const receipt=await collaborationDiff(before,after);
    expect(receipt.changes,"native batch "+(i+1)).toEqual(expectedReadable(line));
    expect(receipt.count).toBe((parse(line) as unknown[]).length);
    expect(await collaborationDiff(before,before)).toEqual({changes:[],count:0,bytes:2});
  }
});
