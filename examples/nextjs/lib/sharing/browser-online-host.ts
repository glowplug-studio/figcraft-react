import type {SupabaseClient} from "@supabase/supabase-js";
import type {IndexedDbRecoveryStore,DeviceOwnerSharing,OnlineWorkspaceHost} from "@glowplug-studio/figcraft-react";
import {SupabaseOnlineFileStore,publishedLinkDigests,watchSupabaseGuest} from "@glowplug-studio/figcraft-react/backends/supabase";
import {postOperatorRequest} from "./operator-request";
import {BrowserTeamLibraries} from "./team-libraries";
import {BrowserInvitations} from "./browser-invites";
import {BrowserOwnerSharing} from "./owner-sharing";

export function browserOnlineHost(client:SupabaseClient,store:IndexedDbRecoveryStore,principal:string,server:string,
  showJoin:()=>void,notify:(message:string)=>void) {
  let currentKey = "";
  const operators = new Map<string, {pair: Awaited<ReturnType<typeof store.publicationLinks>>;
    key?:string; sharing: DeviceOwnerSharing}>();
  const sharing = new BrowserOwnerSharing({
    ownerSharing: async (principal,address,file,update) => {
      const operator = operators.get(file);
      if (!operator) return store.ownerSharing(principal,address,file,update);
      if (update) operator.sharing = update(operator.sharing);
      return operator.sharing;
    },
  }, principal, server, file => operators.has(file) ? operators.get(file)?.key ?? currentKey : undefined);
  const files = new SupabaseOnlineFileStore(client, principal, async (id,serverKey) => {
    const pair = await store.publicationLinks(principal,server,id);
    const links = await publishedLinkDigests(pair);
    const response = await postOperatorRequest("/api/online-files",{id,links},serverKey);
    if (!response.ok) {
      const reason = [403,409,429].includes(response.status) ? await response.json().catch(() => null) : null;
      throw new Error(typeof reason?.error === "string" ? reason.error : "The online file could not be published");
    }
    const receipt = await response.json();
    if (serverKey && receipt?.managedByKey === true) operators.set(id, {pair, sharing:operators.get(id)?.sharing ?? {links:[]}});
    return receipt;
  });
  const invites = new BrowserInvitations({
    readPublishedLinks: async (principal,address,file) => operators.get(file)?.pair ?? store.readPublishedLinks(principal,address,file),
  }, principal, server,
    (connection, ended, edits, people, ready) => watchSupabaseGuest(client, connection, ended, edits, people, ready), showJoin, notify, file => files.resolveTeamFile(file),{hosting:file=>files.hosting(file),
    sharing:(file,recorded)=>sharing.inspect(file,recorded),loadSharing:file=>sharing.read(file,true)});
  return {
    server, libraries:new BrowserTeamLibraries(store,principal,server,client,invites),
    supportsServerKey:true,operatorOrigin:location.origin,serverKeyChanged:key=>{currentKey=key;},
    retainOperatorKey:(file,key)=>{const entry=operators.get(file);if(entry)entry.key=key;},
    releasePublished:file=>{operators.delete(file);},
    store:files,device:store,invitations:invites,sharing,
  } satisfies OnlineWorkspaceHost;
}
