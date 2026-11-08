/** Read the frame before the first scan. The native reader refuses progressive frames
 * with any component sampled more finely than their first, including differential frames. */
export function jpegHeader(data: Uint8Array) {
  if (data[0] !== 0xff || data[1] !== 0xd8) return;
  for (let at = 2; at < data.length;) {
    if (data[at++] !== 0xff) return;
    while (data[at] === 0xff) at++;
    const marker = data[at++];
    if (marker === 0xd9 || marker === 0xda) return;
    if (marker === 1 || marker >= 0xd0 && marker <= 0xd8) continue;
    const length = data[at]*256 + data[at+1];
    if (!(length >= 2 && length <= data.length-at)) return;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) {
      const components = data[at+7];
      if (!components || length !== 8 + 3*components) return;
      const sampling = Array.from({length: components}, (_, i) => data[at + 9 + 3*i]);
      const first = sampling[0];
      const unsupportedSampling = [0xc2,0xc6,0xca,0xce].includes(marker) &&
        sampling.some(sample => (sample >>> 4) > (first >>> 4) || (sample & 15) > (first & 15));
      return {width:data[at+5]*256+data[at+6], height:data[at+3]*256+data[at+4], sampling, unsupportedSampling};
    }
    at += length;
  }
}
