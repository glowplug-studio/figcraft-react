import { jpegHeader } from "./jpeg-header";
import { getDecoder } from "geotiff";

/** Preserve TIFF's sample meanings, including alpha. Browser JPEG drawing returns display RGB. */
export async function decodeRawJpeg(data: ArrayBuffer, width: number, height: number, channels: number) {
  const decoder = await getDecoder(7, {
    tileWidth: width, tileHeight: height, bitsPerSample: 8, samplesPerPixel: channels,
    predictor: 1, planarConfiguration: 1,
  });
  const buffer = await decoder.decode(data);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== width * height * channels) throw Error("Incorrect TIFF JPEG component count");
  const pixels = new Uint8Array(buffer);
  const factors = jpegHeader(new Uint8Array(data))?.sampling;
  if (factors?.length !== channels) throw Error("Invalid raw JPEG frame");
  const maxH = Math.max(...factors.map(v => v >>> 4)), maxV = Math.max(...factors.map(v => v & 15));
  for (const [channel, factor] of factors.entries()) {
    const h = maxH / (factor >>> 4), v = maxV / (factor & 15);
    if ((h !== 1 && h !== 2) || (v !== 1 && v !== 2)) continue;
    // The upstream browser build selects the scalar kernel. Its vertical pass weights the
    // neighbouring row by three, whereas its horizontal pass weights the current column by three.
    if (v === 2) for (let x = 0; x < width; x++) interpolatePairs(pixels, x * channels + channel, width * channels, height, 1);
    if (h === 2) for (let y = 0; y < height; y++) interpolatePairs(pixels, y * width * channels + channel, channels, width, 3);
  }
  return pixels;
}

/** The raw decoder replicates the nearest sample across each pair. Replace those repeats in place. */
function interpolatePairs(bytes: Uint8Array, start: number, stride: number, count: number, currentWeight: 1 | 3) {
  const neighbourWeight = 4 - currentWeight;
  let previous = bytes[start];
  for (let i = 0; i < count; i += 2) {
    const at = start + i * stride, current = bytes[at];
    const next = i + 2 < count ? bytes[at + 2*stride] : current;
    bytes[at] = (currentWeight * current + neighbourWeight * previous + 2) >> 2;
    if (i + 1 < count) bytes[at + stride] = (currentWeight * current + neighbourWeight * next + 2) >> 2;
    previous = current;
  }
}
