import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseBackendOptions {
  url: string;
  publishableKey: string;
}

/** Creates an unprivileged client supplied explicitly by the embedding host. */
export function createSupabaseBackend({
  url,
  publishableKey,
}: SupabaseBackendOptions): SupabaseClient {
  return createClient(url, publishableKey);
}
export { SupabaseIdentityAdapter } from "./identity";
export { SupabaseOnlineFileStore, stageOnlineSnapshot } from "./online-files";
export { isPublishedLinkDigests, publishedLinkDigests } from "../published-links";
export { watchSupabaseGuest } from "./guest-session";
