"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function getBrowserSupabase() {
  if (!client) {
    const { url, publishableKey } = supabaseConfig();
    client = createBrowserClient(url, publishableKey);
  }
  return client;
}
