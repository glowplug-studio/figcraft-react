import {afterEach,expect,it,vi} from "vitest";
import {BrowserInvitations} from "../../examples/nextjs/lib/sharing/browser-invites";
import {BrowserOwnerSharing} from "../../examples/nextjs/lib/sharing/owner-sharing";
import type {DeviceOwnerSharing} from "../../src/backends/browser/owner-sharing";

afterEach(()=>vi.unstubAllGlobals());

it("keeps original links and role-selected codes on the publishing session when the same file is also joined by invite",async()=>{
  vi.stubGlobal("window",new EventTarget());
  vi.stubGlobal("location",{hash:"",origin:"https://editor.example"});
  const token=(role:string)=>role.padEnd(24,"X");
  let row:DeviceOwnerSharing={links:(["edit","view","comment"] as const).map(access=>({
    access,token:token(access),code:access.toUpperCase(),id:access,
  }))};
  const sharing=new BrowserOwnerSharing({ownerSharing:async()=>row},"principal","https://files.example");
  const original={edit:{token:token("originalEdit"),id:"e"},view:{token:token("originalView"),id:"v"}};
  vi.stubGlobal("fetch",async(url:string,options:RequestInit)=>{
    if(url.endsWith("/join"))return new Response("archive",{headers:{
      "X-Figcraft-Access":JSON.parse(String(options.body)).token===original.edit.token?"edit":"view",
      "X-Figcraft-Room":"10000000-0000-4000-8000-000000000001","X-Figcraft-Client":"2",
    }});
    if(url.endsWith("/presence"))return Response.json({me:{name:"Bea",client:2,generation:"1",colour:"#0D99FF"},peers:[]});
    return new Response(null,{status:204});
  });
  const invitations=new BrowserInvitations({readPublishedLinks:async()=>original},"principal","https://files.example",
    ()=>()=>{},()=>{},()=>{},undefined,{hosting:async()=>({idleSeconds:"90000",expires:"18446744073709551615",maxFileMb:12,
      operator:"Studio",terms:"https://files.example/terms",open:false}),loadSharing:file=>sharing.read(file),
      sharing:(file,recorded)=>sharing.inspect(file,recorded)});
  let joined="";
  const unsubscribe=invitations.subscribe(async session=>{joined=session.connection;});
  try{
    const owner=await invitations.joinOwned("file",false,{name:"Drawing",expires:"1900000000"},true);
    const key=owner!.session.connection;
    const native=(secret:string)=>"figcraft://join?server=wss://files.example:443/&file=file&token="+secret;
    sharing.selectAccess("file","comment");
    expect(invitations.inspect(key)).toEqual({
      identity:{name:"Bea",colour:"#0D99FF"},address:"wss://files.example:443/",network:true,link:native(original.edit.token),
      url:"https://editor.example/#join="+encodeURIComponent(native(original.edit.token)),
      published:{file:"file",server:"https://files.example",name:"Drawing",owner:null,expires:1900000000,
        edit:native(original.edit.token),view:native(original.view.token)},
      share:{via:"online",access:"comment",shared:true,editCode:"EDIT",viewCode:"VIEW",commentCode:"COMMENT",
        editLink:native(token("edit")),viewLink:native(token("view")),commentLink:native(token("comment"))},code:"COMMENT",
      hosting:{open:false,operator:"Studio",terms:"https://files.example/terms",idleDays:1.04,maxFileMb:12,expires:"18446744073709551615"},
    });
    await invitations.join(native(token("view")));
    const view=invitations.inspect(joined)!;
    expect(view.link).toBe(native(token("view")));
    expect(view.published).toBeUndefined();expect(view.share).toBeUndefined();expect(view.code).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(original.edit.token);
    row={links:[]};await sharing.read("file");
    expect(invitations.inspect(key)?.share).toMatchObject({shared:false,access:"comment",editCode:null,editLink:null});
    expect(invitations.inspect(key)?.code).toBeNull();
    await invitations.leave(key);expect(invitations.inspect(key)).toBeUndefined();
    await invitations.leave(joined);expect(invitations.inspect(joined)).toBeUndefined();
  }finally{unsubscribe();}
});
