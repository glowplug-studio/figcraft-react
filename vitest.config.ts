import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/{contracts,unit,integration,parity}/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
