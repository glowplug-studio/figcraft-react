import {Decompress} from "fzstd";
import { readKiwiMessage, readKiwiSchema } from "./kiwi";

const maxSchema = 16 * 1024 ** 2;
const maxMessage = 512 * 1024 ** 2;
const zstdMagic = 0xfd2fb528;
const blockLimit = 128 * 1024;
const corrupt = (reason: string) => new Error("not a valid FigCraft file: .fig file: " + reason);

async function inflateDeflate(data: Uint8Array<ArrayBuffer>, format: CompressionFormat, limit: number) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("expanded data exceeds the chunk limit");
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return join(parts, length);
}

function join(parts: Uint8Array[], length: number) {
  if (parts.length === 1) return parts[0];
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Bound the decoder's history allocation before allocating it. The native reader consumes one frame. */
function zstdFrame(data: Uint8Array, limit: number) {
  if (data.length < 6) throw new Error("short frame");
  const flags = data[4], single = Boolean(flags & 32), descriptor = data[5];
  const windowBase = 2 ** (10 + (descriptor >> 3));
  const window = windowBase + windowBase / 8 * (descriptor & 7);
  const dictionaryWidth = [0, 1, 2, 4][flags & 3];
  const sizeWidth = [single ? 1 : 0, 2, 4, 8][flags >> 6];
  if (flags & 8) throw new Error("invalid frame header");
  let offset = (single ? 5 : 6) + dictionaryWidth;
  if (offset + sizeWidth > data.length) throw new Error("short frame header");
  let size = sizeWidth === 2 ? 256 : 0;
  for (let i = 0; i < sizeWidth; i++) size += data[offset++] * 2 ** (8 * i);
  if (size > limit || !single && window > limit) throw new Error("oversized frame");
  let upperBound = 0;
  for (;;) {
    if (offset + 3 > data.length) throw new Error("short block header");
    const header = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16;
    const type = (header >> 1) & 3, length = header >>> 3;
    if (type === 3 || length > blockLimit) throw new Error("invalid block header");
    upperBound += type === 2 ? blockLimit : length;
    offset += 3 + (type === 1 ? 1 : length);
    if (offset > data.length) throw new Error("truncated block");
    if (header & 1) break;
  }
  const end = offset + (flags & 4 ? 4 : 0);
  if (end > data.length || size > upperBound) throw new Error("truncated frame");
  let frame = data.subarray(0, end);
  // A streaming frame can request a much larger window than its blocks can ever fill.
  if (!single && window > Math.max(blockLimit, upperBound)) {
    const effective = Math.ceil(Math.log2(Math.max(blockLimit, upperBound)));
    frame = frame.slice();
    frame[5] = (effective - 10) * 8;
  }
  return {frame, size: sizeWidth ? size : undefined};
}

async function inflate(data: Uint8Array<ArrayBuffer>, limit: number) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 4 && view.getUint32(0, true) === zstdMagic) {
    try {
      const {frame, size} = zstdFrame(data, limit);
      const parts: Uint8Array[] = [];
      let length = 0;
      const decoder = new Decompress(part => {
        length += part.length;
        if (length > limit) throw new Error("expanded data exceeds the chunk limit");
        if (part.length) parts.push(part);
      });
      decoder.push(frame, true);
      if (size !== undefined && length !== size) throw new Error("frame length mismatch");
      return join(parts, length);
    } catch { throw new Error("damaged or oversized zstd chunk"); }
  }
  for (const format of ["deflate-raw", "deflate"] as const) {
    try { return await inflateDeflate(data, format, limit); } catch { /* Try the other native encoding. */ }
  }
  throw new Error("damaged or oversized deflate chunk");
}

export async function decodeFigCanvas(canvas: Uint8Array<ArrayBuffer>, packedSize: number) {
  if (canvas.length < 12 || new TextDecoder().decode(canvas.subarray(0, 4)) !== "fig-") throw corrupt("canvas.fig has no header");
  const view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 12; offset < canvas.length && chunks.length < 16;) {
    if (offset + 4 > canvas.length) throw corrupt("truncated chunk");
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > canvas.length - offset) throw corrupt("truncated chunk");
    chunks.push(canvas.subarray(offset, offset + length));
    offset += length;
  }
  if (chunks.length < 2) throw corrupt("canvas.fig needs a schema and a message chunk");
  try {
    const schema = readKiwiSchema(await inflate(chunks[0], maxSchema));
    const message = await inflate(chunks[1], maxMessage);
    return readKiwiMessage(schema, message, Math.min(32 * 1024 ** 2, Math.max(20000000, packedSize * 4)));
  } catch (error) {
    throw corrupt(error instanceof Error ? error.message : "invalid canvas");
  }
}
