import { isSharedCredentials, type DeviceOwnerSharing, type IndexedDbRecoveryStore, type OnlineGuestSession,
  type OnlineOwnerSharing, type OwnerShareSummary, type PendingSharingChange } from "@glowplug-studio/figcraft-react";
import { nativeInviteLink, parseInviteServer } from "@glowplug-studio/figcraft-react/sharing/invite";

const summary = (row: DeviceOwnerSharing): OwnerShareSummary => ({
  codes: Object.fromEntries(row.links.map(link => [link.access, link.code])),
  ...(row.pending && {pending: row.pending.seed === null ? "stop" : "start"}),
});

async function post(file: string, body: Record<string, unknown>) {
  return fetch("/api/online-files/sharing", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({file, ...body})});
}

export class BrowserOwnerSharing implements OnlineOwnerSharing {
  constructor(private device: IndexedDbRecoveryStore, private principal: string, private server: string) {}
  private record(file: string, update?: (row: DeviceOwnerSharing) => DeviceOwnerSharing) {
    return this.device.ownerSharing(this.principal, this.server, file, update);
  }
  private async status(file: string) {
    const response = await post(file, {action: "status"});
    if (!response.ok) throw new Error("The file is unavailable");
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
    return summary(row);
  }
  private async submit(file: string, pending: PendingSharingChange) {
    const response = await post(file, {action: "change", ...pending});
    if (!response.ok) {
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
    if (!!row.links.length === enabled) return summary(row);
    const state = await this.status(file);
    row = await this.record(file, now => {
      if (now.pending || !!now.links.length === enabled) return now;
      const seed = enabled ? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("") : null;
      return {...now, pending: {expected: state.revision, revision: crypto.randomUUID(), seed,
        revoke: now.links.map(link => link.id).filter(id => state.ids.includes(id))}};
    });
    if (row.pending) row = await this.submit(file, row.pending);
    if (!!row.links.length !== enabled) throw new Error("Sharing changed elsewhere");
    return summary(row);
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
