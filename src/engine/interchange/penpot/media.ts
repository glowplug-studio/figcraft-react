import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { archivedImage, type ImageResource } from "../../image-resource";
import { object } from "../rest/values";
import { isUuid, PenpotArchive } from "./archive";

export class PenpotMedia {
  readonly resources: Record<string, ImageResource> = Object.create(null);
  private readonly resolved = new Map<string, string>();
  private remaining = 512 * 1024 ** 2;

  constructor(private readonly archive: PenpotArchive) {}

  async resolve(base: string, id: string) {
    const cached = this.resolved.get(id);
    if (cached) return cached;
    try {
      const meta = object(await this.archive.json(base + "/media/" + id + ".json"));
      if (!isUuid(meta.mediaId)) return;
      const ext = meta.mtype === "image/jpeg" ? "jpg" : meta.mtype === "image/webp" ? "webp" : meta.mtype === "image/png" ? "png" : "unknown";
      const bytes = await this.archive.image("objects/" + meta.mediaId + "." + ext);
      if (bytes.length > this.remaining) return;
      const {resource} = await archivedImage(new Blob([bytes]));
      if (!resource.width || !resource.height) return;
      this.remaining -= bytes.length;
      const digest = bytesToHex(sha256(bytes));
      this.resolved.set(id, digest);
      this.resources[digest] = Object.freeze({...resource, digest});
      return digest;
    } catch { this.archive.check(); }
  }
}
