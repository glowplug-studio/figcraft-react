/** Decode bounded base64 data without a second whole-file binary string. */
export function fileData(data: unknown, limit: number): Uint8Array<ArrayBuffer> {
  if (typeof data !== "string") throw new Error("A base64 file is required");
  const start = data.indexOf(",") + 1;
  const encoded = data.slice(start).replace(/[ \t\r\n\f]/g, "");
  const padding = encoded.indexOf("=");
  if (padding >= 0 && padding < encoded.length - 2) throw new Error("Invalid base64 padding");
  const length = Math.floor((padding < 0 ? encoded.length : padding) * 3 / 4);
  if (length > limit) throw new Error("File exceeds the browser import limit");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < encoded.length; i += 65536) {
    const chunk = atob(encoded.slice(i, i + 65536));
    for (let j = 0; j < chunk.length; j++) bytes[offset++] = chunk.charCodeAt(j);
  }
  return bytes;
}
