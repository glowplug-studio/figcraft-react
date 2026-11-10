import type { IndexedDbRecoveryStore, OnlineGuestSession, OnlineInvitations } from "@glowplug-studio/figcraft-react";
import { nativeInviteLink, parseInviteServer, parseSessionInvite } from "@glowplug-studio/figcraft-react/sharing/invite";

export const inviteAfterLogin = "figcraft-join-after-login";

export class BrowserInvitations implements OnlineInvitations {
  private listener?: (session: OnlineGuestSession, bytes: Blob) => Promise<void>;
  private readonly endpoint;
  private joining = false;

  constructor(private device: IndexedDbRecoveryStore, private principal: string, private server: string,
    readonly showJoin: () => void, private report: (message: string) => void) {
    this.endpoint = parseInviteServer(server.replace(/^http/, "ws")).server;
  }

  subscribe(listener: (session: OnlineGuestSession, bytes: Blob) => Promise<void>) {
    this.listener = listener;
    queueMicrotask(() => {
      if (this.listener !== listener) return;
      let fragment = location.hash;
      try {
        if (!fragment.startsWith("#join=")) fragment = sessionStorage.getItem(inviteAfterLogin) ?? "";
        sessionStorage.removeItem(inviteAfterLogin);
      } catch { /* A link on this page can still be opened without session storage. */ }
      if (!fragment.startsWith("#join=")) return;
      history.replaceState(history.state, "", location.pathname + location.search);
      void this.join(fragment).catch(() => this.report("The invite could not be opened"));
    });
    return () => { if (this.listener === listener) this.listener = undefined; };
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
    const invite = parseSessionInvite(input);
    if (invite.server.secure !== this.endpoint.secure || invite.server.host.toLowerCase() !== this.endpoint.host.toLowerCase()
        || invite.server.path !== this.endpoint.path) {
      throw new Error("This invite belongs to another server");
    }
    if (invite.kind !== "link") throw new Error("This host requires an invite link for this session");
    this.joining = true;
    const connection = crypto.randomUUID();
    let attached = false;
    try {
      const response = await fetch("/api/online-files/join", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab: connection, file: invite.file, token: invite.token }) });
      if (!response.ok) throw new Error("The invite is unavailable");
      const access = response.headers.get("X-Figcraft-Access");
      if (access !== "view" && access !== "edit" && access !== "comment") throw new Error("Invalid session access");
      const bytes = await response.blob();
      if (this.listener !== receive) throw new Error("The signed-in workspace changed");
      await receive({ file: invite.file, connection, access }, bytes);
      attached = true;
    } finally {
      this.joining = false;
      if (!attached) await this.leave(connection).catch(() => undefined);
    }
  }

  async leave(connection: string) {
    const response = await fetch("/api/online-files/leave", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection }) });
    if (!response.ok) throw new Error("Could not leave the session");
  }
}
