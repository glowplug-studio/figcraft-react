import { checkOperatorTransport } from "@glowplug-studio/figcraft-react";

/** Keep a reusable server key on the checked origin, including on redirects. */
export function postOperatorRequest(path: string, body: Record<string, unknown>, key?: string) {
  let target = path;
  if (key) {
    const destination = new URL(path, location.origin);
    if (destination.origin !== location.origin) throw new Error("Unexpected operator request origin");
    checkOperatorTransport(destination.origin, key);
    target = destination.href;
  }
  return fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: key ? "error" : "follow",
    body: JSON.stringify({ ...body, serverKey: key }),
  });
}
