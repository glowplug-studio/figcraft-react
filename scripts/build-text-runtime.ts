import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

// Keep the upstream module-relative WASM URL intact for consuming bundlers.
// Both environments use the same fallback shaping configuration and Unicode tables.
const output = new URL("../dist/",import.meta.url);
const shaper = new URL("engine/harfbuzz/",output);
await mkdir(shaper,{recursive:true});
await cp(new URL("../src/engine/harfbuzz/",import.meta.url),shaper,{recursive:true});
const bundle = await rolldown({
  input:fileURLToPath(new URL("../src/engine/harfbuzz-browser.ts",import.meta.url)),
  platform:"browser", transform:{define:{process:"undefined"}}, external:["module"],
});
try {
  await bundle.write({file:fileURLToPath(new URL("browser.js",shaper)),format:"es",minify:true});
} finally {
  await bundle.close();
}

// Preserve the module-relative asset URL when another bundler consumes the browser export.
await cp(new URL("../src/engine/icu/",import.meta.url),new URL("icu/",output),{recursive:true});
for (const platform of ["browser","node"] as const) {
  const name="icu-"+platform;
  const module=await rolldown({input:fileURLToPath(new URL("../src/engine/"+name+".ts",import.meta.url)),platform});
  try { await module.write({file:fileURLToPath(new URL(name+".js",output)),format:"es"}); }
  finally { await module.close(); }
}
