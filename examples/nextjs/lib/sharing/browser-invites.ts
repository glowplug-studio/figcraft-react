import {parseJoinCode} from "@glowplug-studio/figcraft-react/sharing/join-code";
import {participantReportReason,readPeopleWelcome,readDisplayName,type PeopleWelcome} from "@glowplug-studio/figcraft-react";
import type { OnlineFileInfo, OnlineHostInformation, SessionDetails, LiveTransport, GuestConnectionStatus, GuestSessionEnd, IndexedDbRecoveryStore, OnlineGuestSession, OnlineInvitations } from "@glowplug-studio/figcraft-react";
import { type SessionInvite,inviteEndpoint, nativeInviteLink, parseInviteServer, parseSessionInvite } from "@glowplug-studio/figcraft-react/sharing/invite";

export const inviteAfterLogin = "figcraft-join-after-login";

// GuestConfig::pause restarts the backoff after each round of twelve attempts.
export function guestReconnectDelay(attempt: number) {
  const index = (attempt - 1) % 12;
  return index === 0 && attempt > 1 ? 60_000 : Math.min(10_000, 500 * 2 ** index);
}

class RefusedInvite extends Error {}
class BarredInvite extends RefusedInvite {}

type Grant = {file:string;token:string;resume:string;physical:string;ended:boolean;archive:Blob;room:string;client:number;
  welcome?:PeopleWelcome;recorded?:boolean;published?:SessionDetails["published"];hosting?:SessionDetails["hosting"]};

function epoch(value?:string|null) {
  if (!value) return null;
  return Number.isSafeInteger(Number(value)) ? Number(value) : value;
}

export class BrowserInvitations implements OnlineInvitations {
  private listener?: (session: OnlineGuestSession, bytes: Blob,current?:()=>boolean) => Promise<void>;
  private stage?: (connection:string,failed?:string|null)=>void;
  private readonly endpoint;
  private readonly pending=new Set<string>();
  private readonly listeners = new Map<string,() => void>();
  private readonly waiting = new Map<string, () => void>();
  // Retain a manual rejoin credential only while its tab belongs to this signed-in host.
  private readonly peopleReady=new Map<string,()=>void>();
  private readonly peopleListeners = new Map<string,(value:unknown)=>void>();
  private readonly tabs = new Map<string,Grant>();


  constructor(private device: Pick<IndexedDbRecoveryStore, "readPublishedLinks">, private principal: string, private server: string,
    private readonly monitor: (connection:string,ended:(reason:GuestSessionEnd)=>void,edits?:()=>void,people?:(message:unknown)=>void,ready?:()=>void)=>()=>void, readonly showJoin: () => void, private readonly notify: (message: string) => void,
    private resolveTeam?: (file: string) => Promise<{file: string; token: string}>,
    private metadata?:{hosting(file:string):Promise<OnlineHostInformation>;sharing(file:string,recorded:boolean):SessionDetails["share"];loadSharing(file:string):Promise<unknown>}) {
    this.endpoint = parseInviteServer(server.replace(/^http/, "ws")).server;
  }

  subscribe(listener: (session: OnlineGuestSession, bytes: Blob,current?:()=>boolean) => Promise<void>, stage?:(connection:string,failed?:string|null)=>void) {
    this.listener = listener;
    this.stage = stage;
    const consume = (afterLogin: boolean) => {
      if (this.listener !== listener) return;
      let fragment = location.hash;
      if (afterLogin) {
        try {
          if (!fragment.startsWith("#join=")) fragment = sessionStorage.getItem(inviteAfterLogin) ?? "";
          sessionStorage.removeItem(inviteAfterLogin);
        } catch { /* A link on this page can still be opened without session storage. */ }
      }
      if (!fragment.startsWith("#join=")) return;
      history.replaceState(history.state, "", location.pathname + location.search);
      void this.join(fragment).catch(() => this.notify("The invite could not be opened"));
    };
    const changed = () => consume(false);
    window.addEventListener("hashchange", changed);
    queueMicrotask(() => consume(true));
    return () => {
      window.removeEventListener("hashchange", changed);
      if (this.listener === listener) {this.listener = undefined;this.stage=undefined;this.pending.clear();}
    };
  }

  live(connection: string): LiveTransport | undefined {
    const tab = this.tabs.get(connection);
    if (!tab || tab.ended) return;
    const room=tab.room,client=tab.client;
    const request = async (body: object, path="live") => {
      const physical = tab.physical;
      if (tab.ended || this.tabs.get(connection) !== tab) throw new Error("The shared connection has ended");
      const result = await fetch("/api/online-files/"+path,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({file:tab.file,tab:physical,...body})});
      if (!result.ok || physical !== tab.physical || tab.ended) throw new Error("Shared edits are temporarily unavailable");
      return result.json();
    };
    return {get archive(){return tab.archive;},get identity(){return {room:tab.room,client:tab.client};},people:{
      get welcome(){return tab.welcome;},
      send:sample=>tab.room===room && tab.client===client ? request({sample},"presence")
        : Promise.reject(new Error("The live room was replaced")),
      listen:(receive,ready)=>{this.peopleListeners.set(connection,receive);this.peopleReady.set(connection,ready);return ()=>{
        if(this.peopleReady.get(connection)===ready)this.peopleReady.delete(connection);
        if(this.peopleListeners.get(connection)===receive)this.peopleListeners.delete(connection);
      };},
    },listen:wake => {
      this.listeners.set(connection,wake);
      return () => { if (this.listeners.get(connection) === wake) this.listeners.delete(connection); };
    },read:after => request({action:"read",after}),
      submit:(batch,base,changes) => request({action:"submit",batch,base,changes})};
  }

  private addGrant(connection:string,tab:Grant) {
    this.tabs.set(connection,tab);
    void this.metadata?.hosting(tab.file).then(info=>{
      if(this.tabs.get(connection)!==tab || tab.ended || info.maxFileMb===undefined || info.open===undefined)return;
      const seconds=Number(info.idleSeconds);
      tab.hosting={open:info.open,operator:info.operator ?? "",terms:info.terms ?? "",
        idleDays:seconds>0 ? Math.round(seconds/864)/100 : null,maxFileMb:info.maxFileMb,expires:epoch(info.expires)};
    }).catch(()=>{});
    if(tab.published) void this.metadata?.loadSharing(tab.file).catch(()=>{});
  }

  inspect(connection:string):SessionDetails|undefined {
    const tab=this.tabs.get(connection);
    if(!tab)return;
    const {host,path,secure}=this.endpoint;
    const address=!secure && path==="/" ? host : inviteEndpoint(this.endpoint);
    const hostname=new URL(inviteEndpoint(this.endpoint)).hostname;
    const network=hostname!=="localhost" && hostname!=="[::1]" && !/^127\./.test(hostname);
    const link=nativeInviteLink({kind:"link",server:this.endpoint,file:tab.file,token:tab.token});
    const share=tab.published ? this.metadata?.sharing(tab.file,!!tab.recorded) : undefined;
    return {identity:tab.welcome && {name:tab.welcome.me.name,colour:tab.welcome.me.colour},link,url:location.origin+"/#join="+encodeURIComponent(link),network,address,
      published:tab.published && {...tab.published},hosting:tab.hosting && {...tab.hosting},share,
      code:share?.[share.access==="edit" ? "editCode" : share.access==="view" ? "viewCode" : "commentCode"]};
  }

  libraryInvite(connection: string) {
    const tab = this.tabs.get(connection);
    if (!tab || tab.ended) throw new Error("Reconnect to the file to use its team library");
    return nativeInviteLink({kind:"link",server:this.endpoint,file:tab.file,token:tab.token});
  }

  async copyPublished(file: string, access: "edit" | "view") {
    const links = await this.device.readPublishedLinks(this.principal, this.server, file);
    if (!links) throw new Error("This device does not have those links");
    const link = nativeInviteLink({ kind: "link", server: this.endpoint, file, token: links[access].token });
    await navigator.clipboard.writeText(location.origin + "/#join=" + encodeURIComponent(link));
  }

  canAttach(connection:string) {const tab=this.tabs.get(connection);return !!tab && !tab.ended;}

  async joinOwned(file: string, managedByKey = false, listing?:Pick<OnlineFileInfo,"name"|"expires">, recorded=false) {
    const listener=this.listener;
    const links = await this.device.readPublishedLinks(this.principal, this.server, file);
    if(listener!==this.listener)throw new Error("The join was cancelled");
    if (!links) return undefined;
    const connection = crypto.randomUUID(), resume = crypto.randomUUID();
    const token = links.edit.token;
    const stage=this.stage;this.pending.add(connection);stage?.(connection);
    try {
      const {access, client, room, bytes,welcome,canRemovePeople} = await this.redeem(connection, {file, token, resume});
      if(!this.pending.has(connection) || stage!==this.stage)throw new Error("The join was cancelled");
      if (access !== "edit") throw new Error("The original edit link is unavailable");
      const wayIn=(token:string)=>nativeInviteLink({kind:"link",server:this.endpoint,file,token});
      const published=listing && {server:this.server,file,name:listing.name,owner:null,expires:epoch(listing.expires),
        edit:wayIn(token),view:wayIn(links.view.token)};
      this.addGrant(connection, {file, token,published,recorded, resume, physical: connection, ended: false, archive:bytes, room, client,welcome});
      return {session: {file, connection, access, client, room, canRemovePeople, ...(!managedByKey && {openedAsOwner: true as const})}, archive: bytes};
    } catch (error) {
      if(this.pending.has(connection) && stage===this.stage) stage?.(connection,error instanceof Error ? error.message : "The invite is unavailable");
      void this.release(connection).catch(() => undefined);
      throw error;
    }finally{this.pending.delete(connection);}
  }

  async join(text:string) {await this.beginJoin(text).completed;}

  beginJoin(text: string) {
    const receive = this.listener;
    if (!receive) throw new Error("The signed-in workspace is unavailable");
    let input = text.trim();
    if (/^https?:\/\//i.test(input)) {
      const address = new URL(input);
      if (address.origin !== location.origin || !address.hash.startsWith("#join=")) throw new Error("This invite belongs to another host");
      input = address.hash;
    }
    if (input.startsWith("#join=")) {
      try { input = decodeURIComponent(input.slice(6)); } catch { throw new Error("Invalid invite fragment"); }
    }
    let invite:SessionInvite;
    if(input.includes("://")) invite=parseSessionInvite(input);
    else{
      const code=parseJoinCode(input);
      invite=code.kind==="local" ? parseSessionInvite(code.link) : {kind:"code",server:this.endpoint,code:code.code};
    }
    if (invite.server.secure !== this.endpoint.secure || invite.server.host.toLowerCase() !== this.endpoint.host.toLowerCase()
        || invite.server.path !== this.endpoint.path) {
      throw new Error("This invite belongs to another server");
    }

    const connection=crypto.randomUUID();
    this.pending.add(connection);
    this.stage?.(connection);
    return {connection,completed:this.finishJoin(connection,invite,receive)};
  }

  private async finishJoin(connection:string,invite:SessionInvite,receive:NonNullable<typeof this.listener>) {
    const resume=crypto.randomUUID();
    const current=()=>this.listener===receive && this.pending.has(connection);
    let attached = false, redeeming = false;
    try {
      let grant: {file: string; token: string};
      if (invite.kind === "team") {
        if (!this.resolveTeam) throw new Error("This server keeps no team list");
        grant = await this.resolveTeam(invite.file);
      } else {
        grant = invite.kind === "code" ? await this.lookup(invite.code) : invite;
      }
      if (!current()) throw new Error("The join was cancelled");
      redeeming = true;
      const {access, client, room, bytes,welcome,canRemovePeople} = await this.redeem(connection, {...grant, resume});
      if (!current()) throw new Error("The join was cancelled");
      this.addGrant(connection, {file: grant.file, token: grant.token, resume, physical: connection, ended: false, archive:bytes, room, client,welcome});
      await receive({ file: grant.file, connection, access, client, room,canRemovePeople }, bytes,current);
      attached = true;
    } catch (error) {
      // Revocation can land between a successful code lookup and its separate join.
      const failure=invite.kind === "code" && error instanceof RefusedInvite && !(error instanceof BarredInvite) ? new Error("That code has expired or its sharing was stopped") : error;
      if(current())this.stage?.(connection,failure instanceof Error ? failure.message : "The invite is unavailable");
      throw failure;
    } finally {
      this.pending.delete(connection);
      if (redeeming && !attached) await this.leave(connection).catch(() => undefined);
    }
  }

  private async lookup(code: string): Promise<{file: string; token: string}> {
    const response = await fetch("/api/online-files/code", {method: "POST", body: code});
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Code lookup failed");
    if (typeof result.file !== "string" || typeof result.token !== "string") throw new Error("Invalid code receipt");
    return {file: result.file, token: result.token};
  }

  private async redeem(connection: string, invite: {file: string; token: string; resume: string}) {
    const response = await fetch("/api/online-files/join", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: connection, file: invite.file, token: invite.token, resume: invite.resume }) });
    if (response.status === 401 || response.status === 403) {
      const reason=await response.json().catch(()=>null);
      if(reason?.error==="you were removed from this session")throw new BarredInvite(reason.error);
      throw new RefusedInvite("The invite is unavailable");
    }
    if (!response.ok) throw new Error("The session could not be reached");
    const access = response.headers.get("X-Figcraft-Access");
    if (access !== "view" && access !== "edit" && access !== "comment") throw new Error("Invalid session access");
    const bytes = await response.blob();
    const client = Number(response.headers.get("X-Figcraft-Client"));
    if (!Number.isInteger(client) || client < 1 || client >= 0xffffffff) throw new Error("Invalid live client number");
    const room=response.headers.get("X-Figcraft-Room");
    if(!room || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(room))throw new Error("Invalid live room identity");
    let welcome:PeopleWelcome|undefined;
    if(this.metadata){
      const roster=await fetch("/api/online-files/presence",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({file:invite.file,tab:connection,action:"welcome",name:readDisplayName(this.principal)})});
      if(roster.status===403)throw new RefusedInvite("The invite is unavailable");
      if(!roster.ok)throw new Error("The session could not be reached");
      welcome=readPeopleWelcome(await roster.json());
      if(welcome.me.client!==client)throw new Error("Invalid participant identity");
    }
    return {access: access as OnlineGuestSession["access"], client, room, bytes,welcome,canRemovePeople:response.headers.get("X-Figcraft-Remove-People")==="true"};
  }

  watch(connection: string, ended: (reason: GuestSessionEnd) => void, changed?: (status: GuestConnectionStatus) => void) {
    const tab = this.tabs.get(connection);
    if (!tab) return () => {};
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stop: (() => void) | undefined;
    const current = () => !disposed && this.tabs.get(connection) === tab;
    const finish = (reason: GuestSessionEnd) => {
      if (!current()) return;
      tab.ended = true;
      ended(reason);
    };
    const schedule = () => {
      attempt++;
      changed?.({attempt});
      this.waiting.set(connection, () => { clearTimeout(timer); attempt = 0; void recover(); });
      timer = setTimeout(() => { void recover(); }, guestReconnectDelay(attempt));
    };
    const observe = () => this.monitor(tab.physical, reason => {
      if (!current()) return;
      if (reason === "unavailable") schedule();
      else finish(reason);
    },() => this.listeners.get(connection)?.(),message=>this.peopleListeners.get(connection)?.(message),()=>this.peopleReady.get(connection)?.());
    const recover = async () => {
      this.waiting.delete(connection);
      if (!current()) return;
      try {
        const welcome = await this.restore(connection, current);
        if (!current()) return;
        attempt = 0;
        changed?.(welcome);
        this.listeners.get(connection)?.();
        stop = observe();
      } catch (error) {
        if (!current()) return;
        if (error instanceof RefusedInvite) finish(error instanceof BarredInvite?"expelled":"unavailable");
        else schedule();
      }
    };
    stop = observe();
    return () => {
      disposed = true;
      this.waiting.delete(connection);
      clearTimeout(timer);
      stop?.();
    };
  }

  async removePerson(connection:string,client:number) {
    const tab=this.tabs.get(connection);
    if(!tab || tab.ended)throw new Error("The open file isn't in a live session");
    const response=await fetch("/api/online-files/people",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({file:tab.file,tab:tab.physical,client})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error ?? "Could not remove the participant");
    if(result.removed!==client || (result.name!==null && typeof result.name!=="string"))throw new Error("Invalid participant removal receipt");
    return {removed:client,name:result.name as string|null};
  }

  async report(connection: string, text: string) {
    const reason = participantReportReason(text);
    const tab = this.tabs.get(connection);
    if (!tab || tab.ended) throw new Error("Join a file on a FigCraft server first");
    const response = await fetch("/api/online-files/report", {method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({connection:tab.physical,reason})});
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(typeof result?.error === "string" ? result.error : "The report could not be saved");
    }
  }

  retryNow(connection: string) { this.waiting.get(connection)?.(); }

  // The logical editor tab survives reconnects. A new physical grant lets an
  // interrupted or superseded request release only its own database connection.
  private async restore(connection: string, current: () => boolean) {
    const tab = this.tabs.get(connection);
    if (!tab) throw new Error("The session tab closed");
    const physical = crypto.randomUUID();
    try {
      const {access, client, room, bytes,welcome,canRemovePeople} = await this.redeem(physical, tab);
      if (this.tabs.get(connection) !== tab || !current()) throw new Error("The session tab closed");
      const previous = tab.physical;
      tab.physical = physical;
      tab.room=room;tab.client=client;tab.archive=bytes;tab.welcome=welcome;
      void this.release(previous).catch(() => undefined);
      return { access, client, room,canRemovePeople };
    } catch (error) {
      // A lost response may have created this grant. The idle deadline also
      // covers the case where the network is unavailable for the release.
      void this.release(physical).catch(() => undefined);
      throw error;
    }
  }

  async rejoin(connection: string) {
    const tab = this.tabs.get(connection);
    if (!tab?.ended) throw new Error("The session cannot be rejoined");
    const access = await this.restore(connection, () => this.tabs.get(connection) === tab);
    tab.ended = false;
    return access;
  }

  private async release(physical: string) {
    const response = await fetch("/api/online-files/leave", { method: "POST", signal: AbortSignal.timeout(5000), headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection: physical }) });
    if (!response.ok) throw new Error("Could not leave the session");
  }

  async leave(connection: string) {
    const pending=this.pending.delete(connection);
    if(pending)this.stage?.(connection,null);
    const tab = this.tabs.get(connection);
    this.tabs.delete(connection);
    // Leaving is final on the device even when the server cannot be reached.
    // A missed leave expires under the same deadline as an abruptly closed page.
    if (pending && !tab)return;
    if (!tab?.ended) await this.release(tab?.physical ?? connection).catch(() => undefined);
  }
}
