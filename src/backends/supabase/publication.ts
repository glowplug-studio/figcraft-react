import type { SupabaseClient } from "@supabase/supabase-js";
import { validateOnlineSnapshot } from "../../engine/sharing/publication";
import { onlineFileInfo, onlineSnapshotPath } from "./online-files";

/** Server only. The authenticated client must be able to read the exact staged object. */
export async function finaliseOnlineFile(user: SupabaseClient, writer: SupabaseClient, id: string) {
  const claims = await user.auth.getClaims();
  const principal = claims.data?.claims.sub;
  if (claims.error || !principal) throw new Error("Sign in to publish a file");
  const path = onlineSnapshotPath(principal, id);
  const storage = user.storage.from("figcraft-files");
  const object = await storage.info(path);
  if (object.error) throw object.error;
  const existing = () => user.from("online_files").select("id,name,created_at").eq("id", id)
    .eq("owner_id", principal).eq("snapshot_id", object.data.id).maybeSingle();
  const before = await existing();
  if (before.error) throw before.error;
  if (before.data) return onlineFileInfo(before.data);
  const download = await storage.download(path);
  if (download.error) throw download.error;
  const { name } = await validateOnlineSnapshot(download.data);
  const inserted = await writer.from("online_files").insert({ id, name, owner_id: principal, snapshot_id: object.data.id })
    .select("id,name,created_at").single();
  if (!inserted.error) return onlineFileInfo(inserted.data);
  if (inserted.error.code === "23505") {
    const raced = await existing();
    if (!raced.error && raced.data) return onlineFileInfo(raced.data);
  }
  throw new Error("The online file could not be published");
}
