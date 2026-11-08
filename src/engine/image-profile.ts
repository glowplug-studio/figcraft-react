const srgbChromaticities = [.3127,.3290,.64,.33,.30,.60,.15,.06];

// Only the three short fixed-length metadata chunks use this checksum.
function validChunk(bytes: Uint8Array, at: number, size: number, view: DataView) {
  let crc = 0xffffffff;
  for (let i=at+4; i<at+8+size; i++) {
    crc ^= bytes[i];
    for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0) === view.getUint32(at+8+size);
}

/** A PNG with no usable ICC profile may describe its colour space before the first IDAT. */
export function pngProfileName(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let gamma: number | undefined, nearSrgb = true, srgb = false;
  for (let at=8; at+12<=bytes.length;) {
    const size = view.getUint32(at), tag = view.getUint32(at+4), data = at+8;
    if (size > bytes.length-at-12) return;
    if (tag === 0x49444154 || tag === 0x49454e44) break; // IDAT, IEND
    if (tag === 0x69434350) return; // iCCP takes precedence over suggested PNG primaries.
    if (tag === 0x73524742 && size === 1 && bytes[data] <= 3 && validChunk(bytes,at,size,view)) srgb = true;
    if (tag === 0x67414d41 && size === 4 && validChunk(bytes,at,size,view)) gamma = view.getUint32(data)/100000;
    if (tag === 0x6348524d && size === 32 && validChunk(bytes,at,size,view)) {
      let valid = true, near = true;
      for (let i=0; i<8; i+=2) {
        const x=view.getUint32(data+4*i)/100000, y=view.getUint32(data+4*i+4)/100000;
        valid &&= y > .001 && x+y <= 1;
        near &&= Math.abs(x-srgbChromaticities[i]) < .01 && Math.abs(y-srgbChromaticities[i+1]) < .01;
      }
      nearSrgb = !valid || near;
    }
    at += size+12;
  }
  if (srgb) return "sRGB";
  if (gamma === undefined || gamma < .1 || gamma > 10) return;
  return nearSrgb && Math.abs(gamma*2.2-1) < .01 ? "sRGB" : "Gamma "+(1/gamma).toFixed(2);
}
