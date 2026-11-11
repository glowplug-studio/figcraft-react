/** A reusable operator key may travel in the clear only to this machine. */
export function checkOperatorTransport(address: string, key?: string) {
  if (!key || /^\p{White_Space}*$/u.test(key)) return;
  let endpoint: URL;
  try {
    endpoint = new URL(address);
  } catch {
    throw new Error("Invalid operator endpoint");
  }
  if (endpoint.protocol === "https:" || endpoint.protocol === "wss:") return;
  const host = endpoint.hostname;
  const loopback = host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);
  if (loopback && (endpoint.protocol === "http:" || endpoint.protocol === "ws:")) return;
  throw new Error("The server key requires an encrypted connection or a server on this machine");
}
