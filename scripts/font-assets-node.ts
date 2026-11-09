import { readFile } from "node:fs/promises";
import { interBold, interItalic, interRegular, interSemiBold, notoGeorgian } from "./font-urls";

export const readBundledFonts = () => Promise.all([
  readFile(interRegular),
  readFile(interItalic),
  readFile(interSemiBold),
  readFile(interBold),
  readFile(notoGeorgian),
]);
