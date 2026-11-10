import { isIP } from "node:net";
import { parseJoinCode } from "@glowplug-studio/figcraft-react/sharing/join-code";
import type { SupabaseClient } from "@supabase/supabase-js";

/** On other hosts all requests share a conservative bucket until a trusted ingress is configured. */
export function codeLookupAddress(headers: Headers, vercel: boolean) {
  const address = vercel && headers.get("x-vercel-forwarded-for");
  return address && isIP(address) ? address : "127.0.0.1";
}

export async function lookupCode(writer: SupabaseClient, address: string, typed: string) {
  let symbols: string | null = null;
  try {
    const parsed = parseJoinCode(typed);
    if (parsed.kind === "online") symbols = parsed.code;
  } catch { /* Malformed attempts also spend the native address and global budgets. */ }
  const {data, error} = await writer.rpc("lookup_online_code", {address, symbols});
  if (error || !data || typeof data !== "object") throw new Error("Code lookup unavailable");
  if (typeof data.file === "string" && typeof data.token === "string") {
    return {status: 200, body: {file: data.file, token: data.token}};
  }
  switch (data.status) {
    case "gone": return {status: 410, body: {error: "That code has expired or its sharing was stopped"}};
    case "unknown": return {status: 404, body: {error: "No session with that code"}};
    case "locked": return {status: 429, body: {error: `Too many wrong codes from your address: try again in ${data.minutes} minutes, or join with the invite link`}};
    case "rate": return {status: 429, body: {error: "Too many codes tried from your address: wait a minute and try again"}};
    case "busy": return {status: 429, body: {error: "Join codes are paused on this server for a while (too many wrong ones were tried): join with the invite link"}};
    default: throw new Error("Invalid code lookup receipt");
  }
}
