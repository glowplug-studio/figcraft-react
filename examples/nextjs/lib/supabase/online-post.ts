import { createClient } from "@supabase/supabase-js";
import { getServerSupabase } from "./server";
import { supabaseConfig } from "./config";

export async function onlinePost(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || !URL.canParse(origin) || new URL(origin).host !== host
      || request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return new Response(null, { status: 415 });
  const user = await getServerSupabase();
  const actor = await user.auth.getClaims();
  if (actor.error || !actor.data?.claims.sub) return new Response(null, { status: 401 });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return Response.json({ error: "Online files are unavailable" }, { status: 503 });
  const writer = createClient(supabaseConfig().url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user, writer, principal: actor.data.claims.sub, session: actor.data.claims.session_id };
}
