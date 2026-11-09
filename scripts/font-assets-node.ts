import { readFile } from "node:fs/promises";
import { fontUrls } from "./font-urls";
export const readBundledFonts = () => Promise.all(fontUrls.map(url => readFile(url)));
