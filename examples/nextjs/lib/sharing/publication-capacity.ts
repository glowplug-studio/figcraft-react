import type { PublicationCapacity } from "@glowplug-studio/figcraft-react/backends/supabase/publication";
import { ingressAddress } from "./ingress-address";

export function publicationCapacity(headers: Headers, env: NodeJS.ProcessEnv): PublicationCapacity {
  const limits: PublicationCapacity = { address: ingressAddress(headers, env.VERCEL === "1") };
  function override(key: Exclude<keyof PublicationCapacity, "address">, name: string, bytes = false) {
    const raw = env[name];
    if (raw === undefined) return;
    const value = Number(raw) * (bytes ? 1024 * 1024 : 1);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || (!bytes && value > (key === "publishes_per_hour" ? 0xffffffff : 0x7fffffff))) {
      throw new Error("Invalid publication setting " + name);
    }
    limits[key] = value;
  }
  override("publishes_per_hour", "FIGCRAFT_PUBLISHES_PER_HOUR");
  override("max_files", "FIGCRAFT_MAX_FILES");
  override("max_files_per_ip", "FIGCRAFT_MAX_FILES_PER_IP");
  override("max_bytes_per_ip", "FIGCRAFT_MAX_MB_PER_IP", true);
  override("max_total_bytes", "FIGCRAFT_MAX_TOTAL_MB", true);
  return limits;
}
