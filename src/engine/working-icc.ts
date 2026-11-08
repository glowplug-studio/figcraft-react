/** ICC v4 Display P3 destination, built from D50-adapted primaries and the sRGB transfer curve. */
function field(signature: string, length: number) {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode(signature));
  return { bytes, view: new DataView(bytes.buffer) };
}
function numbers(signature: string, values: readonly number[], start = 8) {
  const { bytes, view } = field(signature, start + values.length * 4);
  values.forEach((value, index) => view.setInt32(start + index * 4, Math.round(value * 65536)));
  return bytes;
}
function description(text: string) {
  const { bytes, view } = field("mluc", 28 + text.length * 2);
  view.setUint32(8, 1);
  view.setUint32(12, 12);
  bytes.set(new TextEncoder().encode("enUS"), 16);
  view.setUint32(20, text.length * 2);
  view.setUint32(24, 28);
  for (let i = 0; i < text.length; i++) view.setUint16(28 + i * 2, text.charCodeAt(i));
  return bytes;
}

export function displayP3Icc(): Uint8Array<ArrayBuffer> {
  const white = [0.9642, 1, 0.8249];
  const curve = numbers("para", [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045], 12);
  new DataView(curve.buffer).setUint16(8, 3);
  const tags: [string, Uint8Array][] = [
    ["desc", description("Display P3")], ["cprt", description("No copyright, use freely")],
    ["wtpt", numbers("XYZ ", white)],
    ["chad", numbers("sf32", [1.0478860032, 0.0229187652, -0.0502160953, 0.0295817825, 0.9904835185, -0.0170787077, -0.0092518808, 0.0150726075, 0.7516781336])],
    ["rXYZ", numbers("XYZ ", [0.5151187009, 0.2411891678, -0.0010504527])],
    ["gXYZ", numbers("XYZ ", [0.2919778320, 0.6922440506, 0.0418791201])],
    ["bXYZ", numbers("XYZ ", [0.1571034670, 0.0665667815, 0.7840713326])],
    ["rTRC", curve], ["gTRC", curve], ["bTRC", curve],
  ];
  const tableEnd = 132 + tags.length * 12;
  const aligned = (length: number) => Math.ceil(length / 4) * 4;
  const size = tags.reduce((sum, [, data]) => sum + aligned(data.length), tableEnd);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  const write = (at: number, signature: string) => bytes.set(new TextEncoder().encode(signature), at);
  view.setUint32(0, size);
  view.setUint32(8, 0x04300000);
  write(12, "mntrRGB XYZ ");
  view.setUint16(24, 2026); view.setUint16(26, 1); view.setUint16(28, 1);
  write(36, "acsp");
  white.forEach((v, i) => view.setInt32(68 + i * 4, Math.round(v * 65536)));
  view.setUint32(128, tags.length);
  let offset = tableEnd;
  tags.forEach(([name, data], i) => {
    const record = 132 + i * 12;
    write(record, name);
    view.setUint32(record + 4, offset);
    view.setUint32(record + 8, data.length);
    bytes.set(data, offset);
    offset += aligned(data.length);
  });
  return bytes;
}
