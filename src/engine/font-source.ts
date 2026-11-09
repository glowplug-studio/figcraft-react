import { fileData } from "./file-bytes";
import { parseString } from "./parameters";
import type { LocalFontName } from "./font-library";

/** Read OpenType faces from a user file or bundled font. Load the shaper on first use. */
export async function readFontFaces(bytes: Uint8Array, local?:LocalFontName) {
  const { ShapingFace, prepareShapingFace } = await import("./shaping-face");
  await prepareShapingFace();
  return ShapingFace.read(bytes,local);
}

export const maxFontBytes=256*1024*1024;

export async function readFontInput(params:Record<string,unknown>) {
  const data=parseString(params.data);
  if (data===undefined) {
    if (!(params.path instanceof Blob)) throw new Error("Choose a font file or pass base64 data. Browser paths require a user-selected file");
    if (params.path.size>maxFontBytes) throw new Error("Font file exceeds the 256 MiB limit");
    return new Uint8Array(await params.path.arrayBuffer());
  }
  // The registry accepts padded standard base64 with zero trailing bits, including data URLs.
  const encoded=data.slice(data.indexOf(",")+1).trim();
  const firstPad=encoded.indexOf("=");
  const length=firstPad<0 ? encoded.length : firstPad;
  const padding=encoded.length-length;
  if (Math.floor(length*3/4)>maxFontBytes) throw new Error("Font file exceeds the 256 MiB limit");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (encoded.length%4 || padding>2 || /[^A-Za-z0-9+/]/.test(encoded.slice(0,length)) ||
      padding && (encoded.slice(length)!=="=".repeat(padding) ||
      (alphabet.indexOf(encoded[length-1]) & (padding===2 ? 15 : 3))!==0)) throw new Error("Invalid base64 font data");
  return fileData(encoded,maxFontBytes);
}
