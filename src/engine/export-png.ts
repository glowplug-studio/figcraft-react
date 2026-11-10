import { zlibSync } from "fflate";
import type { ColourProfile } from "./colour-spaces";
import { pngChunkCrc } from "./image-profile";
import { displayP3Icc } from "./working-icc";

function chunk(type: string, payload: Uint8Array) {
  const out = new Uint8Array(payload.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  view.setUint32(out.length - 4, pngChunkCrc(out, 4, out.length - 4));
  return out;
}

/** Preserve the browser's compressed pixels and replace its colour metadata with the export profile. */
export async function tagExportPng(blob: Blob, profile: ColourProfile) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) throw new Error("Invalid PNG encoder output");
  const parts: BlobPart[] = [bytes.subarray(0, 8)];
  for (let start = 8; start < bytes.length;) {
    const length = view.getUint32(start), end = start + 12 + length;
    if (end > bytes.length) throw new Error("Incomplete PNG encoder output");
    const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
    if (!["cHRM", "gAMA", "sRGB", "iCCP", "cICP"].includes(type)) parts.push(bytes.subarray(start, end));
    if (type === "IHDR") {
      if (profile === "srgb") parts.push(chunk("sRGB", Uint8Array.of(0)));
      else {
        const name = new TextEncoder().encode("Display P3"), compressed = zlibSync(displayP3Icc());
        const payload = new Uint8Array(name.length + 2 + compressed.length);
        payload.set(name); payload.set(compressed, name.length + 2);
        parts.push(chunk("iCCP", payload), chunk("cICP", Uint8Array.of(12, 13, 0, 1)));
      }
    }
    start = end;
  }
  return new Blob(parts, { type: "image/png" });
}
