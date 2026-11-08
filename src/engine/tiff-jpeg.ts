/** TIFF assigns the channel meaning. Discard JPEG application metadata (JFIF,
 * Adobe, EXIF and ICC) and explicitly request raw RGB for a three-channel strip. */
const rgbMarker = Uint8Array.of(255, 238, 0, 14, 65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 0);
const soi = Uint8Array.of(255, 216);

export function tiffJpegSource(strip: Uint8Array<ArrayBuffer>, tables: Uint8Array<ArrayBuffer> | undefined,
  width: number, height: number, channels: number): Blob {
  if (channels !== 1 && channels !== 3) throw new Error("Unsupported JPEG TIFF channel layout");
  const parts: BlobPart[] = channels === 3 ? [soi, rgbMarker] : [soi];
  function parse(input: Uint8Array<ArrayBuffer>, tableOnly: boolean) {
    if (input[0] !== 255 || input[1] !== 216) throw new Error("Missing JPEG SOI in TIFF");
    let framed = false, markers = 0;
    for (let at = 2; at < input.length;) {
      if (++markers > 65535 || input[at++] !== 255) break;
      while (input[at] === 255) at++;
      const marker = input[at++], start = at - 2;
      if (marker === 217 && tableOnly && at === input.length) return;
      const length = (input[at] << 8) | input[at + 1];
      if (length < 2 || length > input.length - at) break;
      if (marker === 192 || marker === 193 || marker === 194) {
        if (framed || tableOnly || length !== 8 + 3 * channels || input[at + 2] !== 8
          || (input[at+3] * 256 + input[at+4]) !== height || (input[at+5] * 256 + input[at+6]) !== width
          || input[at+7] !== channels) throw new Error("JPEG and TIFF segment dimensions or channels disagree");
        framed = true;
      } else if (marker === 218 && framed) {
        if (input.at(-2) !== 255 || input.at(-1) !== 217) break;
        parts.push(input.subarray(start));
        return;
      } else if (marker === 254 || marker >= 224 && marker <= 239) {
        at += length;
        continue;
      } else if (![196, 219, 221].includes(marker)) break;
      parts.push(input.subarray(start, at + length));
      at += length;
    }
    throw new Error("Invalid TIFF JPEG tables or strip");
  }
  if (tables) parse(tables, true);
  parse(strip, false);
  return new Blob(parts, { type: "image/jpeg" });
}

export async function decodeTiffJpeg(strip: Uint8Array<ArrayBuffer>, tables: Uint8Array<ArrayBuffer> | undefined,
  width: number, height: number, channels: number) {
  const jpeg = tiffJpegSource(strip, tables, width, height, channels);
  const bitmap = await createImageBitmap(jpeg, { imageOrientation: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(width, height);
  try {
    if (bitmap.width !== width || bitmap.height !== height) throw new Error("Invalid TIFF JPEG dimensions");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("TIFF JPEG readback unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const raw = new Uint8Array(width * height * channels);
    const rows = Math.max(1, Math.floor(262144 / width));
    for (let y = 0; y < height; y += rows) {
      const data = ctx.getImageData(0, y, width, Math.min(rows, height - y)).data;
      let out = y * width * channels;
      for (let i = 0; i < data.length; i += 4) {
        raw[out++] = data[i];
        if (channels === 3) { raw[out++] = data[i + 1]; raw[out++] = data[i + 2]; }
      }
      if (y + rows < height) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return raw;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
