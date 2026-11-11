"use client";

import "@glowplug-studio/figcraft-react/fonts.css";
import { useEffect, useRef, useState } from "react";
import { DisplayNameField, WorkspaceEditor, FigcraftRoot, IndexedDbRecoveryStore, type OnlineWorkspaceHost, type DeviceOwnerSharing, type IdentitySnapshot, type DocumentCapability } from "@glowplug-studio/figcraft-react";
import { SupabaseIdentityAdapter, SupabaseOnlineFileStore, publishedLinkDigests, watchSupabaseGuest } from "@glowplug-studio/figcraft-react/backends/supabase";
import { BrowserTeamLibraries } from "../lib/sharing/team-libraries";
import { BrowserOwnerSharing } from "../lib/sharing/owner-sharing";
import { BrowserInvitations } from "../lib/sharing/browser-invites";
import { useRouter } from "next/navigation";
import { supabaseConfig } from "../lib/supabase/config";
import { getBrowserSupabase } from "../lib/supabase/browser";

const localCapabilities: readonly DocumentCapability[] = Object.freeze(["document.read", "document.edit", "document.comment"]);

export function EditorHost({ identity }: { identity: Extract<IdentitySnapshot, { status: "authenticated" }> }) {
  const router = useRouter();
  const [adapter, setAdapter] = useState<SupabaseIdentityAdapter | null>(null);
  const [recovery, setRecovery] = useState<IndexedDbRecoveryStore | null>(null);
  const [online, setOnline] = useState<OnlineWorkspaceHost>();
  const [error, setError] = useState("");
  const [inviteHost, setInviteHost] = useState<BrowserInvitations>();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const joinDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const next = new SupabaseIdentityAdapter(getBrowserSupabase().auth, identity);
    const store = new IndexedDbRecoveryStore();
    const server = supabaseConfig().url.replace(/\/+$/, "");
    let currentKey = "";
    const operators = new Map<string, {pair: Awaited<ReturnType<typeof store.publicationLinks>>;
      sharing: DeviceOwnerSharing}>();
    const sharing = new BrowserOwnerSharing({
      ownerSharing: async (principal,address,file,update) => {
        const operator = operators.get(file);
        if (!operator) return store.ownerSharing(principal,address,file,update);
        if (update) operator.sharing = update(operator.sharing);
        return operator.sharing;
      },
    }, identity.principal.id, server, file => operators.has(file) ? currentKey : undefined);
    const files = new SupabaseOnlineFileStore(getBrowserSupabase(), identity.principal.id, async (id,serverKey) => {
      const pair = await store.publicationLinks(identity.principal.id,server,id);
      const links = await publishedLinkDigests(pair);
      const response = await fetch("/api/online-files", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, links, ...(serverKey && {serverKey}) }),
      });
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
    }, identity.principal.id, server,
      (connection, ended, edits) => watchSupabaseGuest(getBrowserSupabase(), connection, ended, edits), () => {
      setJoinError(""); joinDialog.current?.showModal();
    }, setError, file => files.resolveTeamFile(file));
    setInviteHost(invites);
    setOnline({ server, libraries:new BrowserTeamLibraries(store,identity.principal.id,server,getBrowserSupabase(),invites), supportsServerKey:true, serverKeyChanged:key => { currentKey = key; }, releasePublished:file => { operators.delete(file); }, store: files, device: store, invitations: invites, sharing });
    setRecovery(store);
    setAdapter(next);
    const unsubscribe = next.subscribe(snapshot => {
      if (snapshot.status === "signedOut") router.replace("/login");
      else if (snapshot.status === "authenticated" && snapshot.principal.id !== identity.principal.id) router.refresh();
    });
    void next.refresh();
    return () => { unsubscribe(); next.dispose(); store.close(); };
  }, [identity, router]);
  async function logout() {
    setError("");
    const { error: failure } = await getBrowserSupabase().auth.signOut();
    if (failure) { setError("Sign-out failed. Try again."); return; }
    router.replace("/login");
    router.refresh();
  }
  return <main>
    <header className="host-bar"><p>Figcraft React</p><button onClick={logout}>Sign out</button></header>
    {error && <p role="alert">{error}</p>}
    <dialog ref={joinDialog} aria-label="Join live session" className="figcraft-online-dialog"
      onCancel={event => { if (joining) event.preventDefault(); }}
      onClose={event => event.currentTarget.querySelector("form")?.reset()}>
      <form onSubmit={async event => {
        event.preventDefault();
        if (!inviteHost || joining) return;
        const form = event.currentTarget;
        setJoining(true); setJoinError("");
        try {
          await inviteHost.join(String(new FormData(form).get("invite") ?? ""));
          joinDialog.current?.close();
        } catch (error) { setJoinError(error instanceof Error ? error.message : "The invite is unavailable"); }
        finally { setJoining(false); }
      }}>
        <h2>Join live session</h2><DisplayNameField principal={identity.principal.id}/><label>Invite link or code<input name="invite" required autoComplete="off" /></label>
        {joinError && <p role="alert">{joinError}</p>}
        <button disabled={joining}>Join</button><button type="button" disabled={joining} onClick={() => joinDialog.current?.close()}>Cancel</button>
      </form>
    </dialog>
    <FigcraftRoot>{adapter && recovery ? <WorkspaceEditor key={identity.principal.id} identity={adapter} capabilities={localCapabilities} recoveryStore={recovery} onlineHost={online} /> : <p role="status">Opening editor…</p>}</FigcraftRoot>
  </main>;
}
