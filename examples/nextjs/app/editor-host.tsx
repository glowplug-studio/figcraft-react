"use client";

import {browserOnlineHost} from "../lib/sharing/browser-online-host";
import "@glowplug-studio/figcraft-react/fonts.css";
import { useEffect, useRef, useState } from "react";
import { DisplayNameField, WorkspaceEditor, FigcraftRoot, IndexedDbRecoveryStore, type OnlineWorkspaceHost, type IdentitySnapshot, type DocumentCapability } from "@glowplug-studio/figcraft-react";
import { SupabaseIdentityAdapter } from "@glowplug-studio/figcraft-react/backends/supabase";
import type { BrowserInvitations } from "../lib/sharing/browser-invites";
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
  const joinAttempt=useRef<string|undefined>(undefined);
  const joinDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const next = new SupabaseIdentityAdapter(getBrowserSupabase().auth, identity);
    const store = new IndexedDbRecoveryStore();
    const server = supabaseConfig().url.replace(/\/+$/, "");
    const host=browserOnlineHost(getBrowserSupabase(),store,identity.principal.id,server,()=>{
      setJoinError(""); joinDialog.current?.showModal();
    },setError);
    setInviteHost(host.invitations);
    setOnline(host);
    setRecovery(store);
    setAdapter(next);
    const unsubscribe = next.subscribe(snapshot => {
      if (snapshot.status === "signedOut") router.replace("/login");
      else if (snapshot.status === "authenticated" && snapshot.principal.id !== identity.principal.id) router.refresh();
    });
    void next.refresh();
    return () => { unsubscribe(); host.invitations.dispose(); next.dispose(); store.close(); };
  }, [identity, router]);
  function cancelJoin() {
    const connection=joinAttempt.current;
    joinAttempt.current=undefined;
    if(connection)void inviteHost?.leave(connection);
    setJoining(false);
    joinDialog.current?.close();
  }
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
      onCancel={event => { event.preventDefault();cancelJoin(); }}
      onClose={event => event.currentTarget.querySelector("form")?.reset()}>
      <form onSubmit={async event => {
        event.preventDefault();
        if (!inviteHost || joining) return;
        const form = event.currentTarget;
        setJoining(true); setJoinError("");
        let connection:string|undefined;
        try {
          const attempt=inviteHost.beginJoin(String(new FormData(form).get("invite") ?? ""));
          connection=attempt.connection;joinAttempt.current=connection;
          await attempt.completed;
          if(joinAttempt.current===connection)joinDialog.current?.close();
        } catch (error) {
          if(joinAttempt.current===connection)setJoinError(error instanceof Error ? error.message : "The invite is unavailable");
        } finally {
          if(joinAttempt.current===connection){joinAttempt.current=undefined;setJoining(false);}
        }
      }}>
        <h2>Join live session</h2><DisplayNameField principal={identity.principal.id}/><label>Invite link or code<input name="invite" required autoComplete="off" /></label>
        {joinError && <p role="alert">{joinError}</p>}
        <button disabled={joining}>Join</button><button type="button" onClick={cancelJoin}>Cancel</button>
      </form>
    </dialog>
    <FigcraftRoot>{adapter && recovery ? <WorkspaceEditor key={identity.principal.id} identity={adapter} capabilities={localCapabilities} recoveryStore={recovery} onlineHost={online} /> : <p role="status">Opening editor…</p>}</FigcraftRoot>
  </main>;
}
