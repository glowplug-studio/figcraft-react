import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/** Local-only fixture helper. Never obtains privileged credentials for a hosted project. */
export function localSupabase() {
  const values = Object.fromEntries(readFileSync("examples/nextjs/.env.local", "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#")).map(line => {
    const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
  }));
  const url = values.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "55321") throw new Error("Auth fixtures require the configured local Figcraft stack on 127.0.0.1:55321");
  let status: Record<string, string>;
  try { status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 45_000 })); }
  catch { throw new Error("Local Supabase status discovery failed or exceeded 45 seconds"); }
  if (status.API_URL !== url) throw new Error("Local Supabase project URL mismatch");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return { url, key: values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, client: createClient(url, values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options), admin: createClient(url, status.SECRET_KEY, options) };
}
