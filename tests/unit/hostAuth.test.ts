import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isSameOriginRequest, loginLocation, safeDestination } from "../../examples/nextjs/lib/auth";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  signOut: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  createServerClient: vi.fn(),
  cookieGetAll: vi.fn(() => []),
  cookieSet: vi.fn(),
  redirect: vi.fn((location: string): never => { throw new Error(`redirect:${location}`); }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: mocks.cookieGetAll, set: mocks.cookieSet }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requireIdentity } from "../../examples/nextjs/lib/supabase/server";
import { proxy } from "../../examples/nextjs/proxy";
import { POST as logout } from "../../examples/nextjs/app/auth/logout/route";
import { GET as callback } from "../../examples/nextjs/app/auth/callback/route";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims, signOut: mocks.signOut, exchangeCodeForSession: mocks.exchangeCodeForSession } });
  mocks.redirect.mockImplementation((location: string): never => { throw new Error(`redirect:${location}`); });
}

describe("host redirect boundaries", () => {
  it("retains safe paths and query strings", () => {
    expect(safeDestination("/editor?file=1")).toBe("/editor?file=1");
    expect(loginLocation("/editor?file=1")).toBe("/login?next=%2Feditor%3Ffile%3D1");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/\n/evil.example", "/%00evil", "/login", "/auth/logout", undefined])("rejects unsafe or looping destination %s", (destination) => {
    expect(safeDestination(destination)).toBe("/");
  });
  it("requires an explicit matching origin for logout", () => {
    expect(isSameOriginRequest("https://app.example", "https://app.example/auth/logout")).toBe(true);
    expect(isSameOriginRequest("https://evil.example", "https://app.example/auth/logout")).toBe(false);
    expect(isSameOriginRequest(null, "https://app.example/auth/logout")).toBe(false);
  });
});

describe("validated server identity", () => {
  it("protects routes with getClaims and exposes only the stable subject", async () => {
    configure();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "verified-id", user_metadata: { role: "admin" } } }, error: null });
    expect(await requireIdentity()).toEqual({ status: "authenticated", principal: { id: "verified-id" }, revision: "server" });
    expect(mocks.getClaims).toHaveBeenCalledOnce();
  });
  it("redirects missing or rejected identity to login with its destination", async () => {
    configure();
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("not authenticated") });
    await expect(requireIdentity("/editor?file=1")).rejects.toThrow("redirect:/login?next=%2Feditor%3Ffile%3D1");
  });
});

describe("proxy refresh and public routes", () => {
  it("protects the editor while keeping login and callback public", async () => {
    configure();
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    const protectedResponse = await proxy(new NextRequest("http://localhost:3000/?test=1"));
    expect(protectedResponse.status).toBe(307);
    expect(protectedResponse.headers.get("location")).toContain("/login?next=%2F%3Ftest%3D1");
    expect(protectedResponse.headers.get("cache-control")).toBe("private, no-store");
    expect((await proxy(new NextRequest("http://localhost:3000/login"))).status).toBe(200);
    expect((await proxy(new NextRequest("http://localhost:3000/auth/callback"))).status).toBe(200);
  });
  it("copies refreshed cookies and cache headers onto a denied-route redirect", async () => {
    configure();
    mocks.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: { setAll: (cookies: { name: string; value: string; options: { path: string; httpOnly: boolean } }[], headers: Record<string, string>) => void } }) => ({
      auth: { getClaims: async () => {
        options.cookies.setAll([{ name: "session", value: "refreshed", options: { path: "/", httpOnly: true } }], { Pragma: "no-cache", Expires: "0" });
        return { data: null, error: null };
      } },
    }));
    const request = new NextRequest("http://localhost:3000/");
    const response = await proxy(request);
    expect(request.cookies.get("session")?.value).toBe("refreshed");
    expect(response.cookies.get("session")?.value).toBe("refreshed");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});

describe("callback and logout", () => {
  it("fails safely when a callback code is absent or rejected", async () => {
    configure();
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid code") });
    const absent = await callback(new NextRequest("http://localhost:3000/auth/callback?next=//evil.example"));
    expect(absent.headers.get("location")).toBe("http://localhost:3000/login?next=%2F&error=callback");
    const invalid = await callback(new NextRequest("http://localhost:3000/auth/callback?code=bad&next=/editor"));
    expect(invalid.headers.get("location")).toBe("http://localhost:3000/login?next=%2Feditor&error=callback");
  });
  it("exchanges valid callback codes and preserves a local destination", async () => {
    configure();
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await callback(new NextRequest("http://localhost:3000/auth/callback?code=valid&next=/editor"));
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.headers.get("location")).toBe("http://localhost:3000/editor");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects cross-origin logout before touching the session", async () => {
    configure();
    const response = await logout(new NextRequest("http://localhost:3000/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("logs out same-origin POST requests and reports provider errors", async () => {
    configure();
    const request = () => new NextRequest("http://localhost:3000/auth/logout", { method: "POST", headers: { origin: "http://localhost:3000" } });
    mocks.signOut.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("unavailable") });
    expect((await logout(request())).status).toBe(303);
    expect((await logout(request())).status).toBe(503);
  });
});
