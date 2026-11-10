import { isIP } from "node:net";

/** On other hosts all requests share a conservative bucket until a trusted ingress is configured. */
export function ingressAddress(headers: Headers, vercel: boolean) {
  const address = vercel && headers.get("x-vercel-forwarded-for");
  return address && isIP(address) ? address : "127.0.0.1";
}
