import {readFileSync} from "node:fs";
import {strFromU8, unzipSync} from "fflate";
import {expect,it} from "vitest";
import {decodeFigcraft} from "../../src/engine/file-format";
import {liveReplica} from "../../src/engine/sharing/live-changes";
import {recoveredDrawing, type OnlineRecoveryPosition} from "../../src/engine/sharing/online-recovery";

const native=unzipSync(readFileSync(new URL("../fixtures/native-online-recovery.zip",import.meta.url)));
async function documents(name:string){
  const bytes=(part:string)=>native[name+"/"+part];
  const [stored,server]=await Promise.all(["stored.figcraft","server.figcraft"].map(part=>decodeFigcraft(bytes(part))));
  const json=(part:string)=>JSON.parse(strFromU8(bytes(part)));
  return {copy:stored.document,server:liveReplica(server.document),
    at:json("at.json") as OnlineRecoveryPosition,current:json("welcome.json") as OnlineRecoveryPosition,
    tabs:json("result.json").tabs as {dirty:boolean;layers:number;name:string}[]};
}

const welcomed=Object.keys(native).filter(path=>path.endsWith("/welcome.json")).map(path=>path.split("/")[0]);
it.each(welcomed)("preserves the native crash recovery decision for %s",async name=>{
  const {copy,server,at,current,tabs}=await documents(name);
  const expected=tabs.length===3 ? "copy" : tabs[1].dirty ? "apply" : "equal";
  expect(await recoveredDrawing(server,copy,at,current,"edit")).toBe(expected);
});

it("keeps the copy when access or the creator of a new layer prevents replay",async()=>{
  const {server,copy,at,current}=await documents("a_copy_ahead_of_the_server_has_its_edits_applied_and_sent");
  for(const access of ["view","comment"] as const)expect(await recoveredDrawing(server,copy,at,current,access)).toBe("copy");
  const other={...current,client:current.client+1};
  expect(await recoveredDrawing(server,copy,other,other,"edit")).toBe("copy");
  expect(await recoveredDrawing(server,copy,at,{...current,sequence:"18446744073709551615"},"edit")).toBe("copy");
});
