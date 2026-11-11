import type { OnlineFileRegistry, PendingOnlinePublication, RememberedOnlineFile } from "../../backends/online-files";

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

export function readRememberedFiles(stored: unknown, preserveAddress=false): RememberedOnlineFile[] {
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
    const original=(value as Partial<RememberedOnlineFile>).recordedAddress;
    const raw=typeof original==="string" && onlineServerKey(original)===key ? original : server!;
    const plain=raw.split("?",1)[0].trim();
    files.push({ server: key, ...(preserveAddress && plain!==key && {recordedAddress:plain}), file, name: Array.from(name.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "").replace(/\p{Cc}/gu, "")).slice(0, 256).join(""), created, opened });
    if (files.length === MAX_ONLINE_FILES) break;
  }
  return files;
}

/** Earlier versions stored the confirmed list directly at the same IndexedDB key. */
export function readOnlineRegistry(stored: unknown): OnlineFileRegistry {
  if (!stored || Array.isArray(stored) || typeof stored !== "object") {
    return { files: readRememberedFiles(stored,true), pending: [] };
  }
  const registry = stored as Partial<OnlineFileRegistry>;
  const files = readRememberedFiles(registry.files,true);
  const pending: PendingOnlinePublication[] = [];
  const seen = new Set(files.map(row => row.server + "?" + row.file));
  if (Array.isArray(registry.pending)) {
    for (const item of registry.pending.slice(0, MAX_ONLINE_FILES)) {
      if (!item || typeof item !== "object") continue;
      const { server, file, name, started, snapshot } = item as Partial<PendingOnlinePublication>;
      const key = typeof server === "string" && onlineServerKey(server);
      if (!key || typeof file !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(file)
        || typeof name !== "string" || typeof started !== "number" || !Number.isSafeInteger(started) || started < 0
        || !(snapshot instanceof Blob) || !snapshot.size) continue;
      const identity = key + "?" + file;
      if (seen.has(identity)) continue;
      seen.add(identity);
      pending.push({ server: key, file, name, started, snapshot, ...(item.requiresKey === true && {requiresKey:true}) });
    }
  }
  return { files, pending };
}
