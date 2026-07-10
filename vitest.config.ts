// @ts-nocheck
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/.stryker-tmp/**",
      "**/.pi-lens/**",
    ],
  },
});
