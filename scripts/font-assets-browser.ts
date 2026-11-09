import { fontUrls } from "./font-urls";
export function readBundledFonts() {
  return Promise.all(fontUrls.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load bundled font (HTTP " + response.status + ")");
    return new Uint8Array(await response.arrayBuffer());
  }));
}
