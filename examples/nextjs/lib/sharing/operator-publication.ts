import {createHash, timingSafeEqual} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {PublicationKeyError} from "@glowplug-studio/figcraft-react/backends/supabase/publication";

/** Compare fixed-length hashes. The host keeps its verifier separate from participant-facing settings. */
export async function verifyServerKey(user: SupabaseClient, writer: SupabaseClient, supplied: unknown) {
  const policy = await user.rpc("online_host_information", {target:null}).single<{open_publish:boolean; file_mb:number}>();
  if (policy.error) throw policy.error;
  const {data, error} = await writer.rpc("operator_publication_verifier");
  if (error) throw error;
  if (typeof supplied !== "string" || !supplied || [...supplied].length > 128
    || typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)
    || !timingSafeEqual(createHash("sha256").update(supplied).digest(), Buffer.from(data, "hex"))) {
    throw new PublicationKeyError(policy.data.open_publish
      ? "Wrong server key. This server is open to the public: publish without a key." : "Wrong server key");
  }
  return policy.data;
}
