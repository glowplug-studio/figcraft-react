/** TIFF 6.0 strips and tiles carry their own independent compressed streams. */
export async function decodeTiffSegment(input: Uint8Array<ArrayBuffer>, compression: number, length: number) {
  const damaged = () => new Error("Invalid TIFF strip or tile");
  if (compression === 1) {
    if (input.length < length) throw damaged();
    return input.subarray(0, length);
  }
  const result = new Uint8Array(length);
  let at = 0;
  if (compression === 8 || compression === 32946) {
    const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value.length > length-at) throw damaged();
        result.set(value, at); at += value.length;
      }
    } finally { await reader.cancel().catch(() => undefined); }
  } else if (compression === 32773) {
    let source = 0, nextYield = 262144;
    while (source < input.length && at < length) {
      if (source + at >= nextYield) {
        nextYield = source + at + 262144;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      const control = input[source++];
      if (control === 128) continue;
      const run = control < 128 ? control+1 : 257-control;
      if (run > length-at) throw damaged();
      if (control < 128) {
        if (source+run > input.length) throw damaged();
        result.set(input.subarray(source, source+run), at); source += run;
      } else {
        if (source >= input.length) throw damaged();
        result.fill(input[source++], at, at+run);
      }
      at += run;
    }
  } else if (compression === 5) {
    const prefixes = new Uint16Array(4096), suffixes = new Uint8Array(4096), reversed = new Uint8Array(4096);
    let ended = false, nextYield = 262144;
    let bit = 0, width = 9, next = 258, previous = -1;
    while (bit + width <= input.length * 8) {
      const offset = bit >>> 3;
      if (offset + at >= nextYield) {
        nextYield = offset + at + 262144;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      const packed = input[offset]<<16 | (input[offset+1] ?? 0)<<8 | (input[offset+2] ?? 0);
      const code = (packed >>> (24 - (bit % 8) - width)) & ((1 << width)-1);
      bit += width;
      if (code === 256) { width = 9; next = 258; previous = -1; continue; }
      if (code === 257) { ended = true; break; }
      if (code > next || (code >= 258 && previous < 0)) throw damaged();
      let index = code === next ? previous : code, depth = 0;
      while (index >= 258) {
        if (index >= next || depth >= reversed.length-1) throw damaged();
        reversed[depth++] = suffixes[index]; index = prefixes[index];
      }
      reversed[depth++] = index;
      if (at + depth + Number(code === next) > length) throw damaged();
      for (let i = depth-1; i >= 0; i--) result[at++] = reversed[i];
      if (code === next) result[at++] = index;
      if (previous >= 0 && next < 4096) {
        prefixes[next] = previous; suffixes[next++] = index;
        if (width < 12 && next === (1 << width)-1) width++;
      }
      previous = code;
    }
    if (!ended) throw damaged();
  } else throw new Error(`Unsupported TIFF compression ${compression}`);
  if (at !== length) throw damaged();
  return result;
}
