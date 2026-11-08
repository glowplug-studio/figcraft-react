import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        "backends/supabase/index": resolve(
          import.meta.dirname,
          "src/backends/supabase/index.ts",
        ),
        "backends/memory/index": resolve(
          import.meta.dirname,
          "src/backends/memory/index.ts",
        ),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["paper/dist/paper-core.js", "@supabase/supabase-js", "react", "react-dom", "react/jsx-runtime"],
    },
  },
});
