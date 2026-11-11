import {parse} from "lossless-json";
import {diffLive,liveReplica} from "../../src/engine/sharing/live-changes";
import {applyLive} from "../../src/engine/sharing/live-replica";
import {readComments} from "../../src/engine/comments";
import {readFileSync} from "node:fs";
import {afterEach,expect,it,vi} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import {markRead} from "../../src/engine/comment-actions";

const corpus=JSON.parse(readFileSync(new URL("../fixtures/native-comment-actions.json",import.meta.url),"utf8")) as {
  commands:[string,Record<string,unknown>][],
  receipts:Record<string,unknown>[],
  archived:{created:number;read_by:string[];x:number;y:number}[],
};
afterEach(()=>vi.useRealTimers());

it("matches every pinned Rust comment command receipt and stored anchor after replying, editing and reacting",()=>{
  vi.useFakeTimers();vi.setSystemTime(corpus.archived[0].created*1000);
  const editor=new EditorEngine();
  for(const [index,[cmd,p]] of corpus.commands.entries()) {
    const result=editor.execute(cmd,p);
    if (cmd==="node.create") expect(String(result.id)).toBe(String(corpus.receipts[index].id));
    else expect(result,cmd).toEqual(corpus.receipts[index]);
  }
  const [c]=editor.getSnapshot().document.comments!;
  expect(c).toMatchObject({id:"1",anchor:"2",readBy:corpus.archived[0].read_by,x:corpus.archived[0].x,y:corpus.archived[0].y});
  expect(markRead({...c,readBy:undefined},"Ari",false).readBy).toEqual(["Bea"]);
});

it("preserves exact scoped comment links and distinguishes edit, comment and view access",()=>{
  const editor=new EditorEngine();
  editor.setEditable(false);
  editor.setCommentAccess(true,"Ri");
  editor.setLiveClient(3000000);
  const {id,link}=editor.execute("comment.add",{x:2,y:3,text:"Hello @Jo Doe"});
  expect(typeof id).toBe("string");expect(BigInt(String(id))>>32n).toBe(3000000n);
  expect(editor.execute("comment.link",{link})).toEqual({link});
  expect(()=>editor.execute("shape.rectangle")).toThrow();
  expect(()=>editor.execute("comment.edit",{id,author:"Someone else",text:"Changed"})).toThrow();
  editor.setCommentAccess(false,"Jo Doe",true);
  expect(editor.execute("comment.list",{filter:"mine",mentions:"Jo Doe"})).toMatchObject({comments:[{id,unread:true}]});
  expect(()=>editor.execute("comment.reply",{id,text:"Can't write"})).toThrow();
  editor.setEditable(false);
  expect(()=>editor.execute("comment.list")).toThrow();
});

it("orders and filters native mentions, skips email addresses and keeps unchanged reactions and read markers out of history",()=>{
  const e=new EditorEngine();
  e.execute("comment.add",{author:"Jo Doe",text:"One",x:0,y:0});
  e.execute("comment.add",{author:"Ari",text:"Tell @JO DOE and @λ3 twice @λ3, not a@b.test",x:1,y:1});
  expect(e.execute("comment.people")).toEqual({people:["Ari","Jo Doe","λ3"],you:"You"});
  expect(e.execute("comment.list",{mentions:"jo doe",query:"TWICE",author:"Jo Doe"})).toMatchObject({comments:[{
    id:2,mentions:[{name:"Jo Doe",known:true,you:true},{name:"λ3",known:false,you:false}]}]});
  e.execute("comment.react",{id:2,emoji:"👍",on:true});
  const before=e.getSnapshot().document;
  expect(e.execute("comment.react",{id:2,emoji:"👍",on:"yes"})).toEqual({on:true});
  expect(e.getSnapshot().document).toBe(before);
  expect(e.execute("comment.markRead",{id:2})).toEqual({changed:1});
  expect(e.recordsLiveEdit(e.getSnapshot().document)).toBe(false);
  expect(()=>e.execute("comment.react",{id:2,emoji:"a b"})).toThrow();
});

it("keeps the shared page while following a cross-page comment and carries only its read marker to the journal",()=>{
  const e=new EditorEngine();
  e.execute("comment.add",{text:"Here",x:10,y:20,author:"Ari"});
  e.execute("page.add",{name:"Other"});
  const other=e.getSnapshot().document.currentPage;
  e.setLiveHistory({canUndo:false,canRedo:false,travel:()=>false});
  e.setEditable(false);e.setCommentAccess(true,"Jo");
  expect(e.execute("comment.open",{id:1,view:"center"})).toMatchObject({page:1,unread:false});
  expect(e.getSnapshot().document.currentPage).toBe("1");
  expect(e.liveDrawing().currentPage).toBe(other);
  expect(e.liveDrawing().comments![0].readBy).toEqual(["Ari","Jo"]);
  expect(e.recordsLiveEdit(e.liveDrawing())).toBe(false);
  e.receiveLiveDocument({...e.liveDrawing(),name:"Shared update"});
  expect(e.getSnapshot().document.currentPage).toBe("1");
  expect(e.liveDrawing().currentPage).toBe(other);
});

it("limits feedback to 200 threads and 256 KiB without splitting UTF-8 characters",()=>{
  const e=new EditorEngine();
  for(let i=0;i<201;i++)e.execute("comment.add",{text:"🖇".repeat(4100),x:i,y:0});
  const brief=e.execute("comment.prompt");
  expect(brief).toMatchObject({count:201,truncated:true});
  expect((brief.comments as unknown[]).length).toBe(200);
  expect(new TextEncoder().encode(String(brief.text)).length).toBeLessThanOrEqual(256*1024);
  expect(String(brief.text)).not.toContain("\uFFFD");
  expect(e.execute("pref.userName",{name:"  "+"X".repeat(70)+"  "}).name).toBe("X".repeat(64));
});

it("replays an acknowledged reaction and either version of a competing read exactly as the native replica",async()=>{
  const orders=parse(readFileSync(new URL("../fixtures/native-comment-order.json",import.meta.url),"utf8")) as {staleRead:boolean;comment:unknown}[];
  const author=new EditorEngine();
  vi.useFakeTimers();vi.setSystemTime(0);
  author.execute("comment.add",{author:"Ari",text:"Review",x:0,y:0});
  vi.setSystemTime(1000);
  author.execute("comment.reply",{author:"Bea",id:1,text:"Agreed"});
  const original=liveReplica(author.getSnapshot().document);
  author.execute("comment.react",{author:"Bea",id:1,emoji:"👍"});
  const change=await diffLive(original,author.getSnapshot().document);
  const reacted=(await applyLive(original,change.changes)).replica;
  for (const order of orders) {
    const reader=new EditorEngine(), base=order.staleRead?original:reacted;
    reader.receiveLiveDocument(base.document);
    reader.execute("comment.markRead",{id:1,author:"Ari"});
    const {changes}=await diffLive(base,reader.getSnapshot().document);
    const final=(await applyLive(reacted,changes)).replica;
    expect(final.document.comments).toEqual(readComments([order.comment]));
  }
});
