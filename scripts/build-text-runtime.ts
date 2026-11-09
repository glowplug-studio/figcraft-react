import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

// Keep the upstream module-relative WASM URL intact for consuming bundlers.
// The Node export uses the original package, which owns its filesystem loader.
const output = new URL("../dist/",import.meta.url);
await mkdir(output,{recursive:true});
const bundle = await rolldown({
  input:fileURLToPath(new URL("../src/engine/harfbuzz-browser.ts",import.meta.url)),
  platform:"browser", transform:{define:{process:"undefined"}}, external:["module"],
});
try {
  await bundle.write({file:fileURLToPath(new URL("harfbuzz-browser.js",output)),format:"es",minify:true});
} finally {
  await bundle.close();
}
await copyFile(fileURLToPath(import.meta.resolve("harfbuzzjs/dist/harfbuzz.wasm")),new URL("harfbuzz.wasm",output));
