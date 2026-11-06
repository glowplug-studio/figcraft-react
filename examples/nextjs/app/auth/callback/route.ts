import { NextResponse, type NextRequest } from "next/server";
import { loginLocation, safeDestination } from "../../../lib/auth";
import { getServerSupabase } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeDestination(request.nextUrl.searchParams.get("next"));
  let target = loginLocation(destination, "callback");
  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) target = destination;
  }
  const response = NextResponse.redirect(new URL(target, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
