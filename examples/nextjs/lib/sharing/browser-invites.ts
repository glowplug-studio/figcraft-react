import type { GuestSessionEnd, IndexedDbRecoveryStore, OnlineGuestSession, OnlineInvitations } from "@glowplug-studio/figcraft-react";
import { nativeInviteLink, parseInviteServer, parseSessionInvite } from "@glowplug-studio/figcraft-react/sharing/invite";

export const inviteAfterLogin = "figcraft-join-after-login";

export class BrowserInvitations implements OnlineInvitations {
  private listener?: (session: OnlineGuestSession, bytes: Blob) => Promise<void>;
  private readonly endpoint;
  private joining = false;
  // Retain a manual rejoin credential only while its tab belongs to this signed-in host.
  private readonly tabs = new Map<string, {file: string; token: string; ended: boolean}>();


  constructor(private device: IndexedDbRecoveryStore, private principal: string, private server: string,
    private readonly monitor: NonNullable<OnlineInvitations["watch"]>, readonly showJoin: () => void, private report: (message: string) => void) {
    this.endpoint = parseInviteServer(server.replace(/^http/, "ws")).server;
  }

  subscribe(listener: (session: OnlineGuestSession, bytes: Blob) => Promise<void>) {
    this.listener = listener;
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
      void this.join(fragment).catch(() => this.report("The invite could not be opened"));
    };
    const changed = () => consume(false);
    window.addEventListener("hashchange", changed);
    queueMicrotask(() => consume(true));
    return () => {
      window.removeEventListener("hashchange", changed);
      if (this.listener === listener) this.listener = undefined;
    };
  }

  async copyPublished(file: string, access: "edit" | "view") {
    const links = await this.device.readPublishedLinks(this.principal, this.server, file);
    if (!links) throw new Error("This device does not have those links");
    const link = nativeInviteLink({ kind: "link", server: this.endpoint, file, token: links[access].token });
    await navigator.clipboard.writeText(location.origin + "/#join=" + encodeURIComponent(link));
  }

  async join(text: string) {
    const receive = this.listener;
    if (!receive || this.joining) throw new Error("The editor is busy");
    let input = text.trim();
    if (/^https?:\/\//i.test(input)) {
      const address = new URL(input);
      if (address.origin !== location.origin || !address.hash.startsWith("#join=")) throw new Error("This invite belongs to another host");
      input = address.hash;
    }
    if (input.startsWith("#join=")) {
      try { input = decodeURIComponent(input.slice(6)); } catch { throw new Error("Invalid invite fragment"); }
    }
    const invite = input.includes("://") ? parseSessionInvite(input) : {kind: "code" as const, server: this.endpoint, code: input};
    if (invite.server.secure !== this.endpoint.secure || invite.server.host.toLowerCase() !== this.endpoint.host.toLowerCase()
        || invite.server.path !== this.endpoint.path) {
      throw new Error("This invite belongs to another server");
    }
    if (invite.kind === "team") throw new Error("This host requires an invite link for this session");
    this.joining = true;
    const connection = crypto.randomUUID();
    let attached = false, redeeming = false;
    try {
      const grant = invite.kind === "code" ? await this.lookup(invite.code) : invite;
      if (this.listener !== receive) throw new Error("The signed-in workspace changed");
      redeeming = true;
      const {access, bytes} = await this.redeem(connection, grant);
      if (this.listener !== receive) throw new Error("The signed-in workspace changed");
      this.tabs.set(connection, {file: grant.file, token: grant.token, ended: false});
      await receive({ file: grant.file, connection, access }, bytes);
      attached = true;
    } finally {
      this.joining = false;
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

  private async redeem(connection: string, invite: {file: string; token: string}): Promise<{access: OnlineGuestSession["access"]; bytes: Blob}> {
    const response = await fetch("/api/online-files/join", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: connection, file: invite.file, token: invite.token }) });
    if (!response.ok) throw new Error("The invite is unavailable");
    const access = response.headers.get("X-Figcraft-Access");
    if (access !== "view" && access !== "edit" && access !== "comment") throw new Error("Invalid session access");
    const bytes = await response.blob();
    return {access, bytes};
  }

  watch(connection: string, ended: (reason: GuestSessionEnd) => void) {
    return this.monitor(connection, reason => {
      const tab = this.tabs.get(connection);
      if (tab) tab.ended = true;
      ended(reason);
    });
  }

  async rejoin(connection: string) {
    const tab = this.tabs.get(connection);
    if (!tab?.ended) throw new Error("The session cannot be rejoined");
    const {access} = await this.redeem(connection, tab);
    if (this.tabs.get(connection) !== tab) {
      await this.leave(connection);
      throw new Error("The session tab closed");
    }
    tab.ended = false;
    return access;
  }

  async leave(connection: string) {
    if (this.tabs.get(connection)?.ended) { this.tabs.delete(connection); return; }
    const response = await fetch("/api/online-files/leave", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection }) });
    if (!response.ok) throw new Error("Could not leave the session");
    this.tabs.delete(connection);
  }
}
