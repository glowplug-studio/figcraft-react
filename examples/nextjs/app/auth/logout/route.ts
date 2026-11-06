import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "../../../lib/auth";
import { getServerSupabase } from "../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers.get("origin"), request.url)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) return new NextResponse("Sign-out failed. Try again.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
