import {stageOnlineSnapshot} from "@glowplug-studio/figcraft-react/backends/supabase";
import type {IndexedDbRecoveryStore,OnlineTeamLibraries,TeamLibraryReply,LibraryUsageReport,LibraryUsageSummary} from "@glowplug-studio/figcraft-react";
import {nativeInviteLink,parseInviteServer,parseSessionInvite} from "@glowplug-studio/figcraft-react/sharing/invite";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {BrowserInvitations} from "./browser-invites";

export class BrowserTeamLibraries implements OnlineTeamLibraries {
  private readonly endpoint;
  constructor(private device: IndexedDbRecoveryStore,private principal: string,private server: string,
    private user: SupabaseClient,private invitations: BrowserInvitations) {
    this.endpoint = parseInviteServer(server.replace(/^http/,"ws")).server;
  }
  fromSession(connection: string) { return this.fromInvite(this.invitations.libraryInvite(connection)); }
  async fromInvite(text: string) {
    let value = text.trim();
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.origin !== location.origin || !url.hash.startsWith("#join=")) throw new Error("This link belongs to another host");
      value = decodeURIComponent(url.hash.slice(6));
    }
    const grant = parseSessionInvite(value);
    if (grant.kind !== "link" || grant.server.host.toLowerCase()!==this.endpoint.host.toLowerCase()
      || grant.server.path!==this.endpoint.path || grant.server.secure!==this.endpoint.secure) throw new Error("Choose a file link from this server");
    const invite = nativeInviteLink(grant);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(invite)));
    const path = "team-library:" + Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
    await this.device.teamLibraryInvite(this.principal,this.server,path,invite);
    return path;
  }
  private async post(path: string, body: Record<string,unknown>) {
    const invite = await this.device.teamLibraryInvite(this.principal,this.server,path);
    if (!invite) throw new Error("Enter the team library link for this device");
    const grant = parseSessionInvite(invite);
    if (grant.kind!=="link") throw new Error("Invalid team library link");
    const response = await fetch("/api/online-files/library",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...body,file:grant.file,token:grant.token})});
    if (!response.ok) {
      const reason = await response.json().catch(()=>null);
      throw Object.assign(new Error(typeof reason?.error==="string" ? reason.error : "The library request failed"),{status:response.status});
    }
    return response;
  }
  trusted(remember?:string) { return this.device.trustedTeamLibraries(this.principal,this.server,remember); }
  async usage(path:string,days:number):Promise<LibraryUsageSummary> {
    return (await this.post(path,{action:"usage",days})).json();
  }
  async fetch(path: string, have: string | null, usage?:LibraryUsageReport): Promise<TeamLibraryReply> {
    const response = await this.post(path,{action:"fetch",have,...(usage && {usage})});
    const version = response.headers.get("X-Figcraft-Library-Version");
    if (version !== null) return {state:"available",version,archive:await response.blob()};
    const result = await response.json();
    if (result?.state==="empty" || (have !== null && result?.state==="unchanged" && result.version===have)) return result;
    throw new Error("Invalid library receipt");
  }
  async publish(path: string, archive: Blob, submission: string) {
    await stageOnlineSnapshot(this.user,this.principal,submission,archive);
    const receipt = await (await this.post(path,{action:"publish",submission})).json();
    if (typeof receipt?.version !== "string") throw new Error("Invalid library receipt");
    return receipt.version;
  }
}
