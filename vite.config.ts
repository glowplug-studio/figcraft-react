import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        "sharing/invite": resolve(import.meta.dirname, "src/engine/sharing/invite.ts"),
        "sharing/join-code": resolve(import.meta.dirname, "src/engine/sharing/join-code.ts"),
        "icc-node": resolve(import.meta.dirname, "src/engine/icc-node.ts"),
        "icc-browser": resolve(import.meta.dirname, "src/engine/icc-browser.ts"),
        "backends/supabase/live-session": resolve(import.meta.dirname, "src/backends/supabase/live-session.ts"),
        "backends/supabase/team-library": resolve(import.meta.dirname, "src/backends/supabase/team-library.ts"),
        "backends/supabase/publication": resolve(import.meta.dirname, "src/backends/supabase/publication.ts"),
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
      external: ["#figcraft-font-assets", "#figcraft-word-segmenter", "#figcraft-harfbuzz", "#figcraft-icc-runtime", "paper/dist/paper-core.js", "@supabase/supabase-js", "react", "react-dom", "react/jsx-runtime"],
    },
  },
});
