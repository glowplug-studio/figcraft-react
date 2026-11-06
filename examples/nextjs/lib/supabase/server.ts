import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { IdentitySnapshot } from "@glowplug-studio/figcraft-react";
import { loginLocation } from "../auth";
import { supabaseConfig } from "./config";

/** Never share a server client between requests. Proxy owns refresh response headers. */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseConfig();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts refreshes them first.
        }
      },
    },
  });
}

export async function requireIdentity(destination = "/"): Promise<Extract<IdentitySnapshot, { status: "authenticated" }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims.sub !== "string" || !data.claims.sub) redirect(loginLocation(destination));
  return { status: "authenticated", principal: { id: data.claims.sub }, revision: "server" };
}
