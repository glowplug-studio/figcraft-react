import type { ColourProfile } from "./colour-spaces";
import { workingIcc } from "./working-icc";

const encode = (value: string) => new TextEncoder().encode(value);

export async function tagExportJpeg(blob: Blob, profile: ColourProfile) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  if (view.getUint16(0) !== 0xffd8) throw new Error("The browser did not encode JPEG");
  const icc = workingIcc(profile), signature = encode("ICC_PROFILE\0");
  const app2 = new Uint8Array(18 + icc.length);
  app2.set([0xff, 0xe2]); new DataView(app2.buffer).setUint16(2, app2.length - 2);
  app2.set(signature, 4); app2.set([1, 1], 16); app2.set(icc, 18);
  const parts: BlobPart[] = [bytes.subarray(0, 2), app2];
  for (let at = 2; at < bytes.length;) {
    if (bytes[at] !== 0xff || at + 2 > bytes.length) throw new Error("Invalid JPEG encoder output");
    const tag = bytes[at + 1];
    if (tag === 0xda || tag === 0xd9) {
      parts.push(bytes.subarray(at));
      return new Blob(parts, { type: "image/jpeg" });
    }
    const length = view.getUint16(at + 2), end = at + 2 + length;
    if (length < 2 || end > bytes.length) throw new Error("Incomplete JPEG marker");
    if (!(tag === 0xe2 && length >= 16 && signature.every((v, i) => bytes[at + 4 + i] === v))) parts.push(bytes.subarray(at, end));
    at = end;
  }
  throw new Error("Incomplete JPEG encoder output");
}

function webpChunk(name: string, data: Uint8Array) {
  const bytes = new Uint8Array(8 + data.length + data.length % 2);
  bytes.set(encode(name)); new DataView(bytes.buffer).setUint32(4, data.length, true);
  bytes.set(data, 8);
  return bytes;
}

export async function tagExportWebp(blob: Blob, profile: ColourProfile) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  if (bytes.length < 12 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) {
    throw new Error("The browser did not encode WebP");
  }
  for (let at = 12; at + 8 <= bytes.length;) {
    const length = view.getUint32(at + 4, true), end = at + 8 + length;
    if (end + length % 2 > bytes.length) throw new Error("Incomplete WebP chunk");
    if (view.getUint32(at) === 0x5650384c && length >= 5 && bytes[at + 8] === 0x2f) {
      const chunks = [];
      if (profile === "displayP3") {
        const bits = view.getUint32(at + 9, true), extended = new Uint8Array(10);
        extended[0] = 0x20 | (bits & 0x10000000 ? 0x10 : 0);
        const widthMinusOne = bits & 0x3fff, heightMinusOne = bits >>> 14 & 0x3fff;
        const header = new DataView(extended.buffer);
        header.setUint16(4, widthMinusOne, true); header.setUint16(7, heightMinusOne, true);
        chunks.push(webpChunk("VP8X", extended), webpChunk("ICCP", workingIcc(profile)));
      }
      chunks.push(bytes.subarray(at, end + length % 2));
      const riff = new Uint8Array(12); riff.set(encode("RIFF")); riff.set(encode("WEBP"), 8);
      new DataView(riff.buffer).setUint32(4, 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), true);
      return new Blob([riff, ...chunks], { type: "image/webp" });
    }
    at = end + length % 2;
  }
  throw new Error("This browser cannot encode lossless WebP");
}
