import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@riff-refine/crit": fileURLToPath(
        new URL("./src/react/index.ts", import.meta.url)
      )
    }
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    testTimeout: 10_000
  }
})
