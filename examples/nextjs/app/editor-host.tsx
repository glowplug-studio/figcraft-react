"use client";

import { useEffect, useState } from "react";
import { Editor, FigcraftRoot, IndexedDbRecoveryStore, type IdentitySnapshot, type DocumentCapability } from "@glowplug-studio/figcraft-react";
import { SupabaseIdentityAdapter } from "@glowplug-studio/figcraft-react/backends/supabase";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "../lib/supabase/browser";

const localCapabilities: readonly DocumentCapability[] = Object.freeze(["document.read", "document.edit"]);

export function EditorHost({ identity }: { identity: Extract<IdentitySnapshot, { status: "authenticated" }> }) {
  const router = useRouter();
  const [adapter, setAdapter] = useState<SupabaseIdentityAdapter | null>(null);
  const [recovery, setRecovery] = useState<IndexedDbRecoveryStore | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const next = new SupabaseIdentityAdapter(getBrowserSupabase().auth, identity);
    const store = new IndexedDbRecoveryStore();
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
    <FigcraftRoot>{adapter && recovery ? <Editor key={identity.principal.id} identity={adapter} capabilities={localCapabilities} recoveryStore={recovery} /> : <p role="status">Opening editor…</p>}</FigcraftRoot>
  </main>;
}
