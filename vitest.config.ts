import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {"#figcraft-harfbuzz":fileURLToPath(new URL("./src/engine/harfbuzz/index.mjs",import.meta.url)),
      "#figcraft-word-segmenter":fileURLToPath(new URL("./src/engine/icu-node.ts",import.meta.url)),
      "#figcraft-icc-runtime": fileURLToPath(new URL("./src/engine/icc-node.ts",import.meta.url))},
    include: [
      "tests/{contracts,unit,integration,parity}/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
