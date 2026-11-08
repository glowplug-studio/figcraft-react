/** TIFF assigns the channel meaning. Discard JPEG application metadata (JFIF,
 * Adobe, EXIF and ICC) and explicitly request raw RGB for a three-channel strip. */
const rgbMarker = Uint8Array.of(255, 238, 0, 14, 65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 0);
const soi = Uint8Array.of(255, 216);

/** Keep malformed table lengths inside their own marker before the codec reads them. */
function validTable(data: Uint8Array, marker: number, at: number, end: number) {
  if (marker === 221) return end - at === 2;
  if (at === end) return false;
  while (at < end) {
    const spec = data[at++], kind = spec >>> 4;
    if ((spec & 15) > 3 || kind > 1) return false;
    if (marker === 219) {
      at += 64 * (1 + kind);
    } else {
      if (end - at < 16) return false;
      let symbols = 0, slots = 1;
      for (let length = 1; length <= 16; length++) {
        const count = data[at++];
        slots = slots * 2 - count;
        if (slots < 1) return false; // JPEG reserves the all-ones code.
        symbols += count;
      }
      if (!symbols || symbols > 256) return false;
      at += symbols;
    }
  }
  return at === end;
}

export function tiffJpegSource(strip: Uint8Array<ArrayBuffer>, tables: Uint8Array<ArrayBuffer> | undefined,
  width: number, height: number, channels: number, workingBytes = 512 * 1024 * 1024): Blob {
  if (![1, 2, 3, 4].includes(channels)) throw new Error("Unsupported JPEG TIFF channel layout");
  const raw = channels === 2 || channels === 4;
  const parts: BlobPart[] = channels === 3 ? [soi, rgbMarker] : [soi];
  function parse(input: Uint8Array<ArrayBuffer>, tableOnly: boolean) {
    if (input[0] !== 255 || input[1] !== 216) throw new Error("Missing JPEG SOI in TIFF");
    const componentIds = new Set<number>();
    let framed = false, markers = 0, scans = 0;
    for (let at = 2; at < input.length;) {
      if (++markers > 65535 || input[at++] !== 255) break;
      while (input[at] === 255) at++;
      const marker = input[at++], start = at - 2;
      if (marker === 217 && at === input.length && (tableOnly || scans > 0)) {
        if (!tableOnly) parts.push(input.subarray(start,at));
        return;
      }
      const length = (input[at] << 8) | input[at + 1];
      if (length < 2 || length > input.length - at) break;
      if (marker === 192 || marker === 193 || marker === 194) {
        if (framed || tableOnly || length !== 8 + 3 * channels || input[at + 2] !== 8
          || (input[at+3] * 256 + input[at+4]) !== height || (input[at+5] * 256 + input[at+6]) !== width
          || input[at+7] !== channels) throw new Error("JPEG and TIFF segment dimensions or channels disagree");
        if (raw) {
          let maxH = 0, maxV = 0, blocks = 0;
          for (let i = 0; i < channels; i++) {
            const id = input[at + 8 + i * 3], factors = input[at + 9 + i * 3];
            const h = factors >>> 4, v = factors & 15;
            if (componentIds.has(id) || h < 1 || h > 4 || v < 1 || v > 4) throw Error("Invalid TIFF JPEG sampling");
            componentIds.add(id); maxH = Math.max(maxH, h); maxV = Math.max(maxV, v); blocks += h * v;
          }
          const blockCount = Math.ceil(width / (8 * maxH)) * Math.ceil(height / (8 * maxV)) * blocks;
          // Each DCT block has 64 int32 coefficients, decoded samples, row references and typed-array overhead.
          if (blockCount * 640 + width * height * channels + (strip.length + (tables?.length ?? 0)) * 2 > workingBytes) {
            throw Error("JPEG TIFF coefficient storage exceeds the browser working limit");
          }
        }
        framed = true;
      } else if (marker === 218 && framed) {
        const count = input[at + 2];
        if (++scans > 100 || count < 1 || count > channels || length !== 6 + 2 * count) break;
        if (!raw) {
          if (input.at(-2) !== 255 || input.at(-1) !== 217) break;
          parts.push(input.subarray(start));
          return;
        }
        const selected = new Set<number>();
        for (let i = 0; i < count; i++) {
          const id = input[at + 3 + 2 * i], selector = input[at + 4 + 2 * i];
          if (!componentIds.has(id) || selected.has(id) || (selector >>> 4) > 3 || (selector & 15) > 3) {
            throw Error("Invalid TIFF JPEG scan component");
          }
          selected.add(id);
        }
        const spectral = at + 3 + 2 * count, approximation = input[spectral + 2];
        if (input[spectral] > 63 || input[spectral + 1] > 63 || (approximation >>> 4) > 13 || (approximation & 15) > 13) {
          throw Error("Invalid TIFF JPEG scan parameters");
        }
        // Skip stuffed bytes and restart markers, then validate every subsequent scan and frame.
        let next = at + length;
        while (next + 1 < input.length) {
          if (input[next] !== 255) { next++; continue; }
          const tag = input[next + 1];
          if (tag === 255) { next++; continue; }
          if (tag !== 0 && (tag < 208 || tag > 215)) break;
          next += 2;
        }
        parts.push(input.subarray(start, next));
        at = next;
        continue;
      } else if (marker === 254 || marker >= 224 && marker <= 239) {
        at += length;
        continue;
      } else if (![196, 219, 221].includes(marker) || (raw && !validTable(input, marker, at + 2, at + length))) break;
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
  width: number, height: number, channels: number, workingBytes?: number) {
  const jpeg = tiffJpegSource(strip, tables, width, height, channels, workingBytes);
  if (channels === 2 || channels === 4) {
    if (width * height >= 131072 && typeof Worker !== "undefined") {
      const { decodeInWorker } = await import("./tiff-worker-client");
      return decodeInWorker(await jpeg.arrayBuffer(), width, height, channels);
    }
    const { decodeRawJpeg } = await import("./tiff-raw-jpeg");
    return decodeRawJpeg(await jpeg.arrayBuffer(), width, height, channels);
  }
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
