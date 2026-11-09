/** Read OpenType faces from a user file or bundled font. Load the shaper on first use. */
export async function readFontFaces(bytes: Uint8Array) {
  const { ShapingFace } = await import("./shaping-face");
  return ShapingFace.read(bytes);
}
