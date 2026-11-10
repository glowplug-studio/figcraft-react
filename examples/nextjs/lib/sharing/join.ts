import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function readSharedDrawing(user: SupabaseClient, writer: SupabaseClient, principal: string,
  session: string, tab: string, file: string, token: string) {
  const digest = createHash("sha256").update(token).digest("hex");
  const check = async () => {
    const grant = await writer.rpc("join_online_file", {
      actor: principal, auth_session: session, tab, target: file, presented_hash: digest,
    }).single<{ object_path: string; access_level: "view" | "edit" | "comment" }>();
    if (grant.error) throw new Error("The invite is unavailable");
    return grant.data;
  };
  const grant = await check();
  // Use the guest's Storage client so RLS checks the live link and Auth session.
  const snapshot = await user.storage.from("figcraft-files").download(grant.object_path);
  if (snapshot.error) throw new Error("The shared drawing is unavailable");
  await check();
  return { access: grant.access_level, bytes: snapshot.data };
}
