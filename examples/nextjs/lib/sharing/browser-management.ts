import type {DeviceOwnerSharing,IndexedDbRecoveryStore,OnlineFileManagement,OnlineManagementResult,OnlineManagedLink} from "@glowplug-studio/figcraft-react";
import {nativeInviteLink,parseInviteServer} from "@glowplug-studio/figcraft-react/sharing/invite";
import {BrowserOwnerSharing} from "./owner-sharing";
import {postOperatorRequest} from "./operator-request";

export function browserManagement(device:IndexedDbRecoveryStore,principal:string,server:string,sharing:BrowserOwnerSharing):OnlineFileManagement {
  const object=(value:unknown):Record<string,unknown>=>value && typeof value==="object" ? value as Record<string,unknown> : {};
  const post=async(path:string,body:Record<string,unknown>)=>{
    const response=await postOperatorRequest(path,body);
    if(!response.ok){
      const detail=object([400,403,404,409,422,429].includes(response.status) ? await response.json().catch(()=>null) : null);
      throw new Error(typeof detail.error==="string" ? detail.error : "File management is temporarily unavailable");
    }
    return response.status===204 ? {} : object(await response.json());
  };
  return {async execute(file,request,context):Promise<OnlineManagementResult> {
    const grouped=request.action==="share" || request.action==="unshare";
    if(context.owner!==undefined && !(grouped && context.key)) {
      throw new Error("Native owner tokens are unsupported by this account-backed host; use your recorded file");
    }
    if(grouped){
      let temporary:DeviceOwnerSharing={links:[]};
      // Native unrecorded operator shares return their new links without recording
      // a device owner. Repeating that explicit command is a new share operation.
      const store=context.recorded ? device : {ownerSharing:async(_principal:string,_server:string,_file:string,update?:(row:DeviceOwnerSharing)=>DeviceOwnerSharing)=>{
        if(update)temporary=update(temporary);
        return temporary;
      }};
      const group=context.recorded && !context.key ? sharing
        : new BrowserOwnerSharing(store,principal,server,()=>context.key);
      await group.change(file,request.action==="share");
      const state=group.inspect(file,true)!;
      if(context.recorded && group!==sharing)await sharing.read(file);
      return {shared:state.shared,code:state.editCode,viewCode:state.viewCode,commentCode:state.commentCode,
        editLink:state.editLink,viewLink:state.viewLink,commentLink:state.commentLink};
    }
    if(request.action==="rename" || request.action==="remove"){
      await post("/api/online-files/manage",{id:file,name:request.action==="rename" ? request.name : null,strict:true});
      return {done:true};
    }
    const reply=await post("/api/online-files/links",{file,...request});
    if(request.action==="createLink"){
      if(typeof reply?.id!=="string" || typeof reply.token!=="string" || reply.access!==request.access)throw new Error("Invalid new link receipt");
      const endpoint=parseInviteServer(server.replace(/^http/,"ws")).server;
      return {id:reply.id,access:request.access,link:nativeInviteLink({kind:"link",file,server:endpoint,token:reply.token})};
    }
    if(request.action==="revoke"){
      if(reply?.done!==true)throw new Error("Invalid revocation receipt");
      return {done:true};
    }
    if(!Array.isArray(reply?.links))throw new Error("Invalid link list receipt");
    const links:OnlineManagedLink[]=reply.links.map((value:unknown)=>{
      const row=object(value);
      if(typeof row.id!=="string" || !/^[0-9a-f]{16}$/.test(row.id) || typeof row.label!=="string"
        || (row.access!=="edit" && row.access!=="view" && row.access!=="comment")
        || !((typeof row.created==="number" && Number.isSafeInteger(row.created) && row.created>=0)
          || (typeof row.created==="string" && /^\d+$/.test(row.created))))throw new Error("Invalid link metadata");
      return {id:row.id,label:row.label,access:row.access,created:row.created};
    });
    return {links};
  }};
}
