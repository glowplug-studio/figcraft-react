import { joinLiveFile } from "@glowplug-studio/figcraft-react/backends/supabase/live-session";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export class UnavailableInvite extends Error {}

export async function readSharedDrawing(user: SupabaseClient, writer: SupabaseClient, principal: string,
  session: string, tab: string, file: string, token: string, resume?: string, peerLimit = 256) {
  const digest = createHash("sha256").update(token).digest("hex");
  const resumeHash = createHash("sha256").update(resume ? "resume:" + resume : "tab:" + tab).digest("hex");
  const grant = await joinLiveFile(writer, { actor: principal, auth_session: session, tab, target: file,
    presented_hash: digest, resume_hash: resumeHash, peer_limit: peerLimit }).catch(error => {
    if (error?.code === "42501") throw new UnavailableInvite("The invite is unavailable");
    throw error;
  });
  // Use the guest's Storage client so RLS checks the live link and Auth session.
  const snapshot = await user.storage.from("figcraft-files").download(grant.path);
  if (snapshot.error) throw new Error("The shared drawing is unavailable");
  // A leave or revocation during the download must not recreate the tab.
  const current = await writer.from("online_file_connections").select("id, online_file_links!inner()")
    .eq("id", tab).eq("principal_id", principal).eq("session_id", session)
    .eq("online_file_links.file_id", file).eq("online_file_links.token_hash", digest).maybeSingle();
  if (current.error) throw new Error("The session could not be reached");
  if (!current.data) throw new UnavailableInvite("The invite is unavailable");
  const live = await user.rpc("online_connection_active", {tab});
  if (live.error || live.data !== true) throw new Error("The session timed out");
  return { access: grant.access, bytes: snapshot.data, client: grant.client };
}
