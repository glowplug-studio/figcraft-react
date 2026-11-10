import { createClient } from "@supabase/supabase-js";
import { finaliseOnlineFile } from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import { getServerSupabase } from "../../../lib/supabase/server";
import { supabaseConfig } from "../../../lib/supabase/config";

export async function POST(request: Request) {
  // Next can reconstruct request.url with its internal listener hostname.
  const origin = request.headers.get("origin");
  const publicHost = request.headers.get("host");
  if (!origin || !publicHost || !URL.canParse(origin) || new URL(origin).host !== publicHost
      || request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return new Response(null, { status: 415 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || body.id.length !== 36) {
    return Response.json({ error: "Invalid online file identity" }, { status: 400 });
  }
  const user = await getServerSupabase();
  const actor = await user.auth.getClaims();
  if (actor.error || !actor.data?.claims.sub) return new Response(null, { status: 401 });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return Response.json({ error: "Online publication is unavailable" }, { status: 503 });
  const writer = createClient(supabaseConfig().url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const listing = await finaliseOnlineFile(user, writer, body.id);
    return Response.json(listing, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "The online file could not be published" }, { status: 422 });
  }
}
