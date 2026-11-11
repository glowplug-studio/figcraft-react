import type {OnlineGuestSession, OnlineInvitations} from "../../backends/online-files";
import type {Document} from "../document";
import type {EditorEngine} from "../editor";
import {inspectedId} from "../parameters";
import type {LivePresence} from "./live-presence";

export const sessionCommands={
  "collab.join":{label:"Join live session",undo:false},
  "collab.leave":{label:"Leave live session",undo:false},
  "collab.reconnect":{label:"Reconnect live session",undo:false},
};
export type SessionCommand=keyof typeof sessionCommands;
export type SessionAction=(command:SessionCommand,params:Record<string,unknown>)=>Record<string,unknown>;

export const guestEnding = {
  removed: "The file was removed from the server",
  stopped: "Sharing was stopped",
  unavailable: "The session is no longer available",
};

type Status = "off" | "connecting" | "live" | "reconnecting" | "failed";
interface Session {
  id:number;
  tab?:number;
  status:Status;
  reason:string|null;
  guest?:OnlineGuestSession;
  fileName?:string;
  pages?:{id:number|string;name:string}[];
  name?:string;
  colour?:string;
}
interface Tab {id:number;engine:EditorEngine}
interface Brief {
  session:number;document:number|null;status:Status;reason:string|null;role:"guest"|null;
  fileName:string|null;link:string|null;peers:number;
}

function editingValue(editing:LivePresence["editingText"], engine?:EditorEngine) {
  if (!editing) return null;
  const layer = engine?.getSnapshot().document.nodes[editing.node]?.name ?? null;
  return {node:inspectedId(editing.node),layer,caret:editing.caret,selection:editing.selection};
}

function peerValues(engine?:EditorEngine) {
  return engine?.people?.getSnapshot().map(peer => {
    const {cursor, viewport, selection, editingText} = peer.presence;
    return {id:peer.client,name:peer.name,color:peer.colour,chat:peer.chat || null,editing:editingValue(editingText,engine),
      presence:engine?.people?.hasPresence(peer.client) ? {cursor:cursor && [inspectedId(cursor[0]),cursor[1],cursor[2]], selection:selection?.map(inspectedId) ?? null,
        viewport:viewport && [inspectedId(viewport[0]),...viewport.slice(1)],
        editing_text:editingText && {...editingText,node:inspectedId(editingText.node)}} : null};
  }) ?? [];
}

function summary(available:boolean, sessions:Brief[], current?:Session, brief?:Brief, engine?:EditorEngine,
    details?:ReturnType<NonNullable<OnlineInvitations["inspect"]>>) {
  const guest=current?.guest, status=current?.status ?? "off";
  const people=status==="live" ? engine?.people : undefined;
  const range=engine?.getTextRange();
  const syncing=!!guest && (status==="live" || status==="reconnecting");
  return {available,canHost:false,session:current?.id ?? null,status,reason:current?.reason ?? null,
    attempt:status==="reconnecting" ? guest?.reconnectAttempt ?? null : null,role:brief?.role ?? null,
    me:guest?.client ?? null,name:people?.confirmedName ?? current?.name ?? details?.identity?.name ?? null,
    color:people?.confirmedColour ?? current?.colour ?? details?.identity?.colour ?? null,fileName:brief?.fileName ?? null,pages:current?.pages ?? null,
    link:brief?.link ?? null,url:details?.url ?? null,address:details?.address ?? null,network:details?.network ?? null,
    access:guest?.access ?? null,readOnly:syncing && guest?.access!=="edit",published:details?.published ?? null,
    code:details?.code ?? null,share:details?.share ?? null,hosting:status==="failed" ? null : details?.hosting ?? null,
    follow:(syncing ? engine?.people?.following : undefined) ?? null,signals:people?.signals ?? false,chat:people?.cursorChat ?? "",
    spotlight:people?.presenter ?? null,spotlighting:syncing && !!engine?.people?.spotlighting,syncing,document:brief?.document ?? null,
    editing:range ? {node:inspectedId(range.node.id),layer:range.node.name,caret:range.caret,
      selection:range.start===range.end ? null : [range.start,range.end]} : null,
    peers:peerValues(status==="live" ? engine : undefined),sessions};
}
export const unavailableSession = () => summary(false,[]);
export type LiveSummary = ReturnType<typeof summary>;

/** Session handles outlive physical reconnects. Tab indices are resolved at query time. */
export class LiveSessions {
  private next=1;
  private entries=new Map<string,Session>();
  private invitations?:OnlineInvitations;

  get host(){return this.invitations;}
  configure(invitations?:OnlineInvitations) {
    if (this.invitations!==invitations) this.entries.clear();
    this.invitations=invitations;
  }
  start(connection:string, tab?:number) {
    if (!this.invitations)return;
    const existing=this.entries.get(connection);
    if(existing){
      if(existing.status==="connecting" && !existing.guest)existing.tab=tab;
      return;
    }
    for (const [key,entry] of this.entries) {
      if (entry.tab===tab && entry.status==="failed") this.entries.delete(key);
    }
    this.entries.set(connection,{id:this.next++,tab,status:"connecting",reason:null});
  }
  failed(connection:string,reason:string) {
    const entry=this.entries.get(connection);
    if (entry && !entry.guest) { entry.status="failed";entry.reason=reason; }
  }
  welcome(guest:OnlineGuestSession,tab:Tab) {
    if (!this.invitations) return;
    this.start(guest.connection,tab.id);
    const entry=this.entries.get(guest.connection)!;
    if (!entry.guest || entry.guest.room!==guest.room) {
      this.drawing(guest.connection,tab.engine.getSnapshot().document);
    }
    const people=tab.engine.people;
    entry.name=people?.confirmedName ?? entry.name;
    entry.colour=people?.confirmedColour ?? entry.colour;
    entry.tab=tab.id;
    entry.guest=guest;
    entry.status=guest.ended ? "failed" : guest.reconnectAttempt ? "reconnecting" : "live";
    entry.reason=guest.ended ? guestEnding[guest.ended] : null;
  }
  drawing(connection:string,doc:Document) {
    const entry=this.entries.get(connection);
    if (!entry || entry.status==="failed")return;
    entry.fileName=doc.name;
    entry.pages=doc.pages.map(id=>({id:inspectedId(id),name:doc.nodes[id]?.name ?? ""}));
  }
  leave(connection:string) {this.entries.delete(connection);}
  close(tab:number,replacement?:number) {
    for (const [key,entry] of this.entries) {
      if(entry.tab!==tab)continue;
      if(entry.status==="connecting" && !entry.guest) entry.tab=replacement;
      else this.entries.delete(key);
    }
  }
  find(tab:number,id?:number) {
    let found:[string,Session]|undefined;
    for (const item of this.entries) {
      const entry=item[1];
      if(id!==undefined){if(entry.id===id)return item;continue;}
      if(entry.tab===tab && (!found?.[1].guest || entry.guest)) found=item;
    }
    return found;
  }
  inspect(tab:number,tabs:readonly Tab[],joined?:string) {
    if (!this.invitations) return unavailableSession();
    const briefs:Brief[]=[];
    let shown:Session|undefined, active:Brief|undefined, engine:EditorEngine|undefined;
    let details:ReturnType<NonNullable<OnlineInvitations["inspect"]>>;
    const wanted=joined ?? this.find(tab)?.[0];
    for (const [key,entry] of this.entries) {
      const index=entry.guest ? tabs.findIndex(t=>t.id===entry.tab) : -1;
      const editor=tabs[index]?.engine;
      const info=entry.guest ? this.invitations.inspect?.(key) : undefined;
      const brief:Brief={session:entry.id,document:index>=0 ? index : null,status:entry.status,reason:entry.reason,
        role:entry.guest ? "guest" : null,fileName:entry.fileName ?? null,link:info?.link ?? null,
        peers:entry.status==="live" ? editor?.people?.getSnapshot().length ?? 0 : 0};
      briefs.push(brief);
      if (key===wanted) {
        shown=entry;active=brief;engine=editor;details=info;
      }
    }
    return summary(true,briefs,shown,active,engine,details);
  }
}
