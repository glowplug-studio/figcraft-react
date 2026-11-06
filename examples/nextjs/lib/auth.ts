/** Only local application destinations may survive an authentication redirect. */
export function safeDestination(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\u0000-\u0020]/.test(value)) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return "/";
    const url = new URL(value, "https://figcraft.invalid");
    if (url.origin !== "https://figcraft.invalid" || url.pathname === "/login" || url.pathname.startsWith("/auth/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function loginLocation(destination: unknown, error?: "credentials" | "callback" | "unavailable"): string {
  const query = new URLSearchParams({ next: safeDestination(destination) });
  if (error) query.set("error", error);
  return `/login?${query}`;
}

export function isSameOriginRequest(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
