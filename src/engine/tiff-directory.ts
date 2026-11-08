interface Field { type: number; count: number; at: number }

/** The first TIFF directory is the still image decoded by the native image reader. */
export function tiffDirectory(bytes: Uint8Array<ArrayBuffer>) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = data.getUint16(0) === 0x4949;
  if (!little && data.getUint16(0) !== 0x4d4d) throw new Error("Invalid TIFF byte order");
  const u16 = (at: number) => data.getUint16(at, little);
  const u32 = (at: number) => data.getUint32(at, little);
  const u64 = (at: number) => {
    const n = Number(data.getBigUint64(at, little));
    if (!Number.isSafeInteger(n)) throw new Error("TIFF offset exceeds the browser integer range");
    return n;
  };
  const version = u16(2), big = version === 43;
  if (version !== 42 && !big || big && (u16(4) !== 8 || u16(6) !== 0)) throw new Error("Unsupported TIFF directory");
  const start = big ? u64(8) : u32(4), entries = big ? u64(start) : u16(start);
  const first = start + (big ? 8 : 2), stride = big ? 20 : 12;
  if (entries > 65535 || entries > Math.floor((bytes.length-first)/stride)) throw new Error("Invalid TIFF directory length");
  const fields = new Map<number, Field>();
  for (let i = 0; i < entries; i++) {
    const at = first + i*stride;
    const tag = u16(at), type = u16(at+2);
    const count = big ? u64(at+4) : u32(at+4);
    const size = type === 1 || type === 7 ? 1 : type === 3 ? 2 : type === 4 ? 4 : type === 16 ? 8 : 0;
    if (!size) continue;
    const inline = at + (big ? 12 : 8);
    const offset = count <= (big ? 8 : 4)/size ? inline : big ? u64(inline) : u32(inline);
    if (offset > bytes.length || count > Math.floor((bytes.length-offset)/size)) throw new Error("Invalid TIFF field extent");
    if (fields.has(tag)) throw new Error("Repeated TIFF field");
    fields.set(tag, { type, count, at:offset });
  }
  function value(tag: number, index = 0, fallback?: number) {
    const field = fields.get(tag);
    if (!field && fallback !== undefined) return fallback;
    if (!field || index >= field.count) throw new Error(`Missing TIFF tag ${tag} or value`);
    if (field.type === 1) return bytes[field.at+index];
    if (field.type === 7) throw new Error("Expected a numeric TIFF field");
    if (field.type === 3) return u16(field.at+index*2);
    return field.type === 4 ? u32(field.at+index*4) : u64(field.at+index*8);
  }
  function byteField(tag: number) {
    const field = fields.get(tag);
    if (!field) return undefined;
    if (field.type !== 1 && field.type !== 7) throw new Error("Expected a TIFF byte field");
    return bytes.subarray(field.at, field.at + field.count);
  }
  return { value, byteField, fields, little };
}

export function tiffDimensions(bytes: Uint8Array<ArrayBuffer>) {
  const { value } = tiffDirectory(bytes);
  return { width:value(256), height:value(257) };
}
