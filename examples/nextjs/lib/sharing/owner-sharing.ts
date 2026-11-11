import { isSharedCredentials, type DeviceOwnerSharing, type IndexedDbRecoveryStore, type OnlineGuestSession,
  type OnlineOwnerSharing, type OwnerShareSummary, type SessionDetails, type PendingSharingChange } from "@glowplug-studio/figcraft-react";
import { nativeInviteLink, parseInviteServer } from "@glowplug-studio/figcraft-react/sharing/invite";

const summary = (row: DeviceOwnerSharing): OwnerShareSummary => ({
  codes: Object.fromEntries(row.links.map(link => [link.access, link.code])),
  ...(row.pending && {pending: row.pending.seed === null ? "stop" : "start"}),
});

export class BrowserOwnerSharing implements OnlineOwnerSharing {
  private readonly shares=new Map<string,NonNullable<SessionDetails["share"]>>();
  access(file:string) {return this.shares.get(file)?.access ?? "edit";}
  selectAccess(file:string,access:OnlineGuestSession["access"]) {
    const share=this.shares.get(file);
    if(share) this.shares.set(file,{...share,access});
  }
  inspect(file:string,recorded=false):SessionDetails["share"] {
    const share=this.shares.get(file);
    if(share)return {...share};
    if(recorded)return {via:"online",access:"edit",shared:false,editCode:null,viewCode:null,commentCode:null,
      editLink:null,viewLink:null,commentLink:null};
  }
  private observed(file:string,row:DeviceOwnerSharing,changed=false) {
    if(changed || row.links.length || this.shares.has(file)) {
      const server=parseInviteServer(this.server.replace(/^http/, "ws")).server;
      const way=(access:OnlineGuestSession["access"])=>{
        const entry=row.links.find(link=>link.access===access);
        return {code:entry?.code ?? null,link:entry ? nativeInviteLink({kind:"link",file,server,token:entry.token}) : null};
      };
      const edit=way("edit"),view=way("view"),comment=way("comment");
      this.shares.set(file,{via:"online",access:this.access(file),shared:!!edit.link,editCode:edit.code,
        commentCode:comment.code,viewCode:view.code,editLink:edit.link,commentLink:comment.link,viewLink:view.link});
    }
    return summary(row);
  }

  constructor(private device: Pick<IndexedDbRecoveryStore,"ownerSharing">, private principal: string,
    private server: string, private operatorKey?: (file: string) => string | undefined) {}

  private post(file: string, body: Record<string, unknown>) {
    const serverKey = this.operatorKey?.(file);
    return fetch("/api/online-files/sharing", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({file, ...body, ...(serverKey !== undefined && {serverKey})})});
  }
  private record(file: string, update?: (row: DeviceOwnerSharing) => DeviceOwnerSharing) {
    return this.device.ownerSharing(this.principal, this.server, file, update);
  }
  private async status(file: string) {
    const response = await this.post(file, {action: "status"});
    if (!response.ok) {
      const reason = response.status === 403 ? await response.json().catch(() => null) : null;
      throw new Error(typeof reason?.error === "string" ? reason.error : "The file is unavailable");
    }
    const state: {revision: string | null; ids: string[]} = await response.json();
    return state;
  }
  async read(file: string, refresh = false) {
    let row = await this.record(file);
    if (refresh && row.links.length && !row.pending) {
      const status = await this.status(file);
      const observed = row.links.map(link => link.id);
      if (!observed.every(id => status.ids.includes(id))) {
        row = await this.record(file, now => !now.pending && now.links.length === observed.length
          && now.links.every(link => observed.includes(link.id)) ? {links: []} : now);
      }
    }
    return this.observed(file,row);
  }
  private async submit(file: string, pending: PendingSharingChange) {
    const response = await this.post(file, {action: "change", ...pending});
    if (!response.ok) {
      if (response.status === 429) {
        const refusal = await response.json().catch(() => null);
        throw new Error(typeof refusal?.error === "string" ? refusal.error : "Try sharing again in a minute");
      }
      if ([400, 403, 409, 422].includes(response.status)) {
        await this.record(file, row => row.pending?.revision === pending.revision ? {links: row.links} : row);
      }
      throw new Error(response.status === 409 ? "Sharing changed elsewhere" : "The sharing change could not be completed");
    }
    const {links} = await response.json();
    if (!isSharedCredentials(links) || links.length !== (pending.seed === null ? 0 : 3)) throw new Error("Invalid sharing receipt");
    return this.record(file, row => row.pending?.revision === pending.revision ? {links} : row);
  }
  async change(file: string, enabled: boolean) {
    let row = await this.record(file);
    if (row.pending) row = await this.submit(file, row.pending);
    if (!!row.links.length === enabled) return this.observed(file,row,true);
    const state = await this.status(file);
    row = await this.record(file, now => {
      if (now.pending || !!now.links.length === enabled) return now;
      const seed = enabled ? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("") : null;
      return {...now, pending: {expected: state.revision, revision: crypto.randomUUID(), seed,
        revoke: now.links.map(link => link.id).filter(id => state.ids.includes(id))}};
    });
    if (row.pending) row = await this.submit(file, row.pending);
    if (!!row.links.length !== enabled) throw new Error("Sharing changed elsewhere");
    return this.observed(file,row,true);
  }
  async copy(file: string, access: OnlineGuestSession["access"], format: "code" | "link") {
    const row = await this.record(file);
    const grant = row.links.find(link => link.access === access);
    if (!grant) throw new Error("This device does not have that shared link");
    const server = parseInviteServer(this.server.replace(/^http/, "ws")).server;
    const link = nativeInviteLink({kind: "link", file, server, token: grant.token});
    await navigator.clipboard.writeText(format === "code" ? grant.code : location.origin + "/#join=" + encodeURIComponent(link));
  }
}
