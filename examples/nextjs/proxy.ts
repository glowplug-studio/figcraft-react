import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { loginLocation } from "./lib/auth";
import { supabaseConfig } from "./lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = supabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cacheHeaders ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path === "/auth/callback" || path === "/auth/logout";
  if (!isPublic && (error || typeof data?.claims.sub !== "string" || !data.claims.sub)) {
    const destination = `${path}${request.nextUrl.search}`;
    const redirected = NextResponse.redirect(new URL(loginLocation(destination), request.url));
    response.cookies.getAll().forEach((cookie) => redirected.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirected.headers.set(header, value);
    }
    response = redirected;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
