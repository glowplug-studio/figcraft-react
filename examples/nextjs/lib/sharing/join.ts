import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function readSharedDrawing(user: SupabaseClient, writer: SupabaseClient, principal: string,
  session: string, tab: string, file: string, token: string) {
  const digest = createHash("sha256").update(token).digest("hex");
  const grant = await writer.rpc("join_online_file", {
    actor: principal, auth_session: session, tab, target: file, presented_hash: digest,
  }).single<{object_path: string; access_level: "view" | "edit" | "comment"}>();
  if (grant.error) throw new Error("The invite is unavailable");
  // Use the guest's Storage client so RLS checks the live link and Auth session.
  const snapshot = await user.storage.from("figcraft-files").download(grant.data.object_path);
  if (snapshot.error) throw new Error("The shared drawing is unavailable");
  // A leave or revocation during the download must not recreate the tab.
  const current = await writer.from("online_file_connections").select("id, online_file_links!inner()")
    .eq("id", tab).eq("principal_id", principal).eq("session_id", session)
    .eq("online_file_links.file_id", file).eq("online_file_links.token_hash", digest).maybeSingle();
  if (current.error || !current.data) throw new Error("The invite is unavailable");
  return { access: grant.data.access_level, bytes: snapshot.data };
}
