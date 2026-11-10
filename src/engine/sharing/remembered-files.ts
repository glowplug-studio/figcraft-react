import type { RememberedOnlineFile } from "../../backends/online-files";

export const MAX_ONLINE_FILES = 200;

/** Strip query credentials. Preserve the route's case on a multi-tenant server. */
export function onlineServerKey(server: string): string {
  const address = server.split("?", 1)[0].trim();
  if (address.length > 512 || /[\p{White_Space}\p{Cc}#]/u.test(address)) return "";
  try {
    const url = new URL(address);
    if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol) || url.username || url.password) return "";
    return url.protocol + "//" + url.host + url.pathname.replace(/\/+$/, "");
  } catch { return ""; }
}

export function readRememberedFiles(stored: unknown): RememberedOnlineFile[] {
  const files: RememberedOnlineFile[] = [];
  if (!Array.isArray(stored)) return files;
  const seen = new Set<string>();
  for (const value of stored.slice(0, MAX_ONLINE_FILES * 4)) {
    if (!value || typeof value !== "object") continue;
    const { server, file, name, created, opened } = value as Partial<RememberedOnlineFile>;
    const key = typeof server === "string" && onlineServerKey(server);
    if (!key || typeof file !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(file) || typeof name !== "string"
        || typeof created !== "number" || !Number.isSafeInteger(created) || created < 0
        || typeof opened !== "number" || !Number.isSafeInteger(opened) || opened < 0) continue;
    const identity = key + "?" + file;
    if (seen.has(identity)) continue;
    seen.add(identity);
    files.push({ server: key, file, name: Array.from(name.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "").replace(/\p{Cc}/gu, "")).slice(0, 256).join(""), created, opened });
    if (files.length === MAX_ONLINE_FILES) break;
  }
  return files;
}
